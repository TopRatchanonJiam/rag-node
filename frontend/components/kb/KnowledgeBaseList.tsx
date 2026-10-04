import { Database, Plus } from "lucide-react";
import type { KnowledgeBase } from "@/lib/types";

export function KnowledgeBaseList({
  kbs,
  selectedId,
  onSelect,
  onCreateClick,
}: {
  kbs: KnowledgeBase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onCreateClick}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600"
      >
        <Plus size={15} /> สร้าง Knowledge Base ใหม่
      </button>

      {kbs.map((kb) => (
        <button
          key={kb.id}
          type="button"
          onClick={() => onSelect(kb.id)}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
            selectedId === kb.id
              ? "border-brand-500 bg-brand-50"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Database size={14} className="shrink-0 text-brand-600" />
            <span className="truncate font-medium text-slate-800">{kb.name}</span>
          </div>
          {kb.description && <p className="line-clamp-2 text-xs text-slate-500">{kb.description}</p>}
          <p className="text-xs text-slate-400">
            {kb.file_count} ไฟล์ · {kb.chunk_count} chunks
          </p>
        </button>
      ))}
    </div>
  );
}
