"""legacy_api.py — API แบบเดียวกับ backend ของ langchain-demo เดิม ให้หน้าเว็บเดิม (UI เดิม 100%) ใช้กับ node นี้ได้

เปิดเมื่อตั้ง LEGACY_UI=1 เท่านั้น (node ปกติของลูกค้าไม่มีส่วนนี้)

API ที่ path และรูปแบบตรงกับของเดิมอยู่แล้วใน app.py (kb, bots, skills, chat, exports) ใช้ตัวเดิมเลย
ไฟล์นี้เติมเฉพาะส่วนที่ต่างหรือไม่มี:
- /api/kb/{id}/retrieve        → central /v1/kb/retrieve
- /api/realtime/*              → แปลงเป็นแหล่งข้อมูลสดของ node (ของเดิม: 1 แหล่ง = 1 KB ของตัวเอง)
- /api/ocr/*                   → OCR ผ่าน central แล้วเก็บ job ไว้ที่ node
- /api/screening/*             → central คิด (แยกข้อกำหนด, จับคู่) node เก็บตำแหน่งงาน/ผู้สมัคร
- /api/external/pharmacy-stock → ข้อมูลร้านยาจำลองไว้ทดสอบ KB Realtime (เดิมอยู่ใน Postgres)
- /api/admin/legacy-import     → นำเข้าข้อมูลจากระบบเดิมครั้งเดียว (อยู่หลังรหัสผ่านหลังบ้าน)
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

import app as node

router = APIRouter()

TABLES = ("ocr_jobs", "screening_jobs", "screening_candidates", "screening_templates", "pharmacy")
SCREENING_DIR = node.DATA_DIR / "screening"


def _id() -> str:
    return uuid.uuid4().hex[:12]


def _central_multipart(path: str, payload: dict, filename: str, data: bytes, content_type: str) -> dict:
    url, _ = node._central()
    resp = None
    for attempt in range(2):
        token = node.get_token(force=attempt > 0)
        try:
            resp = httpx.post(f"{url}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=node.TIMEOUT, verify=node.CENTRAL_VERIFY,
                              data={"payload": json.dumps(payload, ensure_ascii=False)},
                              files={"file": (filename, data, content_type)})
        except httpx.HTTPError as e:
            raise node.CentralError(502, "central_unreachable", f"ติดต่อ central ไม่ได้ ({type(e).__name__})")
        if resp.status_code == 401 and attempt == 0:
            continue
        break
    node._raise_for(resp)
    return resp.json()


def _strip_usage(res: dict) -> dict:
    node.add_usage(res.pop("usage", None))
    return res


# ══════════════════════════════════════════════
# Retrieval test
# ══════════════════════════════════════════════

class RetrieveIn(BaseModel):
    query: str
    k: int = 5
    use_splitter: bool = True


@router.post("/api/kb/{kb_id}/retrieve")
def retrieve_test(kb_id: str, req: RetrieveIn):
    kb = node._get_kb(kb_id)
    res = node.central_json("/v1/kb/retrieve", {"ctx": node._kb_ctx(kb), "kb": node.kb_payload(kb),
                                                "query": req.query, "k": req.k, "use_splitter": req.use_splitter})
    return _strip_usage(res)


# ══════════════════════════════════════════════
# KB Realtime (รูปแบบเดิม: สร้างแหล่ง = สร้าง KB ใหม่ให้ด้วย, ลบแหล่ง = ลบ KB นั้น)
# ══════════════════════════════════════════════

def _rt_out(src: dict) -> dict:
    out = node._source_out(src)
    kb = node.db_get("kbs", src["kb_id"])
    # UI เดิมถือ token เป็นข้อความ — ไม่ส่ง token จริงออกไป (ส่งว่างกลับมา = ใช้ค่าเดิม)
    return {**out, "auth_token": "", "kb_name": kb["name"] if kb else None}


@router.get("/api/realtime")
def rt_list():
    return {"sources": [_rt_out(s) for s in node.db_all("sources")]}


@router.post("/api/realtime/test")
def rt_test(req: node.SourceIn):
    res = node.test_source(req)
    return {k: res[k] for k in ("total_records", "fields", "sample")}


@router.post("/api/realtime")
def rt_create(req: node.SourceIn):
    node._validate_source(req)
    kb = node.create_kb(node.KbCreateRequest(name=req.name.strip(), description=f"Realtime API source: {req.url.strip()}"))
    src = node.create_source(kb["id"], req)
    return _rt_out(node.db_get("sources", src["id"]))


@router.get("/api/realtime/{sid}")
def rt_get(sid: str):
    return _rt_out(node._get_source(sid))


@router.put("/api/realtime/{sid}")
def rt_update(sid: str, req: node.SourceIn):
    node.update_source(sid, req)
    return _rt_out(node._get_source(sid))


@router.delete("/api/realtime/{sid}")
def rt_delete(sid: str):
    src = node._get_source(sid)
    node.delete_source(sid)
    if node.db_get("kbs", src["kb_id"]):
        node.delete_kb(src["kb_id"])
    return {"message": f"ลบ Realtime Source '{src['name']}' สำเร็จ"}


@router.post("/api/realtime/{sid}/sync")
def rt_sync(sid: str):
    node._get_source(sid)
    res = node.sync_source(sid)
    if res.get("status") != "success":
        raise HTTPException(502, res.get("error") or "sync ไม่สำเร็จ")
    return {"status": "success", "record_count": res.get("record_count", 0), "source": _rt_out(node._get_source(sid))}


@router.patch("/api/realtime/{sid}/toggle")
def rt_toggle(sid: str, req: node.SourceToggle):
    node.toggle_source(sid, req)
    return _rt_out(node._get_source(sid))


@router.get("/api/realtime/{sid}/chunks")
def rt_chunks(sid: str):
    src = node._get_source(sid)
    kb = node.db_get("kbs", src["kb_id"])
    if not kb:
        return {"total_chunks": 0}
    res = node.central_json("/v1/kb/chunks", {"ctx": node._kb_ctx(kb), "kb": node.kb_payload(kb), "source": node._rt_tag(sid)})
    return {"total_chunks": len(res.get("chunks") or [])}


# ══════════════════════════════════════════════
# OCR (job อยู่ที่ node, การอ่านเอกสารทำที่ central)
# ══════════════════════════════════════════════

OCR_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"}
OCR_MAX_IMAGE = 10 * 1024 * 1024
OCR_MAX_PDF = 20 * 1024 * 1024


@router.post("/api/ocr/extract")
def ocr_extract(file: UploadFile = File(...)):
    if file.content_type not in OCR_TYPES:
        raise HTTPException(400, "รองรับเฉพาะไฟล์รูปภาพ JPEG/PNG/WEBP หรือ PDF เท่านั้น")
    data = file.file.read()
    if not data:
        raise HTTPException(400, "ไฟล์ว่างเปล่า")
    max_size = OCR_MAX_PDF if file.content_type == "application/pdf" else OCR_MAX_IMAGE
    if len(data) > max_size:
        raise HTTPException(400, f"ไฟล์ใหญ่เกินไป (จำกัด {max_size // (1024 * 1024)}MB)")
    try:
        res = _strip_usage(_central_multipart("/v1/ocr", {"ctx": {"credentials": node.credentials()}},
                                              file.filename or "document", data, file.content_type))
    except node.CentralError as e:
        raise HTTPException(500, f"ประมวลผล OCR ไม่สำเร็จ: {e.message}")
    job = {
        "id": _id(), "filename": file.filename, "document_type": res.get("document_type", "unknown"),
        "raw_text": res.get("raw_text", ""), "fields": res.get("fields", []),
        "overall_confidence": res.get("overall_confidence", 0.0), "parse_error": bool(res.get("parse_error", False)),
        "status": "failed" if res.get("parse_error") else "pending_review",
        "created_at": node._now(), "approved_at": None,
    }
    node.db_put("ocr_jobs", job["id"], job)
    return job


def _ocr_jobs() -> list[dict]:
    return sorted(node.db_all("ocr_jobs"), key=lambda j: j.get("created_at") or "", reverse=True)  # ใหม่สุดก่อน เหมือนเดิม


@router.get("/api/ocr/jobs")
def ocr_list(status: str | None = None):
    return {"jobs": [j for j in _ocr_jobs() if not status or j["status"] == status]}


def _ocr_job(job_id: str) -> dict:
    job = node.db_get("ocr_jobs", job_id)
    if not job:
        raise HTTPException(404, "ไม่พบ OCR job")
    return job


@router.get("/api/ocr/jobs/{job_id}")
def ocr_get(job_id: str):
    return _ocr_job(job_id)


@router.delete("/api/ocr/jobs/{job_id}")
def ocr_delete(job_id: str):
    _ocr_job(job_id)
    node.db_delete("ocr_jobs", job_id)
    return {"message": "ลบรายการสำเร็จ"}


class OcrFieldIn(BaseModel):
    label: str
    value: str
    confidence: float = 0.0


class ApproveIn(BaseModel):
    fields: list[OcrFieldIn]
    overall_confidence: float = 0.0
    raw_text: str = ""


@router.post("/api/ocr/jobs/{job_id}/approve")
def ocr_approve(job_id: str, req: ApproveIn):
    job = _ocr_job(job_id)
    job.update({"fields": [f.model_dump() for f in req.fields], "overall_confidence": req.overall_confidence,
                "raw_text": req.raw_text, "status": "approved", "approved_at": node._now()})
    node.db_put("ocr_jobs", job_id, job)
    return {"message": "อนุมัติข้อมูลสำเร็จ", "job": job}


# ══════════════════════════════════════════════
# AI Candidate Screening
# ══════════════════════════════════════════════

RESUME_SUFFIXES = {".pdf", ".docx", ".txt", ".md"}


class RequirementIn(BaseModel):
    text: str
    kind: str = "required"
    tags: list[str] = Field(default_factory=list)
    hard_filter: bool = False


class JobIn(BaseModel):
    title: str
    description: str = ""
    requirements: list[RequirementIn] = Field(default_factory=list)


class JobUpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    requirements: list[RequirementIn] | None = None


class ParseIn(BaseModel):
    text: str


class TemplateIn(BaseModel):
    name: str
    requirements: list[RequirementIn] = Field(default_factory=list)


class TemplateUpdateIn(BaseModel):
    name: str | None = None
    requirements: list[RequirementIn] | None = None


def _normalize(raw: list) -> list[dict]:
    out = []
    for item in raw:
        item = item.model_dump() if isinstance(item, BaseModel) else item
        text = (item.get("text") or "").strip()
        if not text:
            continue
        tags = [str(t).strip() for t in (item.get("tags") or []) if str(t).strip()]
        out.append({"text": text, "kind": item.get("kind") if item.get("kind") in ("required", "preferred") else "preferred",
                    "tags": tags[:5], "hard_filter": bool(item.get("hard_filter", False))})
    return out


def _job_kb(job: dict) -> dict:
    """ตำแหน่งงานในรูป KB (1 ตำแหน่ง = 1 collection) — ใช้ส่ง central ผ่าน kb_payload ตัวเดียวกับ KB ปกติ"""
    return {"id": job["id"], "name": job["title"], "collection_name": job["collection_name"], "embedding": job["embedding"]}


def _job_ctx(job: dict, use_rerank: bool = False) -> dict:
    return {"credentials": node.credentials(embedding_id=job["embedding"].get("model_id"), use_rerank=use_rerank)}


def _candidates(job_id: str) -> list[dict]:
    return [c for c in node.db_all("screening_candidates") if c["job_id"] == job_id]


def _job_public(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "embedding"}


def _job_with_counts(job: dict) -> dict:
    return {**_job_public(job), "candidate_count": len(_candidates(job["id"]))}


def _job(job_id: str) -> dict:
    job = node.db_get("screening_jobs", job_id)
    if not job:
        raise HTTPException(404, "ไม่พบตำแหน่งงาน")
    return job


@router.post("/api/screening/parse-requirements")
def screening_parse(req: ParseIn):
    res = _strip_usage(node.central_json("/v1/screening/parse-requirements",
                                         {"ctx": {"credentials": node.credentials()}, "text": req.text}))
    return {"requirements": res.get("requirements", []), "method": res.get("method", "format")}


@router.get("/api/screening/templates")
def tpl_list():
    return {"templates": node.db_all("screening_templates")}


@router.post("/api/screening/templates")
def tpl_create(req: TemplateIn):
    if not req.name.strip():
        raise HTTPException(400, "กรุณาระบุชื่อชุดข้อกำหนด")
    tpl = {"id": _id(), "name": req.name.strip(), "requirements": _normalize(req.requirements), "created_at": node._now()}
    node.db_put("screening_templates", tpl["id"], tpl)
    return tpl


@router.put("/api/screening/templates/{tid}")
def tpl_update(tid: str, req: TemplateUpdateIn):
    tpl = node.db_get("screening_templates", tid)
    if not tpl:
        raise HTTPException(404, "ไม่พบชุดข้อกำหนด")
    if req.name is not None:
        tpl["name"] = req.name.strip()
    if req.requirements is not None:
        tpl["requirements"] = _normalize(req.requirements)
    node.db_put("screening_templates", tid, tpl)
    return tpl


@router.delete("/api/screening/templates/{tid}")
def tpl_delete(tid: str):
    if not node.db_get("screening_templates", tid):
        raise HTTPException(404, "ไม่พบชุดข้อกำหนด")
    node.db_delete("screening_templates", tid)
    return {"message": "ลบชุดข้อกำหนดสำเร็จ"}


@router.get("/api/screening/jobs")
def jobs_list():
    return {"jobs": [_job_with_counts(j) for j in node.db_all("screening_jobs")]}


@router.post("/api/screening/jobs")
def job_create(req: JobIn):
    if not req.title.strip():
        raise HTTPException(400, "กรุณาระบุชื่อตำแหน่งงาน")
    s = node.load_settings()
    mid, entry = node.resolve_model(s, "embedding")
    if not entry:
        raise HTTPException(400, "ยังไม่มีโมเดล embedding — เพิ่มที่หลังบ้าน → การเชื่อมต่อ AI ก่อน")
    jid = _id()
    job = {"id": jid, "title": req.title.strip(), "description": req.description.strip(),
           "requirements": _normalize(req.requirements), "collection_name": f"screen_{jid}",
           "created_at": node._now(), "last_match": None, "last_match_at": None,
           "embedding": {"model_id": mid, "model": entry["model"], "dim": int(entry.get("dim") or 0)}}
    node.central_json("/v1/kb/ensure", {"ctx": _job_ctx(job), "kb": node.kb_payload(_job_kb(job), s)})
    node.db_put("screening_jobs", jid, job)
    return _job_with_counts(job)


@router.get("/api/screening/jobs/{job_id}")
def job_get(job_id: str):
    job = _job(job_id)
    return {**_job_with_counts(job), "candidates": _candidates(job_id)}


@router.put("/api/screening/jobs/{job_id}")
def job_update(job_id: str, req: JobUpdateIn):
    job = _job(job_id)
    if req.title is not None:
        job["title"] = req.title.strip()
    if req.description is not None:
        job["description"] = req.description
    if req.requirements is not None:
        job["requirements"] = _normalize(req.requirements)
    node.db_put("screening_jobs", job_id, job)
    return _job_with_counts(job)


@router.delete("/api/screening/jobs/{job_id}")
def job_delete(job_id: str):
    job = _job(job_id)
    try:
        node.central_json("/v1/kb/drop", {"ctx": _job_ctx(job), "kb": node.kb_payload(_job_kb(job))})
    except node.CentralError:
        pass
    for c in _candidates(job_id):
        node.db_delete("screening_candidates", c["id"])
    node.db_delete("screening_jobs", job_id)
    return {"message": "ลบตำแหน่งงานสำเร็จ"}


@router.post("/api/screening/jobs/{job_id}/resumes")
def resume_upload(job_id: str, file: UploadFile = File(...)):
    job = _job(job_id)
    filename = node._safe_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in RESUME_SUFFIXES:
        raise HTTPException(400, f"รองรับเฉพาะ {', '.join(sorted(RESUME_SUFFIXES))} (ได้รับ {suffix or 'ไม่มีนามสกุล'})")
    data = file.file.read()
    folder = SCREENING_DIR / job_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)

    cand = {"id": _id(), "job_id": job_id, "name": Path(filename).stem, "filename": filename}
    try:
        res = node._ingest_via_central(_job_kb(job), filename, data, replace_existing=False,
                                       extra_metadata={"candidate_id": cand["id"], "candidate_name": cand["name"]},
                                       ctx=_job_ctx(job))
    except node.CentralError as e:
        raise HTTPException(500, f"ประมวลผลไฟล์ไม่สำเร็จ: {e.message}")
    node.add_usage(res.get("usage"))
    if not res.get("chunks"):
        raise HTTPException(400, "หั่น chunk แล้วไม่ได้อะไรเลย — เนื้อหาอาจสั้นเกินไป")
    cand.update({"extraction_method": res.get("extraction_method") or "text_layer",
                 "chunk_count": res.get("chunks", 0), "created_at": node._now()})
    node.db_put("screening_candidates", cand["id"], cand)
    return cand


@router.delete("/api/screening/candidates/{cid}")
def candidate_delete(cid: str):
    cand = node.db_get("screening_candidates", cid)
    if not cand:
        raise HTTPException(404, "ไม่พบผู้สมัคร")
    job = node.db_get("screening_jobs", cand["job_id"])
    if job:
        try:
            node.central_json("/v1/kb/delete-source", {"ctx": _job_ctx(job), "kb": node.kb_payload(_job_kb(job)),
                                                       "source": cid, "field": "candidate_id"})
        except node.CentralError:
            pass
    node.db_delete("screening_candidates", cid)
    return {"message": "ลบผู้สมัครสำเร็จ"}


@router.get("/api/screening/jobs/{job_id}/match")
def job_match(job_id: str):
    job = _job(job_id)
    public = {k: v for k, v in _job_public(job).items() if k not in ("last_match", "last_match_at")}
    try:
        res = node.central_json("/v1/screening/match", {
            "ctx": _job_ctx(job, use_rerank=True), "kb": node.kb_payload(_job_kb(job)),
            "job": public, "candidates": _candidates(job_id)})
    except node.CentralError as e:
        raise HTTPException(500, f"จับคู่ไม่สำเร็จ: {e.message}")
    res = _strip_usage(res)
    job = node.db_get("screening_jobs", job_id) or job
    job.update({"last_match": res, "last_match_at": node._now()})
    node.db_put("screening_jobs", job_id, job)
    return res


# ══════════════════════════════════════════════
# ข้อมูลร้านยาจำลอง (ระบบภายนอกปลอมสำหรับทดสอบ KB Realtime)
# ══════════════════════════════════════════════

class PharmacyStockIn(BaseModel):
    branch_code: str
    branch_name: str
    sku: str
    trade_name: str
    generic_name: str
    category: str = ""
    drug_type: str = ""
    dosage_form: str = ""
    strength: str = ""
    pack_size: str = ""
    unit: str = ""
    qty_on_hand: int
    reorder_point: int
    cost_price: float
    sell_price: float
    inventory_value: float
    gross_margin_pct: float | None = None
    lot_number: str = ""
    expiry_date: str | None = None
    received_date: str | None = None
    supplier: str = ""
    storage_location: str = ""
    status: str = ""


def _pharmacy_rows() -> list[dict]:
    return sorted(node.db_all("pharmacy"), key=lambda r: int(r["id"]))


def _pharmacy_row(row_id: int) -> dict:
    row = node.db_get("pharmacy", str(row_id))
    if not row:
        raise HTTPException(404, f"ไม่พบแถว id={row_id}")
    return row


@router.get("/api/external/pharmacy-stock")
def pharmacy_list():
    return _pharmacy_rows()


@router.get("/api/external/pharmacy-stock/{row_id}")
def pharmacy_get(row_id: int):
    return _pharmacy_row(row_id)


@router.post("/api/external/pharmacy-stock")
def pharmacy_create(row: PharmacyStockIn):
    with node._db_lock:
        new_id = max((int(r["id"]) for r in node.db_all("pharmacy")), default=0) + 1
        data = {"id": new_id, **row.model_dump()}
        node.db_put("pharmacy", str(new_id), data)
    return data


@router.put("/api/external/pharmacy-stock/{row_id}")
def pharmacy_update(row_id: int, row: PharmacyStockIn):
    _pharmacy_row(row_id)
    data = {"id": row_id, **row.model_dump()}
    node.db_put("pharmacy", str(row_id), data)
    return data


@router.delete("/api/external/pharmacy-stock/{row_id}")
def pharmacy_delete(row_id: int):
    _pharmacy_row(row_id)
    node.db_delete("pharmacy", str(row_id))
    return {"message": f"ลบแถว id={row_id} สำเร็จ"}


# ══════════════════════════════════════════════
# นำเข้าข้อมูลจากระบบเดิม (ครั้งเดียว — vector ถูกคัดลอกเข้า Qdrant ใหม่แยกต่างหาก ไม่ต้อง embed ใหม่)
# ══════════════════════════════════════════════

@router.post("/api/admin/legacy-import")
def legacy_import(bundle: dict = Body(...)):
    """bundle: {kbs, kb_files: {kb_id: {filename: {size, chunks}}}, skills, bots, sources,
    ocr_jobs, screening_jobs, screening_candidates, screening_templates, pharmacy}
    KB และตำแหน่งงานทุกตัวผูกกับ embedding ค่าเริ่มต้น (ต้องเป็นโมเดลเดียวกับที่ระบบเดิมใช้สร้าง vector)"""
    s = node.load_settings()
    mid, emb = node.resolve_model(s, "embedding")
    if not emb:
        raise HTTPException(400, "ตั้งโมเดล embedding ค่าเริ่มต้นก่อนนำเข้า")
    binding = {"model_id": mid, "model": emb["model"], "dim": int(emb.get("dim") or 0)}
    counts: dict[str, int] = {}

    def put(table: str, obj: dict, key: str = "id"):
        node.db_put(table, str(obj[key]), obj)
        counts[table] = counts.get(table, 0) + 1

    kb_files = bundle.get("kb_files") or {}
    for kb in bundle.get("kbs") or []:
        put("kbs", {"id": kb["id"], "name": kb["name"], "description": kb.get("description", ""),
                    "collection_name": kb["collection_name"], "embedding": binding,
                    "files": kb_files.get(kb["id"], {}), "revision": 0, "created_at": kb["created_at"]})
    for sk in bundle.get("skills") or []:
        put("skills", {"id": sk["id"], "name": sk["name"], "description": sk.get("description", ""),
                       "files": sk.get("files") or {}, "revision": 0, "created_at": sk["created_at"]})
    for bot in bundle.get("bots") or []:
        put("bots", {**{k: bot.get(k) for k in ("id", "name", "description", "kb_ids", "skill_set_ids", "system_prompt",
                                                "use_rerank", "quick_chat_enabled", "quick_chat_tags",
                                                "created_at", "last_chatted_at")},
                     "llm_model_id": "", "rerank_model_id": "", "welcome_label": "", "welcome_message": "",
                     "welcome_icon": "sparkles"})
    for src in bundle.get("sources") or []:
        token = src.get("auth_token") or ""
        put("sources", {**src, "auth_token": node._enc(token) if token else "", "syncing": False,
                        "has_data": src.get("last_status") == "success", "last_chunks": src.get("last_chunks", 0),
                        "last_mode": None})
    for job in bundle.get("screening_jobs") or []:
        put("screening_jobs", {**job, "embedding": binding})
    for table in ("ocr_jobs", "screening_candidates", "screening_templates", "pharmacy"):
        for row in bundle.get(table) or []:
            put(table, row)
    return {"imported": counts}
