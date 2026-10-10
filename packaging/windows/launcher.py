"""launcher.py — จุดเริ่มของ 1n9 บน Windows (แพ็กเป็น .exe)

เปิด node ในเครื่องนี้ แล้วเปิดเบราว์เซอร์ไปหน้าหลังบ้าน ข้อมูลทั้งหมดอยู่ใน %LOCALAPPDATA%\\1n9
(ลบโปรแกรมแล้วข้อมูลไม่หาย) โค้ดของ node ใช้ชุดเดียวกับ Docker ทุกบรรทัด — ที่นี่แค่ตั้งค่าสภาพแวดล้อมก่อนเปิด
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "1n9"
DEFAULT_PORT = 8080


def bundle_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    d = Path(os.environ.get("NODE_DATA_DIR") or Path(base) / APP_NAME / "data")
    d.mkdir(parents=True, exist_ok=True)
    return d


def healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1) if hasattr(socket, "SO_EXCLUSIVEADDRUSE") else None
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port() -> int:
    start = int(os.environ.get("NODE_PORT") or DEFAULT_PORT)
    for p in range(start, start + 20):
        if port_free(p):
            return p
    raise RuntimeError("no free port")


def open_when_ready(port: int) -> None:
    for _ in range(120):
        if healthy(port):
            webbrowser.open(f"http://127.0.0.1:{port}/admin/")
            return
        time.sleep(0.5)


def main() -> None:
    port = int(os.environ.get("NODE_PORT") or DEFAULT_PORT)
    if healthy(port):  # เปิดซ้ำ: มีตัวที่รันอยู่แล้ว แค่เปิดหน้าให้
        webbrowser.open(f"http://127.0.0.1:{port}/admin/")
        return
    port = pick_port()

    os.environ.setdefault("NODE_DATA_DIR", str(data_dir()))
    os.environ.setdefault("NODE_FRONTEND_DIR", str(bundle_dir() / "web"))
    os.environ.setdefault("NODE_AUTH_SCOPE", "all")
    sys.path.insert(0, str(bundle_dir()))

    import uvicorn

    import app as node  # noqa: PLC0415 — ต้อง import หลังตั้ง env เพราะ app.py อ่านค่าตอน import

    if not getattr(sys, "frozen", False) or "--no-browser" not in sys.argv:
        threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()
    uvicorn.run(node.app, host=os.environ.get("NODE_HOST", "127.0.0.1"), port=port, log_level="info",
                server_header=False)


if __name__ == "__main__":
    main()
