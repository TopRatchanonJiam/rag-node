"""node/app.py — เครื่องลูกค้า (VPS2) แบบบางที่สุดสำหรับทดสอบการแยกเครื่อง

หน้าที่:
- ถือ key ของลูกค้า (LLM / embedding / rerank / Qdrant) ใน .env แล้วแนบไปกับทุก request ถึง central
- เก็บสถานะของตัวเอง (KB, สูตร, บอท, cache, usage) ในไฟล์ JSON — ไม่มีฐานข้อมูล
- เก็บไฟล์ต้นฉบับไว้เผื่อ re-index และเก็บไฟล์ export ที่ central ส่งกลับมา
- หน้าเว็บถาม-ตอบง่ายๆ ที่ / (ป้องกันด้วย NODE_PASSWORD)

central ไม่เก็บอะไรของลูกค้า — ทุกอย่างที่ต้องจำอยู่ที่นี่
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("NODE_DATA_DIR") or ROOT / "data")
STATE_FILE = DATA_DIR / "state.json"
ORIGINALS_DIR = DATA_DIR / "originals"
EXPORTS_DIR = DATA_DIR / "exports"

CENTRAL_URL = os.environ.get("CENTRAL_URL", "http://127.0.0.1:9000").rstrip("/")
LICENSE_KEY = os.environ.get("LICENSE_KEY", "")
NODE_USER = os.environ.get("NODE_USER", "admin")
NODE_PASSWORD = os.environ.get("NODE_PASSWORD", "")

TIMEOUT = httpx.Timeout(connect=15, read=900, write=120, pool=15)

app = FastAPI(title="RAG Node", docs_url=None, redoc_url=None, openapi_url=None)
security = HTTPBasic(auto_error=False)


def require_user(creds: HTTPBasicCredentials | None = Depends(security)):
    if not NODE_PASSWORD:
        return
    ok = creds is not None and secrets.compare_digest(creds.username, NODE_USER) and secrets.compare_digest(creds.password, NODE_PASSWORD)
    if not ok:
        raise HTTPException(status_code=401, detail="ต้องเข้าสู่ระบบ", headers={"WWW-Authenticate": "Basic"})


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
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_state() -> dict:
    with _state_lock:
        if STATE_FILE.exists():
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        else:
            state = {}
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
            raise CentralError(500, "no_license", "ยังไม่ได้ตั้ง LICENSE_KEY ใน .env ของเครื่องลูกค้า")
        resp = httpx.post(f"{CENTRAL_URL}/v1/auth/token", json={"license_key": LICENSE_KEY}, timeout=20)
        _raise_for(resp)
        body = resp.json()
        _token["value"] = body["access_token"]
        _token["exp"] = time.time() + int(body.get("expires_in", 900))
        _token["license"] = body.get("license")
        _token["warnings"] = body.get("warnings") or []
        return _token["value"]


def central_json(path: str, body: dict) -> dict:
    for attempt in range(2):
        resp = httpx.post(f"{CENTRAL_URL}{path}", json=body, headers={"Authorization": f"Bearer {get_token(force=attempt > 0)}"}, timeout=TIMEOUT)
        if resp.status_code == 401 and attempt == 0:
            continue
        _raise_for(resp)
        return resp.json()
    _raise_for(resp)
    return resp.json()


def kb_payload(kb: dict) -> dict:
    return {"kb_id": kb["id"], "name": kb["name"], "collection_name": kb["collection_name"], "embedding": kb["embedding"]}


def _http_error(e: CentralError) -> HTTPException:
    return HTTPException(status_code=e.status if e.status < 500 else 502, detail=f"[{e.code}] {e.message}")


# ══════════════════════════════════════════════
# Pages / status
# ══════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
def index(_=Depends(require_user)):
    return (ROOT / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/api/state")
def get_state(_=Depends(require_user)):
    state = load_state()
    emb = embedding_config()
    return {
        "kbs": list(state["kbs"].values()),
        "skills": [{"id": s["id"], "name": s["name"], "files": sorted(s["files"])} for s in state["skills"].values()],
        "bots": list(state["bots"].values()),
        "usage": state["usage"],
        "config": {"central_url": CENTRAL_URL, "llm_model": _env("LLM_MODEL"), "embed_model": emb["model"],
                   "embed_dim": emb["dim"], "rerank": bool(_env("RERANK_API_KEY"))},
    }


@app.get("/api/health")
def health(_=Depends(require_user)):
    out: dict = {}
    try:
        out["central"] = httpx.get(f"{CENTRAL_URL}/v1/meta", timeout=10).json()
    except Exception as e:
        out["central"] = {"error": f"ติดต่อ central ไม่ได้: {type(e).__name__}"}
        return out
    try:
        get_token(force=True)
        out["license"] = {"ok": True, **(_token.get("license") or {}), "warnings": _token.get("warnings")}
        out["credentials"] = central_json("/v1/credentials/check", {"ctx": {"credentials": credentials()}})
    except CentralError as e:
        out["license"] = {"ok": False, "code": e.code, "message": e.message}
    return out


# ══════════════════════════════════════════════
# Knowledge bases
# ══════════════════════════════════════════════

class KbCreate(BaseModel):
    name: str


@app.post("/api/kbs")
def create_kb(req: KbCreate, _=Depends(require_user)):
    emb = embedding_config()
    if not emb["model"] or emb["dim"] <= 0:
        raise HTTPException(400, "ตั้ง EMBED_MODEL และ EMBED_DIM ใน .env ก่อนสร้าง KB")
    kb_id = _new_id()
    kb = {
        "id": kb_id, "name": req.name.strip() or kb_id, "collection_name": f"kb_{kb_id}",
        # ล็อก embedding ตอนสร้าง — เปลี่ยนทีหลังไม่ได้ ต้องสร้าง KB ใหม่แล้ว ingest ใหม่
        "embedding": {"provider": emb["provider"], "model": emb["model"], "dim": emb["dim"]},
        "files": {}, "revision": 0, "created_at": _now(),
    }
    try:
        central_json("/v1/kb/ensure", {"ctx": {"credentials": credentials()}, "kb": kb_payload(kb)})
    except CentralError as e:
        raise _http_error(e)
    state = load_state()
    state["kbs"][kb_id] = kb
    save_state(state)
    return kb


@app.delete("/api/kbs/{kb_id}")
def delete_kb(kb_id: str, _=Depends(require_user)):
    state = load_state()
    kb = state["kbs"].get(kb_id)
    if not kb:
        raise HTTPException(404, "ไม่พบ KB")
    try:
        central_json("/v1/kb/drop", {"ctx": {"credentials": credentials()}, "kb": kb_payload(kb)})
    except CentralError as e:
        raise _http_error(e)
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
    return {"message": "ลบ KB แล้ว"}


def _ingest_via_central(kb: dict, filename: str, data: bytes) -> dict:
    payload = {"ctx": {"credentials": credentials()}, "kb": kb_payload(kb),
               "source": {"filename": filename, "replace_existing": True}}
    for attempt in range(2):
        headers = {"Authorization": f"Bearer {get_token(force=attempt > 0)}"}
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
    raise CentralError(502, "ingest_failed", "central ปิดการเชื่อมต่อก่อนส่งผลลัพธ์")


@app.post("/api/kbs/{kb_id}/files")
def upload_file(kb_id: str, file: UploadFile = File(...), _=Depends(require_user)):
    state = load_state()
    kb = state["kbs"].get(kb_id)
    if not kb:
        raise HTTPException(404, "ไม่พบ KB")
    if kb["embedding"]["model"] != embedding_config()["model"]:
        raise HTTPException(409, f"KB นี้สร้างด้วย embedding '{kb['embedding']['model']}' แต่ .env ตอนนี้เป็น "
                                 f"'{embedding_config()['model']}' — ห้ามเปลี่ยน embedding ของ KB เดิม")
    filename = _safe_filename(file.filename)
    data = file.file.read()

    # เก็บต้นฉบับไว้ที่เครื่องลูกค้า (central ไม่เก็บ) เผื่อวันที่ต้อง re-index
    folder = ORIGINALS_DIR / kb_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)

    started = time.time()
    try:
        result = _ingest_via_central(kb, filename, data)
    except CentralError as e:
        raise _http_error(e)

    state = load_state()
    kb = state["kbs"].get(kb_id)
    if kb:
        kb["files"][filename] = {"size": len(data), "chunks": result.get("chunks", 0),
                                 "chunk_types": result.get("chunk_types", {}), "uploaded_at": _now()}
        kb["revision"] = kb.get("revision", 0) + 1
    add_usage(state, result.get("usage"))
    save_state(state)
    return {"filename": filename, "chunks": result.get("chunks"), "chunk_types": result.get("chunk_types"),
            "seconds": round(time.time() - started, 1), "usage": result.get("usage")}


@app.delete("/api/kbs/{kb_id}/files/{filename}")
def delete_file(kb_id: str, filename: str, _=Depends(require_user)):
    state = load_state()
    kb = state["kbs"].get(kb_id)
    if not kb:
        raise HTTPException(404, "ไม่พบ KB")
    filename = _safe_filename(filename)
    try:
        central_json("/v1/kb/delete-source", {"ctx": {"credentials": credentials()}, "kb": kb_payload(kb), "source": filename})
    except CentralError as e:
        raise _http_error(e)
    state = load_state()
    kb = state["kbs"].get(kb_id)
    if kb:
        kb["files"].pop(filename, None)
        kb["revision"] = kb.get("revision", 0) + 1
    save_state(state)
    (ORIGINALS_DIR / kb_id / filename).unlink(missing_ok=True)
    return {"message": f"ลบ {filename} แล้ว"}


# ══════════════════════════════════════════════
# Skills (ไฟล์สูตร .md)
# ══════════════════════════════════════════════

class SkillCreate(BaseModel):
    name: str


@app.post("/api/skills")
def create_skill(req: SkillCreate, _=Depends(require_user)):
    state = load_state()
    sid = _new_id()
    state["skills"][sid] = {"id": sid, "name": req.name.strip() or sid, "files": {}, "revision": 0}
    save_state(state)
    return state["skills"][sid]


@app.post("/api/skills/{skill_id}/files")
def upload_skill_file(skill_id: str, file: UploadFile = File(...), _=Depends(require_user)):
    filename = _safe_filename(file.filename)
    if not filename.lower().endswith(".md"):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ .md")
    content = file.file.read().decode("utf-8")
    state = load_state()
    skill = state["skills"].get(skill_id)
    if not skill:
        raise HTTPException(404, "ไม่พบชุดสูตร")
    skill["files"][filename] = content
    skill["revision"] = skill.get("revision", 0) + 1
    save_state(state)
    return {"filename": filename, "size": len(content)}


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: str, _=Depends(require_user)):
    state = load_state()
    if not state["skills"].pop(skill_id, None):
        raise HTTPException(404, "ไม่พบชุดสูตร")
    for bot in state["bots"].values():
        bot["skill_ids"] = [s for s in bot["skill_ids"] if s != skill_id]
    save_state(state)
    return {"message": "ลบชุดสูตรแล้ว"}


# ══════════════════════════════════════════════
# Bots
# ══════════════════════════════════════════════

class BotIn(BaseModel):
    name: str
    system_prompt: str = ""
    kb_ids: list[str] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    use_rerank: bool = False


@app.post("/api/bots")
def create_bot(req: BotIn, _=Depends(require_user)):
    state = load_state()
    bid = _new_id()
    state["bots"][bid] = {"id": bid, **req.model_dump()}
    save_state(state)
    return state["bots"][bid]


@app.put("/api/bots/{bot_id}")
def update_bot(bot_id: str, req: BotIn, _=Depends(require_user)):
    state = load_state()
    if bot_id not in state["bots"]:
        raise HTTPException(404, "ไม่พบบอท")
    state["bots"][bot_id] = {"id": bot_id, **req.model_dump()}
    state["caches"].pop(bot_id, None)
    save_state(state)
    return state["bots"][bot_id]


@app.delete("/api/bots/{bot_id}")
def delete_bot(bot_id: str, _=Depends(require_user)):
    state = load_state()
    state["bots"].pop(bot_id, None)
    state["caches"].pop(bot_id, None)
    save_state(state)
    return {"message": "ลบบอทแล้ว"}


def _cache_stamp(state: dict, bot: dict) -> dict:
    return {
        "kbs": {k: state["kbs"][k].get("revision", 0) for k in bot["kb_ids"] if k in state["kbs"]},
        "skills": {s: state["skills"][s].get("revision", 0) for s in bot["skill_ids"] if s in state["skills"]},
        "embed_model": embedding_config()["model"],
    }


def _chat_payload(state: dict, bot: dict, message: str) -> dict:
    kbs = [kb_payload(state["kbs"][k]) for k in bot["kb_ids"] if k in state["kbs"]]
    skills = [{"id": s["id"], "name": s["name"], "files": [{"name": n, "content": c} for n, c in s["files"].items()]}
              for s in (state["skills"].get(i) for i in bot["skill_ids"]) if s]
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
            "download_url": f"/api/exports/{eid}"}


@app.post("/api/bots/{bot_id}/chat/stream")
async def chat_stream(bot_id: str, message: str = Form(...), file: UploadFile | None = File(None), _=Depends(require_user)):
    state = load_state()
    bot = state["bots"].get(bot_id)
    if not bot:
        raise HTTPException(404, "ไม่พบบอท")
    payload = _chat_payload(state, bot, message)
    stamp = _cache_stamp(state, bot)
    file_part = None
    if file is not None:
        file_part = {"file": (file.filename or "attachment", await file.read(), file.content_type or "application/octet-stream")}

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
                                st = load_state()
                                if "cache" in event:
                                    st["caches"][bot_id] = {"stamp": stamp, "data": event.pop("cache")}
                                add_usage(st, event.get("usage"))
                                save_state(st)
                                if event.get("export"):
                                    event["export"] = _save_export(event["export"])
                            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                    break
        except CentralError as e:
            yield f"data: {json.dumps({'type': 'error', 'error': {'code': e.code, 'message': e.message}}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'used_skill': False})}\n\n"
        except httpx.HTTPError as e:
            yield f"data: {json.dumps({'type': 'error', 'error': {'code': 'central_unreachable', 'message': f'ติดต่อ central ไม่ได้ ({type(e).__name__})'}}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'used_skill': False})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/exports/{export_id}")
def download_export(export_id: str, _=Depends(require_user)):
    rec = load_state()["exports"].get(export_id)
    if not rec:
        raise HTTPException(404, "ไม่พบไฟล์")
    return FileResponse(EXPORTS_DIR / rec["path"], filename=rec["filename"], media_type=rec.get("mime") or "application/octet-stream")
