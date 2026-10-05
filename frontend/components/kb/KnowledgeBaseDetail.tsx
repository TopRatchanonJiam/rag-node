"use client";

import { useState } from "react";
import { AlertTriangle, Eye, FileText, Loader2, Trash2 } from "lucide-react";
import { DocDropzone } from "./DocDropzone";
import { ChunkViewerModal } from "./ChunkViewerModal";
import { Button } from "@/components/ui/Button";
import type { KnowledgeBase } from "@/lib/types";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBaseDetail({
  kb,
  uploading,
  deletingFile,
  onUpload,
  onDeleteFile,
  onDeleteKb,
}: {
  kb: KnowledgeBase;
  uploading: boolean;
  deletingFile: string | null;
  onUpload: (file: File) => void;
  onDeleteFile: (filename: string) => void;
  onDeleteKb: () => void;
}) {
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{kb.name}</h2>
          {kb.description && <p className="mt-1 text-sm text-slate-500">{kb.description}</p>}
          <p className="mt-2 text-xs text-slate-400">
            {kb.file_count} ไฟล์ · {kb.chunk_count} chunks · embedding: {kb.embedding?.model ?? "—"} ({kb.embedding?.dim ?? "?"} มิติ)
          </p>
        </div>
        <Button variant="ghost" onClick={onDeleteKb} className="text-rose-600 hover:bg-rose-50">
          <Trash2 size={15} /> ลบ Knowledge Base
        </Button>
      </div>

      {kb.embedding_matches === false && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          KB นี้สร้างด้วย embedding คนละตัวกับที่ตั้งไว้ตอนนี้ จึงค้นหาและอัปโหลดเพิ่มไม่ได้ — สร้าง KB ใหม่แล้วอัปโหลดเอกสารใหม่
          หรือเปลี่ยน embedding กลับในหน้าการเชื่อมต่อ AI
        </p>
      )}

      <DocDropzone onFileSelected={onUpload} disabled={uploading || kb.embedding_matches === false} />
      {uploading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> กำลังอัปโหลดและสร้าง chunk...
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">ไฟล์ในนี้</p>
        {!kb.files || kb.files.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีไฟล์ในคลังความรู้นี้</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {kb.files.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={15} className="shrink-0 text-slate-400" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatSize(f.size)}
                    {typeof f.chunks === "number" ? ` · ${f.chunks} chunks` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewingFile(f.name)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`View chunks of ${f.name}`}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFile(f.name)}
                    disabled={deletingFile === f.name}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    aria-label={`Delete ${f.name}`}
                  >
                    {deletingFile === f.name ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewingFile && <ChunkViewerModal kbId={kb.id} filename={viewingFile} onClose={() => setViewingFile(null)} />}
    </div>
  );
}
