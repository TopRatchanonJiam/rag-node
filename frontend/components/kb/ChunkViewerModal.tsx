"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getKnowledgeBaseFileChunks } from "@/lib/api";

type Chunk = {
  id: string;
  text: string;
  length: number;
  metadata: Record<string, unknown>;
  index: number;
};

const CHUNK_TYPE_STYLE: Record<string, string> = {
  parent: "bg-slate-900 text-white ring-slate-900",
  child: "bg-white text-slate-700 ring-slate-300",
  text: "bg-slate-100 text-slate-600 ring-slate-200",
};

function chunkTypeOf(c: Chunk) {
  const t = c.metadata?.chunk_type;
  return typeof t === "string" ? t : "unknown";
}

function chunkLabel(c: Chunk) {
  const parts: string[] = [];
  const page = c.metadata?.page;
  if (typeof page === "number") parts.push(`page ${page}`);
  const row = c.metadata?.row_start ?? c.metadata?.row_index;
  if (typeof row === "number") parts.push(`row ${row}`);
  return parts.join(" · ");
}

function sensitiveColumnsOf(c: Chunk): string[] {
  const v = c.metadata?.sensitive_columns;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function formatMetaValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatChunksForCopy(chunks: Chunk[], filename: string) {
  return chunks
    .map((c) => `--- Chunk ${c.index} [${chunkTypeOf(c)}]${chunkLabel(c) ? ` (${chunkLabel(c)})` : ""} — ${filename} ---\n${c.text}`)
    .join("\n\n");
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ChunkViewerModal({ kbId, filename, onClose }: { kbId: string; filename: string; onClose: () => void }) {
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedMeta, setExpandedMeta] = useState<Set<string>>(new Set());

  function toggleMeta(id: string) {
    setExpandedMeta((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    setChunks(null);
    setError(null);
    getKnowledgeBaseFileChunks(kbId, filename)
      .then((res) => setChunks(res.chunks))
      .catch((e) => setError(e instanceof Error ? e.message : "โหลด chunk ไม่สำเร็จ"));
  }, [kbId, filename]);

  const types = useMemo(() => {
    if (!chunks) return [];
    return Array.from(new Set(chunks.map(chunkTypeOf)));
  }, [chunks]);

  const visibleChunks = useMemo(() => {
    if (!chunks) return [];
    return filterType === "all" ? chunks : chunks.filter((c) => chunkTypeOf(c) === filterType);
  }, [chunks, filterType]);

  async function handleCopyAll() {
    if (!chunks) return;
    await copyText(formatChunksForCopy(visibleChunks, filename));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  async function handleCopyOne(c: Chunk) {
    await copyText(c.text);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 1200);
  }

  return (
    <Modal title={`Chunks: ${filename}`} onClose={onClose} size="xl">
      <div className="flex flex-col gap-3">
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

        {!chunks && !error && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด chunk...
          </div>
        )}

        {chunks && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterType("all")}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    filterType === "all" ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  ทั้งหมด ({chunks.length})
                </button>
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                      filterType === t ? "bg-slate-900 text-white ring-slate-900" : `${CHUNK_TYPE_STYLE[t] ?? CHUNK_TYPE_STYLE.text} hover:opacity-80`
                    }`}
                  >
                    {t} ({chunks.filter((c) => chunkTypeOf(c) === t).length})
                  </button>
                ))}
              </div>

              <Button variant="secondary" onClick={handleCopyAll} className="text-xs">
                {copiedAll ? <Check size={14} /> : <Copy size={14} />}
                {copiedAll ? "คัดลอกแล้ว" : `คัดลอกทั้งหมด (${visibleChunks.length})`}
              </Button>
            </div>

            <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: "60vh" }}>
              {visibleChunks.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">ไม่มี chunk ในหมวดนี้</p>
              ) : (
                visibleChunks.map((c) => {
                  const type = chunkTypeOf(c);
                  const label = chunkLabel(c);
                  const sensitiveCols = sensitiveColumnsOf(c);
                  const metaOpen = expandedMeta.has(c.id);
                  const metaEntries = Object.entries(c.metadata ?? {});
                  return (
                    <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 font-semibold text-white">#{c.index}</span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${CHUNK_TYPE_STYLE[type] ?? CHUNK_TYPE_STYLE.text}`}>
                          {type}
                        </span>
                        <span className="text-slate-400">{c.length} ตัวอักษร</span>
                        {label && <span className="text-slate-400">{label}</span>}
                        <button
                          type="button"
                          onClick={() => handleCopyOne(c)}
                          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Copy chunk"
                        >
                          {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>

                      {sensitiveCols.length > 0 && (
                        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-900 px-2 py-0.5 text-xs font-medium text-slate-900">
                          <Lock size={11} /> อ่อนไหว: {sensitiveCols.join(", ")}
                        </span>
                      )}

                      <p className="whitespace-pre-wrap text-sm text-slate-700">{c.text}</p>

                      <button
                        type="button"
                        onClick={() => toggleMeta(c.id)}
                        className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                      >
                        {metaOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {metaOpen ? "ซ่อน metadata" : "ดู metadata ทั้งหมด"}
                      </button>

                      {metaOpen && (
                        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs">
                          {metaEntries.length === 0 ? (
                            <span className="col-span-2 text-slate-400">ไม่มี metadata</span>
                          ) : (
                            metaEntries.map(([key, value]) => (
                              <div key={key} className="contents">
                                <dt className="font-mono text-slate-400">{key}</dt>
                                <dd className="break-words text-slate-700">{formatMetaValue(value)}</dd>
                              </div>
                            ))
                          )}
                        </dl>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
