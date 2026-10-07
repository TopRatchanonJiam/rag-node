# ── 1) build หน้าเว็บ (Next.js static export → /web/out) ──
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# ว่าง = ปกติ · ใส่ เช่น /node-ui เมื่อวางคู่กับเว็บอื่นบนโดเมนเดียวกัน (ดู next.config.mjs)
ARG NEXT_ASSET_PREFIX=""
RUN NEXT_ASSET_PREFIX="$NEXT_ASSET_PREFIX" npm run build

# ── 2) node backend (FastAPI) + ไฟล์หน้าเว็บที่ build แล้ว ──
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_DATA_DIR=/app/data \
    NODE_FRONTEND_DIR=/app/web

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py legacy_api.py ./
COPY --from=web /web/out /app/web

# data/ = state.json, ไฟล์ต้นฉบับ, ไฟล์ export ของลูกค้า
# chmod a+rX: กันไฟล์ที่มาจาก SMB share (ACL) ที่ user rag อ่านไม่ได้
RUN useradd -r -u 10001 rag && chmod -R a+rX /app && mkdir -p /app/data && chown -R rag /app/data
USER rag

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header"]
