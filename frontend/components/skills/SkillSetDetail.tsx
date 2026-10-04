"use client";

import { FileText, Loader2, Sigma, Trash2 } from "lucide-react";
import { DocDropzone } from "@/components/kb/DocDropzone";
import { Button } from "@/components/ui/Button";
import type { SkillSet } from "@/lib/types";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SkillSetDetail({
  skillSet,
  uploading,
  deletingFile,
  onUpload,
  onDeleteFile,
  onDeleteSkillSet,
}: {
  skillSet: SkillSet;
  uploading: boolean;
  deletingFile: string | null;
  onUpload: (file: File) => void;
  onDeleteFile: (filename: string) => void;
  onDeleteSkillSet: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{skillSet.name}</h2>
          {skillSet.description && <p className="mt-1 text-sm text-slate-500">{skillSet.description}</p>}
          <p className="mt-2 text-xs text-slate-400">
            {skillSet.file_count} ไฟล์ · {skillSet.skills_count} สูตร
          </p>
        </div>
        <Button variant="ghost" onClick={onDeleteSkillSet} className="text-rose-600 hover:bg-rose-50">
          <Trash2 size={15} /> ลบ Skill Set
        </Button>
      </div>

      <DocDropzone onFileSelected={onUpload} disabled={uploading} acceptedExt={[".md"]} />
      {uploading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> กำลังอัปโหลดและ parse สูตร...
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">ไฟล์สูตร (.md)</p>
        {!skillSet.files || skillSet.files.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีไฟล์สูตรใน Skill Set นี้</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {skillSet.files.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={15} className="shrink-0 text-slate-400" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{formatSize(f.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteFile(f.name)}
                  disabled={deletingFile === f.name}
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  aria-label={`Delete ${f.name}`}
                >
                  {deletingFile === f.name ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Sigma size={14} /> สูตรที่ parse ได้ ({skillSet.skills?.length ?? 0})
        </p>
        {!skillSet.skills || skillSet.skills.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีสูตรที่ parse ได้</p>
        ) : (
          <div className="flex max-h-80 flex-col divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {skillSet.skills.map((s, i) => (
              <div key={i} className="px-3.5 py-2.5 text-sm">
                <p className="font-medium text-slate-800">{s.name}</p>
                {s.formula && <p className="mt-0.5 font-mono text-xs text-slate-500">{s.formula}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
