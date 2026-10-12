"""line_channel.py — บอทตอบใน LINE Official Account ของลูกค้า

เส้นทาง: LINE → central (/v1/line/webhook/<tenant>/<channel>) → ท่อเชื่อมของ node → handle_webhook() ที่นี่
central ไม่รู้ secret/token ของ LINE — node ตรวจลายเซ็น (HMAC-SHA256 ของ body ด้วย channel secret) เอง แล้วตอบรับทันที
ส่วนคำตอบประมวลผลใน thread แล้วตอบผ่าน Reply API ด้วย access token ของลูกค้า (ตอบกลับฟรีไม่จำกัด ต่างจาก push ที่มีโควตา)

ข้อกำหนดที่ตัดสินใจไว้: ตอบเฉพาะข้อความตัวอักษรในแชทเดี่ยว — สติกเกอร์ รูป เสียง และกลุ่ม เงียบ (ไม่ตอบ)
ความจำบทสนทนาเก็บในหน่วยความจำเท่านั้น หมดอายุเอง ไม่เขียนลงดิสก์ (ข้อมูลส่วนบุคคลของลูกค้าปลายทาง)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import httpx

_log = logging.getLogger("node.line")

LINE_API = os.environ.get("LINE_API_BASE", "https://api.line.me").rstrip("/")
MEMORY_MESSAGES = 6          # ข้อความล่าสุดที่จำต่อผู้ใช้ (ผู้ใช้+บอทรวมกัน)
MEMORY_TTL = 2 * 3600        # ไม่คุยเกิน 2 ชั่วโมง = เริ่มบทสนทนาใหม่
MAX_USERS_IN_MEMORY = 2000
MAX_INPUT_CHARS = 1000
USER_LIMIT_COUNT, USER_LIMIT_WINDOW = 20, 3600   # ต่อผู้ใช้ LINE หนึ่งคน — ค่า LLM ตกที่ key ของร้าน กันถูกยิงรัว
MAX_REPLY_CHARS = 4800       # LINE รับข้อความละไม่เกิน 5000 ตัวอักษร
MAX_REPLY_MESSAGES = 5       # และตอบได้ครั้งละไม่เกิน 5 ข้อความ

THAI = re.compile(r"[฀-๿]")
_FALLBACK_TH = "ขออภัย ตอนนี้ตอบไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่"
_FALLBACK_EN = "Sorry, I can't answer right now. Please try again in a moment."
_LIMIT_TH = "ขออภัย ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"
_LIMIT_EN = "You're sending messages too quickly. Please wait a moment and try again."


def verify_signature(secret: str, body: bytes, signature: str) -> bool:
    if not secret or not signature:
        return False
    digest = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    return hmac.compare_digest(digest, signature.strip())


def to_plain_text(md: str) -> str:
    """LINE แสดง markdown ไม่ได้ — ตัดเครื่องหมายที่จะโผล่เป็นตัวอักษรรกตาออก"""
    t = md.replace("\r\n", "\n")
    t = re.sub(r"```[a-zA-Z0-9]*\n?", "", t)
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.M)
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    t = re.sub(r"__(.+?)__", r"\1", t)
    t = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", t)
    t = re.sub(r"^\s*[*-]\s+", "• ", t, flags=re.M)
    t = t.replace("`", "")
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def split_messages(text: str) -> list[str]:
    """แบ่งตามย่อหน้าให้พอดีข้อความละไม่เกิน MAX_REPLY_CHARS และไม่เกิน MAX_REPLY_MESSAGES ข้อความ"""
    parts: list[str] = []
    cur = ""
    for para in text.split("\n\n"):
        while len(para) > MAX_REPLY_CHARS:
            cut = para.rfind("\n", 0, MAX_REPLY_CHARS)
            cut = cut if cut > MAX_REPLY_CHARS // 2 else MAX_REPLY_CHARS
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(para[:cut])
            para = para[cut:].lstrip("\n")
        if len(cur) + len(para) + 2 > MAX_REPLY_CHARS and cur:
            parts.append(cur)
            cur = para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        parts.append(cur)
    return [p for p in parts if p.strip()][:MAX_REPLY_MESSAGES]


class LineService:
    def __init__(self, get_channel: Callable[[str], dict | None], ask: Callable[[str, str, list], str],
                 welcome_text: Callable[[str], str], record: Callable[[str, str | None], None]):
        self._get_channel = get_channel
        self._ask = ask
        self._welcome_text = welcome_text
        self._record = record
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="line")
        self._lock = threading.Lock()
        self._memory: OrderedDict[tuple[str, str], dict] = OrderedDict()
        self._hits: dict[tuple[str, str], deque] = {}
        self._warned: dict[tuple[str, str], float] = {}

    # ── เข้าจากท่อเชื่อม: ตรวจแล้วตอบรับทันที ──
    def handle_webhook(self, channel_id: str, signature: str, body: bytes) -> int:
        ch = self._get_channel(channel_id)
        if not ch or not ch.get("enabled", True):
            return 404
        if not verify_signature(ch.get("channel_secret", ""), body, signature):
            return 401
        try:
            events = (json.loads(body.decode("utf-8")) or {}).get("events") or []
        except ValueError:
            return 400
        for ev in events:
            if isinstance(ev, dict):
                self._pool.submit(self._process_safely, ch, ev)
        return 200

    def _process_safely(self, ch: dict, ev: dict) -> None:
        try:
            self._process(ch, ev)
        except Exception as e:  # noqa: BLE001 — จำสาเหตุไว้แสดงในหลังบ้าน ไม่ปล่อยให้ thread ตายเงียบ
            _log.warning("line event failed (%s): %s", type(e).__name__, e)
            self._record(ch["id"], f"{type(e).__name__}: {e}"[:200])

    # ── ประมวลผลเหตุการณ์ ──
    def _process(self, ch: dict, ev: dict) -> None:
        source = ev.get("source") or {}
        if source.get("type") != "user":  # กลุ่ม/ห้อง: เงียบ
            return
        kind = ev.get("type")
        if kind == "follow":
            text = self._welcome_text(ch["bot_id"]) if ch.get("welcome", True) else ""
            if text and ev.get("replyToken"):
                self._reply(ch, ev["replyToken"], split_messages(to_plain_text(text)))
            return
        message = ev.get("message") or {}
        if kind != "message" or message.get("type") != "text":  # สติกเกอร์ รูป เสียง ฯลฯ: เงียบ
            return
        text = str(message.get("text") or "").strip()[:MAX_INPUT_CHARS]
        user = source.get("userId") or ""
        token = ev.get("replyToken")
        if not text or not user or not token:
            return
        key = (ch["id"], user)
        if not self._allow(key):
            if self._first_warning(key):
                self._reply(ch, token, [_LIMIT_TH if THAI.search(text) else _LIMIT_EN])
            return
        self._loading(ch, user)
        history = self._history(key)
        try:
            answer = to_plain_text(self._ask(ch["bot_id"], text, history)) or ""
        except Exception as e:  # noqa: BLE001
            # เก็บรหัส error ของ central ไว้ด้วย (เช่น [provider_quota_exhausted]) ให้หลังบ้านบอกสาเหตุและวิธีแก้ได้ตรงจุด
            code = getattr(e, "code", "")
            self._record(ch["id"], (f"[{code}] {e}" if code else f"{type(e).__name__}: {e}")[:200])
            self._reply(ch, token, [_FALLBACK_TH if THAI.search(text) else _FALLBACK_EN])
            return
        if not answer:
            return
        self._reply(ch, token, split_messages(answer))
        self._remember(key, text, answer)
        self._record(ch["id"], None)

    # ── ความจำ + จำกัดความถี่ (ในหน่วยความจำ) ──
    def _allow(self, key) -> bool:
        now = time.time()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > USER_LIMIT_WINDOW:
                q.popleft()
            if len(q) >= USER_LIMIT_COUNT:
                return False
            q.append(now)
            return True

    def _first_warning(self, key) -> bool:
        now = time.time()
        with self._lock:
            if now - self._warned.get(key, 0) < USER_LIMIT_WINDOW:
                return False
            self._warned[key] = now
            return True

    def _history(self, key) -> list[dict]:
        now = time.time()
        with self._lock:
            entry = self._memory.get(key)
            if not entry or now - entry["at"] > MEMORY_TTL:
                self._memory.pop(key, None)
                return []
            return list(entry["messages"])

    def _remember(self, key, question: str, answer: str) -> None:
        now = time.time()
        with self._lock:
            entry = self._memory.get(key)
            if not entry or now - entry["at"] > MEMORY_TTL:
                entry = {"messages": [], "at": now}
            entry["messages"] = (entry["messages"] + [{"role": "user", "text": question},
                                                      {"role": "assistant", "text": answer}])[-MEMORY_MESSAGES:]
            entry["at"] = now
            self._memory[key] = entry
            self._memory.move_to_end(key)
            while len(self._memory) > MAX_USERS_IN_MEMORY:
                self._memory.popitem(last=False)

    # ── เรียก LINE API ──
    @staticmethod
    def _headers(ch: dict) -> dict:
        return {"Authorization": f"Bearer {ch['access_token']}"}

    def _reply(self, ch: dict, reply_token: str, texts: list[str]) -> None:
        if not texts:
            return
        resp = httpx.post(f"{LINE_API}/v2/bot/message/reply", headers=self._headers(ch), timeout=15,
                          json={"replyToken": reply_token, "messages": [{"type": "text", "text": t} for t in texts]})
        if resp.status_code >= 400:
            # reply token หมดอายุ/ใช้ซ้ำ/access token ผิด — ไม่ push แทน (push มีโควตาและค่าใช้จ่ายของร้าน)
            raise RuntimeError(f"LINE reply {resp.status_code}: {resp.text[:120]}")

    def _loading(self, ch: dict, user_id: str) -> None:
        """แสดงจุดสามจุดว่ากำลังพิมพ์ระหว่างรอ AI (ได้เฉพาะแชทเดี่ยว) — พลาดไม่เป็นไร"""
        try:
            httpx.post(f"{LINE_API}/v2/bot/chat/loading/start", headers=self._headers(ch), timeout=5,
                       json={"chatId": user_id, "loadingSeconds": 30})
        except httpx.HTTPError:
            pass


def fetch_bot_info(access_token: str) -> dict:
    """ตรวจ access token (และดึงชื่อบัญชี) — ยกเว้นข้อผิดพลาดที่อ่านรู้เรื่อง"""
    try:
        resp = httpx.get(f"{LINE_API}/v2/bot/info", headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    except httpx.HTTPError as e:
        raise ValueError(f"ติดต่อ LINE ไม่ได้ ({type(e).__name__})") from e
    if resp.status_code == 401:
        raise ValueError("Channel access token ไม่ถูกต้อง (ตรวจว่าคัดลอกมาครบ และเป็น Messaging API channel)")
    if resp.status_code >= 400:
        raise ValueError(f"LINE ตอบกลับ {resp.status_code}")
    return resp.json()
