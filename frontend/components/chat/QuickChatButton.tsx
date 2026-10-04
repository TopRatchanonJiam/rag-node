"use client";

import { useState } from "react";
import { MessageSquareText, Zap } from "lucide-react";

// ปุ่มลอยมุมขวาบนของ ChatWindow คู่กับ BotSwitchButton — ใช้แทนแถว quick-chat chip
// เต็มความกว้างบนจอแคบ ตั้งใจไม่ใช้ Modal (ไม่ต้อง dim จอ ไม่บังคับให้เลือก) แค่ popover
// เล็ก ๆ ที่คลิกข้างนอกแล้วปิดเฉย ๆ ได้โดยไม่ต้องเลือกอะไร
export function QuickChatButton({
  tags,
  onPick,
  disabled,
}: {
  tags: string[];
  onPick: (tag: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (tags.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="คำถามด่วน"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-soft ring-1 ring-inset ring-slate-200 backdrop-blur transition-colors hover:bg-white"
      >
        <Zap size={16} />
      </button>

      {open && (
        <>
          {/* backdrop โปร่งใส แค่ดักคลิกข้างนอกให้ปิด ไม่ใช่ modal จริง เลยไม่ dim จอ */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-72 max-w-[85vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              กดเพื่อถามได้เลย
            </p>
            {/* divide-y กันข้อความแต่ละคำถามไหลติดกันเป็นพรืด ๆ เหมือนย่อหน้าเดียว โดยเฉพาะเวลามีหลายข้อ
                หรือคำถามยาวจนตัดบรรทัด + จำกัดความสูงให้ scroll เองถ้ามีคำถามเยอะ ไม่ดันจอยาวเกิน */}
            <div className="flex max-h-72 flex-col divide-y divide-slate-100 overflow-y-auto">
              {tags.map((tag, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onPick(tag);
                    setOpen(false);
                  }}
                  className="flex items-start gap-2 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <MessageSquareText size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
