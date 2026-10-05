# Central API Contract — ร่าง v1 (DRAFT)

สัญญาระหว่าง **VPS กลาง (central)** กับ **VPS ลูกค้า (customer node)** — ร่างเพื่อคุยตัดสินใจ ยังไม่ใช่สเปกสุดท้าย
อ้างอิงจากโค้ดปัจจุบัน (`bot_router.py`, `bot_engine.py`, `kb_router.py`, `realtime_ingest.py`, `models.py`)
และ `docs/CHAT_FLOW.md` — ส่วนที่ "ยังไม่ได้ตรวจกับโค้ดจริง" ทำเครื่องหมาย ⚠️ ไว้

> **สถานะ implement (4 ต.ค. 2569, รุ่นทดสอบ)** — `central/src/central_app/main.py` ต่างจากร่างด้านล่างดังนี้:
> - SSE ทุกตัวใช้รูปแบบ `data: {"type": ...}` บรรทัดเดียว (ไม่มีบรรทัด `event:`) — type: `progress`, `result`, `status`, `chunk`, `done`, `error`
> - สิทธิ์ถูกเช็คทุก request (ไม่ใช่แค่ตอนออก token) — ระงับ/หมดอายุมีผลทันที
> - ingest ใช้ `POST /v1/ingest/file` (payload JSON ใน form field `payload` + `file`); `/v1/ingest/records` ยังไม่ทำ
> - เพิ่ม `POST /v1/kb/stats`; cache ที่ส่งไป-กลับใน `ctx.cache` มี 4 ชื่อ: `entity_registry`, `kb_schema`, `component`, `sensitivity_recheck`
> - export ส่งกลับใน `done.export.content_base64`
> - **embedding ต่อ KB** (`features: per_kb_embedding` ใน `/v1/meta`): แต่ละ KB ใน `bot.kbs` / `kb` แนบ `credentials` (provider/model/api_key/base_url ของ embedding ที่ KB นั้นผูกไว้) ได้ — central สร้าง embedding แยกต่อ KB บอทหนึ่งตัวจึงผูก KB ที่ใช้ embedding ต่างกันได้ ถ้าไม่แนบ ใช้ `ctx.credentials.embedding` ตามเดิม

---

## 0. หลักการ (ห้ามละเมิด)

1. **Server-to-server เท่านั้น** — เบราว์เซอร์/Line ไม่เรียก central ตรง ทุกอย่างผ่าน thin backend ของลูกค้า
2. **Central stateless** — ไม่เก็บเนื้อหา/คำถาม/คำตอบ/ไฟล์/key ลูกค้า (อยู่ใน memory ต่อ request แล้วทิ้ง)
   เก็บได้เฉพาะ: tenants, license, ตัวนับ usage (ไม่มีเนื้อหา)
3. **Endpoint หยาบ ไม่ chatty** — เปิดแค่ความสามารถระดับ "ทำงานหนึ่งงานจบ" ไม่เปิดฟังก์ชันภายใน pipeline
4. **ความต่างของลูกค้า = ข้อมูลใน request** ไม่ใช่โค้ดใน central (ดู §3 `hints`)
5. **Additive only ภายใน `/v1`** — เพิ่มฟิลด์ได้ ลบ/เปลี่ยนความหมายไม่ได้ ต้องขึ้น `/v2`
6. **ห้าม log payload** — log ได้เฉพาะ `request_id`, tenant, endpoint, status, latency, ขนาด; ฟิลด์ที่ชื่อลงท้าย
   `api_key` / `token` ต้อง redact เสมอ (ต้องปิด debug middleware และ `/debug/routes` ที่มีอยู่ตอนนี้ก่อนใช้งานจริง)

## 1. ภาพรวม

```
Browser/Line → [Customer node: frontend + thin backend + Postgres + connector]
                      │  HTTPS, Bearer token (อายุสั้น), ctx ใน body
                      ▼
               [Central /v1/*  — stateless]
                      │  ใช้ key ที่ส่งมา (ใน memory เท่านั้น)
                      ├─► LLM / Embedding provider ของลูกค้า
                      └─► Qdrant ของลูกค้า
```

| อยู่ฝั่งลูกค้า | อยู่ฝั่ง central |
|---|---|
| user/auth, หน้าตั้งค่า, key vault (เข้ารหัส) | pipeline ความแม่นยำทั้งหมด (`src/core/*`) |
| Postgres: bots, KBs, skills, export history | license / tenants / usage counters |
| ไฟล์ต้นฉบับ (ถ้าเก็บ), ไฟล์ export ที่ได้รับกลับ | guardrails, prompts, regex ภาษาไทย |
| connector scheduler (ดึงข้อมูลจากระบบลูกค้า) | chunker, entity/period resolver, คำนวณเลข |
| Line webhook, widget | — |

## 2. Authentication

### `POST /v1/auth/token`
```json
// req
{ "license_key": "lic_live_xxxxxxxx" }
// res 200
{ "access_token": "eyJ...", "expires_in": 900, "tenant_id": "t_123",
  "license": { "status": "active", "valid_until": "2026-12-31T23:59:59Z", "plan": "standard" },
  "warnings": [ { "code": "license_expiring", "message": "สิทธิ์จะหมดใน 5 วัน" } ] }
```
- ทุก endpoint อื่นใช้ `Authorization: Bearer <access_token>`
- token อายุ 10–15 นาที ฝั่งลูกค้าขอใหม่ก่อนหมด → ปิดสิทธิ์มีผลภายในไม่กี่นาทีโดยไม่ต้องเช็ค DB ทุก request
- สถานะ `suspended`/`expired` → ไม่ออก token (`403 license_suspended` / `license_expired`) ส่วน grace period คุณกำหนดเองในระบบเปิด/ปิดสิทธิ์
- (ทางเลือก v1.1) เข้ารหัส `ctx.credentials` ด้วย public key ของ central (`GET /v1/.well-known/keys`) กันหลุดผ่าน proxy log

## 3. Context bundle (`ctx`) — ส่งมาทุก request ที่ต้องใช้ LLM/vector

```json
{
  "ctx": {
    "credentials": {
      "llm":        { "kind": "customer_key", "provider": "google", "model": "gemini-2.5-flash", "api_key": "..." },
      "embedding":  { "kind": "customer_key", "provider": "google", "model": "gemini-embedding-001", "api_key": "..." },
      "vector":     { "type": "qdrant", "url": "https://...", "api_key": "..." }
    },
    "options": { "use_rerank": false, "language": "th" },
    "hints": { "entity_field_hints": ["company_name","company_code"], "period_field": "period_date" }
  }
}
```
- `kind` เป็นฟิลด์ที่เผื่อไว้: ตอนนี้มีแค่ `customer_key` อนาคตเพิ่ม `platform` (managed) ได้โดยไม่เปลี่ยน contract
- `embedding` ถ้าไม่ส่ง = ใช้ provider/key เดียวกับ `llm` (preset "key เดียวจบ")
- **ล็อก embedding ต่อ KB**: ทุก KB ต้องระบุ `embedding: {model, dim}` (§4) central ตรวจว่าตรงกับ collection ไม่ตรง → `409 embedding_dim_mismatch`
- `hints`: จุดที่ตอนนี้ฮาร์ดโค้ดในโค้ด (`_LIKELY_ENTITY_FIELD_NAMES`, ชื่อ field งวด) ยกออกมาเป็น config ต่อ request
  ถ้าไม่ส่ง = ใช้ค่า default เดิมของ central ⚠️ ต้องตรวจว่ามีค่าฮาร์ดโค้ดตัวอื่นอีกไหมตอน refactor
- ห้าม central เก็บ/cache ค่าใน `credentials` ข้าม request

## 4. Chat

### `POST /v1/chat/stream` (SSE) · `POST /v1/chat` (JSON)
`multipart/form-data`: part `payload` (JSON) + part `file` (ไม่บังคับ — ไฟล์แนบ OCR ครั้งเดียว ตรงกับ `_handle_pre_chat` เดิม)

```json
// payload
{
  "request_id": "9f1c...",
  "ctx": { ... },
  "bot": {
    "system_prompt": "...",
    "use_rerank": false,
    "kbs": [ { "kb_id": "a1b2c3d4e5f6", "collection_name": "kb_a1b2c3d4e5f6",
               "embedding": { "model": "gemini-embedding-001", "dim": 3072 } } ],
    "skills": [ { "id": "s1", "name": "สูตรการเงิน", "files": [ { "name": "ratios.md", "content": "..." } ] } ]
  },
  "message": "บริษัทใดมี ROE สูงที่สุด"
}
```
- ตรงกับฟิลด์ที่ engine ใช้จริง: `kb_ids`, `skill_set_ids`, `system_prompt`, `use_rerank` (ตอนนี้ chat รับข้อความเดียว ไม่มี history — v1 ไม่มี `history` ตามนั้น)
- skill ส่งเป็นเนื้อหาในทุก request (ตอนนี้เป็นไฟล์ .md บนดิสก์) ⚠️ ขนาด payload — ถ้าใหญ่ ค่อยเพิ่มกลไก hash+cache ใน v1.x

**SSE events** (ตรงกับของเดิม `chunk` / `status` / `done` + เพิ่ม `usage`, `error`):
```
event: status   data: {"text":"กำลังดึงข้อมูลจากสูตร: ROE..."}
event: chunk    data: {"text":"..."}
event: done     data: {"used_skill":true,
                       "usage":{"llm":{"input_tokens":4210,"output_tokens":312,"model":"gemini-2.5-flash"},
                                "embedding":{"tokens":38},"rerank":{"calls":0}},
                       "export": null }
event: error    data: {"error":{ ...envelope §9... }}
```
- **คำตอบทางธุรกิจไม่ใช่ error**: guardrail ปฏิเสธ, `NoCommonPeriodError`, "ไม่พบข้อมูล" ส่งเป็น `chunk` ปกติ
- **Export ใน chat**: ถ้า intent เป็นขอไฟล์ `done.export = { "format":"docx", "filename":"...", "mime":"...", "content_base64":"..." }`
  ลูกค้าเก็บ/เสิร์ฟไฟล์เอง (central ไม่เก็บ) จำกัดขนาด ~10 MB ⚠️ ตัดสินใจ: in-band base64 vs endpoint `/v1/export` แยก (ดู §10)
- `usage` ในทุก response คือวิธีที่ลูกค้าได้ตัวเลขประมาณค่าใช้จ่าย โดย central ไม่ต้องเก็บ

## 5. Ingest (ไฟล์)

### `POST /v1/ingest/file` (SSE progress)
```json
// payload (multipart: payload + file)
{ "request_id":"...", "ctx":{...},
  "kb": { "kb_id":"...", "collection_name":"kb_...", "embedding":{"model":"...","dim":3072} },
  "source": { "filename":"report.pdf", "replace_existing": true } }
```
```
event: progress data: {"stage":"parse","pct":10}      // parse → chunk → embed → upsert
event: result   data: {"source":"report.pdf","pages":120,"parent_chunks":84,"child_chunks":611,
                       "usage":{"llm":{...},"embedding":{...}},"warnings":[]}
```
- **ไม่มี job store ที่ central** (stateless) — ผลคืนบนการเชื่อมต่อเดียวกัน ถ้าสายหลุดงานถูกยกเลิก
- **ต้อง idempotent**: id ของ point มาจาก hash(source + ตำแหน่ง chunk); `replace_existing` ลบ point ที่มี `source` เดิมก่อน → ลูกค้า retry ได้ปลอดภัย
  (⚠️ ตรวจว่า `add_documents` ปัจจุบันใช้ id แบบสุ่มหรือไม่ — ถ้าสุ่มต้องเปลี่ยน)
- ข้อจำกัดต่อแพ็กเกจ: ขนาดไฟล์, จำนวนหน้า — เกิน → `413`/`429 quota_exceeded`
- ประเภทไฟล์: `.pdf .docx .txt .md .csv .xlsx` (ตรงกับที่รองรับตอนนี้)

### `POST /v1/ingest/records` (สำหรับ connector ฝั่งลูกค้า)
```json
{ "request_id":"...","ctx":{...},"kb":{...},
  "source": { "name":"realtime:pharmacy_stock" },
  "mode": "replace",            // replace = refresh ทั้ง source, patch = อัปเดตเฉพาะแถวที่เปลี่ยน (ความหมายเหมือน sync_source เดิม)
  "records": [ { "...": "..." } ] }   // JSON rows, จำกัดจำนวนต่อครั้ง; หลายก้อนใช้ batch + final flag
```
- connector (APScheduler + การเข้าถึงระบบภายในของลูกค้า) **ย้ายไปอยู่ฝั่งลูกค้า** แล้วส่งแถวมาให้ central ประมวลผลผ่าน pipeline เดียวกับ CSV

## 6. KB / collection

| Endpoint | หน้าที่ |
|---|---|
| `POST /v1/kb/ensure` | สร้าง collection ถ้ายังไม่มี (`{collection_name, embedding:{dim}}`) + payload index ที่ pipeline ต้องใช้ |
| `POST /v1/kb/delete-source` | ลบ point ทั้งหมดของ `source` หนึ่ง |
| `POST /v1/kb/drop` | ลบ collection |

(ใช้ `ctx.credentials.vector` — ลูกค้าไม่ต้องรู้รายละเอียด payload index)

## 7. OCR

### `POST /v1/ocr`  (multipart: payload + file) → `{ "text": "...", "pages": n, "usage": {...} }`

## 8. Utility

| Endpoint | หน้าที่ |
|---|---|
| `POST /v1/credentials/check` | ทดสอบ key (LLM/embedding/vector) ตอนลูกค้ากด "ทดสอบ" → `{llm:{ok,error_code}, embedding:{...}, vector:{ok}}` |
| `GET /v1/meta` | `{api_version, min_supported_version, deprecations[], supported_providers[]}` |
| `GET /v1/limits` | โควตาแพ็กเกจและที่ใช้ไปของ tenant นี้ (จากตัวนับที่ central เก็บ) |

## 9. Error envelope (ทุก endpoint)

```json
{ "error": { "code": "provider_quota_exhausted", "message": "เงินใน API key ของคุณหมด",
             "retryable": false, "request_id": "9f1c...", "details": { "provider": "google", "http_status": 429 } } }
```

| code | ความหมาย | HTTP |
|---|---|---|
| `auth_invalid` / `token_expired` | token ผิด/หมดอายุ | 401 |
| `license_suspended` / `license_expired` | สิทธิ์ถูกปิด/หมด | 403 |
| `rate_limited` / `quota_exceeded` | เกินเพดานแพ็กเกจ (มี `Retry-After`) | 429 |
| `payload_too_large` | ไฟล์/คำขอใหญ่เกิน | 413 |
| `credential_invalid` | provider ตอบ 401/403 (key ผิดหรือถูก revoke) | 422 |
| `provider_quota_exhausted` | provider ตอบเงินหมด/เกินโควตา | 422 |
| `provider_unavailable` | provider ล่ม/timeout (`retryable: true`) | 502/504 |
| `vector_unreachable` | เข้า Qdrant ของลูกค้าไม่ได้ | 502 |
| `embedding_dim_mismatch` | embedding ไม่ตรงกับ collection | 409 |
| `bad_request` | payload ผิดรูป | 400 |
| `internal` | ข้อผิดพลาดของ central | 500 |

central แปล error ของ provider เป็นรหัสเดียวกันทุกเจ้า ลูกค้า/ผู้ใช้จึงได้ข้อความที่เข้าใจเหมือนกันหมด

## 10. Versioning & ความเข้ากันได้

- Path `/v1`; ฟิลด์ที่ไม่รู้จักต้องถูกเมินทั้งสองฝั่ง
- เลิกรองรับ: ส่ง header `Deprecation` + `Sunset` และแจ้งใน `/v1/meta` — **ระยะแจ้งล่วงหน้าเป็นการตัดสินใจทางธุรกิจ** (เช่น ≥ 6 เดือน) ให้ระบุในสัญญาเช่า
- `request_id` (UUID ที่ลูกค้าสร้าง) ใช้ตามรอย/ทำ idempotency ทั้งหมด

## 11. ประเด็นที่ยังต้องตัดสินใจ

1. **Export**: base64 ใน `done` event (ง่าย, จำกัดขนาด) หรือ endpoint แยกที่ทำ retrieval ซ้ำ (แพงกว่า)? — เสนอ: base64 ก่อน
2. **Ingest ไฟล์ใหญ่**: SSE บนคำขอเดียว (stateless แต่หลุดแล้วต้องเริ่มใหม่) หรือมีคิวงานที่ central (ต้องมี state/Redis)? — เสนอ: SSE + idempotent
3. **Skill payload ใหญ่**: ส่งทุก request ก่อน แล้วค่อยทำ hash+cache ถ้าวัดแล้วเป็นปัญหา
4. **เข้ารหัส credentials ด้วย public key** ใน v1 หรือ v1.1?
5. **Default preset** (provider + model + dim) — ต้องรัน eval ภาษาไทยเทียบก่อนประกาศ ⚠️
6. **entity registry cache** (สแกน child 3000 ตัวต่อ collection): ถ้าจะ cache ต้องแยกตาม tenant + TTL สั้น ไม่ใช่ global
7. **ขนาด/โควตา default ต่อแพ็กเกจ** (ไฟล์สูงสุด, หน้า/เดือน, request พร้อมกัน) — ต้องวัดจาก VPS กลางจริง (ตอนนี้ 1 vCPU, backend ~1 GB/process)

## 12. สิ่งที่ต้องแก้ใน central ก่อนเป็นไปตามสัญญานี้ (จากผลสำรวจโค้ด)

- LLM/embedding/rerank/Qdrant client: จาก singleton ตอน import (`os.environ[...]`) → factory ต่อ request จาก `ctx`
- bot/KB/skill: จากอ่าน Postgres/ดิสก์ → รับจาก payload (`bot_engine` ใช้ `bot.get(...)` อยู่แล้ว จึงแก้น้อย)
- ไฟล์/exports: เลิกเขียน `uploaded_files/`, `data/exports/` → ใช้ memory/temp แล้วทิ้ง
- ฮาร์ดโค้ดที่ต้องยกเป็น `hints`, EMBEDDING_DIM=2560 → มาจาก `kb.embedding.dim`
- เพิ่ม auth/token, rate limit, quota, usage counters; ปิด CORS `*`, debug middleware, `/debug/routes`
- Realtime scheduler: ย้ายฝั่ง connector ไปลูกค้า; central เหลือแค่ `/v1/ingest/records`
