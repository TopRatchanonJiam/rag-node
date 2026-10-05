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

_TABLES = ("kbs", "skills", "bots", "caches", "exports")
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
               "embed_tokens": 0, "embed_calls": 0, "rerank_calls": 0, "requests": 0}


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
# Settings — key เข้ารหัส, แก้ได้จากหน้าเว็บ, มีผลทันที
# ══════════════════════════════════════════════

SECTIONS = ("llm", "embedding", "rerank", "vector", "central")
SECRET_FIELDS = {"api_key", "license_key"}
_settings_cache: dict | None = None


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


def _defaults_from_env() -> dict:
    """ค่าเริ่มต้นครั้งแรกจาก .env — node ที่ติดตั้งไว้แล้วจึงย้ายมาใช้ Settings ได้โดยไม่ต้องตั้งใหม่"""
    return {
        "llm": {"provider": _env("LLM_PROVIDER", "google"), "model": _env("LLM_MODEL", "gemini-2.5-flash"),
                "api_key": _env("LLM_API_KEY"), "base_url": _env("LLM_BASE_URL")},
        "embedding": {"provider": _env("EMBED_PROVIDER", "openai_compatible"),
                      "model": _env("EMBED_MODEL", "Qwen/Qwen3-Embedding-4B"),
                      "api_key": _env("EMBED_API_KEY"), "base_url": _env("EMBED_BASE_URL", "https://api.siliconflow.com/v1"),
                      "dim": int(_env("EMBED_DIM", "2560") or 0)},
        "rerank": {"enabled": bool(_env("RERANK_API_KEY")), "api_key": _env("RERANK_API_KEY"),
                   "model": _env("RERANK_MODEL", "Qwen/Qwen3-Reranker-0.6B"),
                   "base_url": _env("RERANK_BASE_URL", "https://api.siliconflow.com/v1")},
        "vector": {"url": _env("QDRANT_URL"), "api_key": _env("QDRANT_API_KEY")},
        "central": {"url": _env("CENTRAL_URL", "http://127.0.0.1:9000"), "license_key": _env("LICENSE_KEY")},
    }


def _write_settings(settings: dict) -> None:
    global _settings_cache
    with _db_lock, _db() as c:
        for section in SECTIONS:
            stored = {k: (_enc(v) if k in SECRET_FIELDS else v) for k, v in settings[section].items()}
            c.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (section, json.dumps(stored, ensure_ascii=False)))
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
    defaults = _defaults_from_env()
    settings = {}
    for section in SECTIONS:
        raw = json.loads(rows.get(section, "{}"))
        merged = {**{k: ("" if k in SECRET_FIELDS else v) for k, v in defaults[section].items()}, **raw}
        settings[section] = {k: (_dec(v) if k in SECRET_FIELDS else v) for k, v in merged.items()}
    _settings_cache = settings
    return settings


def _mask(value: str) -> dict:
    return {"set": bool(value), "hint": f"••••{value[-4:]}" if len(value) >= 8 else ("••••" if value else "")}


def public_settings(settings: dict) -> dict:
    return {section: {k: (_mask(v) if k in SECRET_FIELDS else v) for k, v in values.items()}
            for section, values in settings.items()}


def merge_settings(current: dict, incoming: dict) -> dict:
    """รวมค่าที่ส่งมาจากฟอร์มเข้ากับค่าเดิม — ช่อง key: ไม่ส่ง/ส่งว่าง = ใช้ค่าเดิม, ส่ง null = ลบ"""
    merged = {s: dict(current[s]) for s in SECTIONS}
    for section in SECTIONS:
        for k, v in (incoming.get(section) or {}).items():
            if k not in merged[section]:
                continue
            if k in SECRET_FIELDS:
                if v is None:
                    merged[section][k] = ""
                elif isinstance(v, str) and v.strip():
                    merged[section][k] = v.strip()
            elif k == "dim":
                merged[section][k] = int(v or 0)
            elif k == "enabled":
                merged[section][k] = bool(v)
            else:
                merged[section][k] = (v or "").strip() if isinstance(v, str) else v
    return merged


def _provider_cfg(cfg: dict) -> dict:
    """แปลงค่าที่ผู้ใช้เลือกให้อยู่ในรูปที่ central รับได้ — ollama = endpoint แบบ OpenAI ที่ /v1
    (ทำที่ node เพื่อให้ใช้ได้แม้ central ยังเป็นรุ่นที่ไม่รู้จัก ollama) และเซิร์ฟเวอร์ในเครื่องที่ไม่ใช้ key"""
    provider = (cfg.get("provider") or "").lower()
    out = {"provider": provider, "model": cfg.get("model", ""), "api_key": cfg.get("api_key", "")}
    base = (cfg.get("base_url") or "").strip()
    if provider == "ollama":
        base = (base or "http://localhost:11434").rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        out["provider"] = "openai_compatible"
        out["api_key"] = out["api_key"] or "ollama"
    elif provider == "openai_compatible":
        out["api_key"] = out["api_key"] or "not-needed"
    if base and provider != "google":
        out["base_url"] = base
    return out


def credentials(settings: dict | None = None) -> dict:
    s = settings or load_settings()
    creds = {
        "llm": _provider_cfg(s["llm"]),
        "embedding": _provider_cfg(s["embedding"]),
        "vector": {"url": s["vector"].get("url", ""), "api_key": s["vector"].get("api_key") or None},
    }
    rr = s["rerank"]
    if rr.get("enabled") and rr.get("api_key"):
        creds["rerank"] = {"api_key": rr["api_key"], "model": rr.get("model") or None, "base_url": rr.get("base_url") or None}
    return creds


def embedding_lock_info(settings: dict) -> dict:
    return {"provider": settings["embedding"].get("provider"), "model": settings["embedding"].get("model"),
            "dim": int(settings["embedding"].get("dim") or 0)}


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


def kb_payload(kb: dict) -> dict:
    return {"kb_id": kb["id"], "name": kb["name"], "collection_name": kb["collection_name"], "embedding": kb["embedding"]}


def _ctx() -> dict:
    return {"credentials": credentials()}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


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


# ══════════════════════════════════════════════
# หลังบ้าน: การเชื่อมต่อ (Settings) + สถานะ
# ══════════════════════════════════════════════

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/admin/settings")
def get_settings():
    s = load_settings()
    return {"settings": public_settings(s), "kb_count": len(db_all("kbs"))}


def _run_check(settings: dict) -> dict:
    """ตรวจทุกส่วนด้วยการตั้งค่าที่ให้มา (ใช้ได้ทั้งค่าที่บันทึกแล้ว และค่าในฟอร์มที่ยังไม่บันทึก)"""
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
        check = central_json("/v1/credentials/check", {"ctx": {"credentials": credentials(settings)}}, settings=settings)
        for k in ("llm", "embedding", "vector", "rerank"):
            out[k] = check.get(k)
        dim = int(settings["embedding"].get("dim") or 0)
        got = (check.get("embedding") or {}).get("dim")
        if got and dim and got != dim:
            out["embedding"]["dim_mismatch"] = {"configured": dim, "actual": got}
    except CentralError as e:
        out["llm"] = {"ok": False, "error_code": e.code, "message": e.message}
    return out


@app.post("/api/admin/settings/test")
def test_settings(body: dict = Body(default={})):
    return _run_check(merge_settings(load_settings(), body.get("settings") or {}))


@app.put("/api/admin/settings")
def save_settings(body: dict = Body(...)):
    current = load_settings()
    new = merge_settings(current, body.get("settings") or {})
    if not new["embedding"].get("model") or int(new["embedding"].get("dim") or 0) <= 0:
        raise HTTPException(400, "ต้องระบุโมเดล embedding และจำนวนมิติ (dim)")

    # ล็อก embedding ต่อ KB — KB เดิมใช้โมเดลอื่นจะค้นไม่ได้ ต้องยืนยันก่อนเปลี่ยน
    new_emb = embedding_lock_info(new)
    affected = [kb["name"] for kb in db_all("kbs")
                if kb["embedding"].get("model") != new_emb["model"] or int(kb["embedding"].get("dim") or 0) != new_emb["dim"]]
    old_emb = embedding_lock_info(current)
    if affected and (old_emb["model"], old_emb["dim"]) != (new_emb["model"], new_emb["dim"]) and not body.get("confirm_embedding_change"):
        return JSONResponse(status_code=409, content={
            "detail": "เปลี่ยน embedding แล้ว KB เดิมจะใช้ไม่ได้ ต้องสร้าง KB ใหม่และอัปโหลดใหม่",
            "code": "embedding_change", "affected_kbs": affected,
        })

    _write_settings(new)
    with _token_lock:
        _tokens.clear()
    return {"settings": public_settings(load_settings())}


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
    kbs = db_all("kbs")
    return {
        "central": central,
        "license": license_info,
        "models": {"llm": {"provider": s["llm"].get("provider"), "model": s["llm"].get("model")},
                   "embedding": embedding_lock_info(s),
                   "rerank": bool(s["rerank"].get("enabled") and s["rerank"].get("api_key"))},
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


def _kb_out(kb: dict, with_files: bool = False) -> dict:
    files = kb.get("files", {})
    out = {
        "id": kb["id"], "name": kb["name"], "description": kb.get("description", ""),
        "collection_name": kb["collection_name"], "created_at": kb["created_at"],
        "file_count": len(files), "chunk_count": sum(f.get("chunks", 0) for f in files.values()),
        "embedding": kb["embedding"],
        "embedding_matches": kb["embedding"].get("model") == load_settings()["embedding"].get("model"),
    }
    if with_files:
        out["files"] = [{"name": n, "size": f.get("size", 0), "type": Path(n).suffix.lstrip("."),
                         "chunks": f.get("chunks", 0), "uploaded_at": f.get("uploaded_at")} for n, f in files.items()]
    return out


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
    emb = embedding_lock_info(load_settings())
    if not emb["model"] or emb["dim"] <= 0:
        raise HTTPException(400, "ตั้งโมเดล embedding และ dim ในหน้าการเชื่อมต่อก่อนสร้าง Knowledge Base")
    kb_id = _new_id()
    kb = {
        "id": kb_id, "name": req.name.strip(), "description": req.description.strip(),
        "collection_name": f"kb_{kb_id}",
        # ล็อก embedding ตอนสร้าง — เปลี่ยนทีหลังไม่ได้ ต้องสร้าง KB ใหม่แล้ว ingest ใหม่
        "embedding": emb, "files": {}, "revision": 0, "created_at": _now(),
    }
    central_json("/v1/kb/ensure", {"ctx": _ctx(), "kb": kb_payload(kb)})
    db_put("kbs", kb_id, kb)
    return _kb_out(kb)


@app.get("/api/kb/{kb_id}")
def get_kb(kb_id: str):
    return _kb_out(_get_kb(kb_id), with_files=True)


@app.delete("/api/kb/{kb_id}")
def delete_kb(kb_id: str):
    kb = _get_kb(kb_id)
    central_json("/v1/kb/drop", {"ctx": _ctx(), "kb": kb_payload(kb)})
    db_delete("kbs", kb_id)
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
    payload = {"ctx": _ctx(), "kb": kb_payload(kb), "source": {"filename": filename, "replace_existing": True}}
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
    current_model = load_settings()["embedding"].get("model")
    if kb["embedding"].get("model") != current_model:
        raise HTTPException(409, f"Knowledge Base นี้สร้างด้วย embedding '{kb['embedding'].get('model')}' แต่ตอนนี้ตั้งเป็น "
                                 f"'{current_model}' — สร้าง Knowledge Base ใหม่เพื่อใช้ embedding ตัวใหม่")
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
    central_json("/v1/kb/delete-source", {"ctx": _ctx(), "kb": kb_payload(kb), "source": filename})
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
    result = central_json("/v1/kb/chunks", {"ctx": _ctx(), "kb": kb_payload(kb), "source": filename})
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


class BotUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    kb_ids: list[str] | None = None
    skill_set_ids: list[str] | None = None
    system_prompt: str | None = None
    use_rerank: bool | None = None
    quick_chat_enabled: bool | None = None
    quick_chat_tags: list[str] | None = None


def _enrich(bot: dict) -> dict:
    kbs = {kb["id"]: kb for kb in db_all("kbs")}
    skills = {s["id"]: s for s in db_all("skills")}
    return {
        **bot,
        "kb_names": [kbs[k]["name"] for k in bot["kb_ids"] if k in kbs],
        "skill_set_names": [skills[s]["name"] for s in bot["skill_set_ids"] if s in skills],
    }


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
    bid = _new_id()
    bot = {
        "id": bid, "name": req.name.strip(), "description": req.description.strip(),
        "kb_ids": req.kb_ids, "skill_set_ids": req.skill_set_ids,
        "system_prompt": req.system_prompt or DEFAULT_SYSTEM_PROMPT, "use_rerank": req.use_rerank,
        "quick_chat_enabled": req.quick_chat_enabled, "quick_chat_tags": [t.strip() for t in req.quick_chat_tags],
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
        "embed_model": load_settings()["embedding"].get("model"),
    }


def _chat_payload(bot: dict, message: str, stamp: dict) -> dict:
    kbs = [kb_payload(kb) for k in bot["kb_ids"] if (kb := db_get("kbs", k))]
    skills = [{"id": s["id"], "name": s["name"], "files": [{"name": n, "content": c} for n, c in s["files"].items()]}
              for i in bot["skill_set_ids"] if (s := db_get("skills", i))]
    cached = db_get("caches", bot["id"]) or {}
    cache = cached.get("data") if cached.get("stamp") == stamp else {}
    return {
        "ctx": {"credentials": credentials(), "cache": cache or {}},
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
