# rag-node (เครื่องลูกค้า)

node เป็นตัวบาง หน้าที่มีดังนี้

- ถือ key ของลูกค้าใน `.env`
- เก็บสถานะ (KB, ชุดสูตร, บอท, cache, usage) เป็นไฟล์ JSON
- ส่งงานทั้งหมดไปให้ central ประมวลผล
- เสิร์ฟหน้าเว็บหมวด **AI Chatbot** (Chat / Chatbots / Knowledge Bases / Skills) ซึ่งเป็น UI เดิมจาก langchain-demo

- หน้าเว็บ: `frontend/` (Next.js, build เป็นไฟล์ static แล้วให้ node เสิร์ฟบน origin เดียวกับ API)
- API: path และรูปแบบเดียวกับ backend เดิม (`/api/kb`, `/api/skills`, `/api/bots`)
- สัญญาที่ใช้คุยกับ central: [docs/CENTRAL_API_CONTRACT.md](docs/CENTRAL_API_CONTRACT.md)

node เป็นฝ่ายเรียกออกไปหา central เพียงทางเดียว จึงรันบนเครื่อง local ได้ ไม่ต้องเปิดพอร์ตหรือมี IP สาธารณะ

## รันด้วย Docker (แนะนำ)

```bash
cp .env.example .env        # ตั้ง CENTRAL_URL, LICENSE_KEY และ key ของลูกค้า
docker compose up -d --build
```

- เปิดที่ http://127.0.0.1:8080
- ค่าเริ่มต้นเปิดให้เข้าได้เฉพาะจากเครื่องตัวเอง ถ้าจะให้เครื่องอื่นเข้า ให้ตั้ง `NODE_BIND=0.0.0.0`
- ข้อมูลอยู่ใน volume `node-data`
- `CENTRAL_URL` ต้องเป็น IP หรือโดเมนของ central ห้ามใช้ `127.0.0.1` เพราะใน container ค่านี้หมายถึงตัว container เอง

## รันแบบไม่ใช้ Docker (Windows)

```powershell
cd node\frontend
npm ci; npm run build          # ได้ frontend\out
cd ..
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

## ล็อกอิน

ถ้าเว้น `NODE_PASSWORD` ว่าง หน้าเว็บจะไม่ล็อก (ใช้ได้เฉพาะบนเครื่องตัวเอง) ถ้าตั้งค่าไว้ หน้าเว็บจะถามชื่อและรหัสผ่านแบบ Basic Auth

## ข้อควรรู้

- **Embedding ล็อกต่อ KB** ต้องตั้ง `EMBED_MODEL` และ `EMBED_DIM` ก่อนสร้าง KB แรก ถ้าเปลี่ยนทีหลัง KB เดิมจะใช้ไม่ได้
- **ไฟล์ต้นฉบับ** อยู่ที่ `data/originals/` ส่วนไฟล์ export อยู่ที่ `data/exports/`
- **ข้อมูลไม่ผูกกับ central ตัวใดตัวหนึ่ง** central ไม่เก็บอะไร เปลี่ยน `CENTRAL_URL` ไปเครื่องอื่นได้ KB และบอทเดิมยังใช้ได้ ตราบใดที่ license กับ Qdrant ยังเป็นชุดเดิม
- **ยังไม่มีในหน้าเว็บนี้:** Retrieval Test และ KB Realtime (connector) เพราะ central ยังไม่มี endpoint รองรับ
