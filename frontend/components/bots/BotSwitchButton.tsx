"use client";

import { useState } from "react";
import { Bot, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Chatbot } from "@/lib/types";

// ปุ่มลอยมุมขวาบนของ ChatWindow — ใช้แทน BotSelector แบบ dropdown เต็มแถวบนจอแคบ
// (มือถือ/แท็บเล็ต) เพื่อไม่ให้กินพื้นที่แนวตั้งถาวร กดแล้วค่อยเปิด modal ให้เลือก
export function BotSwitchButton({
  bots,
  activeBotId,
  onSelect,
}: {
  bots: Chatbot[];
  activeBotId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (bots.length <= 1) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="สลับ Chatbot"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-soft ring-1 ring-inset ring-slate-200 backdrop-blur transition-colors hover:bg-white"
      >
        <Bot size={16} />
      </button>

      {open && (
        <Modal title="สลับ Chatbot" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-1">
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => {
                  onSelect(bot.id);
                  setOpen(false);
                }}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  bot.id === activeBotId ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {bot.name}
                {bot.id === activeBotId && <Check size={15} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
