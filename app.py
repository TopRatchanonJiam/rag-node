"""node/app.py — เครื่องลูกค้า (VPS2 หรือเครื่อง local) แบบบาง

หน้าที่:
- ถือ key ของลูกค้า (LLM / embedding / rerank / Qdrant) ใน .env แล้วแนบไปกับทุก request ถึง central
- เก็บสถานะของตัวเอง (KB, ชุดสูตร, บอท, cache, usage) ในไฟล์ JSON — ไม่มีฐานข้อมูล
- เก็บไฟล์ต้นฉบับไว้เผื่อ re-index และเก็บไฟล์ export ที่ central ส่งกลับมา
- เสิร์ฟหน้าเว็บหมวดแชทบอท (frontend/out — Next.js static export) บน origin เดียวกับ API

API ใช้ path และรูปแบบเดียวกับ backend เดิม (/api/kb, /api/skills, /api/bots) เพื่อให้หน้าเว็บเดิม
ใช้ได้โดยไม่ต้องแก้ — ต่างกันแค่เบื้องหลังไม่ได้ประมวลผลเอง แต่ส่งต่อให้ central
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("NODE_DATA_DIR") or ROOT / "data")
STATE_FILE = DATA_DIR / "state.json"
ORIGINALS_DIR = DATA_DIR / "originals"
EXPORTS_DIR = DATA_DIR / "exports"
FRONTEND_DIR = Path(os.environ.get("NODE_FRONTEND_DIR") or ROOT / "frontend" / "out")

CENTRAL_URL = os.environ.get("CENTRAL_URL", "http://127.0.0.1:9000").rstrip("/")
LICENSE_KEY = os.environ.get("LICENSE_KEY", "")
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
# Basic Auth (เปิดเมื่อตั้ง NODE_PASSWORD เท่านั้น)
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


# ══════════════════════════════════════════════
# เครื่องปรุงของลูกค้า (จาก .env)
# ══════════════════════════════════════════════

def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def embedding_config() -> dict:
    return {
        "provider": _env("EMBED_PROVIDER", "openai_compatible"),
        "model": _env("EMBED_MODEL"),
        "api_key": _env("EMBED_API_KEY"),
        "base_url": _env("EMBED_BASE_URL") or None,
        "dim": int(_env("EMBED_DIM", "0") or 0),
    }


def credentials() -> dict:
    llm = {"provider": _env("LLM_PROVIDER", "google"), "model": _env("LLM_MODEL"), "api_key": _env("LLM_API_KEY")}
    if _env("LLM_BASE_URL"):
        llm["base_url"] = _env("LLM_BASE_URL")
    emb = embedding_config()
    creds = {
        "llm": llm,
        "embedding": {k: v for k, v in emb.items() if k != "dim" and v},
        "vector": {"url": _env("QDRANT_URL"), "api_key": _env("QDRANT_API_KEY") or None},
    }
    if _env("RERANK_API_KEY"):
        creds["rerank"] = {"api_key": _env("RERANK_API_KEY"), "model": _env("RERANK_MODEL") or None,
                           "base_url": _env("RERANK_BASE_URL") or None}
    return creds


# ══════════════════════════════════════════════
# State (ไฟล์ JSON)
# ══════════════════════════════════════════════

_state_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_state() -> dict:
    with _state_lock:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
        for key in ("kbs", "skills", "bots", "caches", "exports"):
            state.setdefault(key, {})
        state.setdefault("usage", {"llm_input_tokens": 0, "llm_output_tokens": 0, "llm_calls": 0,
                                   "embed_tokens": 0, "embed_calls": 0, "rerank_calls": 0, "requests": 0})
        return state


def save_state(state: dict) -> None:
    with _state_lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATE_FILE)


def add_usage(state: dict, usage: dict | None) -> None:
    if not usage:
        return
    u = state["usage"]
    llm, emb, rr = usage.get("llm") or {}, usage.get("embedding") or {}, usage.get("rerank") or {}
    u["llm_input_tokens"] += int(llm.get("input_tokens") or 0)
    u["llm_output_tokens"] += int(llm.get("output_tokens") or 0)
    u["llm_calls"] += int(llm.get("calls") or 0)
    u["embed_tokens"] += int(emb.get("tokens") or 0)
    u["embed_calls"] += int(emb.get("calls") or 0)
    u["rerank_calls"] += int(rr.get("calls") or 0)
    u["requests"] += 1


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _safe_filename(name: str) -> str:
    name = Path(name or "").name
    if not name or name in {".", ".."}:
        raise HTTPException(400, "ชื่อไฟล์ไม่ถูกต้อง")
    return name


# ══════════════════════════════════════════════
# Central client
# ══════════════════════════════════════════════

_token: dict = {"value": None, "exp": 0.0}
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


def get_token(force: bool = False) -> str:
    with _token_lock:
        if not force and _token["value"] and _token["exp"] - 60 > time.time():
            return _token["value"]
        _token["value"] = None
        if not LICENSE_KEY:
            raise CentralError(500, "no_license", "ยังไม่ได้ตั้ง LICENSE_KEY ใน .env ของ node")
        try:
            resp = httpx.post(f"{CENTRAL_URL}/v1/auth/token", json={"license_key": LICENSE_KEY}, timeout=20)
        except httpx.HTTPError as e:
            raise CentralError(502, "central_unreachable", f"ติดต่อ central ที่ {CENTRAL_URL} ไม่ได้ ({type(e).__name__})")
        _raise_for(resp)
        body = resp.json()
        _token["value"] = body["access_token"]
        _token["exp"] = time.time() + int(body.get("expires_in", 900))
        _token["license"] = body.get("license")
        _token["warnings"] = body.get("warnings") or []
        return _token["value"]


def central_json(path: str, body: dict) -> dict:
    resp = None
    for attempt in range(2):
        try:
            resp = httpx.post(f"{CENTRAL_URL}{path}", json=body,
                              headers={"Authorization": f"Bearer {get_token(force=attempt > 0)}"}, timeout=TIMEOUT)
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


# ══════════════════════════════════════════════
# Status
# ══════════════════════════════════════════════

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/health")
def health():
    out: dict = {"central_url": CENTRAL_URL}
    try:
        out["central"] = httpx.get(f"{CENTRAL_URL}/v1/meta", timeout=10).json()
    except Exception as e:
        out["central"] = {"error": f"ติดต่อ central ไม่ได้: {type(e).__name__}"}
        return out
    try:
        get_token(force=True)
        out["license"] = {"ok": True, **(_token.get("license") or {}), "warnings": _token.get("warnings")}
        out["credentials"] = central_json("/v1/credentials/check", {"ctx": _ctx()})
    except CentralError as e:
        out["license"] = {"ok": False, "code": e.code, "message": e.message}
    return out


@app.get("/api/usage")
def usage():
    return load_state()["usage"]


# ══════════════════════════════════════════════
# Knowledge Bases  (รูปแบบเดียวกับ kb_router.py เดิม)
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
    }
    if with_files:
        out["files"] = [{"name": n, "size": f.get("size", 0), "type": Path(n).suffix.lstrip(".")} for n, f in files.items()]
    return out


def _get_kb(state: dict, kb_id: str) -> dict:
    kb = state["kbs"].get(kb_id)
    if not kb:
        raise HTTPException(404, "ไม่พบ Knowledge Base")
    return kb


@app.get("/api/kb")
def list_kbs():
    return {"knowledge_bases": [_kb_out(kb) for kb in load_state()["kbs"].values()]}


@app.post("/api/kb")
def create_kb(req: KbCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อ Knowledge Base")
    emb = embedding_config()
    if not emb["model"] or emb["dim"] <= 0:
        raise HTTPException(400, "ตั้ง EMBED_MODEL และ EMBED_DIM ใน .env ก่อนสร้าง Knowledge Base")
    kb_id = _new_id()
    kb = {
        "id": kb_id, "name": req.name.strip(), "description": req.description.strip(),
        "collection_name": f"kb_{kb_id}",
        # ล็อก embedding ตอนสร้าง — เปลี่ยนทีหลังไม่ได้ ต้องสร้าง KB ใหม่แล้ว ingest ใหม่
        "embedding": {"provider": emb["provider"], "model": emb["model"], "dim": emb["dim"]},
        "files": {}, "revision": 0, "created_at": _now(),
    }
    central_json("/v1/kb/ensure", {"ctx": _ctx(), "kb": kb_payload(kb)})
    state = load_state()
    state["kbs"][kb_id] = kb
    save_state(state)
    return _kb_out(kb)


@app.get("/api/kb/{kb_id}")
def get_kb(kb_id: str):
    return _kb_out(_get_kb(load_state(), kb_id), with_files=True)


@app.delete("/api/kb/{kb_id}")
def delete_kb(kb_id: str):
    kb = _get_kb(load_state(), kb_id)
    central_json("/v1/kb/drop", {"ctx": _ctx(), "kb": kb_payload(kb)})
    state = load_state()
    state["kbs"].pop(kb_id, None)
    for bot in state["bots"].values():
        bot["kb_ids"] = [k for k in bot["kb_ids"] if k != kb_id]
    save_state(state)
    folder = ORIGINALS_DIR / kb_id
    if folder.exists():
        for f in folder.iterdir():
            f.unlink(missing_ok=True)
        folder.rmdir()
    return {"message": "ลบ Knowledge Base สำเร็จ"}


def _ingest_via_central(kb: dict, filename: str, data: bytes) -> dict:
    payload = {"ctx": _ctx(), "kb": kb_payload(kb), "source": {"filename": filename, "replace_existing": True}}
    for attempt in range(2):
        headers = {"Authorization": f"Bearer {get_token(force=attempt > 0)}"}
        try:
            with httpx.stream("POST", f"{CENTRAL_URL}/v1/ingest/file", headers=headers, timeout=TIMEOUT,
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
                        state = load_state()
                        add_usage(state, event.get("usage"))
                        save_state(state)
                        raise CentralError(502, err.get("code", "ingest_failed"), err.get("message", "ingest ไม่สำเร็จ"))
        except httpx.HTTPError as e:
            raise CentralError(502, "central_unreachable", f"ติดต่อ central ไม่ได้ ({type(e).__name__})")
    raise CentralError(502, "ingest_failed", "central ปิดการเชื่อมต่อก่อนส่งผลลัพธ์")


@app.post("/api/kb/{kb_id}/upload")
def upload_to_kb(kb_id: str, file: UploadFile = File(...)):
    kb = _get_kb(load_state(), kb_id)
    filename = _safe_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in KB_ALLOWED:
        raise HTTPException(400, f"รองรับเฉพาะ {', '.join(KB_ALLOWED)} เท่านั้น")
    if kb["embedding"]["model"] != embedding_config()["model"]:
        raise HTTPException(409, f"Knowledge Base นี้สร้างด้วย embedding '{kb['embedding']['model']}' แต่ .env ตอนนี้เป็น "
                                 f"'{embedding_config()['model']}' — ห้ามเปลี่ยน embedding ของ KB เดิม")
    data = file.file.read()

    # เก็บต้นฉบับไว้ที่ node (central ไม่เก็บ) เผื่อวันที่ต้อง re-index
    folder = ORIGINALS_DIR / kb_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)

    result = _ingest_via_central(kb, filename, data)

    state = load_state()
    kb = state["kbs"].get(kb_id)
    if kb:
        kb["files"][filename] = {"size": len(data), "chunks": result.get("chunks", 0),
                                 "chunk_types": result.get("chunk_types", {}), "uploaded_at": _now()}
        kb["revision"] = kb.get("revision", 0) + 1
    add_usage(state, result.get("usage"))
    save_state(state)
    return {
        "message": f"อัปโหลด '{filename}' เข้า '{kb['name'] if kb else kb_id}' สำเร็จ",
        "chunks": result.get("chunks", 0),
        "chunk_types": result.get("chunk_types", {}),
        "filename": filename,
        "type": suffix.lstrip("."),
    }


@app.delete("/api/kb/{kb_id}/files/{filename}")
def delete_kb_file(kb_id: str, filename: str):
    kb = _get_kb(load_state(), kb_id)
    filename = _safe_filename(filename)
    if filename not in kb.get("files", {}):
        raise HTTPException(404, "ไม่พบไฟล์")
    central_json("/v1/kb/delete-source", {"ctx": _ctx(), "kb": kb_payload(kb), "source": filename})
    state = load_state()
    kb = state["kbs"].get(kb_id)
    if kb:
        kb["files"].pop(filename, None)
        kb["revision"] = kb.get("revision", 0) + 1
    save_state(state)
    (ORIGINALS_DIR / kb_id / filename).unlink(missing_ok=True)
    return {"message": f"ลบ '{filename}' สำเร็จ"}


@app.get("/api/kb/{kb_id}/files/{filename}/chunks")
def get_kb_file_chunks(kb_id: str, filename: str):
    kb = _get_kb(load_state(), kb_id)
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
# Skill Sets  (รูปแบบเดียวกับ skill_router.py เดิม)
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


def _get_skill(state: dict, skill_id: str) -> dict:
    s = state["skills"].get(skill_id)
    if not s:
        raise HTTPException(404, "ไม่พบ Skill Set")
    return s


@app.get("/api/skills")
def list_skill_sets():
    return {"skill_sets": [_skill_out(s) for s in load_state()["skills"].values()]}


@app.post("/api/skills")
def create_skill_set(req: SkillSetCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อ Skill Set")
    state = load_state()
    sid = _new_id()
    state["skills"][sid] = {"id": sid, "name": req.name.strip(), "description": req.description.strip(),
                            "files": {}, "revision": 0, "created_at": _now()}
    save_state(state)
    return _skill_out(state["skills"][sid])


@app.get("/api/skills/{skill_id}")
def get_skill_set(skill_id: str):
    return _skill_out(_get_skill(load_state(), skill_id), detail=True)


@app.delete("/api/skills/{skill_id}")
def delete_skill_set(skill_id: str):
    state = load_state()
    _get_skill(state, skill_id)
    state["skills"].pop(skill_id)
    for bot in state["bots"].values():
        bot["skill_set_ids"] = [s for s in bot["skill_set_ids"] if s != skill_id]
    save_state(state)
    return {"message": "ลบ Skill Set สำเร็จ"}


@app.post("/api/skills/{skill_id}/upload")
def upload_skill_file(skill_id: str, file: UploadFile = File(...)):
    filename = _safe_filename(file.filename)
    if not filename.lower().endswith(".md"):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ .md เท่านั้น")
    content = file.file.read().decode("utf-8")
    state = load_state()
    skill = _get_skill(state, skill_id)
    skill["files"][filename] = content
    skill["revision"] = skill.get("revision", 0) + 1
    save_state(state)
    return {"message": f"อัปโหลด '{filename}' สำเร็จ", "skills_parsed": len(_preview_skills(content)), "filename": filename}


@app.delete("/api/skills/{skill_id}/files/{filename}")
def delete_skill_file(skill_id: str, filename: str):
    state = load_state()
    skill = _get_skill(state, skill_id)
    if skill["files"].pop(_safe_filename(filename), None) is None:
        raise HTTPException(404, "ไม่พบไฟล์")
    skill["revision"] = skill.get("revision", 0) + 1
    save_state(state)
    return {"message": f"ลบ '{filename}' สำเร็จ"}


# ══════════════════════════════════════════════
# Chatbots  (รูปแบบเดียวกับ bot_router.py เดิม)
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


def _enrich(state: dict, bot: dict) -> dict:
    return {
        **bot,
        "kb_names": [state["kbs"][k]["name"] for k in bot["kb_ids"] if k in state["kbs"]],
        "skill_set_names": [state["skills"][s]["name"] for s in bot["skill_set_ids"] if s in state["skills"]],
    }


def _validate_refs(state: dict, kb_ids: list[str] | None, skill_ids: list[str] | None, tags: list[str] | None):
    for k in kb_ids or []:
        if k not in state["kbs"]:
            raise HTTPException(400, f"ไม่พบ Knowledge Base '{k}'")
    for s in skill_ids or []:
        if s not in state["skills"]:
            raise HTTPException(400, f"ไม่พบ Skill Set '{s}'")
    if tags is not None:
        if len(tags) > QUICK_CHAT_MAX_TAGS:
            raise HTTPException(400, f"Quick Chat ได้สูงสุด {QUICK_CHAT_MAX_TAGS} รายการ")
        for t in tags:
            if not t.strip():
                raise HTTPException(400, "Quick Chat ห้ามเป็นข้อความว่างเปล่า")
            if len(t) > QUICK_CHAT_MAX_TAG_LENGTH:
                raise HTTPException(400, f"Quick Chat แต่ละรายการยาวได้ไม่เกิน {QUICK_CHAT_MAX_TAG_LENGTH} ตัวอักษร")


def _get_bot(state: dict, bot_id: str) -> dict:
    bot = state["bots"].get(bot_id)
    if not bot:
        raise HTTPException(404, "ไม่พบ Chatbot")
    return bot


@app.get("/api/bots")
def list_bots():
    state = load_state()
    return {"bots": [_enrich(state, b) for b in state["bots"].values()]}


@app.post("/api/bots")
def create_bot(req: BotCreateRequest):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อ Chatbot")
    state = load_state()
    _validate_refs(state, req.kb_ids, req.skill_set_ids, req.quick_chat_tags)
    bid = _new_id()
    state["bots"][bid] = {
        "id": bid, "name": req.name.strip(), "description": req.description.strip(),
        "kb_ids": req.kb_ids, "skill_set_ids": req.skill_set_ids,
        "system_prompt": req.system_prompt or DEFAULT_SYSTEM_PROMPT, "use_rerank": req.use_rerank,
        "quick_chat_enabled": req.quick_chat_enabled, "quick_chat_tags": [t.strip() for t in req.quick_chat_tags],
        "created_at": _now(), "last_chatted_at": None,
    }
    save_state(state)
    return _enrich(state, state["bots"][bid])


@app.get("/api/bots/{bot_id}")
def get_bot(bot_id: str):
    state = load_state()
    return _enrich(state, _get_bot(state, bot_id))


@app.put("/api/bots/{bot_id}")
def update_bot(bot_id: str, req: BotUpdateRequest):
    state = load_state()
    bot = _get_bot(state, bot_id)
    _validate_refs(state, req.kb_ids, req.skill_set_ids, req.quick_chat_tags)
    for field, value in req.model_dump(exclude_none=True).items():
        bot[field] = [t.strip() for t in value] if field == "quick_chat_tags" else value
    state["caches"].pop(bot_id, None)
    save_state(state)
    return _enrich(state, bot)


@app.delete("/api/bots/{bot_id}")
def delete_bot(bot_id: str):
    state = load_state()
    _get_bot(state, bot_id)
    state["bots"].pop(bot_id)
    state["caches"].pop(bot_id, None)
    save_state(state)
    return {"message": "ลบ Chatbot สำเร็จ"}


def _cache_stamp(state: dict, bot: dict) -> dict:
    return {
        "kbs": {k: state["kbs"][k].get("revision", 0) for k in bot["kb_ids"] if k in state["kbs"]},
        "skills": {s: state["skills"][s].get("revision", 0) for s in bot["skill_set_ids"] if s in state["skills"]},
        "embed_model": embedding_config()["model"],
    }


def _chat_payload(state: dict, bot: dict, message: str) -> dict:
    kbs = [kb_payload(state["kbs"][k]) for k in bot["kb_ids"] if k in state["kbs"]]
    skills = [{"id": s["id"], "name": s["name"], "files": [{"name": n, "content": c} for n, c in s["files"].items()]}
              for s in (state["skills"].get(i) for i in bot["skill_set_ids"]) if s]
    cached = state["caches"].get(bot["id"]) or {}
    cache = cached.get("data") if cached.get("stamp") == _cache_stamp(state, bot) else {}
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
    state = load_state()
    state["exports"][eid] = {"filename": export["filename"], "mime": export.get("mime"), "path": path.name, "created_at": _now()}
    save_state(state)
    return {"id": eid, "format": export["format"], "title": export.get("title"), "filename": export["filename"],
            "download_url": f"/api/exports/{eid}/download"}


def _after_done(bot_id: str, stamp: dict, event: dict) -> dict:
    """เก็บ cache/usage ที่ central ส่งกลับ แล้วคืน event ที่ส่งต่อให้หน้าเว็บ (ไม่มี cache)"""
    st = load_state()
    if "cache" in event:
        st["caches"][bot_id] = {"stamp": stamp, "data": event.pop("cache")}
    add_usage(st, event.get("usage"))
    if bot_id in st["bots"]:
        st["bots"][bot_id]["last_chatted_at"] = _now()
    save_state(st)
    if event.get("export"):
        event["export"] = _save_export(event["export"])
    return event


async def _read_file_part(file: UploadFile | None):
    if file is None:
        return None
    return {"file": (file.filename or "attachment", await file.read(), file.content_type or "application/octet-stream")}


@app.post("/api/bots/{bot_id}/chat/stream")
async def chat_stream(bot_id: str, message: str = Form(...), file: UploadFile | None = File(None)):
    state = load_state()
    bot = _get_bot(state, bot_id)
    payload = _chat_payload(state, bot, message)
    stamp = _cache_stamp(state, bot)
    file_part = await _read_file_part(file)

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    async def gen():
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                for attempt in range(2):
                    token = get_token(force=attempt > 0)
                    async with client.stream("POST", f"{CENTRAL_URL}/v1/chat/stream",
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
    state = load_state()
    bot = _get_bot(state, bot_id)
    payload = _chat_payload(state, bot, message)
    stamp = _cache_stamp(state, bot)
    file_part = await _read_file_part(file)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for attempt in range(2):
            resp = await client.post(f"{CENTRAL_URL}/v1/chat", headers={"Authorization": f"Bearer {get_token(force=attempt > 0)}"},
                                     data={"payload": json.dumps(payload, ensure_ascii=False)}, files=file_part)
            if resp.status_code == 401 and attempt == 0:
                continue
            break
    _raise_for(resp)
    body = _after_done(bot_id, stamp, resp.json())
    return {k: body[k] for k in ("reply", "used_skill", "export") if k in body}


@app.get("/api/exports/{export_id}/download")
def download_export(export_id: str):
    rec = load_state()["exports"].get(export_id)
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
