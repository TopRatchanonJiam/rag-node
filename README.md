# rag-node (VPS2 / เครื่องลูกค้า)

node เป็นตัวบางที่สุด ทำหน้าที่ดังนี้:

- ถือ key ของลูกค้าใน `.env`
- เก็บสถานะ (KB, สูตร, บอท, cache, usage) เป็นไฟล์ JSON ใน `data/`
- ส่งงานทั้งหมดไปให้ central ประมวลผล
- มีหน้าเว็บถาม-ตอบที่ `/` ไว้ทดสอบ

สัญญา API ที่ใช้คุยกับ central: [docs/CENTRAL_API_CONTRACT.md](docs/CENTRAL_API_CONTRACT.md)

node เป็นฝ่ายเรียกออกไปหา central ฝ่ายเดียว จึงรันบนเครื่อง local ได้ ไม่ต้องเปิดพอร์ตหรือมี IP สาธารณะ

## รันบนเครื่อง local (Windows)

```powershell
cd node
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env     # ตั้ง CENTRAL_URL=https://central.example.com, LICENSE_KEY และ key ของคุณ
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

เปิด http://127.0.0.1:8080 แล้วล็อกอินด้วย `NODE_USER` / `NODE_PASSWORD` (ถ้าเว้น `NODE_PASSWORD` ว่าง หน้าเว็บจะไม่ล็อก ซึ่งใช้ได้เฉพาะบน local)

## ติดตั้งบน server

```bash
sudo useradd -r -m -d /opt/rag-node rag || true
sudo -u rag git clone <url ของ repo นี้> /opt/rag-node/app
cd /opt/rag-node/app
sudo -u rag python3 -m venv .venv && sudo -u rag .venv/bin/pip install -r requirements.txt
sudo -u rag cp .env.example .env      # ต้องตั้ง NODE_PASSWORD บนเครื่องจริง
sudo cp deploy/rag-node.service /etc/systemd/system/ && sudo systemctl enable --now rag-node
# nginx + certbot ใช้ deploy/nginx-node.conf.example
```

## ข้อควรรู้

- **Embedding ล็อกต่อ KB** ตั้ง `EMBED_MODEL` และ `EMBED_DIM` ก่อนสร้าง KB แรก ถ้าเปลี่ยนทีหลัง KB เดิมจะใช้ไม่ได้
- **ไฟล์ต้นฉบับ** เก็บไว้ที่ `data/originals/` เผื่อต้อง re-index
- **ไฟล์ export** ที่ central ส่งกลับมาเก็บไว้ที่ `data/exports/`
