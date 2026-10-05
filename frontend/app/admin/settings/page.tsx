"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  ListOrdered,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldAlert,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { ErrorNote, PageHeader } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getSettings,
  listProviderModels,
  runFullCheck,
  saveSettings,
  setDefaultModel,
  testModel,
  testProvider,
  updateModel,
  updateProvider,
} from "@/lib/api";
import type {
  CheckItem,
  CheckResult,
  ModelRole,
  NodeSettings,
  ProtocolId,
  ProtocolInfo,
  ProviderConn,
  ProviderModel,
  RegistryModel,
  SecretMask,
} from "@/lib/types";

// ── ตกแต่ง ────────────────────────────────────────────

const TYPE_STYLE: Record<string, string> = {
  google: "bg-sky-50 text-sky-700",
  ollama: "bg-amber-50 text-amber-700",
  openai_compatible: "bg-brand-50 text-brand-700",
};

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || "AI").toUpperCase();
}

function Mark({ name, type, size = "md" }: { name: string; type: string; size?: "md" | "lg" }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${TYPE_STYLE[type] ?? TYPE_STYLE.openai_compatible} ${size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"}`}>
      {initials(name)}
    </span>
  );
}

// ── ชิ้นส่วนฟอร์ม ─────────────────────────────────────

type SecretInput = string | null; // "" = ใช้ค่าเดิม, ข้อความ = ค่าใหม่, null = ลบ
const secretOut = (v: SecretInput) => (v === null ? null : v.trim() ? v.trim() : undefined);
const NO_MASK: SecretMask = { set: false, hint: "" };

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-accent-400">{hint}</p>}
    </div>
  );
}

function SecretField({ label, mask, value, onChange, optional }: { label: string; mask: SecretMask; value: SecretInput; onChange: (v: SecretInput) => void; optional?: boolean }) {
  const cleared = value === null;
  return (
    <Field label={label} hint={cleared ? "จะลบเมื่อกดบันทึก" : mask.set ? "เว้นว่างไว้ = ใช้ค่าเดิม" : optional ? "ไม่บังคับ" : undefined}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-400" />
          <input
            type="password"
            autoComplete="new-password"
            value={value ?? ""}
            disabled={cleared}
            onChange={(e) => onChange(e.target.value)}
            placeholder={mask.set ? `${mask.hint} (ตั้งไว้แล้ว)` : "วางค่าที่นี่"}
            className="field pl-8"
          />
        </div>
        {mask.set && (
          <button type="button" onClick={() => onChange(cleared ? "" : null)} className="shrink-0 rounded-lg px-2.5 text-xs font-medium text-accent-500 hover:bg-accent-100">
            {cleared ? "ยกเลิก" : "ลบ"}
          </button>
        )}
      </div>
    </Field>
  );
}

function Result({ item, okText }: { item?: CheckItem | null; okText?: string }) {
  if (!item) return null;
  if (item.ok === null || item.ok === undefined) return <span className="text-xs text-accent-400">{String(item.message ?? "ไม่ได้ตั้งค่า")}</span>;
  return item.ok ? (
    <span className="flex items-center gap-1 text-xs font-medium text-brand-700"><CheckCircle2 size={14} /> {okText ?? "ใช้งานได้"}</span>
  ) : (
    <span className="flex items-start gap-1 text-xs font-medium text-rose-700"><XCircle size={14} className="mt-px shrink-0" /> {String(item.message ?? item.error_code ?? "ใช้งานไม่ได้")}</span>
  );
}

function Panel({ icon, title, description, action, children }: { icon: ReactNode; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-accent-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-accent-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-accent-400">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-accent-900">{title}</h2>
            <p className="mt-0.5 text-xs text-accent-500">{description}</p>
          </div>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── หน้าต่างเพิ่ม/แก้ไขการเชื่อมต่อ ──────────────────────

function detectType(url: string, fallback?: ProtocolId): ProtocolId {
  const u = url.trim().toLowerCase();
  if (!u) return fallback ?? "google";
  if (u.includes("generativelanguage.googleapis.com") && !u.includes("/openai")) return "google";
  if (u.includes(":11434") || u.includes("ollama")) return "ollama";
  return "openai_compatible";
}

function ConnectionModal({
  conn,
  protocols,
  onClose,
  onSaved,
}: {
  conn: ProviderConn | null; // null = เพิ่มใหม่
  protocols: Record<ProtocolId, ProtocolInfo>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(conn?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(conn?.base_url ?? "");
  const [apiKey, setApiKey] = useState<SecretInput>("");
  const [busy, setBusy] = useState<"test" | "save" | "delete" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const type = detectType(baseUrl, conn?.type);
  const proto = protocols[type];

  const body = () => ({ name, base_url: baseUrl.trim(), api_key: apiKey === null ? null : apiKey.trim() });

  async function run(kind: "test" | "save" | "delete") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "test") {
        const { models } = await testProvider({ ...body(), id: conn?.id });
        setMsg({ ok: true, text: `เชื่อมต่อได้ — พบ ${models.length} โมเดล` });
        return;
      }
      if (kind === "delete" && conn) {
        if (!window.confirm(`ลบการเชื่อมต่อ ‘${conn.name}’?`)) return;
        await deleteProvider(conn.id);
      } else if (conn) {
        await updateProvider(conn.id, body());
      } else {
        await createProvider(body());
      }
      await onSaved();
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "ไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={conn ? `แก้ไข ${conn.name}` : "เพิ่มการเชื่อมต่อ"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="ชื่อ" hint="ตั้งให้จำง่าย เช่น ‘Gemini บริษัท’ หรือ ‘Ollama ห้อง Server’">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อการเชื่อมต่อ" autoFocus />
        </Field>
        <Field
          label="URL"
          hint={
            <>
              ระบบจะรู้เองว่าเป็น <span className="font-medium text-accent-600">{protocols[type]?.label}</span>
              {type === "ollama" ? " — ไม่ต้องใส่ /v1" : type === "openai_compatible" ? " — ปกติลงท้ายด้วย /v1" : ""}
            </>
          }
        >
          <input className="field font-mono text-[13px]" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="เช่น https://api.openai.com/v1" spellCheck={false} />
          <p className="mt-1.5 text-[11px] leading-relaxed text-accent-400">
            ตัวอย่าง: Gemini <span className="font-mono">https://generativelanguage.googleapis.com</span> · Ollama{" "}
            <span className="font-mono">http://192.168.1.10:11434</span> · SiliconFlow <span className="font-mono">https://api.siliconflow.com/v1</span>
          </p>
        </Field>
        <SecretField
          label={type === "ollama" ? "API key (ไม่ต้องใส่สำหรับ Ollama)" : "API key"}
          mask={conn?.api_key ?? NO_MASK}
          value={apiKey}
          onChange={setApiKey}
          optional={type !== "google"}
        />
        {msg && (
          <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-brand-50 text-brand-800" : "bg-rose-50 text-rose-700"}`}>
            {msg.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <XCircle size={14} className="mt-px shrink-0" />}
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {conn ? (
            <Button variant="ghost" onClick={() => run("delete")} disabled={!!busy} className="text-rose-600 hover:bg-rose-50">
              {busy === "delete" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} ลบ
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => run("test")} disabled={!!busy}>
              {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ทดสอบ
            </Button>
            <Button onClick={() => run("save")} disabled={!!busy || !name.trim()}>
              {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── หน้าต่างเพิ่ม/แก้ไขโมเดลในคลัง ───────────────────────

const KIND_INFO: Record<ModelRole, { label: string; title: string; description: string }> = {
  llm: { label: "LLM", title: "LLM (ตอบคำถาม)", description: "บอทแต่ละตัวเลือกใช้ได้ — ไม่เลือก = ใช้ค่าเริ่มต้น และใช้จัดข้อมูลตอนอัปโหลดเอกสาร" },
  embedding: { label: "Embedding", title: "Embedding (ค้นหาเอกสาร)", description: "เลือกตอนสร้าง KB แล้ว KB ผูกกับตัวนั้นตลอด — ลบได้เมื่อไม่มี KB ใช้แล้ว" },
  rerank: { label: "Rerank", title: "Rerank (ไม่บังคับ)", description: "ใช้กับบอทที่เปิด ‘ใช้ Rerank’ — ต้องเป็นการเชื่อมต่อที่มี endpoint /rerank เช่น SiliconFlow" },
};

function ModelModal({
  kind,
  model,
  connections,
  onClose,
  onSaved,
}: {
  kind: ModelRole;
  model: RegistryModel | null; // null = เพิ่มใหม่
  connections: ProviderConn[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const options = kind === "rerank" ? connections.filter((c) => c.type !== "google") : connections;
  const [name, setName] = useState(model?.name ?? "");
  const [provider, setProvider] = useState(model?.provider ?? options.find((c) => c.configured)?.id ?? "");
  const [modelId, setModelId] = useState(model?.model ?? "");
  const [dim, setDim] = useState<number>(model?.dim ?? 0);
  const [makeDefault, setMakeDefault] = useState(false);
  const [list, setList] = useState<ProviderModel[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lockedByKb = kind === "embedding" && !!model?.used_by.kbs.length;

  useEffect(() => {
    setList(null);
    if (!provider || !connections.find((c) => c.id === provider)?.configured) return;
    setLoadingList(true);
    listProviderModels(provider)
      .then(({ models }) => setList(models))
      .catch(() => setList([]))
      .finally(() => setLoadingList(false));
  }, [provider, connections]);

  const suggestions = (list ?? []).filter((m) => m.kinds.includes(kind));
  const shown = suggestions.length ? suggestions : list ?? [];

  async function handleTest() {
    setBusy("test");
    setMsg(null);
    try {
      const r = await testModel({ kind, provider, model: modelId });
      if (r.ok && kind === "embedding" && typeof r.dim === "number") {
        setDim(r.dim);
        setMsg({ ok: true, text: `ใช้งานได้ — โมเดลนี้ให้ ${r.dim} มิติ (ใส่ให้แล้ว)` });
      } else {
        setMsg({ ok: !!r.ok, text: r.ok ? "ใช้งานได้" : String(r.message ?? r.error_code ?? "ใช้งานไม่ได้") });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    setMsg(null);
    try {
      const body = { name: name.trim() || modelId.trim(), kind, provider, model: modelId.trim(), dim, make_default: makeDefault };
      if (model) await updateModel(model.id, body);
      else await createModel(body);
      await onSaved();
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`${model ? "แก้ไข" : "เพิ่ม"} ${KIND_INFO[kind].label}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {options.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">ยังไม่มีการเชื่อมต่อที่ใช้ได้ — เพิ่มการเชื่อมต่อในส่วนด้านบนก่อน</p>
        ) : (
          <>
            <Field label="การเชื่อมต่อ">
              <select className="field" value={provider} onChange={(e) => { setProvider(e.target.value); setMsg(null); }}>
                {!provider && <option value="">— เลือก —</option>}
                {options.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.configured ? "" : " (ตั้งค่ายังไม่ครบ)"}</option>
                ))}
              </select>
            </Field>
            <Field
              label="โมเดล"
              hint={lockedByKb ? "ผูกกับ KB อยู่ — เปลี่ยนโมเดลไม่ได้" : loadingList ? "กำลังดึงรายชื่อโมเดล..." : list ? `พบ ${shown.length} โมเดล — เลือกจากรายการหรือพิมพ์เองได้` : undefined}
            >
              <input className="field font-mono text-[13px]" list="registry-model-list" value={modelId} disabled={lockedByKb} onChange={(e) => { setModelId(e.target.value); setMsg(null); }} placeholder="ชื่อโมเดล" spellCheck={false} />
              <datalist id="registry-model-list">
                {shown.map((m) => <option key={m.id} value={m.id} />)}
              </datalist>
            </Field>
            {kind === "embedding" && (
              <Field label="จำนวนมิติ (dim)" hint={lockedByKb ? "ผูกกับ KB อยู่ — เปลี่ยนไม่ได้" : "กด ‘ทดสอบ’ แล้วระบบใส่ค่าที่ถูกต้องให้"}>
                <input type="number" min={1} className="field" value={dim || ""} disabled={lockedByKb} onChange={(e) => setDim(Number(e.target.value))} />
              </Field>
            )}
            <Field label="ชื่อที่แสดง (ไม่บังคับ)" hint="เว้นว่าง = ใช้ชื่อโมเดล">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={modelId || "เช่น Gemini เร็ว"} />
            </Field>
            {!model?.is_default && (
              <label className="flex items-center gap-2 text-sm text-accent-700">
                <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 rounded border-accent-300 text-brand-600 focus:ring-brand-500" />
                ตั้งเป็นค่าเริ่มต้นของ {KIND_INFO[kind].label}
              </label>
            )}
          </>
        )}
        {msg && (
          <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-brand-50 text-brand-800" : "bg-rose-50 text-rose-700"}`}>
            {msg.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <XCircle size={14} className="mt-px shrink-0" />}
            {msg.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleTest} disabled={!!busy || !provider || !modelId.trim()}>
            {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ทดสอบ
          </Button>
          <Button onClick={handleSave} disabled={!!busy || !provider || !modelId.trim() || (kind === "embedding" && !dim)}>
            {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── กลุ่มโมเดลต่อประเภท ───────────────────────────────

const KIND_STYLE: Record<ModelRole, { icon: ReactNode; tile: string; ring: string }> = {
  llm: { icon: <MessageSquare size={18} />, tile: "bg-violet-100 text-violet-700", ring: "border-violet-200" },
  embedding: { icon: <Search size={18} />, tile: "bg-sky-100 text-sky-700", ring: "border-sky-200" },
  rerank: { icon: <ListOrdered size={18} />, tile: "bg-amber-100 text-amber-700", ring: "border-amber-200" },
};

const KIND_PLAIN: Record<ModelRole, { what: string; where: string }> = {
  llm: { what: "สมองของบอท — อ่านเอกสารแล้วเรียบเรียงคำตอบ", where: "เลือกใช้ที่หน้า Chatbots" },
  embedding: { what: "แปลงเอกสารเป็นตัวเลขเพื่อค้นหา — KB ผูกกับตัวที่เลือกตอนสร้างตลอดไป", where: "เลือกใช้ตอนสร้าง Knowledge Base" },
  rerank: { what: "จัดลำดับผลค้นหาให้แม่นขึ้น (ไม่บังคับ) — ต้องเป็นเจ้าที่มี /rerank เช่น SiliconFlow", where: "ใช้กับบอทที่เปิด ‘ใช้ Rerank’" },
};

function lockReason(kind: ModelRole, m: RegistryModel): string | null {
  if (kind === "embedding" && m.used_by.kbs.length) return `มี KB ใช้อยู่ ${m.used_by.kbs.length} ตัว — ต้องลบ KB เหล่านั้นก่อน`;
  if (m.used_by.bots.length) return `มีบอทใช้อยู่ ${m.used_by.bots.length} ตัว — ต้องเปลี่ยนโมเดลในบอทก่อน`;
  return null;
}

function ModelGroup({
  kind,
  models,
  onAdd,
  onEdit,
  onDefault,
  onDelete,
}: {
  kind: ModelRole;
  models: RegistryModel[];
  onAdd: () => void;
  onEdit: (m: RegistryModel) => void;
  onDefault: (m: RegistryModel) => void;
  onDelete: (m: RegistryModel) => void;
}) {
  const info = KIND_INFO[kind];
  const style = KIND_STYLE[kind];
  const plain = KIND_PLAIN[kind];
  return (
    <div className={`flex min-w-0 flex-col rounded-xl border bg-white ${style.ring}`}>
      <div className="flex items-start gap-3 border-b border-accent-100 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.tile}`}>{style.icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-accent-900">{info.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-accent-600">{plain.what}</p>
          <p className="mt-1 text-[11px] font-medium text-accent-400">→ {plain.where}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3">
        {models.length === 0 && (
          <p className="rounded-lg bg-accent-50 px-3 py-3 text-center text-xs text-accent-500">
            ยังไม่มี {info.label}
            {kind !== "rerank" && <span className="mt-0.5 block font-medium text-amber-700">ต้องมีอย่างน้อย 1 ตัว ระบบถึงจะทำงาน</span>}
          </p>
        )}
        {models.map((m) => {
          const locked = lockReason(kind, m);
          const usedNames = [...m.used_by.kbs.map((n) => `KB ${n}`), ...m.used_by.bots.map((n) => `บอท ${n}`)];
          return (
            <div key={m.id} className={`rounded-lg border p-3 ${m.is_default ? "border-brand-300 bg-brand-50/40" : "border-accent-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-accent-900">{m.name}</p>
                {m.is_default && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star size={11} className="fill-white" /> ค่าเริ่มต้น
                  </span>
                )}
              </div>
              {m.name !== m.model && <p className="mt-1 break-all font-mono text-[11px] text-accent-500">{m.model}</p>}
              <p className="mt-0.5 text-[11px] text-accent-500">
                ผ่าน {m.provider_name}
                {kind === "embedding" && m.dim ? ` · ${m.dim} มิติ` : ""}
              </p>
              <p className="mt-2 text-[11px] text-accent-500">
                {usedNames.length ? (
                  <>
                    ใช้อยู่กับ <span className="font-medium text-accent-700">{usedNames.join(", ")}</span>
                  </>
                ) : m.is_default ? (
                  "ใช้กับทุกที่ที่ไม่ได้เลือกโมเดลเฉพาะ"
                ) : (
                  "ยังไม่มีใครใช้"
                )}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-accent-100 pt-2.5">
                {!m.is_default && (
                  <button type="button" onClick={() => onDefault(m)} className="flex items-center gap-1 rounded-md border border-accent-200 bg-white px-2 py-1 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700">
                    <Star size={12} /> ตั้งเป็นค่าเริ่มต้น
                  </button>
                )}
                <button type="button" onClick={() => onEdit(m)} className="flex items-center gap-1 rounded-md border border-accent-200 bg-white px-2 py-1 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700">
                  <Pencil size={12} /> แก้ไข
                </button>
                {locked ? (
                  <span title={locked} className="ml-auto flex items-center gap-1 px-1 text-[11px] text-accent-400">
                    <Lock size={11} /> ลบไม่ได้
                  </span>
                ) : (
                  <button type="button" onClick={() => onDelete(m)} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
                    <Trash2 size={12} /> ลบ
                  </button>
                )}
              </div>
              {locked && <p className="mt-1.5 text-[11px] text-accent-400">{locked}</p>}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-accent-300 py-2.5 text-sm font-medium text-accent-600 hover:border-brand-400 hover:bg-brand-50/30 hover:text-brand-700"
        >
          <Plus size={15} /> เพิ่ม {info.label}
        </button>
      </div>
    </div>
  );
}

// ── โครงสร้างพื้นฐาน: แสดงอย่างเดียว กดแก้ไขถึงเปิดฟอร์ม ──────

type InfraKind = "vector" | "central";

function InfraModal({
  kind,
  settings,
  kbCount,
  onClose,
  onSaved,
}: {
  kind: InfraKind;
  settings: NodeSettings;
  kbCount: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isVector = kind === "vector";
  const original = isVector ? settings.vector.url : settings.central.url;
  const [url, setUrl] = useState(original);
  const [secret, setSecret] = useState<SecretInput>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = url.trim() !== original || secret !== "";

  async function handleSave() {
    if (
      isVector &&
      url.trim() !== original &&
      kbCount > 0 &&
      !window.confirm(`เปลี่ยนที่อยู่ Qdrant แล้ว Knowledge Base ${kbCount} ตัวที่มีอยู่จะหาเอกสารเดิมไม่เจอ (เอกสารยังอยู่ที่ Qdrant ตัวเก่า)\n\nยืนยันเปลี่ยน?`)
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await saveSettings(isVector ? { vector: { url, api_key: secretOut(secret) } } : { central: { url, license_key: secretOut(secret) } });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isVector ? "แก้ไข Qdrant (ที่เก็บเอกสาร)" : "แก้ไข Central และ license"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
          <ShieldAlert size={15} className="mt-px shrink-0" />
          {isVector
            ? "ส่วนนี้คือที่เก็บเอกสารของทุก KB — ถ้าใส่ผิด บอทจะค้นหาเอกสารไม่เจอทันที แก้เฉพาะตอนย้ายฐานข้อมูลเท่านั้น"
            : "ถ้าใส่ผิด ทั้งแชทและการอัปโหลดจะหยุดทำงานทันที — ปกติใส่ครั้งเดียวตอนติดตั้ง หรือตอนได้ license ใหม่"}
        </p>
        <Field label={isVector ? "URL" : "ที่อยู่ central"} hint={isVector ? "เช่น https://xxxx.cloud.qdrant.io" : "เช่น http://192.168.30.108:9000"}>
          <input className="field font-mono text-[13px]" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </Field>
        <SecretField
          label={isVector ? "API key" : "License key"}
          mask={isVector ? settings.vector.api_key : settings.central.license_key}
          value={secret}
          onChange={setSecret}
          optional={isVector}
        />
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={busy || !changed || !url.trim()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึกและตรวจการเชื่อมต่อ
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InfraCard({
  icon,
  title,
  subtitle,
  rows,
  status,
  onEdit,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  rows: [string, ReactNode][];
  status?: CheckItem | null;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-accent-500 ring-1 ring-accent-200">{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent-900">{title}</p>
            <p className="text-xs text-accent-500">{subtitle}</p>
          </div>
        </div>
        <button type="button" onClick={onEdit} className="flex shrink-0 items-center gap-1 rounded-lg border border-accent-200 bg-white px-2.5 py-1.5 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700">
          <Pencil size={12} /> แก้ไข
        </button>
      </div>
      <dl className="grid gap-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 gap-2">
            <dt className="w-20 shrink-0 text-accent-400">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-accent-700">{v}</dd>
          </div>
        ))}
      </dl>
      {status && <Result item={status} />}
    </div>
  );
}

// ── หน้า ──────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<NodeSettings | null>(null);
  const [protocols, setProtocols] = useState<Record<ProtocolId, ProtocolInfo> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingConn, setEditingConn] = useState<ProviderConn | "new" | null>(null);
  const [editingModel, setEditingModel] = useState<{ kind: ModelRole; model: RegistryModel | null } | null>(null);
  const [editingInfra, setEditingInfra] = useState<InfraKind | null>(null);

  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const res = await getSettings();
    setSettings(res.settings);
    setProtocols(res.protocols);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ"));
  }, [load]);

  if (!settings || !protocols) {
    return error ? <ErrorNote message={error} /> : (
      <div className="flex items-center gap-2 text-sm text-accent-400"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>
    );
  }

  const connections = settings.providers;
  const modelsOf = (kind: ModelRole) => settings.models.filter((m) => m.kind === kind);
  const connUsage = (pid: string) => settings.models.filter((m) => m.provider === pid);
  const kbCount = new Set(settings.models.flatMap((m) => m.used_by.kbs)).size;
  const keyText = (mask: SecretMask) => (mask.set ? `${mask.hint} (ตั้งไว้แล้ว)` : "— ไม่ได้ตั้ง —");

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สำเร็จ");
    }
  }

  async function handleCheckAll() {
    setChecking(true);
    setError(null);
    try {
      setCheck(await runFullCheck());
    } catch (e) {
      setError(e instanceof Error ? e.message : "ตรวจไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  }

  async function afterInfraSave() {
    await load();
    await handleCheckAll();
  }

  return (
    <div>
      <PageHeader
        title="การเชื่อมต่อ AI"
        description="เพิ่มการเชื่อมต่อและโมเดลไว้เป็นตัวเลือก — KB เลือก embedding ตอนสร้าง ส่วนบอทเลือก LLM/rerank ได้เอง (ไม่เลือก = ใช้ค่าเริ่มต้น)"
        actions={
          <Button variant="secondary" onClick={handleCheckAll} disabled={checking}>
            {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ตรวจค่าเริ่มต้นทั้งระบบ
          </Button>
        }
      />
      <ErrorNote message={error} />

      {check && (
        <div className="mb-5 grid gap-2 rounded-xl border border-accent-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["central", check.central],
            ["license", check.license],
            ["LLM", check.llm],
            ["Embedding", check.embedding],
            ["Qdrant", check.vector],
            ["Rerank", check.rerank],
          ] as [string, CheckItem | undefined][]).map(([label, item]) => (
            <div key={label} className="min-w-0 rounded-lg bg-accent-50 px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent-400">{label}</p>
              {item ? <Result item={item} okText={label === "Embedding" && item.dim ? `ใช้ได้ · ${item.dim} มิติ` : undefined} /> : <span className="text-xs text-accent-400">—</span>}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {/* 1) การเชื่อมต่อ */}
        <Panel icon={<Cpu size={18} />} title="ขั้นที่ 1 · การเชื่อมต่อผู้ให้บริการ" description="กรอกชื่อ / URL / API key — ต่อได้ทุกเจ้าที่ใช้ API แบบ OpenAI รวมถึง Gemini และ Ollama">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {connections.map((c) => {
              const used = connUsage(c.id);
              return (
                <div key={c.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${c.configured ? "border-accent-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
                  <div className="flex items-start gap-3">
                    <Mark name={c.name} type={c.type} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-accent-900">{c.name}</p>
                      <p className="truncate font-mono text-[11px] text-accent-400">{c.base_url || protocols[c.type]?.label}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-xs ${c.configured ? "text-accent-500" : "text-amber-700"}`}>
                      {!c.configured ? "ตั้งค่ายังไม่ครบ" : used.length ? `ใช้กับ ${used.length} โมเดล` : "ยังไม่มีโมเดลใช้"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingConn(c)}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-accent-200 bg-white px-2.5 py-1.5 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      <Pencil size={12} /> แก้ไข
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setEditingConn("new")}
              className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent-300 text-sm font-medium text-accent-500 transition-colors hover:border-brand-400 hover:bg-brand-50/30 hover:text-brand-700"
            >
              <Plus size={18} /> เพิ่มการเชื่อมต่อ
            </button>
          </div>
        </Panel>

        {/* 2) คลังโมเดล */}
        <Panel
          icon={<Boxes size={18} />}
          title="ขั้นที่ 2 · คลังโมเดล"
          description="เลือกโมเดลจากการเชื่อมต่อด้านบนมาเก็บไว้เป็นตัวเลือก — ตัวที่ติดดาว ‘ค่าเริ่มต้น’ จะถูกใช้เมื่อ KB/บอทไม่ได้เลือกเฉพาะ"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {(["llm", "embedding", "rerank"] as ModelRole[]).map((kind) => (
              <ModelGroup
                key={kind}
                kind={kind}
                models={modelsOf(kind)}
                onAdd={() => setEditingModel({ kind, model: null })}
                onEdit={(m) => setEditingModel({ kind, model: m })}
                onDefault={(m) => act(() => setDefaultModel(m.id))}
                onDelete={(m) => {
                  if (window.confirm(`ลบ ‘${m.name}’ ออกจากคลังโมเดล?`)) act(() => deleteModel(m.id));
                }}
              />
            ))}
          </div>
        </Panel>

        {/* 3) โครงสร้างพื้นฐาน — แสดงอย่างเดียว */}
        <Panel
          icon={<Lock size={18} />}
          title="โครงสร้างพื้นฐาน"
          description="ตั้งครั้งเดียวตอนติดตั้ง — ถ้าแก้ผิดระบบจะหยุดทำงาน จึงต้องกด ‘แก้ไข’ ก่อนถึงจะเปลี่ยนได้"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <InfraCard
              icon={<Database size={17} />}
              title="Qdrant"
              subtitle="ฐานข้อมูลที่เก็บเอกสารของทุก KB"
              rows={[
                ["URL", settings.vector.url || "— ไม่ได้ตั้ง —"],
                ["API key", keyText(settings.vector.api_key)],
              ]}
              status={check?.vector}
              onEdit={() => setEditingInfra("vector")}
            />
            <InfraCard
              icon={<Server size={17} />}
              title="Central และ license"
              subtitle="บริการประมวลผลกลาง"
              rows={[
                ["ที่อยู่", settings.central.url || "— ไม่ได้ตั้ง —"],
                ["License", keyText(settings.central.license_key)],
              ]}
              status={check?.central && check.license ? (check.central.ok === false ? check.central : check.license) : check?.central}
              onEdit={() => setEditingInfra("central")}
            />
          </div>
        </Panel>
      </div>

      {editingConn && (
        <ConnectionModal conn={editingConn === "new" ? null : editingConn} protocols={protocols} onClose={() => setEditingConn(null)} onSaved={load} />
      )}
      {editingModel && (
        <ModelModal kind={editingModel.kind} model={editingModel.model} connections={connections} onClose={() => setEditingModel(null)} onSaved={load} />
      )}
      {editingInfra && (
        <InfraModal kind={editingInfra} settings={settings} kbCount={kbCount} onClose={() => setEditingInfra(null)} onSaved={afterInfraSave} />
      )}
    </div>
  );
}
