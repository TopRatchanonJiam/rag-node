"""qdrant_runner.py — รัน Qdrant ที่แถมมาในโปรแกรม เป็นโปรเซสลูกของ 1n9.exe

- เปิดเฉพาะ 127.0.0.1 และบังคับใช้ API key ที่สุ่มครั้งแรก (เก็บในโฟลเดอร์ข้อมูล) — Qdrant ตอบ CORS แบบเปิดกว้าง
  ถ้าไม่มี key เว็บไซต์ใดก็ตามที่ลูกค้าเปิดอยู่ในเบราว์เซอร์จะยิงอ่านฐานข้อมูลผ่าน localhost ได้
- ผูกกับ Job object ของ Windows แบบ kill-on-close: ถึง 1n9.exe ถูกฆ่ากะทันหัน Qdrant ก็ตายตามด้วย ไม่ค้างล็อกโฟลเดอร์ข้อมูล
- พอร์ตเริ่มที่ 16333 (ไม่ชนกับ Qdrant 6333 ที่ลูกค้าอาจมีอยู่แล้ว)
"""

from __future__ import annotations

import ctypes
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from ctypes import wintypes
from pathlib import Path

QDRANT_PORT = 16333


class _IoCounters(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in
                ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                 "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _BasicLimits(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _BasicLimits), ("IoInfo", _IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


_JOB_KILL_ON_CLOSE = 0x2000
_job_handle = None  # ต้องถือไว้ตลอดอายุโปรเซส — handle ปิดเมื่อไหร่ ลูกถูกฆ่าเมื่อนั้น


def _bind_to_kill_on_close_job(proc: subprocess.Popen) -> None:
    global _job_handle
    if sys.platform != "win32":
        return
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    info = _ExtendedLimits()
    info.BasicLimitInformation.LimitFlags = _JOB_KILL_ON_CLOSE
    if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
    if not k32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):  # noqa: SLF001
        raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
    _job_handle = job


def _get_or_create_key(path: Path) -> str:
    if path.exists():
        key = path.read_text(encoding="utf-8").strip()
        if key:
            return key
    key = secrets.token_urlsafe(32)
    path.write_text(key, encoding="utf-8")
    return key


def _is_qdrant(port: int, key: str) -> bool:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/collections", headers={"api-key": key})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            return r.status == 200 and "result" in json.loads(r.read())
    except Exception:
        return False


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


class QdrantRunner:
    def __init__(self, exe: Path, data_root: Path):
        self.exe = exe
        self.dir = data_root / "qdrant"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.key = _get_or_create_key(data_root / "qdrant_api_key")
        self.port = QDRANT_PORT
        self.proc: subprocess.Popen | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self, wait: float = 40.0) -> None:
        if _is_qdrant(self.port, self.key):  # ตัวของเราที่ค้างจากรอบก่อน/เปิดซ้ำ — ใช้ต่อ
            return
        if not _port_free(self.port):
            self.port = next(p for p in range(QDRANT_PORT + 2, QDRANT_PORT + 40) if _port_free(p) and _port_free(p + 1))
        env = {
            **os.environ,
            "QDRANT__SERVICE__HOST": "127.0.0.1",
            "QDRANT__SERVICE__HTTP_PORT": str(self.port),
            "QDRANT__SERVICE__GRPC_PORT": str(self.port + 1),
            "QDRANT__SERVICE__API_KEY": self.key,
            "QDRANT__STORAGE__STORAGE_PATH": str(self.dir / "storage"),
            "QDRANT__STORAGE__SNAPSHOTS_PATH": str(self.dir / "snapshots"),
            "QDRANT__TELEMETRY_DISABLED": "true",
        }
        # Windows จำกัดเส้นทางไฟล์ 260 ตัวอักษร ส่วน Qdrant สร้างไฟล์ลึกต่อจากนี้อีกราว 120 ตัว (วัดจริง: 111 + ชื่อ collection)
        # ถ้าโฟลเดอร์ข้อมูลยาวเกินไป สร้าง collection จะล้มด้วย error ที่อ่านไม่รู้เรื่อง — บอกสาเหตุตรง ๆ ก่อน
        if sys.platform == "win32" and len(str(self.dir / "storage")) > 110:
            raise RuntimeError(f"โฟลเดอร์ข้อมูลยาวเกินไปสำหรับ Windows ({len(str(self.dir / 'storage'))} ตัวอักษร) "
                               "— ตั้ง NODE_DATA_DIR เป็นเส้นทางสั้น ๆ เช่น C:\1n9")
        log = open(self.dir / "qdrant.log", "ab")
        self.proc = subprocess.Popen(
            [str(self.exe)], cwd=str(self.dir), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        _bind_to_kill_on_close_job(self.proc)
        deadline = time.time() + wait
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"Qdrant ปิดตัวเองทันที (ดู {self.dir / 'qdrant.log'})")
            if _is_qdrant(self.port, self.key):
                return
            time.sleep(0.3)
        raise RuntimeError("Qdrant เริ่มไม่ทันเวลา")

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(8)
            except subprocess.TimeoutExpired:
                self.proc.kill()
