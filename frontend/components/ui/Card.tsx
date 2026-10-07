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
      className={`rounded-2xl bg-white p-6 shadow-float ring-1 ring-accent-200/60 ${
        hover ? "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-soft-lg" : ""
      } ${className}`}
      {...props}
    />
  );
}
