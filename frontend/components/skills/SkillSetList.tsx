import { Sigma, Plus } from "lucide-react";
import type { SkillSet } from "@/lib/types";

export function SkillSetList({
  skillSets,
  selectedId,
  onSelect,
  onCreateClick,
}: {
  skillSets: SkillSet[];
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
        <Plus size={15} /> สร้าง Skill Set ใหม่
      </button>

      {skillSets.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
            selectedId === s.id ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Sigma size={14} className="shrink-0 text-brand-600" />
            <span className="truncate font-medium text-slate-800">{s.name}</span>
          </div>
          {s.description && <p className="line-clamp-2 text-xs text-slate-500">{s.description}</p>}
          <p className="text-xs text-slate-400">
            {s.file_count} ไฟล์ · {s.skills_count} สูตร
          </p>
        </button>
      ))}
    </div>
  );
}
