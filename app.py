"""node/app.py — เครื่องลูกค้า (node) แบบบาง

หน้าที่:
- เก็บการตั้งค่า (provider / key / โมเดล ของ LLM, embedding, rerank, Qdrant, central) ใน SQLite —
  key เข้ารหัสด้วย Fernet, แก้จากหน้า Settings แล้วมีผลทันทีโดยไม่ต้องรีสตาร์ต
- เก็บสถานะ (KB, ชุดสูตร, บอท, cache, export, usage) ใน SQLite ไฟล์เดียว (data/node.db)
- ส่งงานทั้งหมดให้ central ประมวลผล (central ไม่เก็บอะไรของลูกค้า)
- เสิร์ฟหน้าเว็บ (frontend/out — Next.js static export): หน้าแชทที่ / และหลังบ้านที่ /admin

.env ใช้แค่ค่าตอนติดตั้ง: ค่าเริ่มต้นของ Settings ครั้งแรก, NODE_PASSWORD, NODE_SECRET_KEY (ไม่บังคับ)
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("NODE_DATA_DIR") or ROOT / "data")
DB_FILE = DATA_DIR / "node.db"
LEGACY_STATE_FILE = DATA_DIR / "state.json"
SECRET_KEY_FILE = DATA_DIR / "secret.key"
ORIGINALS_DIR = DATA_DIR / "originals"
EXPORTS_DIR = DATA_DIR / "exports"
FRONTEND_DIR = Path(os.environ.get("NODE_FRONTEND_DIR") or ROOT / "frontend" / "out")

NODE_USER = os.environ.get("NODE_USER", "admin")
NODE_PASSWORD = os.environ.get("NODE_PASSWORD", "")

KB_ALLOWED = [".pdf", ".txt", ".docx", ".csv", ".xlsx"]
QUICK_CHAT_MAX_TAGS = 5
QUICK_CHAT_MAX_TAG_LENGTH = 100

# ค่าเดียวกับ bot_store.py เดิม — ใช้เมื่อสร้างบอทโดยไม่ระบุ system prompt
DEFAULT_SYSTEM_PROMPT = (
    "คุณคือ AI Assistant ที่ตอบคำถามโดยอ้างอิงข้อมูลจาก Context ที่ให้มาเท่านั้น "
    "ห้ามแต่งข้อมูลที่ไม่มีใน Context หากไม่มีข้อมูลให้ตอบว่า \"ไม่พบข้อมูลใน Knowledge Base\" "
    "พร้อมระบุว่ากำลังหาอะไรอยู่ ตอบเป็นภาษาเดียวกับคำถามของผู้ใช้"
)

TIMEOUT = httpx.Timeout(connect=15, read=900, write=120, pool=15)

app = FastAPI(title="RAG Node", docs_url=None, redoc_url=None, openapi_url=None)


# ══════════════════════════════════════════════
# Basic Auth (เปิดเมื่อตั้ง NODE_PASSWORD เท่านั้น — ระบบ login จริงมาในขั้นถัดไป)
# ══════════════════════════════════════════════

@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if NODE_PASSWORD and request.url.path != "/healthz":
        ok = False
        header = request.headers.get("authorization", "")
        if header.lower().startswith("basic "):
            try:
                user, _, pw = base64.b64decode(header[6:]).decode().partition(":")
                ok = secrets.compare_digest(user, NODE_USER) and secrets.compare_digest(pw, NODE_PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response("ต้องเข้าสู่ระบบ", status_code=401, headers={"WWW-Authenticate": "Basic"})
    return await call_next(request)


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    """ห้ามเบราว์เซอร์จำหน้า HTML/API — ไม่งั้นหลังอัปเดตเวอร์ชันจะยังเห็นหน้าเก่าจนกว่าจะกด Ctrl+F5
    (ไฟล์ใน /_next/static มีชื่อเปลี่ยนทุก build อยู่แล้ว จึง cache ได้ตามปกติ)"""
    static_asset = request.url.path.startswith("/_next/static/")
    if not static_asset:
        # ตัด header ขอ 304 ทิ้ง — StaticFiles ตัดสิน "ไม่เปลี่ยน" จากเวลาไฟล์ ซึ่งผิดได้กับไฟล์ที่ build ใน
        # Docker (เคยเจอ: เบราว์เซอร์ได้ 304 แล้วแสดงหน้า /chat/ รุ่นเก่าค้าง แม้กดรีเฟรช)
        request.scope["headers"] = [
            (k, v) for k, v in request.scope["headers"] if k not in (b"if-none-match", b"if-modified-since")
        ]
    response = await call_next(request)
    if not static_asset:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# ══════════════════════════════════════════════
# SQLite — เก็บแต่ละรายการเป็น JSON ต่อแถว (ตารางละประเภท)
# ══════════════════════════════════════════════

_TABLES = ("kbs", "skills", "bots", "caches", "exports", "sources")
_db_lock = threading.RLock()


@contextmanager
def _db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=15)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _db_lock, _db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        for t in _TABLES:
            c.execute(f"CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)")


def db_all(table: str) -> list[dict]:
    with _db() as c:
        return [json.loads(r[0]) for r in c.execute(f"SELECT data FROM {table} ORDER BY rowid")]


def db_get(table: str, item_id: str) -> dict | None:
    with _db() as c:
        row = c.execute(f"SELECT data FROM {table} WHERE id=?", (item_id,)).fetchone()
    return json.loads(row[0]) if row else None


def db_put(table: str, item_id: str, obj: dict) -> None:
    with _db_lock, _db() as c:
        c.execute(
            f"INSERT INTO {table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (item_id, json.dumps(obj, ensure_ascii=False)),
        )


def db_delete(table: str, item_id: str) -> None:
    with _db_lock, _db() as c:
        c.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))


_USAGE_ZERO = {"llm_input_tokens": 0, "llm_output_tokens": 0, "llm_calls": 0,
               "embed_tokens": 0, "embed_calls": 0, "rerank_calls": 0, "stt_calls": 0, "stt_seconds": 0.0,
               "requests": 0}


def get_usage() -> dict:
    with _db() as c:
        row = c.execute("SELECT data FROM usage WHERE id=1").fetchone()
    return {**_USAGE_ZERO, **(json.loads(row[0]) if row else {})}


def add_usage(usage: dict | None) -> None:
    if not usage:
        return
    with _db_lock:
        u = get_usage()
        llm, emb, rr = usage.get("llm") or {}, usage.get("embedding") or {}, usage.get("rerank") or {}
        u["llm_input_tokens"] += int(llm.get("input_tokens") or 0)
        u["llm_output_tokens"] += int(llm.get("output_tokens") or 0)
        u["llm_calls"] += int(llm.get("calls") or 0)
        u["embed_tokens"] += int(emb.get("tokens") or 0)
        u["embed_calls"] += int(emb.get("calls") or 0)
        u["rerank_calls"] += int(rr.get("calls") or 0)
        stt = usage.get("stt") or {}
        u["stt_calls"] += int(stt.get("calls") or 0)
        u["stt_seconds"] = round(u["stt_seconds"] + float(stt.get("audio_seconds") or 0), 2)
        u["requests"] += 1
        with _db() as c:
            c.execute("INSERT INTO usage (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                      (json.dumps(u),))


def migrate_legacy_state() -> None:
    """ย้ายข้อมูลจาก state.json (รุ่นก่อน) เข้า SQLite ครั้งเดียว แล้วเปลี่ยนชื่อไฟล์เดิมเก็บไว้"""
    if not LEGACY_STATE_FILE.exists() or db_all("kbs") or db_all("bots"):
        return
    state = json.loads(LEGACY_STATE_FILE.read_text(encoding="utf-8"))
    for table in _TABLES:
        for item_id, obj in (state.get(table) or {}).items():
            db_put(table, item_id, obj)
    if state.get("usage"):
        with _db() as c:
            c.execute("INSERT OR REPLACE INTO usage (id, data) VALUES (1, ?)", (json.dumps(state["usage"]),))
    LEGACY_STATE_FILE.rename(LEGACY_STATE_FILE.with_suffix(".json.migrated"))


# ══════════════════════════════════════════════
# Settings — การเชื่อมต่อ + คลังโมเดล (key เข้ารหัส, แก้จากหน้าเว็บ, มีผลทันที)
# ══════════════════════════════════════════════
#
# providers  = การเชื่อมต่อที่ผู้ใช้เพิ่มเอง {id: {name, type, base_url, api_key}}
# registry   = คลังโมเดล {id: {name, kind (llm|embedding|rerank|stt), provider, model, dim?}} — เพิ่มได้หลายตัวต่อประเภท
# defaults   = ค่าเริ่มต้นต่อประเภท {llm: id, embedding: id, rerank: id, stt: id}
# stt (ถอดเสียง) ไม่บังคับ — ถ้าไม่มี ใช้ LLM ของบอทถอดแทนได้เมื่อเป็น Gemini
# การเลือกใช้จริงอยู่ที่งาน: KB เลือก embedding ตอนสร้าง (ผูกถาวร), บอทเลือก LLM/rerank (ว่าง = ค่าเริ่มต้น)

SECTIONS = ("providers", "registry", "defaults", "vector", "central")
LEGACY_SECTIONS = ("llm", "embedding", "rerank", "models")
KINDS = ("llm", "embedding", "rerank", "stt")
LEGACY_KINDS = ("llm", "embedding", "rerank")  # การตั้งค่ารุ่นแรก (ยังไม่มี stt)
KIND_LABEL = {"llm": "LLM", "embedding": "Embedding", "rerank": "Rerank", "stt": "Speech-to-Text"}
SECRET_FIELDS = {"api_key", "license_key"}
_settings_cache: dict | None = None

# รูปแบบ API ที่ระบบคุยได้ (ระบบเดาจาก URL ให้เอง) — ผู้ให้บริการแทบทุกเจ้าใช้แบบ OpenAI ได้
PROTOCOLS: dict[str, dict] = {
    "openai_compatible": {"label": "OpenAI-compatible API"},
    "google": {"label": "Google Gemini API"},
    "ollama": {"label": "Ollama"},
}

# สำหรับแปลงการตั้งค่ารุ่นแรก ๆ ที่ผูก id ตายตัว
_LEGACY_PROVIDERS = {
    "google": ("Google Gemini", "google", ""),
    "openai": ("OpenAI", "openai_compatible", "https://api.openai.com/v1"),
    "siliconflow": ("SiliconFlow", "openai_compatible", "https://api.siliconflow.com/v1"),
    "ollama": ("Ollama", "ollama", ""),
    "custom": ("OpenAI-compatible", "openai_compatible", ""),
}


def _fernet() -> Fernet:
    key = os.environ.get("NODE_SECRET_KEY", "").strip()
    if not key:
        if not SECRET_KEY_FILE.exists():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            SECRET_KEY_FILE.write_bytes(Fernet.generate_key())
            try:
                os.chmod(SECRET_KEY_FILE, 0o600)
            except OSError:
                pass
        key = SECRET_KEY_FILE.read_text().strip()
    return Fernet(key.encode())


def _enc(value: str) -> str:
    return "enc:" + _fernet().encrypt(value.encode()).decode() if value else ""


def _dec(value: str) -> str:
    if not value or not value.startswith("enc:"):
        return value or ""
    try:
        return _fernet().decrypt(value[4:].encode()).decode()
    except InvalidToken:
        return ""


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# ── แปลงการตั้งค่ารุ่นก่อน ────────────────────────────

def _provider_id_for(cfg: dict) -> str:
    provider = (cfg.get("provider") or "").lower()
    base = (cfg.get("base_url") or "").lower()
    if provider in ("google", "ollama"):
        return provider
    if "siliconflow" in base:
        return "siliconflow"
    if "api.openai.com" in base:
        return "openai"
    return "custom"


def _from_role_schema(old: dict) -> dict:
    """รุ่นแรก (llm/embedding/rerank แยกกันพร้อม key ในตัว) → providers + models (รุ่นที่สอง)"""
    providers = {pid: {"api_key": "", "base_url": ""} for pid in _LEGACY_PROVIDERS}
    models: dict = {}
    for role in LEGACY_KINDS:
        cfg = old.get(role) or {}
        pid = _provider_id_for(cfg) if (cfg.get("base_url") or role != "rerank") else "siliconflow"
        if role == "rerank" and pid not in ("siliconflow", "custom"):
            pid = "custom"
        if cfg.get("api_key"):
            providers[pid]["api_key"] = cfg["api_key"]
        if pid in ("ollama", "custom") and cfg.get("base_url"):
            providers[pid]["base_url"] = cfg["base_url"]
        models[role] = {"provider": pid, "model": cfg.get("model", "")}
    models["embedding"]["dim"] = int((old.get("embedding") or {}).get("dim") or 0)
    return {"providers": providers, "models": models,
            "vector": old.get("vector") or {"url": "", "api_key": ""},
            "central": old.get("central") or {"url": "", "license_key": ""}}


def _upgrade_providers(providers: dict, used: set) -> dict:
    """providers รุ่นที่ผูก id ตายตัว (ไม่มี type) → การเชื่อมต่อแบบ dynamic — คง id เดิมไว้"""
    out = {}
    for pid, prov in providers.items():
        if "type" in prov:
            out[pid] = prov
            continue
        name, typ, base = _LEGACY_PROVIDERS.get(pid, (pid, "openai_compatible", ""))
        if not (prov.get("api_key") or prov.get("base_url")) and pid not in used:
            continue
        out[pid] = {"name": name, "type": typ, "base_url": prov.get("base_url") or base, "api_key": prov.get("api_key", "")}
    return out


def _models_to_registry(models: dict) -> tuple[dict, dict]:
    """models รุ่นที่สอง (1 ตัวต่อหน้าที่) → คลังโมเดล + ค่าเริ่มต้น"""
    registry: dict = {}
    defaults: dict = {k: None for k in KINDS}
    for kind in KINDS:
        m = models.get(kind) or {}
        if not m.get("model"):
            continue
        mid = f"m_{_new_id()[:8]}"
        entry = {"name": m["model"], "kind": kind, "provider": m.get("provider", ""), "model": m["model"]}
        if kind == "embedding":
            entry["dim"] = int(m.get("dim") or 0)
        registry[mid] = entry
        defaults[kind] = mid
    return registry, defaults


def _to_current(old_rows: dict) -> dict:
    """รับการตั้งค่ารุ่นใดก็ได้ (ถอดรหัสแล้ว) → รูปแบบปัจจุบัน"""
    if "llm" in old_rows:
        old_rows = _from_role_schema(old_rows)
    if "models" in old_rows and "registry" not in old_rows:
        registry, defaults = _models_to_registry(old_rows["models"])
    else:
        registry, defaults = old_rows.get("registry", {}), old_rows.get("defaults", {})
    used = {e.get("provider") for e in registry.values()}
    return {
        "providers": _upgrade_providers(old_rows.get("providers", {}), used),
        "registry": registry,
        "defaults": {k: defaults.get(k) for k in KINDS},
        "vector": old_rows.get("vector") or {"url": "", "api_key": ""},
        "central": old_rows.get("central") or {"url": "", "license_key": ""},
    }


def _defaults_from_env() -> dict:
    """ค่าเริ่มต้นครั้งแรกจาก .env — node ที่ติดตั้งไว้แล้วจึงย้ายมาใช้หน้าตั้งค่าได้โดยไม่ต้องกรอกใหม่"""
    return _to_current({
        "llm": {"provider": _env("LLM_PROVIDER", "google"), "model": _env("LLM_MODEL", "gemini-2.5-flash"),
                "api_key": _env("LLM_API_KEY"), "base_url": _env("LLM_BASE_URL")},
        "embedding": {"provider": _env("EMBED_PROVIDER", "openai_compatible"),
                      "model": _env("EMBED_MODEL", "Qwen/Qwen3-Embedding-4B"),
                      "api_key": _env("EMBED_API_KEY"), "base_url": _env("EMBED_BASE_URL", "https://api.siliconflow.com/v1"),
                      "dim": int(_env("EMBED_DIM", "2560") or 0)},
        "rerank": {"api_key": _env("RERANK_API_KEY"),
                   "model": _env("RERANK_MODEL", "Qwen/Qwen3-Reranker-0.6B") if _env("RERANK_API_KEY") else "",
                   "base_url": _env("RERANK_BASE_URL", "https://api.siliconflow.com/v1")},
        "vector": {"url": _env("QDRANT_URL"), "api_key": _env("QDRANT_API_KEY")},
        "central": {"url": _env("CENTRAL_URL", "http://127.0.0.1:9000"), "license_key": _env("LICENSE_KEY")},
    })


# ── อ่าน/เขียน ───────────────────────────────────────

def _secret_map(section: str, values: dict, fn) -> dict:
    if section == "providers":
        return {pid: {k: (fn(v) if k in SECRET_FIELDS else v) for k, v in prov.items()} for pid, prov in values.items()}
    if section in ("registry", "defaults", "models"):
        return values
    return {k: (fn(v) if k in SECRET_FIELDS else v) for k, v in values.items()}


def _write_settings(settings: dict) -> None:
    global _settings_cache
    with _db_lock, _db() as c:
        for section in SECTIONS:
            c.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (section, json.dumps(_secret_map(section, settings[section], _enc), ensure_ascii=False)))
        c.execute(f"DELETE FROM settings WHERE key IN ({','.join('?' * len(LEGACY_SECTIONS))})", LEGACY_SECTIONS)
    _settings_cache = None


def load_settings() -> dict:
    """การตั้งค่าแบบถอดรหัสแล้ว (ใช้ภายใน node เท่านั้น ห้ามส่ง key ออกไปหน้าเว็บ)"""
    global _settings_cache
    if _settings_cache is not None:
        return _settings_cache
    with _db() as c:
        rows = dict(c.execute("SELECT key, value FROM settings").fetchall())
    if not rows:
        _write_settings(_defaults_from_env())
        return load_settings()
    decoded = {k: _secret_map(k, json.loads(v), _dec) for k, v in rows.items()}
    if any(k in decoded for k in LEGACY_SECTIONS) or "registry" not in decoded:
        _write_settings(_to_current(decoded))
        return load_settings()
    settings = {s: decoded.get(s, {}) for s in SECTIONS}
    settings["defaults"] = {k: settings["defaults"].get(k) for k in KINDS}
    for section, secret in (("vector", "api_key"), ("central", "license_key")):
        settings[section].setdefault("url", "")
        settings[section].setdefault(secret, "")
    _settings_cache = settings
    return settings


def ensure_kb_embeddings() -> None:
    """KB รุ่นก่อนเก็บแค่ชื่อโมเดล embedding — ผูกเข้ากับรายการในคลังโมเดล (สร้างให้ถ้ายังไม่มี)"""
    s = load_settings()
    registry = dict(s["registry"])
    changed = False
    for kb in db_all("kbs"):
        emb = kb.get("embedding") or {}
        if emb.get("model_id") in registry:
            continue
        mid = next((i for i, e in registry.items() if e["kind"] == "embedding"
                    and e["model"] == emb.get("model") and int(e.get("dim") or 0) == int(emb.get("dim") or 0)), None)
        if not mid:
            default_emb = registry.get(s["defaults"].get("embedding") or "") or {}
            provider = emb.get("provider") if emb.get("provider") in s["providers"] else default_emb.get("provider", "")
            mid = f"m_{_new_id()[:8]}"
            registry[mid] = {"name": emb.get("model") or mid, "kind": "embedding", "provider": provider,
                             "model": emb.get("model", ""), "dim": int(emb.get("dim") or 0)}
            changed = True
        kb["embedding"] = {"model_id": mid, "model": registry[mid]["model"], "dim": int(registry[mid].get("dim") or 0)}
        db_put("kbs", kb["id"], kb)
    if changed:
        _write_settings({**s, "registry": registry})


# ── ส่งออกให้หน้าเว็บ (ไม่มี key) ─────────────────────

def _mask(value: str) -> dict:
    return {"set": bool(value), "hint": f"••••{value[-4:]}" if len(value) >= 8 else ("••••" if value else "")}


def provider_configured(prov: dict) -> bool:
    return bool(prov.get("api_key")) if prov.get("type") == "google" else bool(prov.get("base_url"))


def public_provider(pid: str, prov: dict) -> dict:
    return {"id": pid, "name": prov.get("name") or pid, "type": prov.get("type"), "base_url": prov.get("base_url", ""),
            "api_key": _mask(prov.get("api_key", "")), "configured": provider_configured(prov)}


def _model_usage() -> dict[str, dict[str, list[str]]]:
    usage: dict[str, dict[str, list[str]]] = {}
    for kb in db_all("kbs"):
        mid = (kb.get("embedding") or {}).get("model_id")
        if mid:
            usage.setdefault(mid, {"kbs": [], "bots": []})["kbs"].append(kb["name"])
    for bot in db_all("bots"):
        for field in ("llm_model_id", "rerank_model_id"):
            if bot.get(field):
                usage.setdefault(bot[field], {"kbs": [], "bots": []})["bots"].append(bot["name"])
    return usage


def public_settings(settings: dict) -> dict:
    usage = _model_usage()
    providers = settings["providers"]
    return {
        "providers": [public_provider(pid, prov) for pid, prov in providers.items()],
        "models": [{"id": mid, **e, "provider_name": (providers.get(e.get("provider")) or {}).get("name", "—"),
                    "is_default": settings["defaults"].get(e["kind"]) == mid,
                    "used_by": usage.get(mid, {"kbs": [], "bots": []})}
                   for mid, e in settings["registry"].items()],
        "defaults": settings["defaults"],
        "vector": {"url": settings["vector"].get("url", ""), "api_key": _mask(settings["vector"].get("api_key", ""))},
        "central": {"url": settings["central"].get("url", ""), "license_key": _mask(settings["central"].get("license_key", ""))},
    }


def _apply_secret(target: dict, key: str, value) -> None:
    """ช่อง key: ไม่ส่ง/ส่งว่าง = ใช้ค่าเดิม, ส่ง null = ลบ"""
    if value is None:
        target[key] = ""
    elif isinstance(value, str) and value.strip():
        target[key] = value.strip()


# ── แปลงเป็น credentials ที่ central รับ ──────────────

def _endpoint(prov: dict) -> tuple[str, str | None, str]:
    """(provider ที่ central รู้จัก, base_url, api_key) — ollama ใช้ endpoint แบบ OpenAI ที่ /v1
    (แปลงที่ node เพื่อให้ใช้ได้แม้ central ยังเป็นรุ่นที่ไม่รู้จัก ollama)"""
    key = prov.get("api_key", "")
    typ = prov.get("type")
    if typ == "google":
        return "google", None, key
    base = (prov.get("base_url") or "").strip().rstrip("/")
    if typ == "ollama":
        base = base or "http://localhost:11434"
        return "openai_compatible", base if base.endswith("/v1") else f"{base}/v1", key or "ollama"
    return "openai_compatible", base or None, key or "not-needed"


def resolve_model(s: dict, kind: str, model_id: str | None = None) -> tuple[str | None, dict | None]:
    """โมเดลที่เลือกไว้ (ถ้ายังมีอยู่และเป็นประเภทถูก) ไม่งั้นค่าเริ่มต้นของประเภทนั้น"""
    for mid in (model_id, s["defaults"].get(kind)):
        e = s["registry"].get(mid or "")
        if e and e["kind"] == kind:
            return mid, e
    return None, None


def model_creds(s: dict, entry: dict | None) -> dict:
    if not entry:
        return {}
    kind, base, key = _endpoint(s["providers"].get(entry.get("provider") or "", {}))
    out = {"provider": kind, "model": entry.get("model", ""), "api_key": key}
    if base:
        out["base_url"] = base
    if entry.get("params"):
        out["params"] = entry["params"]  # พารามิเตอร์เพิ่มเติมของโมเดล — central ส่งต่อให้ผู้ให้บริการตรง ๆ
    return out


def credentials(settings: dict | None = None, *, llm_id: str | None = None, embedding_id: str | None = None,
                rerank_id: str | None = None, use_rerank: bool = False) -> dict:
    s = settings or load_settings()
    creds = {
        "llm": model_creds(s, resolve_model(s, "llm", llm_id)[1]),
        "embedding": model_creds(s, resolve_model(s, "embedding", embedding_id)[1]),
        "vector": {"url": s["vector"].get("url", ""), "api_key": s["vector"].get("api_key") or None},
    }
    if use_rerank:
        rr = model_creds(s, resolve_model(s, "rerank", rerank_id)[1])
        if rr:
            creds["rerank"] = {"api_key": rr["api_key"], "model": rr["model"], "base_url": rr.get("base_url"), "params": rr.get("params") or {}}
    return creds


# ── รายชื่อโมเดลจากผู้ให้บริการ ─────────────────────────

def _guess_kinds(model_id: str) -> list[str]:
    mid = model_id.lower()
    if "rerank" in mid:
        return ["rerank"]
    if any(w in mid for w in ("whisper", "sensevoice", "transcribe", "asr", "speech-to-text", "stt")):
        return ["stt"]
    if any(w in mid for w in ("embed", "bge-", "/bge", "e5-", "gte-", "minilm")):
        return ["embedding"]
    return ["llm"]


def list_provider_models(prov: dict) -> list[dict]:
    """ดึงรายชื่อโมเดลจากผู้ให้บริการโดยตรง (ใช้แสดงตัวเลือกในหน้าตั้งค่าเท่านั้น)"""
    try:
        if prov.get("type") == "google":
            if not prov.get("api_key"):
                raise HTTPException(400, "ใส่ API key ก่อน")
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                          params={"key": prov["api_key"], "pageSize": 1000}, timeout=15)
            r.raise_for_status()
            out = []
            for m in r.json().get("models", []):
                methods = m.get("supportedGenerationMethods", [])
                kinds = (["llm"] if "generateContent" in methods else []) + (["embedding"] if "embedContent" in methods else [])
                if "generateContent" in methods and m["name"].startswith("models/gemini"):
                    kinds.append("stt")  # Gemini ถอดเสียงได้ในตัว (multimodal)
                if kinds:
                    out.append({"id": m["name"].removeprefix("models/"), "kinds": kinds})
            return sorted(out, key=lambda x: x["id"])
        _, base, key = _endpoint(prov)
        if not base:
            raise HTTPException(400, "ใส่ URL ของเซิร์ฟเวอร์ก่อน")
        headers = {"Authorization": f"Bearer {key}"} if key and key not in ("ollama", "not-needed") else {}
        r = httpx.get(f"{base}/models", headers=headers, timeout=15)
        r.raise_for_status()
        return sorted(({"id": m["id"], "kinds": _guess_kinds(m["id"])} for m in r.json().get("data", [])),
                      key=lambda x: x["id"])
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        msg = ("API key ไม่ถูกต้องหรือไม่มีสิทธิ์" if code in (401, 403)
               else "ไม่พบ endpoint — ตรวจ URL (ปกติลงท้ายด้วย /v1)" if code == 404
               else f"ผู้ให้บริการตอบ {code}")
        raise HTTPException(400, msg)
    except httpx.HTTPError as e:
        raise HTTPException(400, f"ติดต่อผู้ให้บริการไม่ได้ ({type(e).__name__}) — ตรวจ URL และเครือข่าย")


# ══════════════════════════════════════════════
# Central client
# ══════════════════════════════════════════════

_tokens: dict[tuple, dict] = {}
_token_lock = threading.Lock()


class CentralError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@app.exception_handler(CentralError)
async def _central_error_handler(_req: Request, e: CentralError):
    return JSONResponse({"detail": f"[{e.code}] {e.message}"}, status_code=e.status if e.status < 500 else 502)


def _raise_for(resp: httpx.Response):
    if resp.status_code < 400:
        return
    try:
        err = resp.json().get("error") or {}
    except Exception:
        err = {}
    raise CentralError(resp.status_code, err.get("code") or "central_error", err.get("message") or f"central ตอบ {resp.status_code}")


def _central(settings: dict | None = None) -> tuple[str, str]:
    c = (settings or load_settings())["central"]
    return (c.get("url") or "").rstrip("/"), c.get("license_key") or ""


def get_token(force: bool = False, settings: dict | None = None) -> str:
    url, lic = _central(settings)
    cache_key = (url, lic)
    with _token_lock:
        cached = _tokens.get(cache_key)
        if not force and cached and cached["exp"] - 60 > time.time():
            return cached["value"]
        _tokens.pop(cache_key, None)
        if not url:
            raise CentralError(500, "no_central", "ยังไม่ได้ตั้งที่อยู่ central (หลังบ้าน → การเชื่อมต่อ)")
        if not lic:
            raise CentralError(500, "no_license", "ยังไม่ได้ใส่ license key (หลังบ้าน → การเชื่อมต่อ)")
        try:
            resp = httpx.post(f"{url}/v1/auth/token", json={"license_key": lic}, timeout=20)
        except httpx.HTTPError as e:
            raise CentralError(502, "central_unreachable", f"ติดต่อ central ที่ {url} ไม่ได้ ({type(e).__name__})")
        _raise_for(resp)
        body = resp.json()
        _tokens[cache_key] = {"value": body["access_token"], "exp": time.time() + int(body.get("expires_in", 900)),
                              "license": body.get("license"), "warnings": body.get("warnings") or []}
        return body["access_token"]


def token_info(settings: dict | None = None) -> dict:
    return _tokens.get(_central(settings)) or {}


def central_json(path: str, body: dict, settings: dict | None = None) -> dict:
    url, _ = _central(settings)
    resp = None
    for attempt in range(2):
        token = get_token(force=attempt > 0, settings=settings)
        try:
            resp = httpx.post(f"{url}{path}", json=body, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise CentralError(502, "central_unreachable", f"ติดต่อ central ไม่ได้ ({type(e).__name__})")
        if resp.status_code == 401 and attempt == 0:
            continue
        break
    _raise_for(resp)
    return resp.json()


def kb_payload(kb: dict, s: dict | None = None) -> dict:
    """KB ที่ส่งให้ central — แนบ credentials ของ embedding ที่ KB นี้ผูกไว้ (central รุ่นใหม่ใช้สร้าง embedding ต่อ KB)"""
    s = s or load_settings()
    emb = kb.get("embedding") or {}
    _, entry = resolve_model(s, "embedding", emb.get("model_id"))
    return {"kb_id": kb["id"], "name": kb["name"], "collection_name": kb["collection_name"],
            "embedding": {"model": emb.get("model"), "dim": emb.get("dim")},
            "credentials": model_creds(s, entry) if entry and emb.get("model_id") in s["registry"] else {}}


def _kb_ctx(kb: dict) -> dict:
    return {"credentials": credentials(embedding_id=(kb.get("embedding") or {}).get("model_id"))}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(name: str) -> str:
    name = Path(name or "").name
    if not name or name in {".", ".."}:
        raise HTTPException(400, "ชื่อไฟล์ไม่ถูกต้อง")
    return name


@app.on_event("startup")
def _startup():
    init_db()
    migrate_legacy_state()
    load_settings()
    ensure_kb_embeddings()
    start_realtime_scheduler()


# ══════════════════════════════════════════════
# หลังบ้าน: การเชื่อมต่อ (Settings) + สถานะ
# ══════════════════════════════════════════════

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/admin/settings")
def get_settings():
    return {"settings": public_settings(load_settings()), "protocols": PROTOCOLS}


@app.put("/api/admin/settings")
def save_settings(body: dict = Body(...)):
    """บันทึกโครงสร้างพื้นฐาน (Qdrant, central/license) — การเชื่อมต่อและคลังโมเดลมี endpoint ของตัวเอง"""
    s = load_settings()
    incoming = body.get("settings") or {}
    new = json.loads(json.dumps(s))
    for section, secret in (("vector", "api_key"), ("central", "license_key")):
        for k, v in (incoming.get(section) or {}).items():
            if k == secret:
                _apply_secret(new[section], k, v)
            elif k == "url":
                new[section]["url"] = (v or "").strip()
    _write_settings(new)
    with _token_lock:
        _tokens.clear()
    return {"settings": public_settings(load_settings())}


# ── การเชื่อมต่อ ─────────────────────────────────────

class ProviderIn(BaseModel):
    name: str
    base_url: str = ""
    api_key: str | None = ""  # "" = ใช้ค่าเดิม (ตอนแก้ไข), null = ลบ


def detect_type(base_url: str, existing_type: str | None = None) -> str:
    """เดารูปแบบ API จาก URL ให้ผู้ใช้กรอกแค่ URL/key เหมือนใส่ใน .env"""
    url = (base_url or "").strip().lower()
    if not url:
        return existing_type or "google"
    if "generativelanguage.googleapis.com" in url and "/openai" not in url:
        return "google"
    if ":11434" in url or "ollama" in url:
        return "ollama"
    return "openai_compatible"


def _provider_from_input(req: ProviderIn, existing: dict | None = None) -> dict:
    if not req.name.strip():
        raise HTTPException(400, "กรุณาตั้งชื่อการเชื่อมต่อ")
    prov = {"name": req.name.strip(), "type": detect_type(req.base_url, (existing or {}).get("type")),
            "base_url": req.base_url.strip(), "api_key": (existing or {}).get("api_key", "")}
    _apply_secret(prov, "api_key", req.api_key)
    if prov["type"] == "google" and not prov["api_key"]:
        raise HTTPException(400, "Google Gemini ต้องใช้ API key")
    return prov


def _update_settings(**sections) -> None:
    _write_settings({**load_settings(), **sections})


@app.post("/api/admin/providers")
def create_provider(req: ProviderIn):
    s = load_settings()
    pid = "p_" + _new_id()[:8]
    _update_settings(providers={**s["providers"], pid: _provider_from_input(req)})
    return public_provider(pid, load_settings()["providers"][pid])


@app.put("/api/admin/providers/{pid}")
def update_provider(pid: str, req: ProviderIn):
    s = load_settings()
    if pid not in s["providers"]:
        raise HTTPException(404, "ไม่พบการเชื่อมต่อนี้")
    _update_settings(providers={**s["providers"], pid: _provider_from_input(req, s["providers"][pid])})
    return public_provider(pid, load_settings()["providers"][pid])


@app.delete("/api/admin/providers/{pid}")
def delete_provider(pid: str):
    s = load_settings()
    if pid not in s["providers"]:
        raise HTTPException(404, "ไม่พบการเชื่อมต่อนี้")
    used = [e["name"] for e in s["registry"].values() if e.get("provider") == pid]
    if used:
        raise HTTPException(409, f"มีโมเดลในคลังใช้การเชื่อมต่อนี้อยู่ ({', '.join(used)}) — ลบโมเดลเหล่านั้นก่อน")
    _update_settings(providers={k: v for k, v in s["providers"].items() if k != pid})
    return {"message": "ลบการเชื่อมต่อแล้ว"}


@app.post("/api/admin/providers/test")
def test_provider(body: dict = Body(...)):
    """ทดสอบการเชื่อมต่อที่ยังไม่บันทึก (หรือที่แก้อยู่) โดยดึงรายชื่อโมเดล — ช่อง key ว่าง = ใช้ key เดิมของ id นั้น"""
    existing = load_settings()["providers"].get(body.get("id") or "", {})
    base = (body.get("base_url") or "").strip()
    prov = {"type": detect_type(base, existing.get("type")), "base_url": base, "api_key": existing.get("api_key", "")}
    _apply_secret(prov, "api_key", body.get("api_key", ""))
    if prov["type"] == "google" and not prov["api_key"]:
        raise HTTPException(400, "ใส่ API key ก่อน")
    return {"models": list_provider_models(prov), "type": prov["type"]}


@app.post("/api/admin/providers/{pid}/models")
def provider_models(pid: str):
    prov = load_settings()["providers"].get(pid)
    if not prov:
        raise HTTPException(404, "ไม่พบการเชื่อมต่อนี้")
    return {"models": list_provider_models(prov)}


# ── คลังโมเดล ────────────────────────────────────────

class ModelIn(BaseModel):
    name: str = ""
    kind: str
    provider: str
    model: str
    dim: int = 0
    make_default: bool = False
    params: dict | str | None = None  # JSON object หรือข้อความ JSON — ส่งต่อให้ผู้ให้บริการตรง ๆ


PARAMS_MAX_CHARS = 8000


def _parse_params(raw) -> dict:
    """พารามิเตอร์เพิ่มเติมของโมเดล: รับได้ทั้ง object และข้อความ JSON (ช่องกรอกในหน้าเว็บ) — ว่าง = {}"""
    if raw is None or raw == "" or raw == {}:
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(400, f"พารามิเตอร์เพิ่มเติมต้องเป็น JSON — {e.msg} (บรรทัด {e.lineno})")
    if not isinstance(raw, dict):
        raise HTTPException(400, 'พารามิเตอร์เพิ่มเติมต้องเป็น JSON object เช่น {"temperature": 0.2}')
    if len(json.dumps(raw, ensure_ascii=False)) > PARAMS_MAX_CHARS:
        raise HTTPException(400, "พารามิเตอร์เพิ่มเติมยาวเกินไป")
    return raw


def _model_from_input(req: ModelIn, s: dict) -> dict:
    if req.kind not in KINDS:
        raise HTTPException(400, "ประเภทโมเดลไม่ถูกต้อง")
    if req.provider not in s["providers"]:
        raise HTTPException(400, "เลือกการเชื่อมต่อก่อน")
    if not req.model.strip():
        raise HTTPException(400, "ใส่ชื่อโมเดล")
    if req.kind == "rerank" and s["providers"][req.provider].get("type") == "google":
        raise HTTPException(400, "Rerank ต้องใช้การเชื่อมต่อแบบ OpenAI-compatible ที่มี endpoint /rerank")
    if req.kind == "stt" and s["providers"][req.provider].get("type") == "ollama":
        raise HTTPException(400, "Ollama ยังไม่มี API ถอดเสียง — ใช้ Gemini หรือเจ้าที่มี /audio/transcriptions (เช่น Whisper)")
    entry = {"name": req.name.strip() or req.model.strip(), "kind": req.kind, "provider": req.provider, "model": req.model.strip()}
    params = _parse_params(req.params)
    if params:
        entry["params"] = params
    if req.kind == "embedding":
        if req.dim <= 0:
            raise HTTPException(400, "Embedding ต้องระบุจำนวนมิติ (dim) — กดตรวจเพื่อหาค่าที่ถูกต้อง")
        entry["dim"] = int(req.dim)
    return entry


@app.post("/api/admin/models")
def create_model(req: ModelIn):
    s = load_settings()
    entry = _model_from_input(req, s)
    mid = f"m_{_new_id()[:8]}"
    defaults = dict(s["defaults"])
    if req.make_default or not defaults.get(req.kind):
        defaults[req.kind] = mid
    _update_settings(registry={**s["registry"], mid: entry}, defaults=defaults)
    return {"id": mid}


@app.put("/api/admin/models/{mid}")
def update_model(mid: str, req: ModelIn):
    s = load_settings()
    old = s["registry"].get(mid)
    if not old:
        raise HTTPException(404, "ไม่พบโมเดลนี้")
    entry = _model_from_input(ModelIn(**{**req.model_dump(), "kind": old["kind"]}), s)
    used_kbs = _model_usage().get(mid, {}).get("kbs", [])
    if old["kind"] == "embedding" and used_kbs and (entry["model"] != old["model"] or entry["dim"] != old.get("dim")
                                                    or (entry.get("params") or {}) != (old.get("params") or {})):
        # params ของ embedding อาจเปลี่ยน vector (เช่น dimensions, task_type) — เทียบกับของเดิมใน KB ไม่ได้
        raise HTTPException(409, f"embedding นี้ผูกกับ KB อยู่ ({', '.join(used_kbs)}) — เปลี่ยนโมเดล มิติ หรือพารามิเตอร์ไม่ได้ แก้ได้แค่ชื่อและการเชื่อมต่อ")
    defaults = dict(s["defaults"])
    if req.make_default:
        defaults[old["kind"]] = mid
    _update_settings(registry={**s["registry"], mid: entry}, defaults=defaults)
    if old["kind"] == "embedding":
        for kb in db_all("kbs"):
            if (kb.get("embedding") or {}).get("model_id") == mid:
                kb["embedding"] = {"model_id": mid, "model": entry["model"], "dim": entry["dim"]}
                db_put("kbs", kb["id"], kb)
    return {"id": mid}


@app.delete("/api/admin/models/{mid}")
def delete_model(mid: str):
    s = load_settings()
    entry = s["registry"].get(mid)
    if not entry:
        raise HTTPException(404, "ไม่พบโมเดลนี้")
    usage = _model_usage().get(mid, {"kbs": [], "bots": []})
    if usage["kbs"]:
        raise HTTPException(409, f"มี KB ใช้ embedding นี้อยู่ ({', '.join(usage['kbs'])}) — ลบ KB เหล่านั้นก่อนจึงจะลบได้")
    if usage["bots"]:
        raise HTTPException(409, f"มีบอทเลือกโมเดลนี้อยู่ ({', '.join(usage['bots'])}) — เปลี่ยนโมเดลในหน้า Chatbots ก่อน")
    registry = {k: v for k, v in s["registry"].items() if k != mid}
    defaults = dict(s["defaults"])
    if defaults.get(entry["kind"]) == mid:  # ลบตัวที่เป็นค่าเริ่มต้น → ยกตัวอื่นประเภทเดียวกันขึ้นแทน (ถ้ามี)
        defaults[entry["kind"]] = next((k for k, v in registry.items() if v["kind"] == entry["kind"]), None)
    _update_settings(registry=registry, defaults=defaults)
    return {"message": "ลบโมเดลแล้ว"}


@app.post("/api/admin/models/{mid}/default")
def set_default_model(mid: str):
    s = load_settings()
    entry = s["registry"].get(mid)
    if not entry:
        raise HTTPException(404, "ไม่พบโมเดลนี้")
    _update_settings(defaults={**s["defaults"], entry["kind"]: mid})
    return {"message": "ตั้งเป็นค่าเริ่มต้นแล้ว"}


@app.post("/api/admin/models/test")
def test_model(body: dict = Body(...)):
    """ทดสอบโมเดลก่อนบันทึก ผ่าน central (เส้นทางเดียวกับใช้งานจริง) — embedding จะได้จำนวนมิติกลับมาด้วย"""
    s = load_settings()
    kind = body.get("kind")
    prov = s["providers"].get(body.get("provider") or "")
    if kind not in KINDS or not prov:
        raise HTTPException(400, "เลือกประเภทและการเชื่อมต่อก่อน")
    cfg = model_creds(s, {"provider": body.get("provider"), "model": (body.get("model") or "").strip(),
                          "params": _parse_params(body.get("params"))})
    creds = credentials(s, use_rerank=False)
    if kind == "rerank":
        creds["rerank"] = {"api_key": cfg["api_key"], "model": cfg["model"], "base_url": cfg.get("base_url"), "params": cfg.get("params") or {}}
    else:
        creds[kind] = cfg
    result = central_json("/v1/credentials/check", {"ctx": {"credentials": creds}})
    return result.get(kind) or {"ok": False, "message": "ไม่ได้ผลตรวจ"}


# ── ตรวจ / สถานะ ─────────────────────────────────────

def _run_check(settings: dict) -> dict:
    """ตรวจทุกส่วนด้วยค่าเริ่มต้นของแต่ละประเภท"""
    url, _ = _central(settings)
    out: dict = {"central": {"url": url}}
    try:
        meta = httpx.get(f"{url}/v1/meta", timeout=10).json()
        out["central"].update({"ok": True, "api_version": meta.get("api_version")})
    except Exception as e:
        out["central"].update({"ok": False, "message": f"ติดต่อ central ไม่ได้ ({type(e).__name__})"})
        return out
    try:
        get_token(force=True, settings=settings)
        info = token_info(settings)
        out["license"] = {"ok": True, **(info.get("license") or {}), "warnings": info.get("warnings")}
    except CentralError as e:
        out["license"] = {"ok": False, "code": e.code, "message": e.message}
        return out
    try:
        creds = credentials(settings, use_rerank=True)
        stt_creds = model_creds(settings, resolve_model(settings, "stt")[1])
        if stt_creds:
            creds["stt"] = stt_creds
        check = central_json("/v1/credentials/check", {"ctx": {"credentials": creds}}, settings=settings)
        for k in ("llm", "embedding", "vector", "rerank", "stt"):
            out[k] = check.get(k)
        _, emb = resolve_model(settings, "embedding")
        got = (check.get("embedding") or {}).get("dim")
        if emb and got and int(emb.get("dim") or 0) != got:
            out["embedding"]["dim_mismatch"] = {"configured": emb.get("dim"), "actual": got}
    except CentralError as e:
        out["llm"] = {"ok": False, "error_code": e.code, "message": e.message}
    return out


@app.post("/api/admin/check")
def check_saved():
    return _run_check(load_settings())


@app.get("/api/health")
def health():
    return _run_check(load_settings())


@app.get("/api/admin/status")
def admin_status():
    s = load_settings()
    url, _ = _central(s)
    central: dict = {"url": url}
    try:
        meta = httpx.get(f"{url}/v1/meta", timeout=8).json()
        central.update({"ok": True, "api_version": meta.get("api_version")})
    except Exception as e:
        central.update({"ok": False, "message": f"ติดต่อ central ไม่ได้ ({type(e).__name__})"})
    license_info: dict = {}
    if central["ok"]:
        try:
            get_token(settings=s)
            info = token_info(s)
            license_info = {"ok": True, **(info.get("license") or {}), "warnings": info.get("warnings")}
        except CentralError as e:
            license_info = {"ok": False, "code": e.code, "message": e.message}

    def default_of(kind: str) -> dict | None:
        mid, e = resolve_model(s, kind)
        if not e:
            return None
        return {"id": mid, "name": e["name"], "model": e["model"], "dim": e.get("dim"),
                "provider_name": (s["providers"].get(e.get("provider")) or {}).get("name", "—")}

    kbs = db_all("kbs")
    return {
        "central": central,
        "license": license_info,
        "defaults": {k: default_of(k) for k in KINDS},
        "model_counts": {k: sum(1 for e in s["registry"].values() if e["kind"] == k) for k in KINDS},
        "counts": {"kbs": len(kbs), "files": sum(len(kb.get("files", {})) for kb in kbs),
                   "chunks": sum(f.get("chunks", 0) for kb in kbs for f in kb.get("files", {}).values()),
                   "bots": len(db_all("bots")), "skills": len(db_all("skills"))},
        "usage": get_usage(),
    }


@app.get("/api/usage")
def usage():
    return get_usage()


# ══════════════════════════════════════════════
# Knowledge Bases
# ══════════════════════════════════════════════

class KbCreateRequest(BaseModel):
    name: str
    description: str = ""
    embedding_model_id: str | None = None  # ว่าง = ค่าเริ่มต้น


def _kb_out(kb: dict, with_files: bool = False) -> dict:
    files = kb.get("files", {})
    sources = [s for s in db_all("sources") if s.get("kb_id") == kb["id"]]
    out = {
        "id": kb["id"], "name": kb["name"], "description": kb.get("description", ""),
        "collection_name": kb["collection_name"], "created_at": kb["created_at"],
        "file_count": len(files), "source_count": len(sources),
        "chunk_count": sum(f.get("chunks", 0) for f in files.values()) + sum(int(s.get("last_chunks") or 0) for s in sources),
        "embedding": {**kb["embedding"], "name": _embedding_name(kb)},
        "embedding_available": (kb.get("embedding") or {}).get("model_id") in load_settings()["registry"],
    }
    if with_files:
        out["files"] = [{"name": n, "size": f.get("size", 0), "type": Path(n).suffix.lstrip("."),
                         "chunks": f.get("chunks", 0), "uploaded_at": f.get("uploaded_at")} for n, f in files.items()]
    return out


def _embedding_name(kb: dict) -> str:
    e = load_settings()["registry"].get((kb.get("embedding") or {}).get("model_id") or "")
    return e["name"] if e else (kb.get("embedding") or {}).get("model", "—")


def _get_kb(kb_id: str) -> dict:
    kb = db_get("kbs", kb_id)
    if not kb:
        raise HTTPException(404, "ไม่พบ Knowledge Base")
    return kb


@app.get("/api/kb")
def list_kbs():
    return {"knowledge_bases": [_kb_out(kb) for kb in db_all("kbs")]}


@app.post("/api/kb")
def create_kb(req: KbCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อ Knowledge Base")
    mid, entry = resolve_model(load_settings(), "embedding", req.embedding_model_id)
    if not entry:
        raise HTTPException(400, "ยังไม่มีโมเดล embedding — เพิ่มที่หลังบ้าน → การเชื่อมต่อ AI ก่อนสร้าง Knowledge Base")
    if req.embedding_model_id and mid != req.embedding_model_id:
        raise HTTPException(400, "ไม่พบโมเดล embedding ที่เลือก")
    kb_id = _new_id()
    kb = {
        "id": kb_id, "name": req.name.strip(), "description": req.description.strip(),
        "collection_name": f"kb_{kb_id}",
        # ผูก embedding ตอนสร้าง — เปลี่ยนทีหลังไม่ได้ (vector ต่างโมเดลเทียบกันไม่ได้)
        "embedding": {"model_id": mid, "model": entry["model"], "dim": int(entry.get("dim") or 0)},
        "files": {}, "revision": 0, "created_at": _now(),
    }
    central_json("/v1/kb/ensure", {"ctx": _kb_ctx(kb), "kb": kb_payload(kb)})
    db_put("kbs", kb_id, kb)
    return _kb_out(kb)


@app.get("/api/kb/{kb_id}")
def get_kb(kb_id: str):
    return _kb_out(_get_kb(kb_id), with_files=True)


@app.delete("/api/kb/{kb_id}")
def delete_kb(kb_id: str):
    kb = _get_kb(kb_id)
    central_json("/v1/kb/drop", {"ctx": _kb_ctx(kb), "kb": kb_payload(kb)})
    db_delete("kbs", kb_id)
    for src in db_all("sources"):
        if src.get("kb_id") == kb_id:
            db_delete("sources", src["id"])
    for bot in db_all("bots"):
        if kb_id in bot["kb_ids"]:
            bot["kb_ids"] = [k for k in bot["kb_ids"] if k != kb_id]
            db_put("bots", bot["id"], bot)
    folder = ORIGINALS_DIR / kb_id
    if folder.exists():
        for f in folder.iterdir():
            f.unlink(missing_ok=True)
        folder.rmdir()
    return {"message": "ลบ Knowledge Base สำเร็จ"}


def _ingest_via_central(kb: dict, filename: str, data: bytes) -> dict:
    url, _ = _central()
    payload = {"ctx": _kb_ctx(kb), "kb": kb_payload(kb), "source": {"filename": filename, "replace_existing": True}}
    for attempt in range(2):
        headers = {"Authorization": f"Bearer {get_token(force=attempt > 0)}"}
        try:
            with httpx.stream("POST", f"{url}/v1/ingest/file", headers=headers, timeout=TIMEOUT,
                              data={"payload": json.dumps(payload, ensure_ascii=False)},
                              files={"file": (filename, data, "application/octet-stream")}) as resp:
                if resp.status_code == 401 and attempt == 0:
                    continue
                if resp.status_code >= 400:
                    resp.read()
                    _raise_for(resp)
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    if event.get("type") == "result":
                        return event
                    if event.get("type") == "error":
                        err = event.get("error") or {}
                        add_usage(event.get("usage"))
                        raise CentralError(502, err.get("code", "ingest_failed"), err.get("message", "ingest ไม่สำเร็จ"))
        except httpx.HTTPError as e:
            raise CentralError(502, "central_unreachable", f"ติดต่อ central ไม่ได้ ({type(e).__name__})")
    raise CentralError(502, "ingest_failed", "central ปิดการเชื่อมต่อก่อนส่งผลลัพธ์")


@app.post("/api/kb/{kb_id}/upload")
def upload_to_kb(kb_id: str, file: UploadFile = File(...)):
    kb = _get_kb(kb_id)
    filename = _safe_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in KB_ALLOWED:
        raise HTTPException(400, f"รองรับเฉพาะ {', '.join(KB_ALLOWED)} เท่านั้น")
    if (kb.get("embedding") or {}).get("model_id") not in load_settings()["registry"]:
        raise HTTPException(409, "โมเดล embedding ของ Knowledge Base นี้ถูกลบไปแล้ว — สร้าง Knowledge Base ใหม่")
    data = file.file.read()

    # เก็บต้นฉบับไว้ที่ node (central ไม่เก็บ) เผื่อวันที่ต้อง re-index
    folder = ORIGINALS_DIR / kb_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)

    result = _ingest_via_central(kb, filename, data)

    with _db_lock:
        kb = db_get("kbs", kb_id)
        if kb:
            kb["files"][filename] = {"size": len(data), "chunks": result.get("chunks", 0),
                                     "chunk_types": result.get("chunk_types", {}), "uploaded_at": _now()}
            kb["revision"] = kb.get("revision", 0) + 1
            db_put("kbs", kb_id, kb)
    add_usage(result.get("usage"))
    return {
        "message": f"อัปโหลด '{filename}' เข้า '{kb['name'] if kb else kb_id}' สำเร็จ",
        "chunks": result.get("chunks", 0),
        "chunk_types": result.get("chunk_types", {}),
        "filename": filename,
        "type": suffix.lstrip("."),
    }


@app.delete("/api/kb/{kb_id}/files/{filename}")
def delete_kb_file(kb_id: str, filename: str):
    kb = _get_kb(kb_id)
    filename = _safe_filename(filename)
    if filename not in kb.get("files", {}):
        raise HTTPException(404, "ไม่พบไฟล์")
    central_json("/v1/kb/delete-source", {"ctx": _kb_ctx(kb), "kb": kb_payload(kb), "source": filename})
    with _db_lock:
        kb = db_get("kbs", kb_id)
        if kb:
            kb["files"].pop(filename, None)
            kb["revision"] = kb.get("revision", 0) + 1
            db_put("kbs", kb_id, kb)
    (ORIGINALS_DIR / kb_id / filename).unlink(missing_ok=True)
    return {"message": f"ลบ '{filename}' สำเร็จ"}


@app.get("/api/kb/{kb_id}/files/{filename}/chunks")
def get_kb_file_chunks(kb_id: str, filename: str):
    kb = _get_kb(kb_id)
    filename = _safe_filename(filename)
    result = central_json("/v1/kb/chunks", {"ctx": _kb_ctx(kb), "kb": kb_payload(kb), "source": filename})
    chunks = [{"id": c["id"], "text": c["text"], "length": len(c["text"]), "metadata": c["metadata"]}
              for c in result.get("chunks", [])]
    if not chunks:
        raise HTTPException(404, f"ไม่พบ chunk ของ '{filename}'")

    def sort_key(c):
        m = c["metadata"]
        order = {"parent": 0, "child": 1, "text": 2}.get(m.get("chunk_type", "zzz"), 9)
        row = m.get("row_start") or m.get("row_id") or 0
        return (order, row if isinstance(row, (int, float)) else 0)

    chunks.sort(key=sort_key)
    for i, c in enumerate(chunks):
        c["index"] = i + 1
    return {"filename": filename, "total_chunks": len(chunks), "chunks": chunks}


# ══════════════════════════════════════════════
# แหล่งข้อมูลสด (Realtime API) — node ดึง API ของลูกค้าเอง (key ไม่ออกนอกองค์กร) แล้วส่งแถวให้
# central แปลงเป็น chunk ลง KB; central patch เฉพาะแถวที่ค่าเปลี่ยน ไม่ต้อง embed ใหม่ทั้งชุดทุกรอบ
# ══════════════════════════════════════════════

RT_METHODS = ("GET", "POST")
RT_AUTH = ("none", "bearer", "api_key_header", "api_key_query")
RT_MIN_INTERVAL = 60
RT_MAX_RECORDS = 5000
RT_FETCH_TIMEOUT = 20
_rt_locks: dict[str, threading.Lock] = {}
_rt_locks_guard = threading.Lock()


class SourceIn(BaseModel):
    name: str
    url: str
    method: str = "GET"
    headers: dict = Field(default_factory=dict)
    query_params: dict = Field(default_factory=dict)
    body: dict = Field(default_factory=dict)
    auth_type: str = "none"
    auth_token: str | None = ""  # "" = ใช้ค่าเดิม (ตอนแก้ไข), null = ลบ
    auth_header_name: str = ""
    auth_query_param: str = ""
    records_path: str = ""
    poll_interval_sec: int = 300
    id: str | None = None  # ใช้ตอนทดสอบ: เอา token ที่บันทึกไว้มาใช้


class SourceToggle(BaseModel):
    enabled: bool


def _rt_tag(sid: str) -> str:
    # ใช้ id (ไม่ใช่ชื่อที่แก้ได้) เป็น metadata "source" ของทุก chunk — sync รอบหน้าหาของเก่าเจอเสมอ
    return f"realtime:{sid}"


def _rt_lock(sid: str) -> threading.Lock:
    with _rt_locks_guard:
        return _rt_locks.setdefault(sid, threading.Lock())


def _validate_source(req: SourceIn) -> None:
    if not req.name.strip():
        raise HTTPException(400, "กรุณาตั้งชื่อแหล่งข้อมูล")
    if not re.match(r"^https?://", req.url.strip(), re.I):
        raise HTTPException(400, "URL ต้องขึ้นต้นด้วย http:// หรือ https://")
    if req.method.upper() not in RT_METHODS:
        raise HTTPException(400, "รองรับเฉพาะ GET และ POST")
    if req.auth_type not in RT_AUTH:
        raise HTTPException(400, "รูปแบบการยืนยันตัวตนไม่ถูกต้อง")
    if req.poll_interval_sec < RT_MIN_INTERVAL:
        raise HTTPException(400, f"ตั้งรอบอัปเดตได้ต่ำสุด {RT_MIN_INTERVAL} วินาที")


def _source_fields(req: SourceIn, old: dict | None = None) -> dict:
    token = (old or {}).get("auth_token", "")
    if req.auth_token is None:
        token = ""
    elif req.auth_token.strip():
        token = _enc(req.auth_token.strip())
    return {
        "name": req.name.strip(), "url": req.url.strip(), "method": req.method.upper(),
        "headers": req.headers or {}, "query_params": req.query_params or {}, "body": req.body or {},
        "auth_type": req.auth_type, "auth_token": token if req.auth_type != "none" else "",
        "auth_header_name": req.auth_header_name.strip(), "auth_query_param": req.auth_query_param.strip(),
        "records_path": req.records_path.strip(), "poll_interval_sec": int(req.poll_interval_sec),
    }


def _source_out(src: dict) -> dict:
    out = {k: v for k, v in src.items() if k not in ("auth_token", "last_attempt_epoch", "has_data")}
    out["auth_token"] = _mask(_dec(src.get("auth_token", "")))
    return out


def _get_source(sid: str) -> dict:
    src = db_get("sources", sid)
    if not src:
        raise HTTPException(404, "ไม่พบแหล่งข้อมูล")
    return src


def _walk_path(payload, path: str):
    node = payload
    for key in [k.strip() for k in (path or "").split(".") if k.strip()]:
        if isinstance(node, dict) and key in node:
            node = node[key]
        elif isinstance(node, list) and key.isdigit() and int(key) < len(node):
            node = node[int(key)]
        else:
            raise ValueError(f"ไม่พบ '{key}' ในข้อมูลที่ API ตอบมา — ตรวจช่อง ‘ตำแหน่งข้อมูล’")
    return node


def fetch_records(src: dict) -> list[dict]:
    headers = {str(k): str(v) for k, v in (src.get("headers") or {}).items()}
    params = {str(k): str(v) for k, v in (src.get("query_params") or {}).items()}
    token = _dec(src.get("auth_token", ""))
    auth = src.get("auth_type", "none")
    if token and auth == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    elif token and auth == "api_key_header":
        headers[src.get("auth_header_name") or "X-API-Key"] = token
    elif token and auth == "api_key_query":
        params[src.get("auth_query_param") or "api_key"] = token
    try:
        resp = httpx.request(src.get("method", "GET"), src["url"], headers=headers, params=params,
                             json=(src.get("body") or None) if src.get("method") == "POST" else None,
                             timeout=RT_FETCH_TIMEOUT, follow_redirects=True)
    except httpx.HTTPError as e:
        raise ValueError(f"เรียก API ไม่ได้ ({type(e).__name__}) — ตรวจ URL และเครือข่าย")
    if resp.status_code >= 400:
        raise ValueError(f"API ตอบ {resp.status_code} — ตรวจ URL / การยืนยันตัวตน")
    try:
        payload = resp.json()
    except ValueError:
        raise ValueError("API ไม่ได้ตอบเป็น JSON")
    records = _walk_path(payload, src.get("records_path", ""))
    if isinstance(records, dict):
        # API บางตัวตอบเป็น object ก้อนเดียว — ถือเป็น 1 แถว
        records = [records]
    if not isinstance(records, list):
        raise ValueError(f"ตำแหน่งข้อมูลต้องชี้ไปที่รายการ (list) แต่ได้ {type(records).__name__}")
    return [r if isinstance(r, dict) else {"value": r} for r in records]


def _bump_kb_revision(kb_id: str) -> None:
    with _db_lock:
        kb = db_get("kbs", kb_id)
        if kb:
            kb["revision"] = kb.get("revision", 0) + 1
            db_put("kbs", kb_id, kb)


def _update_source(sid: str, patch: dict) -> dict | None:
    with _db_lock:
        src = db_get("sources", sid)
        if not src:
            return None
        src.update(patch)
        db_put("sources", sid, src)
        return src


def sync_source(sid: str) -> dict:
    """ดึง API → ส่งให้ central → บันทึกสถานะ; คืนผล (ไม่ raise) ให้ทั้งปุ่ม ‘อัปเดตเดี๋ยวนี้’ และตัวจับเวลาใช้ร่วมกัน"""
    lock = _rt_lock(sid)
    if not lock.acquire(blocking=False):
        return {"status": "busy", "error": "กำลังอัปเดตอยู่ — รอสักครู่"}
    try:
        src = db_get("sources", sid)
        if not src:
            return {"status": "error", "error": "ไม่พบแหล่งข้อมูล"}
        _update_source(sid, {"last_attempt_epoch": time.time(), "syncing": True})
        try:
            kb = db_get("kbs", src["kb_id"])
            if not kb:
                raise ValueError("ไม่พบ Knowledge Base ของแหล่งข้อมูลนี้")
            if (kb.get("embedding") or {}).get("model_id") not in load_settings()["registry"]:
                raise ValueError("โมเดล embedding ของ Knowledge Base นี้ถูกลบไปแล้ว")
            records = fetch_records(src)
            if len(records) > RT_MAX_RECORDS:
                raise ValueError(f"API ส่งมา {len(records)} แถว เกินที่รองรับ ({RT_MAX_RECORDS} แถว)")
            res = central_json("/v1/ingest/records", {
                "ctx": _kb_ctx(kb), "kb": kb_payload(kb),
                # เคยดึงสำเร็จและต้นทางไม่ได้เปลี่ยน → patch ได้ (รอบที่ล้มชั่วคราวไม่ทำให้ต้องโหลดใหม่ทั้งชุด)
                "source": {"name": _rt_tag(sid), "allow_incremental": bool(src.get("has_data"))},
                "records": records,
            })
            add_usage(res.get("usage"))
            if res.get("cache_invalidated"):
                _bump_kb_revision(kb["id"])
            patch = {"syncing": False, "has_data": True, "last_synced_at": _now(), "last_status": "success", "last_error": None,
                     "last_record_count": len(records), "last_mode": res.get("mode")}
            if res.get("chunks") is not None:
                patch["last_chunks"] = res["chunks"]
            updated = _update_source(sid, patch)
            return {"status": "success", "mode": res.get("mode"), "patched_rows": res.get("patched_rows", 0),
                    "record_count": len(records), "source": _source_out(updated) if updated else None}
        except (ValueError, CentralError) as e:
            msg = e.message if isinstance(e, CentralError) else str(e)
        except Exception as e:  # ไม่ให้ตัวจับเวลาตาย
            msg = f"อัปเดตไม่สำเร็จ ({type(e).__name__})"
        updated = _update_source(sid, {"syncing": False, "last_synced_at": _now(), "last_status": "error", "last_error": msg})
        return {"status": "error", "error": msg, "source": _source_out(updated) if updated else None}
    finally:
        lock.release()


def _realtime_loop() -> None:
    """ตัวจับเวลาเบา ๆ ในเธรดเดียว: ทุก 15 วินาทีหาแหล่งที่ถึงรอบแล้ว sync ทีละตัว"""
    while True:
        time.sleep(15)
        try:
            now = time.time()
            for src in db_all("sources"):
                if src.get("enabled") and now - float(src.get("last_attempt_epoch") or 0) >= int(src.get("poll_interval_sec") or 300):
                    sync_source(src["id"])
        except Exception as e:
            print(f"[realtime] loop error: {e}")


def start_realtime_scheduler() -> None:
    # รีสตาร์ตแล้วอย่าค้างสถานะ ‘กำลังอัปเดต’
    for src in db_all("sources"):
        if src.get("syncing"):
            _update_source(src["id"], {"syncing": False})
    threading.Thread(target=_realtime_loop, name="realtime-sync", daemon=True).start()


@app.get("/api/kb/{kb_id}/sources")
def list_sources(kb_id: str):
    _get_kb(kb_id)
    return {"sources": [_source_out(s) for s in db_all("sources") if s.get("kb_id") == kb_id]}


@app.post("/api/kb/{kb_id}/sources")
def create_source(kb_id: str, req: SourceIn):
    _get_kb(kb_id)
    _validate_source(req)
    sid = _new_id()
    src = {"id": sid, "kb_id": kb_id, **_source_fields(req), "enabled": False, "syncing": False,
           "last_synced_at": None, "last_status": "never", "last_error": None, "last_record_count": 0,
           "last_chunks": 0, "last_mode": None, "created_at": _now()}
    db_put("sources", sid, src)
    return _source_out(src)


@app.put("/api/sources/{sid}")
def update_source(sid: str, req: SourceIn):
    old = _get_source(sid)
    _validate_source(req)
    changed_shape = any(old.get(k) != v for k, v in _source_fields(req, old).items()
                        if k in ("url", "method", "records_path", "body", "query_params"))
    src = {**old, **_source_fields(req, old)}
    if changed_shape:
        src["has_data"] = False  # ต้นทางเปลี่ยน — รอบหน้าโหลดใหม่ทั้งชุด ไม่ patch ทับของเก่า
    db_put("sources", sid, src)
    return _source_out(src)


@app.delete("/api/sources/{sid}")
def delete_source(sid: str):
    src = _get_source(sid)
    kb = db_get("kbs", src["kb_id"])
    with _rt_lock(sid):
        if kb:
            central_json("/v1/kb/delete-source", {"ctx": _kb_ctx(kb), "kb": kb_payload(kb), "source": _rt_tag(sid)})
            _bump_kb_revision(kb["id"])
        db_delete("sources", sid)
    return {"message": f"ลบแหล่งข้อมูล ‘{src['name']}’ และข้อมูลที่ดึงมาแล้ว"}


@app.post("/api/sources/test")
def test_source(req: SourceIn):
    _validate_source(req)
    old = db_get("sources", req.id) if req.id else None
    try:
        records = fetch_records(_source_fields(req, old))
    except ValueError as e:
        raise HTTPException(400, str(e))
    fields = sorted({k for r in records[:20] for k in r.keys()})
    return {"total_records": len(records), "fields": fields, "sample": records[:3], "too_many": len(records) > RT_MAX_RECORDS}


@app.post("/api/sources/{sid}/sync")
def sync_now(sid: str):
    _get_source(sid)
    return sync_source(sid)


@app.patch("/api/sources/{sid}/toggle")
def toggle_source(sid: str, req: SourceToggle):
    _get_source(sid)
    patch = {"enabled": req.enabled}
    if req.enabled:
        patch["last_attempt_epoch"] = 0  # เปิดแล้วอัปเดตรอบแรกทันที (ภายใน ~15 วินาที)
    return _source_out(_update_source(sid, patch))


@app.get("/api/sources/{sid}/chunks")
def get_source_chunks(sid: str):
    src = _get_source(sid)
    return get_kb_file_chunks(src["kb_id"], _rt_tag(sid))


# ══════════════════════════════════════════════
# Skill Sets
# ══════════════════════════════════════════════

class SkillSetCreateRequest(BaseModel):
    name: str
    description: str = ""


def _preview_skills(text: str) -> list[dict]:
    """แสดงรายชื่อสูตรในหน้าเว็บเท่านั้น (การจับคู่สูตรจริงทำที่ central ด้วย parser เต็ม)
    ใช้กติกาเดียวกับ skill_engine.parse_skills: แยกด้วยหัวข้อ ### แล้วหา "สูตร:"/"Formula:" """
    skills = []
    for block in re.split(r"\n###\s+", text)[1:]:
        lines = block.strip().split("\n")
        if not lines:
            continue
        m = re.search(r"(?:สูตร|Formula)\s*[:：]\s*(.+)", block)
        formula = m.group(1).strip() if m else ""
        if formula:
            skills.append({"name": lines[0].strip(), "formula": formula})
    return skills


def _skill_out(s: dict, detail: bool = False) -> dict:
    files = s.get("files", {})
    previews = [p for content in files.values() for p in _preview_skills(content)]
    out = {"id": s["id"], "name": s["name"], "description": s.get("description", ""),
           "created_at": s.get("created_at", ""), "file_count": len(files), "skills_count": len(previews)}
    if detail:
        out["files"] = [{"name": n, "size": len(c.encode("utf-8")), "type": "md"} for n, c in files.items()]
        out["skills"] = previews
    return out


def _get_skill(skill_id: str) -> dict:
    s = db_get("skills", skill_id)
    if not s:
        raise HTTPException(404, "ไม่พบชุดสูตร")
    return s


@app.get("/api/skills")
def list_skill_sets():
    return {"skill_sets": [_skill_out(s) for s in db_all("skills")]}


@app.post("/api/skills")
def create_skill_set(req: SkillSetCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อชุดสูตร")
    sid = _new_id()
    s = {"id": sid, "name": req.name.strip(), "description": req.description.strip(),
         "files": {}, "revision": 0, "created_at": _now()}
    db_put("skills", sid, s)
    return _skill_out(s)


@app.get("/api/skills/{skill_id}")
def get_skill_set(skill_id: str):
    return _skill_out(_get_skill(skill_id), detail=True)


@app.delete("/api/skills/{skill_id}")
def delete_skill_set(skill_id: str):
    _get_skill(skill_id)
    db_delete("skills", skill_id)
    for bot in db_all("bots"):
        if skill_id in bot["skill_set_ids"]:
            bot["skill_set_ids"] = [s for s in bot["skill_set_ids"] if s != skill_id]
            db_put("bots", bot["id"], bot)
    return {"message": "ลบชุดสูตรสำเร็จ"}


@app.post("/api/skills/{skill_id}/upload")
def upload_skill_file(skill_id: str, file: UploadFile = File(...)):
    filename = _safe_filename(file.filename)
    if not filename.lower().endswith(".md"):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ .md เท่านั้น")
    content = file.file.read().decode("utf-8")
    with _db_lock:
        skill = _get_skill(skill_id)
        skill["files"][filename] = content
        skill["revision"] = skill.get("revision", 0) + 1
        db_put("skills", skill_id, skill)
    return {"message": f"อัปโหลด '{filename}' สำเร็จ", "skills_parsed": len(_preview_skills(content)), "filename": filename}


@app.delete("/api/skills/{skill_id}/files/{filename}")
def delete_skill_file(skill_id: str, filename: str):
    with _db_lock:
        skill = _get_skill(skill_id)
        if skill["files"].pop(_safe_filename(filename), None) is None:
            raise HTTPException(404, "ไม่พบไฟล์")
        skill["revision"] = skill.get("revision", 0) + 1
        db_put("skills", skill_id, skill)
    return {"message": f"ลบ '{filename}' สำเร็จ"}


# ══════════════════════════════════════════════
# Chatbots
# ══════════════════════════════════════════════

class BotCreateRequest(BaseModel):
    name: str
    description: str = ""
    kb_ids: list[str] = Field(default_factory=list)
    skill_set_ids: list[str] = Field(default_factory=list)
    system_prompt: str | None = None
    use_rerank: bool = False
    quick_chat_enabled: bool = False
    quick_chat_tags: list[str] = Field(default_factory=list)
    llm_model_id: str = ""      # ว่าง = ค่าเริ่มต้น
    rerank_model_id: str = ""   # ว่าง = ค่าเริ่มต้น
    # หน้าต้อนรับในหน้าแชท — ว่าง = ไม่แสดง (ข้อความต้อนรับว่าง → ใช้คำอธิบายบอท)
    welcome_label: str = ""
    welcome_message: str = ""
    welcome_icon: str = "sparkles"


class BotUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    kb_ids: list[str] | None = None
    skill_set_ids: list[str] | None = None
    system_prompt: str | None = None
    use_rerank: bool | None = None
    quick_chat_enabled: bool | None = None
    quick_chat_tags: list[str] | None = None
    llm_model_id: str | None = None
    rerank_model_id: str | None = None
    welcome_label: str | None = None
    welcome_message: str | None = None
    welcome_icon: str | None = None


def stt_model_for(s: dict, bot: dict) -> dict | None:
    """โมเดลถอดเสียงของบอท: STT ค่าเริ่มต้นในคลัง ไม่งั้นใช้ LLM ของบอทถ้าเป็น Gemini (ถอดเสียงได้ในตัว)
    — LLM แบบ OpenAI-compatible ทั่วไปรับไฟล์เสียงไม่ได้ จึงไม่ใช้แทน"""
    _, stt = resolve_model(s, "stt")
    if stt:
        return stt
    _, llm = resolve_model(s, "llm", bot.get("llm_model_id"))
    if llm and (s["providers"].get(llm.get("provider") or "") or {}).get("type") == "google":
        return llm
    return None


def _enrich(bot: dict) -> dict:
    kbs = {kb["id"]: kb for kb in db_all("kbs")}
    skills = {s["id"]: s for s in db_all("skills")}
    s = load_settings()
    _, llm = resolve_model(s, "llm", bot.get("llm_model_id"))
    _, rr = resolve_model(s, "rerank", bot.get("rerank_model_id"))
    stt = stt_model_for(s, bot)
    return {
        **bot,
        "llm_model_id": bot.get("llm_model_id") or "",
        "rerank_model_id": bot.get("rerank_model_id") or "",
        "welcome_label": bot.get("welcome_label") or "",
        "welcome_message": bot.get("welcome_message") or "",
        "welcome_icon": bot.get("welcome_icon") or "sparkles",
        "llm_name": llm["name"] if llm else None,
        "rerank_name": rr["name"] if rr else None,
        "voice_input": {"available": bool(stt), "model_name": stt["name"] if stt else None},
        "kb_names": [kbs[k]["name"] for k in bot["kb_ids"] if k in kbs],
        "skill_set_names": [skills[s_]["name"] for s_ in bot["skill_set_ids"] if s_ in skills],
    }


def _validate_models(llm_id: str | None, rerank_id: str | None) -> None:
    registry = load_settings()["registry"]
    for mid, kind in ((llm_id, "llm"), (rerank_id, "rerank")):
        if mid and (registry.get(mid) or {}).get("kind") != kind:
            raise HTTPException(400, f"ไม่พบโมเดล {KIND_LABEL[kind]} ที่เลือก")


def _validate_refs(kb_ids: list[str] | None, skill_ids: list[str] | None, tags: list[str] | None):
    kbs = {kb["id"] for kb in db_all("kbs")}
    skills = {s["id"] for s in db_all("skills")}
    for k in kb_ids or []:
        if k not in kbs:
            raise HTTPException(400, f"ไม่พบ Knowledge Base '{k}'")
    for s in skill_ids or []:
        if s not in skills:
            raise HTTPException(400, f"ไม่พบชุดสูตร '{s}'")
    if tags is not None:
        if len(tags) > QUICK_CHAT_MAX_TAGS:
            raise HTTPException(400, f"Quick Chat ได้สูงสุด {QUICK_CHAT_MAX_TAGS} รายการ")
        for t in tags:
            if not t.strip():
                raise HTTPException(400, "Quick Chat ห้ามเป็นข้อความว่างเปล่า")
            if len(t) > QUICK_CHAT_MAX_TAG_LENGTH:
                raise HTTPException(400, f"Quick Chat แต่ละรายการยาวได้ไม่เกิน {QUICK_CHAT_MAX_TAG_LENGTH} ตัวอักษร")


def _get_bot(bot_id: str) -> dict:
    bot = db_get("bots", bot_id)
    if not bot:
        raise HTTPException(404, "ไม่พบ Chatbot")
    return bot


@app.get("/api/bots")
def list_bots():
    return {"bots": [_enrich(b) for b in db_all("bots")]}


@app.post("/api/bots")
def create_bot(req: BotCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อ Chatbot")
    _validate_refs(req.kb_ids, req.skill_set_ids, req.quick_chat_tags)
    _validate_models(req.llm_model_id, req.rerank_model_id)
    bid = _new_id()
    bot = {
        "id": bid, "name": req.name.strip(), "description": req.description.strip(),
        "kb_ids": req.kb_ids, "skill_set_ids": req.skill_set_ids,
        "system_prompt": req.system_prompt or DEFAULT_SYSTEM_PROMPT, "use_rerank": req.use_rerank,
        "quick_chat_enabled": req.quick_chat_enabled, "quick_chat_tags": [t.strip() for t in req.quick_chat_tags],
        "llm_model_id": req.llm_model_id, "rerank_model_id": req.rerank_model_id,
        "welcome_label": req.welcome_label.strip(), "welcome_message": req.welcome_message.strip(),
        "welcome_icon": req.welcome_icon.strip() or "sparkles",
        "created_at": _now(), "last_chatted_at": None,
    }
    db_put("bots", bid, bot)
    return _enrich(bot)


@app.get("/api/bots/{bot_id}")
def get_bot(bot_id: str):
    return _enrich(_get_bot(bot_id))


@app.put("/api/bots/{bot_id}")
def update_bot(bot_id: str, req: BotUpdateRequest):
    _validate_refs(req.kb_ids, req.skill_set_ids, req.quick_chat_tags)
    _validate_models(req.llm_model_id, req.rerank_model_id)
    with _db_lock:
        bot = _get_bot(bot_id)
        for field, value in req.model_dump(exclude_none=True).items():
            bot[field] = [t.strip() for t in value] if field == "quick_chat_tags" else value
        db_put("bots", bot_id, bot)
    db_delete("caches", bot_id)
    return _enrich(bot)


@app.delete("/api/bots/{bot_id}")
def delete_bot(bot_id: str):
    _get_bot(bot_id)
    db_delete("bots", bot_id)
    db_delete("caches", bot_id)
    return {"message": "ลบ Chatbot สำเร็จ"}


def _cache_stamp(bot: dict) -> dict:
    kbs = {kb["id"]: kb for kb in db_all("kbs")}
    skills = {s["id"]: s for s in db_all("skills")}
    return {
        "kbs": {k: kbs[k].get("revision", 0) for k in bot["kb_ids"] if k in kbs},
        "skills": {s: skills[s].get("revision", 0) for s in bot["skill_set_ids"] if s in skills},
        "embeddings": {k: (kbs[k].get("embedding") or {}).get("model_id") for k in bot["kb_ids"] if k in kbs},
    }


def _chat_payload(bot: dict, message: str, stamp: dict) -> dict:
    s = load_settings()
    kb_rows = [kb for k in bot["kb_ids"] if (kb := db_get("kbs", k))]
    kbs = [kb_payload(kb, s) for kb in kb_rows]
    skills = [{"id": s["id"], "name": s["name"], "files": [{"name": n, "content": c} for n, c in s["files"].items()]}
              for i in bot["skill_set_ids"] if (s := db_get("skills", i))]
    cached = db_get("caches", bot["id"]) or {}
    cache = cached.get("data") if cached.get("stamp") == stamp else {}
    return {
        # embedding ระดับ request = ของ KB แรก (central รุ่นเก่าใช้ตัวนี้ตัวเดียว) — central รุ่นใหม่ใช้ credentials ต่อ KB
        "ctx": {"credentials": credentials(s, llm_id=bot.get("llm_model_id"), rerank_id=bot.get("rerank_model_id"),
                                           use_rerank=bool(bot.get("use_rerank")),
                                           embedding_id=((kb_rows[0].get("embedding") or {}).get("model_id") if kb_rows else None)),
                "cache": cache or {}},
        "bot": {"system_prompt": bot.get("system_prompt", ""), "use_rerank": bot.get("use_rerank", False),
                "kbs": kbs, "skills": skills},
        "message": message,
    }


def _save_export(export: dict) -> dict:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    eid = _new_id()
    path = EXPORTS_DIR / f"{eid}.{export['format']}"
    path.write_bytes(base64.b64decode(export["content_base64"]))
    db_put("exports", eid, {"filename": export["filename"], "mime": export.get("mime"), "path": path.name, "created_at": _now()})
    return {"id": eid, "format": export["format"], "title": export.get("title"), "filename": export["filename"],
            "download_url": f"/api/exports/{eid}/download"}


def _after_done(bot_id: str, stamp: dict, event: dict) -> dict:
    """เก็บ cache/usage ที่ central ส่งกลับ แล้วคืน event ที่ส่งต่อให้หน้าเว็บ (ไม่มี cache)"""
    if "cache" in event:
        db_put("caches", bot_id, {"stamp": stamp, "data": event.pop("cache")})
    add_usage(event.get("usage"))
    with _db_lock:
        bot = db_get("bots", bot_id)
        if bot:
            bot["last_chatted_at"] = _now()
            db_put("bots", bot_id, bot)
    if event.get("export"):
        event["export"] = _save_export(event["export"])
    return event


async def _read_file_part(file: UploadFile | None):
    if file is None:
        return None
    return {"file": (file.filename or "attachment", await file.read(), file.content_type or "application/octet-stream")}


@app.post("/api/bots/{bot_id}/chat/stream")
async def chat_stream(bot_id: str, message: str = Form(...), file: UploadFile | None = File(None)):
    bot = _get_bot(bot_id)
    stamp = _cache_stamp(bot)
    payload = _chat_payload(bot, message, stamp)
    file_part = await _read_file_part(file)
    url, _ = _central()

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    async def gen():
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                for attempt in range(2):
                    token = get_token(force=attempt > 0)
                    async with client.stream("POST", f"{url}/v1/chat/stream",
                                             headers={"Authorization": f"Bearer {token}"},
                                             data={"payload": json.dumps(payload, ensure_ascii=False)},
                                             files=file_part) as resp:
                        if resp.status_code == 401 and attempt == 0:
                            continue
                        if resp.status_code >= 400:
                            await resp.aread()
                            _raise_for(resp)
                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            event = json.loads(line[6:])
                            if event.get("type") == "done":
                                event = _after_done(bot_id, stamp, event)
                            yield sse(event)
                    break
        except CentralError as e:
            yield sse({"type": "error", "error": {"code": e.code, "message": e.message}})
            yield sse({"type": "done", "used_skill": False})
        except httpx.HTTPError as e:
            yield sse({"type": "error", "error": {"code": "central_unreachable", "message": f"ติดต่อ central ไม่ได้ ({type(e).__name__})"}})
            yield sse({"type": "done", "used_skill": False})

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/bots/{bot_id}/chat")
async def chat(bot_id: str, message: str = Form(...), file: UploadFile | None = File(None)):
    bot = _get_bot(bot_id)
    stamp = _cache_stamp(bot)
    payload = _chat_payload(bot, message, stamp)
    file_part = await _read_file_part(file)
    url, _ = _central()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for attempt in range(2):
            resp = await client.post(f"{url}/v1/chat", headers={"Authorization": f"Bearer {get_token(force=attempt > 0)}"},
                                     data={"payload": json.dumps(payload, ensure_ascii=False)}, files=file_part)
            if resp.status_code == 401 and attempt == 0:
                continue
            break
    _raise_for(resp)
    body = _after_done(bot_id, stamp, resp.json())
    return {k: body[k] for k in ("reply", "used_skill", "export") if k in body}


STT_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")


@app.post("/api/bots/{bot_id}/transcribe")
async def transcribe(bot_id: str, file: UploadFile = File(...), language: str = Form("")):
    """ถอดเสียงจากปุ่มไมค์ในหน้าแชท — ส่งเสียงให้ central พร้อมโมเดลของเรา (central ไม่มีโมเดลเอง)
    ได้ข้อความกลับมาใส่ช่องพิมพ์ ผู้ใช้ตรวจ/แก้ก่อนกดส่งเอง (ไม่ส่งเข้าแชทอัตโนมัติ)"""
    bot = _get_bot(bot_id)
    s = load_settings()
    model = stt_model_for(s, bot)
    if not model:
        raise HTTPException(400, "ยังไม่มีโมเดลถอดเสียง — เพิ่ม Speech-to-Text ในหลังบ้าน → การเชื่อมต่อ AI หรือใช้ LLM ที่เป็น Gemini")
    language = language.strip()
    payload = {"ctx": {"credentials": {"stt": model_creds(s, model)}},
               "language": language if STT_LANGUAGE_RE.match(language) else None}
    data = await file.read()
    if not data:
        raise HTTPException(400, "ไม่ได้ยินเสียง ลองอัดใหม่อีกครั้ง")
    file_part = {"file": (file.filename or "voice.wav", data, file.content_type or "audio/wav")}
    url, _ = _central(s)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for attempt in range(2):
            try:
                resp = await client.post(f"{url}/v1/stt", headers={"Authorization": f"Bearer {get_token(force=attempt > 0, settings=s)}"},
                                         data={"payload": json.dumps(payload, ensure_ascii=False)}, files=file_part)
            except httpx.HTTPError as e:
                raise CentralError(502, "central_unreachable", f"ติดต่อ central ไม่ได้ ({type(e).__name__})")
            if resp.status_code == 401 and attempt == 0:
                continue
            break
    _raise_for(resp)
    body = resp.json()
    add_usage(body.get("usage"))
    return {"text": body.get("text") or ""}


@app.get("/api/exports/{export_id}/download")
def download_export(export_id: str):
    rec = db_get("exports", export_id)
    if not rec:
        raise HTTPException(404, "ไม่พบไฟล์")
    return FileResponse(EXPORTS_DIR / rec["path"], filename=rec["filename"], media_type=rec.get("mime") or "application/octet-stream")


# ══════════════════════════════════════════════
# หน้าเว็บ (Next.js static export) — mount ท้ายสุดเพื่อไม่ทับ /api
# ══════════════════════════════════════════════

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
else:
    @app.get("/")
    def _no_frontend():
        return JSONResponse({"detail": f"ยังไม่ได้ build หน้าเว็บ ({FRONTEND_DIR}) — รัน npm ci && npm run build ใน node/frontend"}, status_code=503)
