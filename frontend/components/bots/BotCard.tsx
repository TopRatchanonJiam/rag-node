import Link from "next/link";
import { MessageSquareText, Pencil, Sigma, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Chatbot } from "@/lib/types";

export function BotCard({
  bot,
  onEdit,
  onDelete,
}: {
  bot: Chatbot;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="font-semibold text-slate-900">{bot.name}</h3>
        {bot.description && <p className="mt-1 text-sm text-slate-500">{bot.description}</p>}
        <p className="mt-1 text-xs text-slate-400">
          LLM: {bot.llm_name ?? "—"}{bot.llm_model_id ? "" : " (ค่าเริ่มต้น)"}
          {bot.use_rerank ? ` · Rerank: ${bot.rerank_name ?? "—"}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {bot.kb_names.length === 0 ? (
          <span className="text-xs italic text-slate-400">ยังไม่ได้ผูก Knowledge Base</span>
        ) : (
          bot.kb_names.map((name) => <Badge key={name}>{name}</Badge>)
        )}
        {bot.skill_set_names.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
          >
            <Sigma size={11} /> {name}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-2">
        <Link
          href={`/?bot=${bot.id}`}
          className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white shadow-ink transition-shadow hover:shadow-glow"
        >
          <MessageSquareText size={13} /> คุยกับบอทนี้
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          <Pencil size={13} /> แก้ไข
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50"
        >
          <Trash2 size={13} /> ลบ
        </button>
      </div>
    </div>
  );
}
