"""launcher.py — จุดเริ่มของ 1n9 บน Windows (แพ็กเป็น .exe แบบไม่มีหน้าต่างดำ)

เปิด node ในเครื่องนี้ + ไอคอนที่มุมจอ (system tray: เปิดหน้าเว็บ / ปิดโปรแกรม) ข้อมูลทั้งหมดอยู่ใน %LOCALAPPDATA%\\1n9
(ลบโปรแกรมแล้วข้อมูลไม่หาย) โค้ดของ node ใช้ชุดเดียวกับ Docker ทุกบรรทัด — ที่นี่แค่ตั้งค่าสภาพแวดล้อมก่อนเปิด
"""

from __future__ import annotations

import atexit
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


def redirect_output_to_log() -> None:
    """แบบไม่มีหน้าต่างดำ stdout/stderr เป็น None — uvicorn จะพัง ส่งลงไฟล์ log แทน (หมุนเมื่อเกิน 2 MB)"""
    if sys.stdout is not None and sys.stderr is not None and sys.stdout.isatty():
        return
    log_dir = data_dir().parent if data_dir().name == "data" else data_dir()
    log = log_dir / "1n9.log"
    if log.exists() and log.stat().st_size > 2_000_000:
        log.replace(log_dir / "1n9.old.log")
    stream = open(log, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = stream


def healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
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


def start_qdrant():
    """Qdrant ที่แถมมาในโปรแกรม — ไม่มีไฟล์ (เช่นรันจากซอร์ส) หรือเปิดไม่ขึ้น ก็ยังเปิด node ให้ใช้ได้ (หน้าตรวจจะบอกเอง)"""
    if os.environ.get("QDRANT_URL") or os.environ.get("NODE_NO_BUNDLED_QDRANT"):
        return None
    exe = bundle_dir() / "qdrant" / "qdrant.exe"
    if not exe.exists():
        return None
    from qdrant_runner import QdrantRunner

    runner = QdrantRunner(exe, data_dir().parent if data_dir().name == "data" else data_dir())
    try:
        runner.start()
    except Exception as e:  # noqa: BLE001
        print(f"[1n9] Qdrant ที่แถมมาเปิดไม่ขึ้น: {e}", file=sys.stderr)
        return None
    atexit.register(runner.stop)
    return runner


def run_tray(port: int, server) -> bool:
    """ไอคอนที่มุมจอ — คืน False ถ้าสร้างไม่ได้ (เช่นรันจากซอร์สบนเครื่องที่ไม่มี pystray) ให้ผู้เรียกรันแบบไม่มีไอคอนแทน"""
    try:
        import pystray
        from PIL import Image
    except Exception:  # noqa: BLE001
        return False
    icon_path = bundle_dir() / "1n9.ico"
    image = Image.open(icon_path) if icon_path.exists() else Image.new("RGBA", (64, 64), (216, 74, 103, 255))

    def open_page(_icon=None, _item=None):
        webbrowser.open(f"http://127.0.0.1:{port}/admin/")

    def quit_app(icon, _item):
        server.should_exit = True
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("เปิดหน้าเว็บ 1n9", open_page, default=True),
        pystray.MenuItem("ปิดโปรแกรม", quit_app),
    )
    pystray.Icon("1n9", image, "1n9 AI", menu).run()
    return True


def main() -> None:
    port = int(os.environ.get("NODE_PORT") or DEFAULT_PORT)
    if healthy(port):  # เปิดซ้ำ: มีตัวที่รันอยู่แล้ว แค่เปิดหน้าให้
        if "--no-browser" not in sys.argv:
            webbrowser.open(f"http://127.0.0.1:{port}/admin/")
        return
    port = pick_port()

    redirect_output_to_log()
    os.environ.setdefault("NODE_DATA_DIR", str(data_dir()))
    os.environ.setdefault("NODE_FRONTEND_DIR", str(bundle_dir() / "web"))
    os.environ.setdefault("NODE_AUTH_SCOPE", "all")
    sys.path.insert(0, str(bundle_dir()))

    runner = start_qdrant()
    if runner:
        # ค่าเริ่มต้นตอนเปิดครั้งแรกเท่านั้น (เหมือน .env ของ Docker) — หลังจากนั้นเก็บในฐานข้อมูลของ node
        os.environ.setdefault("VECTOR_TYPE", "local")
        os.environ.setdefault("QDRANT_URL", runner.url)
        os.environ.setdefault("QDRANT_API_KEY", runner.key)

    import uvicorn

    import app as node  # noqa: PLC0415 — ต้อง import หลังตั้ง env เพราะ app.py อ่านค่าตอน import

    config = uvicorn.Config(node.app, host=os.environ.get("NODE_HOST", "127.0.0.1"), port=port, log_level="info",
                            server_header=False, use_colors=False)
    server = uvicorn.Server(config)

    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()

    if "--no-tray" in sys.argv:
        server.run()
        return
    thread = threading.Thread(target=server.run, name="node-server")
    thread.start()
    if not run_tray(port, server):
        thread.join()
        return
    server.should_exit = True  # ปิดจากเมนูไอคอน
    thread.join(timeout=15)


if __name__ == "__main__":
    main()
