import { Bot, ChevronDown } from "lucide-react";
import type { Chatbot } from "@/lib/types";

export function BotSelector({
  bots,
  activeBotId,
  onSelect,
}: {
  bots: Chatbot[];
  activeBotId: string | null;
  onSelect: (id: string) => void;
}) {
  // มีบอทเดียวไม่ต้องมี dropdown ให้เลือก — โชว์ชื่อบอทตรง ๆ พอ
  if (bots.length <= 1) {
    const bot = bots[0];
    if (!bot) return null;
    return (
      <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white">
        <Bot size={14} />
        {bot.name}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-1">
      {/* label ชัด ๆ ว่า dropdown นี้ใช้สลับ Chatbot ไม่ใช่ตัวกรองอื่น */}
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">สลับ Chatbot</span>
      <div className="relative">
        <Bot size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <select
          value={activeBotId ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        >
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}
