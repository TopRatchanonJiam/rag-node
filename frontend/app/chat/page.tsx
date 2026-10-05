"use client";

import { useEffect } from "react";

// ลิงก์เดิม /chat/?bot=... (ก่อนแยกหน้าแชท/หลังบ้าน) — ส่งต่อไปหน้าแชทใหม่ที่ / โดยคง query ไว้
export default function LegacyChatRedirect() {
  useEffect(() => {
    window.location.replace(`/${window.location.search}`);
  }, []);
  return null;
}
