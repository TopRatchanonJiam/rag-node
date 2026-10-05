"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
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
  return (
    <div className="border-b border-accent-100 py-5 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-accent-900">{info.title}</p>
          <p className="mt-0.5 max-w-2xl text-xs text-accent-500">{info.description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-accent-300 px-2.5 py-1.5 text-xs font-medium text-accent-600 hover:border-brand-400 hover:text-brand-700"
        >
          <Plus size={13} /> เพิ่ม {info.label}
        </button>
      </div>
      {models.length === 0 ? (
        <p className="rounded-lg bg-accent-50 px-3 py-2.5 text-xs text-accent-400">ยังไม่มี {info.label}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-accent-200">
          {models.map((m) => {
            const usage = [
              m.used_by.kbs.length ? `KB: ${m.used_by.kbs.join(", ")}` : "",
              m.used_by.bots.length ? `บอท: ${m.used_by.bots.join(", ")}` : "",
            ].filter(Boolean).join(" · ");
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-accent-100 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-accent-900">
                    {m.name}
                    {m.is_default && <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">ค่าเริ่มต้น</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-accent-500">
                    {m.provider_name} · <span className="font-mono">{m.model}</span>
                    {kind === "embedding" && m.dim ? ` · ${m.dim} มิติ` : ""}
                  </p>
                  {usage && <p className="mt-0.5 truncate text-[11px] text-accent-400">ใช้อยู่กับ {usage}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!m.is_default && (
                    <button type="button" onClick={() => onDefault(m)} className="rounded-lg px-2 py-1 text-xs font-medium text-accent-500 hover:bg-accent-100 hover:text-accent-800">
                      ตั้งเป็นค่าเริ่มต้น
                    </button>
                  )}
                  <button type="button" onClick={() => onEdit(m)} title="แก้ไข" className="rounded-lg p-1.5 text-accent-400 hover:bg-accent-100 hover:text-accent-700">
                    <Settings2 size={15} />
                  </button>
                  <button type="button" onClick={() => onDelete(m)} title="ลบ" className="rounded-lg p-1.5 text-accent-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
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

  const [vectorUrl, setVectorUrl] = useState("");
  const [vectorKey, setVectorKey] = useState<SecretInput>("");
  const [centralUrl, setCentralUrl] = useState("");
  const [licenseKey, setLicenseKey] = useState<SecretInput>("");
  const [savingInfra, setSavingInfra] = useState(false);
  const [infraNotice, setInfraNotice] = useState<string | null>(null);

  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const res = await getSettings();
    setSettings(res.settings);
    setProtocols(res.protocols);
    setVectorUrl(res.settings.vector.url);
    setCentralUrl(res.settings.central.url);
    setVectorKey("");
    setLicenseKey("");
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

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สำเร็จ");
    }
  }

  async function handleSaveInfra() {
    setSavingInfra(true);
    setError(null);
    try {
      await saveSettings({
        vector: { url: vectorUrl, api_key: secretOut(vectorKey) },
        central: { url: centralUrl, license_key: secretOut(licenseKey) },
      });
      await load();
      setInfraNotice("บันทึกแล้ว — มีผลทันที");
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingInfra(false);
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
        <Panel icon={<Cpu size={18} />} title="การเชื่อมต่อผู้ให้บริการ" description="กรอกชื่อ / URL / API key — ต่อได้ทุกเจ้าที่ใช้ API แบบ OpenAI รวมถึง Gemini และ Ollama">
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
                      <Settings2 size={13} /> แก้ไข
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
        <Panel icon={<Server size={18} />} title="คลังโมเดล" description="เพิ่มได้หลายตัวในแต่ละประเภท และเลือกค่าเริ่มต้น — การเลือกใช้จริงอยู่ที่หน้า KB และหน้า Chatbots">
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
        </Panel>

        {/* 3) โครงสร้างพื้นฐาน */}
        <Panel
          icon={<Database size={18} />}
          title="โครงสร้างพื้นฐาน"
          description="ที่เก็บเอกสารขององค์กร (Qdrant) และบริการประมวลผลกลาง (central)"
          action={
            <div className="flex items-center gap-3">
              {infraNotice && <span className="flex items-center gap-1 text-xs text-brand-700"><CheckCircle2 size={14} /> {infraNotice}</span>}
              <Button onClick={handleSaveInfra} disabled={savingInfra}>
                {savingInfra ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
              </Button>
            </div>
          }
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border border-accent-200 p-4">
              <p className="text-sm font-semibold text-accent-900">Qdrant (ฐานข้อมูลเวกเตอร์)</p>
              <Field label="URL">
                <input className="field" value={vectorUrl} onChange={(e) => { setVectorUrl(e.target.value); setInfraNotice(null); }} placeholder="https://xxxx.cloud.qdrant.io" />
              </Field>
              <SecretField label="API key" mask={settings.vector.api_key} value={vectorKey} onChange={(v) => { setVectorKey(v); setInfraNotice(null); }} optional />
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-accent-200 p-4">
              <p className="text-sm font-semibold text-accent-900">Central และ license</p>
              <Field label="ที่อยู่ central" hint="เช่น http://192.168.30.108:9000">
                <input className="field" value={centralUrl} onChange={(e) => { setCentralUrl(e.target.value); setInfraNotice(null); }} />
              </Field>
              <SecretField label="License key" mask={settings.central.license_key} value={licenseKey} onChange={(v) => { setLicenseKey(v); setInfraNotice(null); }} />
            </div>
          </div>
        </Panel>
      </div>

      {editingConn && (
        <ConnectionModal conn={editingConn === "new" ? null : editingConn} protocols={protocols} onClose={() => setEditingConn(null)} onSaved={load} />
      )}
      {editingModel && (
        <ModelModal kind={editingModel.kind} model={editingModel.model} connections={connections} onClose={() => setEditingModel(null)} onSaved={load} />
      )}
    </div>
  );
}
