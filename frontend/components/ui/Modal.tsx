"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

const MAX_WIDTH = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  title,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className={`max-h-[85vh] w-full ${MAX_WIDTH[size]} overflow-y-auto rounded-2xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header ปักหมุดไว้บนสุดของพื้นที่ scroll ไม่ให้ปุ่มปิดเลื่อนหายไปพร้อมเนื้อหาด้านล่าง */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
