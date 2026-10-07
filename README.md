# rag-node (เครื่องลูกค้า)

node เป็นตัวบาง ส่งงานทั้งหมดไปให้ central ประมวลผล และมีหน้าเว็บ 2 ส่วน

| หน้า | สำหรับ | มีอะไร |
|---|---|---|
| `/` | ผู้ใช้งาน | หน้าแชท เลือกบอทแล้วถามได้เลย |
| `/admin` | ผู้ดูแล | **จัดการความรู้**: คลังความรู้ (อัปโหลด/ดู chunk), ชุดสูตร, Chatbots · **ระบบ**: การเชื่อมต่อ AI (provider/key/โมเดล), ภาพรวมสถานะและการใช้งาน |

- การตั้งค่าและข้อมูลทั้งหมดอยู่ใน `data/node.db` (SQLite) โดย key ถูกเข้ารหัส และแก้จากหน้า `/admin/settings` แล้วมีผลทันที
- `.env` ใช้แค่ค่าเริ่มต้นตอนเปิดครั้งแรก (รุ่นก่อนที่ใช้ `state.json` จะถูกย้ายเข้า SQLite ให้อัตโนมัติ)
- หน้าเว็บอยู่ใน `frontend/` (Next.js, build เป็นไฟล์ static แล้วให้ node เสิร์ฟบน origin เดียวกับ API)
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

## รันบน NAS / server (ให้เครื่องอื่นใน LAN เข้าได้)

```bash
git clone https://github.com/TopRatchanonJiam/rag-node.git && cd rag-node
cp .env.example .env
vi .env
docker compose up -d --build
```

ใน `.env` ต้องตั้ง 3 ค่านี้เพิ่มจากการรันบนเครื่องตัวเอง:

```
CENTRAL_URL=http://<IP ของ central>:9000   # ห้ามใช้ 127.0.0.1
NODE_BIND=0.0.0.0                           # ค่าเริ่มต้น 127.0.0.1 เครื่องอื่นจะเข้าไม่ได้
NODE_PASSWORD=<ตั้งรหัสผ่าน>                 # เปิดให้ทั้ง LAN เข้าได้ ต้องมีรหัสผ่าน
```

จากนั้นเปิด `http://<IP ของ NAS>:8080` แล้วล็อกอินด้วย `NODE_USER` / `NODE_PASSWORD`

ถ้าเปิดไม่ได้ ให้ตรวจตามนี้

- **error `.env: no such file`**: ยังไม่ได้สร้าง `.env` (ไฟล์นี้ไม่อยู่ใน git เพราะมี key)
- **error `port is already allocated`**: มีแอปอื่นใช้ 8080 อยู่แล้ว ให้แก้ `docker-compose.yml` เป็น `"${NODE_BIND:-127.0.0.1}:8090:8080"` แล้วเปิดที่พอร์ต 8090
- **เครื่องอื่นเข้าไม่ได้**: เปิดพอร์ต 8080 ใน firewall (Synology: Control Panel → Security → Firewall)
- **หน้าเว็บขึ้น แต่ขึ้นว่า "ติดต่อ central ไม่ได้"**: ทดสอบด้วย `curl http://<IP ของ central>:9000/v1/meta` ถ้าคนละเครือข่ายกับ central ต้องใช้ VPN หรือเปิด central ผ่าน HTTPS
- **อัปเดตเวอร์ชัน**: `git pull && docker compose up -d --build` ข้อมูลใน volume `node-data` ไม่หาย

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

- **สำรอง `data/node.db` คู่กับ `data/secret.key` เสมอ** ถ้า `secret.key` หาย key ทั้งหมดใน Settings จะอ่านไม่ได้ ต้องกรอกใหม่ (ข้อมูล KB และบอทไม่หาย)
- **Embedding ล็อกต่อ KB** ระบบจะเตือนและให้ยืนยันก่อนเปลี่ยน เพราะ KB เดิมจะค้นไม่ได้ ต้องสร้างใหม่และอัปโหลดใหม่
- **Ollama** เลือก provider "Ollama" แล้วใส่ `http://<ip>:11434` ไม่ต้องใส่ `/v1` และไม่ต้องใช้ key
- **พูดแทนพิมพ์ (ปุ่มไมค์ในหน้าแชท)** ใช้ Speech-to-Text ค่าเริ่มต้นในคลังโมเดล ถ้ายังไม่ได้ตั้ง บอทที่ใช้ LLM เป็น Gemini จะถอดเสียงเองได้ ส่วนบอทอื่นจะไม่แสดงปุ่มไมค์ ข้อความที่ถอดได้จะลงในช่องพิมพ์ให้ตรวจก่อนกดส่ง เบราว์เซอร์จะยอมเปิดไมค์ก็ต่อเมื่อเข้าผ่าน https หรือ localhost เท่านั้น
- **ไฟล์ต้นฉบับ** อยู่ที่ `data/originals/` ส่วนไฟล์ export อยู่ที่ `data/exports/`
- **ข้อมูลไม่ผูกกับ central ตัวใดตัวหนึ่ง** central ไม่เก็บอะไร เปลี่ยน `CENTRAL_URL` ไปเครื่องอื่นได้ KB และบอทเดิมยังใช้ได้ ตราบใดที่ license กับ Qdrant ยังเป็นชุดเดิม
- **ยังไม่มีในหน้าเว็บนี้:** Retrieval Test และ KB Realtime (connector) เพราะ central ยังไม่มี endpoint รองรับ

## โหมดหน้าเว็บเดิม (LEGACY_UI)

ตั้ง `LEGACY_UI=1` แล้ว node จะตอบ API แบบเดียวกับ backend ของ langchain-demo (`legacy_api.py`) ให้หน้าเว็บเดิมใช้ได้โดยไม่แก้โค้ดหน้าเว็บ
ใช้คู่กับ `NODE_AUTH_SCOPE=admin` เพื่อล็อกเฉพาะหลังบ้าน `/admin` ส่วน API ที่หน้าเว็บเดิมเรียกเปิดเหมือนระบบเดิม
และ build ด้วย `NEXT_ASSET_PREFIX=/node-ui` เมื่อวางหน้าเว็บสองตัวบนโดเมนเดียวกัน
