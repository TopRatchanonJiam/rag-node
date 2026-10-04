import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** ยกการ์ดขึ้นเมื่อ hover — ค่าเริ่มต้น true เหมือนเดิมทุกที่ที่ใช้อยู่แล้ว (การ์ดโชว์เนื้อหา
   *  เช่นหน้าแรก) ปิดเฉพาะหน้าที่เนื้อหาข้างในเป็นฟอร์ม/รายการที่ต้องเอาเมาส์วนอยู่ตลอด เพราะ
   *  การ์ดทั้งใบขยับทุกครั้งที่เมาส์แตะขอบทำให้เวียนหัวเวลาต้องกรอกข้อมูลในนั้นนานๆ */
  hover?: boolean;
}

export function Card({ className = "", hover = true, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-6 shadow-soft ${
        hover ? "transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-soft-lg" : ""
      } ${className}`}
      {...props}
    />
  );
}
