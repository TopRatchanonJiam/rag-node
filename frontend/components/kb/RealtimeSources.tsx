"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ChunkViewerModal } from "./ChunkViewerModal";
import {
  createRealtimeSource,
  deleteRealtimeSource,
  listRealtimeSources,
  syncRealtimeSource,
  testRealtimeSource,
  toggleRealtimeSource,
  updateRealtimeSource,
} from "@/lib/api";
import type { RealtimeAuth, RealtimeSource, RealtimeSourceInput } from "@/lib/types";

// ── ข้อความ ──────────────────────────────────────────

const INTERVALS: [number, string][] = [
  [60, "ทุก 1 นาที"],
  [300, "ทุก 5 นาที"],
  [900, "ทุก 15 นาที"],
  [1800, "ทุก 30 นาที"],
  [3600, "ทุก 1 ชั่วโมง"],
  [21600, "ทุก 6 ชั่วโมง"],
  [86400, "วันละครั้ง"],
];

const AUTH_LABEL: Record<RealtimeAuth, string> = {
  none: "ไม่ต้องยืนยันตัวตน",
  bearer: "Bearer token",
  api_key_header: "API key ใน header",
  api_key_query: "API key ใน URL",
};

const MODE_LABEL: Record<string, string> = {
  full: "โหลดใหม่ทั้งชุด",
  incremental: "แก้เฉพาะแถวที่เปลี่ยน",
  unchanged: "ไม่มีข้อมูลเปลี่ยน",
};

function intervalLabel(sec: number) {
  return INTERVALS.find(([s]) => s === sec)?.[1] ?? `ทุก ${Math.round(sec / 60)} นาที`;
}

function timeAgo(iso: string | null) {
  if (!iso) return "ยังไม่เคยอัปเดต";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}

// ── ฟอร์ม ────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-accent-400">{hint}</p>}
    </div>
  );
}

function jsonText(v: Record<string, unknown>) {
  return Object.keys(v || {}).length ? JSON.stringify(v, null, 2) : "";
}

function parseJson(label: string, text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`${label} ต้องเป็น JSON เช่น {"key": "value"}`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} ต้องเป็น JSON object`);
  return v as Record<string, unknown>;
}

function SourceModal({
  kbId,
  source,
  onClose,
  onSaved,
}: {
  kbId: string;
  source: RealtimeSource | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [method, setMethod] = useState<"GET" | "POST">(source?.method ?? "GET");
  const [auth, setAuth] = useState<RealtimeAuth>(source?.auth_type ?? "none");
  const [token, setToken] = useState<string | null>("");
  const [headerName, setHeaderName] = useState(source?.auth_header_name ?? "");
  const [queryName, setQueryName] = useState(source?.auth_query_param ?? "");
  const [path, setPath] = useState(source?.records_path ?? "");
  const [pollSec, setPollSec] = useState(source?.poll_interval_sec ?? 300);
  const [fields, setFields] = useState<string[]>(source?.fields ?? []);
  const [advanced, setAdvanced] = useState(!!source && (jsonText(source.headers) !== "" || jsonText(source.query_params) !== "" || jsonText(source.body) !== ""));
  const [headers, setHeaders] = useState(jsonText(source?.headers ?? {}));
  const [query, setQuery] = useState(jsonText(source?.query_params ?? {}));
  const [body, setBody] = useState(jsonText(source?.body ?? {}));
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof testRealtimeSource>> | null>(null);
  const tokenSet = !!source?.auth_token.set;

  function build(): RealtimeSourceInput {
    return {
      id: source?.id,
      name: name.trim() || "แหล่งข้อมูล",
      url: url.trim(),
      method,
      auth_type: auth,
      auth_token: token === null ? null : token.trim(),
      auth_header_name: headerName,
      auth_query_param: queryName,
      records_path: path,
      poll_interval_sec: pollSec,
      fields,
      headers: parseJson("Headers", headers) as Record<string, string>,
      query_params: parseJson("Query", query) as Record<string, string>,
      body: method === "POST" ? parseJson("Body", body) : {},
    };
  }

  async function run(kind: "test" | "save") {
    setBusy(kind);
    setErr(null);
    try {
      const input = build();
      if (kind === "test") {
        setPreview(await testRealtimeSource(input));
        return;
      }
      if (source) await updateRealtimeSource(source.id, input);
      else await createRealtimeSource(kbId, input);
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ไม่สำเร็จ");
      if (kind === "test") setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  const cols = preview ? preview.fields.slice(0, 6) : [];

  return (
    <Modal title={source ? `แก้ไข ${source.name}` : "เชื่อมข้อมูลสดจาก API"} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อ" hint="เช่น ‘สต็อกสินค้า’ หรือ ‘ราคาวันนี้’">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อแหล่งข้อมูล" autoFocus />
          </Field>
          <Field label="อัปเดตอัตโนมัติ">
            <select className="field" value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))}>
              {INTERVALS.map(([s, l]) => (
                <option key={s} value={s}>{l}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="URL ของ API" hint="node เป็นคนเรียก API นี้เอง — ใช้ API ภายในบริษัทได้ key ไม่ออกนอกองค์กร">
          <div className="flex gap-2">
            <div className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-accent-200">
              {(["GET", "POST"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-3 text-xs font-semibold ${method === m ? "bg-ink bg-ink-grad text-white" : "bg-white text-accent-500 hover:text-accent-800"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <input className="field font-mono text-[13px]" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} placeholder="https://erp.company.local/api/stock" spellCheck={false} />
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="การยืนยันตัวตน">
            <select className="field" value={auth} onChange={(e) => setAuth(e.target.value as RealtimeAuth)}>
              {(Object.keys(AUTH_LABEL) as RealtimeAuth[]).map((a) => (
                <option key={a} value={a}>{AUTH_LABEL[a]}</option>
              ))}
            </select>
          </Field>
          {auth !== "none" && (
            <Field label={auth === "bearer" ? "Token" : "API key"} hint={token === null ? "จะลบเมื่อกดบันทึก" : tokenSet ? "เว้นว่าง = ใช้ค่าเดิม" : undefined}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-400" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="field !pl-8"
                    value={token ?? ""}
                    disabled={token === null}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={tokenSet ? `${source?.auth_token.hint} (ตั้งไว้แล้ว)` : "วางค่าที่นี่"}
                  />
                </div>
                {tokenSet && (
                  <button type="button" onClick={() => setToken(token === null ? "" : null)} className="shrink-0 rounded-lg px-2.5 text-xs font-medium text-accent-500 hover:bg-accent-100">
                    {token === null ? "ยกเลิก" : "ลบ"}
                  </button>
                )}
              </div>
            </Field>
          )}
          {auth === "api_key_header" && (
            <Field label="ชื่อ header" hint="เว้นว่าง = X-API-Key">
              <input className="field font-mono text-[13px]" value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-API-Key" />
            </Field>
          )}
          {auth === "api_key_query" && (
            <Field label="ชื่อพารามิเตอร์" hint="เว้นว่าง = api_key">
              <input className="field font-mono text-[13px]" value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="api_key" />
            </Field>
          )}
        </div>

        <Field label="ตำแหน่งของรายการข้อมูล (ไม่บังคับ)" hint="ถ้า API ตอบ { “data”: { “items”: [...] } } ให้ใส่ data.items — เว้นว่างถ้าตอบเป็นรายการ [...] เลย">
          <input className="field font-mono text-[13px]" value={path} onChange={(e) => { setPath(e.target.value); setPreview(null); }} placeholder="data.items" spellCheck={false} />
        </Field>

        <div>
          <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-xs font-medium text-accent-500 hover:text-accent-800">
            <ChevronDown size={14} className={`transition-transform ${advanced ? "rotate-180" : ""}`} /> ตั้งค่าขั้นสูง (headers / query / body)
          </button>
          {advanced && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Headers (JSON)">
                <textarea className="field h-24 font-mono text-[12px]" value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder={'{"Accept": "application/json"}'} spellCheck={false} />
              </Field>
              <Field label="Query (JSON)">
                <textarea className="field h-24 font-mono text-[12px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={'{"branch": "BKK"}'} spellCheck={false} />
              </Field>
              {method === "POST" && (
                <div className="sm:col-span-2">
                  <Field label="Body (JSON)">
                    <textarea className="field h-24 font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'{"status": "active"}'} spellCheck={false} />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        {err && (
          <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <XCircle size={14} className="mt-px shrink-0" /> {err}
          </p>
        )}

        {preview && (
          <div className="overflow-hidden rounded-xl ring-1 ring-brand-200">
            <p className="flex items-center gap-1.5 bg-gradient-to-r from-brand-50 to-white px-3 py-2 text-xs font-medium text-brand-800">
              <CheckCircle2 size={14} /> ดึงได้ {preview.total_records.toLocaleString()} แถว · {preview.fields.length} ช่องข้อมูล
              {preview.too_many && <span className="ml-1 text-rose-600">— เกิน 5,000 แถว ระบบจะไม่รับ</span>}
            </p>
            {preview.sample.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-accent-50 text-accent-500">
                    <tr>
                      {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-1.5 font-semibold">{c}</th>)}
                      {preview.fields.length > cols.length && <th className="px-3 py-1.5 font-normal">+{preview.fields.length - cols.length}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r, i) => (
                      <tr key={i} className="border-t border-accent-100">
                        {cols.map((c) => (
                          <td key={c} className="max-w-[160px] truncate px-3 py-1.5 text-accent-700">
                            {typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "")}
                          </td>
                        ))}
                        {preview.fields.length > cols.length && <td />}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-accent-100 px-3 py-2.5">
              <p className="text-xs font-semibold text-accent-700">ช่องข้อมูลที่ให้บอทใช้</p>
              <p className="mb-2 text-[11px] text-accent-500">
                ไม่เลือก = ใช้ทั้งหมด · เลือกเฉพาะที่บอทต้องใช้ตอบ ช่วยลดค่า AI ทุกครั้งที่แชท และส่งข้อมูลออกนอกเครื่องน้อยลง
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.fields.map((f) => {
                  const on = fields.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFields(on ? fields.filter((x) => x !== f) : [...fields, f])}
                      className={`rounded-full px-2.5 py-1 font-mono text-[11px] ring-1 ring-inset ${on ? "bg-ink bg-ink-grad text-white ring-transparent" : "bg-white text-accent-600 ring-accent-200 hover:ring-brand-300"}`}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
              {fields.length > 0 && (
                <p className="mt-2 text-[11px] text-accent-500">
                  ใช้ {fields.length} จาก {preview.fields.length} ช่อง ·{" "}
                  <button type="button" onClick={() => setFields([])} className="font-medium text-brand-700 hover:underline">ใช้ทั้งหมด</button>
                </p>
              )}
            </div>
          </div>
        )}

        {!preview && fields.length > 0 && (
          <p className="text-[11px] text-accent-500">ใช้เฉพาะ {fields.length} ช่องข้อมูลที่เลือกไว้ · กด ‘ทดสอบดึงข้อมูล’ เพื่อแก้ไข</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => run("test")} disabled={!!busy || !url.trim()}>
            {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ทดสอบดึงข้อมูล
          </Button>
          <Button onClick={() => run("save")} disabled={!!busy || !url.trim() || !name.trim()}>
            {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── รายการ ───────────────────────────────────────────

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-azure-grad" : "bg-accent-200"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function RealtimeSources({ kbId, disabled, onChanged }: { kbId: string; disabled?: boolean; onChanged: () => void }) {
  const [sources, setSources] = useState<RealtimeSource[] | null>(null);
  const [editing, setEditing] = useState<RealtimeSource | "new" | null>(null);
  const [viewing, setViewing] = useState<RealtimeSource | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { sources } = await listRealtimeSources(kbId);
    setSources(sources);
  }, [kbId]);

  useEffect(() => {
    setSources(null);
    load().catch((e) => setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"));
  }, [load]);

  // มีตัวที่เปิดอัตโนมัติอยู่ → รีเฟรชสถานะเป็นระยะ
  const live = !!sources?.some((s) => s.enabled || s.syncing);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => load().catch(() => {}), 10000);
    return () => window.clearInterval(t);
  }, [live, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(s: RealtimeSource) {
    await act(s.id, async () => {
      const r = await syncRealtimeSource(s.id);
      setNote({
        id: s.id,
        ok: r.status === "success",
        text: r.status === "success"
          ? `อัปเดตแล้ว — ${r.record_count?.toLocaleString()} แถว · ${MODE_LABEL[r.mode ?? ""] ?? ""}${r.mode === "incremental" ? ` (${r.patched_rows} แถว)` : ""}`
          : r.error ?? "อัปเดตไม่สำเร็จ",
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {sources === null ? (
        <p className="flex items-center gap-2 text-sm text-accent-400"><Loader2 size={14} className="animate-spin" /> กำลังโหลด...</p>
      ) : (
        <>
          {sources.length === 0 && (
            <div className="rounded-xl bg-gradient-to-br from-brand-50/80 via-white to-white px-5 py-6 text-center ring-1 ring-brand-100">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-ink bg-ink-grad text-brand-300 shadow-ink">
                <Radio size={18} />
              </span>
              <p className="text-sm font-semibold text-accent-900">ให้บอทตอบจากข้อมูลล่าสุดเสมอ</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-accent-500">
                เชื่อม API ของระบบในบริษัท เช่น สต็อก ราคา สถานะงาน — ระบบดึงให้อัตโนมัติตามรอบ และแก้เฉพาะแถวที่เปลี่ยน ไม่ต้องอัปโหลดไฟล์ใหม่
              </p>
            </div>
          )}
          {sources.map((s) => {
            const status = s.syncing ? "syncing" : s.last_status;
            return (
              <div key={s.id} className={`rounded-xl p-4 ring-1 ${status === "error" ? "bg-rose-50/30 ring-rose-200" : "bg-white ring-accent-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${s.enabled ? "bg-ink bg-ink-grad text-brand-300 shadow-ink" : "bg-accent-100 text-accent-400"}`}>
                      <Zap size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-accent-900">
                        {s.name}
                        {s.enabled && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-azure-grad" />}
                      </p>
                      <p className="truncate font-mono text-[11px] text-accent-400">
                        <span className="font-semibold text-accent-500">{s.method}</span> {s.url}
                      </p>
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-accent-600">
                    {s.enabled ? intervalLabel(s.poll_interval_sec) : "อัปเดตอัตโนมัติ"}
                    <Switch on={s.enabled} disabled={busy === s.id || disabled} onChange={(v) => act(s.id, () => toggleRealtimeSource(s.id, v))} />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-accent-500">
                  {status === "syncing" ? (
                    <span className="flex items-center gap-1 font-medium text-brand-700"><Loader2 size={12} className="animate-spin" /> กำลังอัปเดต...</span>
                  ) : status === "success" ? (
                    <span className="flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 size={12} /> {timeAgo(s.last_synced_at)}</span>
                  ) : status === "error" ? (
                    <span className="flex items-center gap-1 font-medium text-rose-700"><XCircle size={12} /> ล้มเหลว {timeAgo(s.last_synced_at)}</span>
                  ) : (
                    <span>ยังไม่เคยอัปเดต</span>
                  )}
                  {s.last_status !== "never" && <span>{s.last_record_count.toLocaleString()} แถว · {s.last_chunks ?? 0} chunks</span>}
                  {s.last_mode && s.last_status === "success" && <span>รอบล่าสุด: {MODE_LABEL[s.last_mode]}</span>}
                </div>
                {s.last_status === "error" && s.last_error && <p className="mt-1.5 text-xs text-rose-700">{s.last_error}</p>}
                {note?.id === s.id && <p className={`mt-1.5 text-xs ${note.ok ? "text-brand-700" : "text-rose-700"}`}>{note.text}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-accent-100 pt-3">
                  <button type="button" disabled={busy === s.id || disabled} onClick={() => syncNow(s)} className="flex items-center gap-1 rounded-md bg-ink bg-ink-grad px-2.5 py-1 text-xs font-medium text-white shadow-ink hover:shadow-glow disabled:bg-none disabled:bg-accent-300 disabled:shadow-none">
                    {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} อัปเดตเดี๋ยวนี้
                  </button>
                  {s.last_status === "success" && (
                    <button type="button" onClick={() => setViewing(s)} className="flex items-center gap-1 rounded-md border border-accent-200 bg-white px-2 py-1 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700">
                      <Eye size={12} /> ดูข้อมูลที่ดึงมา
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(s)} className="flex items-center gap-1 rounded-md border border-accent-200 bg-white px-2 py-1 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700">
                    <Pencil size={12} /> แก้ไข
                  </button>
                  <button
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => window.confirm(`ลบ ‘${s.name}’ และข้อมูลที่ดึงมาแล้วออกจาก KB นี้?`) && act(s.id, () => deleteRealtimeSource(s.id))}
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 size={12} /> ลบ
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing("new")}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent-300 py-3 text-sm font-medium text-accent-600 hover:border-brand-400 hover:bg-brand-50/30 hover:text-brand-700 disabled:opacity-50"
          >
            <Plus size={15} /> เชื่อม API ใหม่
          </button>
        </>
      )}

      {editing && <SourceModal kbId={kbId} source={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { await load(); onChanged(); }} />}
      {viewing && <ChunkViewerModal kbId={kbId} filename={`realtime:${viewing.id}`} title={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  );
}
