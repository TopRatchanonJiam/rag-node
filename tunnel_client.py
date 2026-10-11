"""tunnel_client.py — เปิดท่อขาออกไปหา central ค้างไว้ ให้ central ใช้ Qdrant ในเครื่องนี้ได้โดยไม่ต้องเปิดพอร์ต

ความปลอดภัย: ส่งต่อได้เฉพาะ Qdrant API ไปที่ URL ของ Qdrant ที่ตั้งไว้ในเครื่องนี้เท่านั้น (central สั่งให้ไปที่อื่นใน LAN
ไม่ได้) และ key ของ Qdrant ใส่ที่ฝั่งนี้ ไม่เคยส่งไป central
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import threading
import time
from typing import Callable

import httpx

_log = logging.getLogger("node.tunnel")

# path ที่ qdrant-client ใช้ — นอกจากนี้ปฏิเสธหมด
_ALLOWED_PATH = re.compile(r"^/(collections(/.*)?|aliases(/.*)?)?$")
_ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
_MAX_MESSAGE = 128 * 1024 * 1024


class TunnelClient:
    def __init__(self, central_url: Callable[[], str], token: Callable[[bool], str],
                 target: Callable[[], tuple[str, str | None]], verify=True,
                 on_line: Callable[[dict], dict] | None = None):
        self._on_line = on_line
        self._central_url = central_url
        self._token = token
        self._target = target
        self._verify = verify
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.state = {"status": "stopped", "since": None, "error": None}

    # ── ควบคุม ──
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=lambda: asyncio.run(self._run()), name="central-tunnel", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._set("stopped")

    def _set(self, status: str, error: str | None = None) -> None:
        if self.state["status"] != status or self.state["error"] != error:
            self.state = {"status": status, "since": time.time(), "error": error}

    # ── วนเชื่อมต่อใหม่จนกว่าจะสั่งหยุด ──
    async def _run(self) -> None:
        import websockets
        delay, force_token = 1.0, False
        while not self._stop.is_set():
            self._set("connecting", self.state.get("error"))
            try:
                token = await asyncio.to_thread(self._token, force_token)
                url = re.sub(r"^http", "ws", self._central_url().rstrip("/")) + "/v1/tunnel"
                ssl_ctx = None
                if url.startswith("wss://") and self._verify is not True:
                    import ssl
                    ssl_ctx = ssl.create_default_context(cafile=self._verify) if isinstance(self._verify, str) else ssl.create_default_context()
                async with websockets.connect(url, additional_headers={"Authorization": f"Bearer {token}"},
                                              max_size=_MAX_MESSAGE, ping_interval=20, ping_timeout=20,
                                              open_timeout=15, ssl=ssl_ctx) as ws:
                    self._set("connected")
                    delay, force_token = 1.0, False
                    await self._serve(ws)
            except Exception as e:  # noqa: BLE001 — วนต่อเสมอ แค่จำสาเหตุล่าสุดไว้แสดงในหลังบ้าน
                code = getattr(getattr(e, "rcvd", None), "code", None)
                if code == 4401:
                    force_token = True  # token หมดอายุ/ถูกระงับ — ขอใหม่รอบหน้า
                if code == 4409:
                    self._set("replaced", "license นี้ถูกเปิดท่อจากเครื่องอื่นล่าสุด")
                else:
                    self._set("connecting", f"{type(e).__name__}: {e}"[:200])
            if self._stop.wait(delay):
                break
            delay = min(delay * 2, 30.0)

    async def _serve(self, ws) -> None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10)) as client:
            tasks: set[asyncio.Task] = set()
            send_lock = asyncio.Lock()

            async def handle(msg: dict):
                reply = await self._forward(client, msg)
                async with send_lock:
                    await ws.send(json.dumps({**reply, "id": msg.get("id")}))

            async for raw in ws:
                if self._stop.is_set():
                    break
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                t = asyncio.create_task(handle(msg))
                tasks.add(t)
                t.add_done_callback(tasks.discard)

    async def _forward(self, client: httpx.AsyncClient, msg: dict) -> dict:
        if msg.get("op") == "line" and self._on_line:
            # webhook ของ LINE ที่ central ส่งต่อมา — ตรวจลายเซ็นแล้วตอบรับทันที (คำตอบประมวลผลทีหลังใน thread)
            return await asyncio.to_thread(self._on_line, msg)
        if msg.get("op") != "http":
            return {"error": "unsupported op"}
        method, path = str(msg.get("method", "")).upper(), str(msg.get("path", ""))
        segments = path.split("/")
        if (method not in _ALLOWED_METHODS or not _ALLOWED_PATH.match(path) or "//" in path or "%" in path
                or any(seg in (".", "..") for seg in segments)):
            return {"error": "path not allowed"}
        base, api_key = self._target()
        if not base:
            return {"error": "ยังไม่ได้ตั้ง Qdrant ในเครื่องนี้"}
        headers = {k: v for k, v in (msg.get("headers") or {}).items() if k.lower() == "content-type"}
        if api_key:
            headers["api-key"] = api_key
        query = msg.get("query") or ""
        try:
            resp = await client.request(method, base.rstrip("/") + path + (f"?{query}" if query else ""),
                                        content=base64.b64decode(msg.get("body") or ""), headers=headers)
        except httpx.HTTPError as e:
            return {"error": f"ติดต่อ Qdrant ในเครื่องไม่ได้ ({type(e).__name__})"}
        return {"status": resp.status_code,
                "headers": {k: v for k, v in resp.headers.items() if k.lower() == "content-type"},
                "body": base64.b64encode(resp.content).decode()}
