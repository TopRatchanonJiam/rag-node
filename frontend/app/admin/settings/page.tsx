"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Loader2,
  Lock,
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
  EmbeddingChangeError,
  createProvider,
  deleteProvider,
  getSettings,
  listProviderModels,
  runFullCheck,
  saveSettings,
  testProvider,
  testSettings,
  updateProvider,
  type SettingsInput,
} from "@/lib/api";
import type {
  CheckItem,
  CheckResult,
  ModelRole,
  ModelsSettings,
  NodeSettings,
  ProtocolId,
  ProtocolInfo,
  ProviderConn,
  ProviderModel,
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

// ── แถวเลือกโมเดลต่อหน้าที่ ─────────────────────────────

function ModelRow({
  role,
  title,
  description,
  value,
  connections,
  models,
  loadingModels,
  onProvider,
  onModel,
  onLoadModels,
  children,
}: {
  role: ModelRole;
  title: string;
  description: string;
  value: { provider: string; model: string };
  connections: ProviderConn[];
  models: ProviderModel[] | undefined;
  loadingModels: boolean;
  onProvider: (pid: string) => void;
  onModel: (m: string) => void;
  onLoadModels: () => void;
  children?: ReactNode;
}) {
  // rerank ใช้ endpoint /rerank แบบ OpenAI-compatible เท่านั้น
  const options = role === "rerank" ? connections.filter((c) => c.type === "openai_compatible") : connections;
  const current = connections.find((c) => c.id === value.provider);
  const listId = `models-${role}`;
  const suggested = (models ?? []).filter((m) => m.kinds.includes(role));
  const shown = suggested.length ? suggested : models ?? [];

  return (
    <div className="grid gap-4 border-b border-accent-100 py-5 first:pt-0 last:border-0 last:pb-0 lg:grid-cols-[220px_1fr]">
      <div>
        <p className="text-sm font-semibold text-accent-900">{title}</p>
        <p className="mt-0.5 text-xs text-accent-500">{description}</p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="การเชื่อมต่อ"
            hint={!current ? <span className="text-amber-700">เลือกการเชื่อมต่อ (เพิ่มได้ที่ส่วนด้านบน)</span> : !current.configured ? <span className="text-amber-700">การเชื่อมต่อนี้ยังตั้งค่าไม่ครบ</span> : undefined}
          >
            <select className="field" value={current ? value.provider : ""} onChange={(e) => onProvider(e.target.value)}>
              {!current && <option value="">— เลือก —</option>}
              {options.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.configured ? "" : " (ยังตั้งค่าไม่ครบ)"}</option>
              ))}
            </select>
          </Field>
          <Field label="โมเดล" hint={models ? `พบ ${shown.length} โมเดล — เลือกจากรายการหรือพิมพ์ชื่อเองได้` : "กดปุ่มรีเฟรชเพื่อดึงรายชื่อโมเดล"}>
            <div className="flex gap-2">
              <input className="field" list={listId} value={value.model} onChange={(e) => onModel(e.target.value)} placeholder="ชื่อโมเดล" />
              <button
                type="button"
                onClick={onLoadModels}
                disabled={!current?.configured || loadingModels}
                title="ดึงรายชื่อโมเดล"
                className="flex h-[38px] w-10 shrink-0 items-center justify-center rounded-lg border border-accent-200 text-accent-500 hover:bg-accent-50 disabled:opacity-40"
              >
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
            <datalist id={listId}>
              {shown.map((m) => <option key={m.id} value={m.id} />)}
            </datalist>
          </Field>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── หน้า ──────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<NodeSettings | null>(null);
  const [protocols, setProtocols] = useState<Record<ProtocolId, ProtocolInfo> | null>(null);
  const [kbCount, setKbCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ProviderConn | "new" | null>(null);
  const [models, setModels] = useState<ModelsSettings | null>(null);
  const [modelLists, setModelLists] = useState<Record<string, ProviderModel[]>>({});
  const [loadingList, setLoadingList] = useState<string | null>(null);
  const [savingModels, setSavingModels] = useState(false);
  const [modelsNotice, setModelsNotice] = useState<string | null>(null);
  const [dimCheck, setDimCheck] = useState<CheckItem | null>(null);
  const [checkingDim, setCheckingDim] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);

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
    setKbCount(res.kb_count);
    setModels(res.settings.models);
    setVectorUrl(res.settings.vector.url);
    setCentralUrl(res.settings.central.url);
    setVectorKey("");
    setLicenseKey("");
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ"));
  }, [load]);

  const loadModels = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoadingList(pid);
    try {
      const { models } = await listProviderModels(pid);
      setModelLists((m) => ({ ...m, [pid]: models }));
    } catch (e) {
      setError(e instanceof Error ? `ดึงรายชื่อโมเดลไม่สำเร็จ: ${e.message}` : "ดึงรายชื่อโมเดลไม่สำเร็จ");
    } finally {
      setLoadingList(null);
    }
  }, []);

  // ดึงรายชื่อโมเดลของการเชื่อมต่อที่ถูกเลือกอยู่ให้อัตโนมัติ (เฉพาะที่ตั้งค่าครบ)
  useEffect(() => {
    if (!settings || !models) return;
    new Set([models.llm.provider, models.embedding.provider, models.rerank.provider]).forEach((pid) => {
      const conn = settings.providers.find((c) => c.id === pid);
      if (conn?.configured && !modelLists[pid]) loadModels(pid);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, models?.llm.provider, models?.embedding.provider, models?.rerank.provider]);

  const savedEmbedding = settings?.models.embedding;
  const embeddingChanged = useMemo(
    () => !!(models && savedEmbedding && kbCount > 0 && (models.embedding.model !== savedEmbedding.model || Number(models.embedding.dim) !== savedEmbedding.dim)),
    [models, savedEmbedding, kbCount]
  );

  if (!settings || !models || !protocols) {
    return error ? <ErrorNote message={error} /> : (
      <div className="flex items-center gap-2 text-sm text-accent-400"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>
    );
  }

  const connections = settings.providers;
  const usedBy = (pid: string) =>
    (["llm", "embedding", "rerank"] as ModelRole[]).filter((r) => models[r].provider === pid && (r !== "rerank" || models.rerank.enabled));

  function patchModel<R extends ModelRole>(role: R, values: Partial<ModelsSettings[R]>) {
    setModels((m) => (m ? { ...m, [role]: { ...m[role], ...values } } : m));
    setModelsNotice(null);
    if (role === "embedding") setDimCheck(null);
  }

  async function handleSaveModels(confirmChange = false) {
    if (!models) return;
    setSavingModels(true);
    setError(null);
    try {
      await saveSettings({ models: models as unknown as SettingsInput["models"] }, confirmChange);
      setConfirm(null);
      await load();
      setModelsNotice("บันทึกแล้ว — มีผลทันที");
    } catch (e) {
      if (e instanceof EmbeddingChangeError) setConfirm(e.affected);
      else setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingModels(false);
    }
  }

  async function handleCheckDim() {
    if (!models) return;
    setCheckingDim(true);
    try {
      const r = await testSettings({ models: { embedding: models.embedding } });
      setDimCheck(r.embedding ?? { ok: false, message: String(r.license?.message ?? r.central?.message ?? "ตรวจไม่ได้") });
    } catch (e) {
      setDimCheck({ ok: false, message: e instanceof Error ? e.message : "ตรวจไม่ได้" });
    } finally {
      setCheckingDim(false);
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

  const detectedDim = typeof dimCheck?.dim === "number" ? dimCheck.dim : null;
  const ROLE_LABEL: Record<ModelRole, string> = { llm: "LLM", embedding: "Embedding", rerank: "Rerank" };

  return (
    <div>
      <PageHeader
        title="การเชื่อมต่อ AI"
        description="เพิ่มการเชื่อมต่อกับผู้ให้บริการ AI เจ้าไหนก็ได้ แล้วเลือกโมเดลที่ใช้ในแต่ละหน้าที่ — มีผลทันทีโดยไม่ต้องรีสตาร์ต และ key ถูกเข้ารหัสก่อนเก็บ"
        actions={
          <Button variant="secondary" onClick={handleCheckAll} disabled={checking}>
            {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ตรวจทั้งระบบ
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
        <Panel icon={<Cpu size={18} />} title="การเชื่อมต่อผู้ให้บริการ" description="ต่อได้ทุกเจ้าที่ใช้ API แบบ OpenAI รวมถึง Gemini และ Ollama — เพิ่มได้ไม่จำกัด เจ้าเดียวกันหลายบัญชีก็ได้">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {connections.map((c) => {
              const roles = usedBy(c.id);
              return (
                <div key={c.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${c.configured ? "border-accent-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
                  <div className="flex items-start gap-3">
                    <Mark name={c.name} type={c.type} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-accent-900">{c.name}</p>
                      <p className="truncate text-[11px] text-accent-400">{protocols[c.type]?.label}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {roles.length ? roles.map((r) => (
                        <span key={r} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">ใช้กับ {ROLE_LABEL[r]}</span>
                      )) : (
                        <span className={`text-xs ${c.configured ? "text-accent-400" : "text-amber-700"}`}>{c.configured ? "ยังไม่ได้ใช้" : "ตั้งค่ายังไม่ครบ"}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
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
              onClick={() => setEditing("new")}
              className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent-300 text-sm font-medium text-accent-500 transition-colors hover:border-brand-400 hover:bg-brand-50/30 hover:text-brand-700"
            >
              <Plus size={18} /> เพิ่มการเชื่อมต่อ
            </button>
          </div>
        </Panel>

        {/* 2) โมเดลที่ใช้ */}
        <Panel
          icon={<Server size={18} />}
          title="โมเดลที่ใช้ในระบบ"
          description="เลือกการเชื่อมต่อและโมเดลสำหรับแต่ละหน้าที่"
          action={
            <div className="flex items-center gap-3">
              {modelsNotice && <span className="flex items-center gap-1 text-xs text-brand-700"><CheckCircle2 size={14} /> {modelsNotice}</span>}
              <Button onClick={() => handleSaveModels(false)} disabled={savingModels}>
                {savingModels ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึกโมเดล
              </Button>
            </div>
          }
        >
          <ModelRow
            role="llm"
            title="LLM (ตอบคำถาม)"
            description="อ่าน context แล้วตอบผู้ใช้ และช่วยจัดข้อมูลตอนอัปโหลดเอกสาร"
            value={models.llm}
            connections={connections}
            models={modelLists[models.llm.provider]}
            loadingModels={loadingList === models.llm.provider}
            onProvider={(pid) => patchModel("llm", { provider: pid, model: "" })}
            onModel={(m) => patchModel("llm", { model: m })}
            onLoadModels={() => loadModels(models.llm.provider)}
          />

          <ModelRow
            role="embedding"
            title="Embedding (ค้นหาเอกสาร)"
            description="แปลงเอกสารเป็นเวกเตอร์ — KB ผูกกับโมเดลที่ใช้ตอนสร้าง"
            value={models.embedding}
            connections={connections}
            models={modelLists[models.embedding.provider]}
            loadingModels={loadingList === models.embedding.provider}
            onProvider={(pid) => patchModel("embedding", { provider: pid, model: "" })}
            onModel={(m) => patchModel("embedding", { model: m })}
            onLoadModels={() => loadModels(models.embedding.provider)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="จำนวนมิติ (dim)">
                <div className="flex gap-2">
                  <input type="number" min={1} className="field" value={models.embedding.dim || ""} onChange={(e) => patchModel("embedding", { dim: Number(e.target.value) })} />
                  <Button variant="secondary" onClick={handleCheckDim} disabled={checkingDim || !models.embedding.model} className="shrink-0 px-3">
                    {checkingDim ? <Loader2 size={14} className="animate-spin" /> : "ตรวจ"}
                  </Button>
                </div>
              </Field>
              <div className="flex items-end pb-2">
                {dimCheck && (detectedDim && detectedDim !== Number(models.embedding.dim) ? (
                  <button type="button" onClick={() => patchModel("embedding", { dim: detectedDim })} className="text-left text-xs font-medium text-amber-700 underline">
                    โมเดลนี้ให้ {detectedDim} มิติ — กดเพื่อใช้ค่านี้
                  </button>
                ) : (
                  <Result item={dimCheck} okText={detectedDim ? `ถูกต้อง · ${detectedDim} มิติ` : undefined} />
                ))}
              </div>
            </div>
            {kbCount > 0 && (
              <p className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${embeddingChanged ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" : "bg-accent-50 text-accent-600"}`}>
                {embeddingChanged ? <AlertTriangle size={14} className="mt-px shrink-0" /> : <Lock size={14} className="mt-px shrink-0" />}
                {embeddingChanged
                  ? `กำลังเปลี่ยน embedding — KB ที่มีอยู่ ${kbCount} รายการจะค้นหาไม่ได้ ต้องสร้าง KB ใหม่และอัปโหลดเอกสารใหม่`
                  : `ล็อกอยู่กับ ${savedEmbedding?.model} (${savedEmbedding?.dim} มิติ) เพราะมี KB ${kbCount} รายการใช้อยู่`}
              </p>
            )}
          </ModelRow>

          <ModelRow
            role="rerank"
            title="Rerank (ไม่บังคับ)"
            description="จัดอันดับผลค้นหาใหม่ให้แม่นขึ้น ใช้กับบอทที่เปิด ‘ใช้ Rerank’ (ต้องเป็นการเชื่อมต่อที่มี endpoint /rerank เช่น SiliconFlow)"
            value={models.rerank}
            connections={connections}
            models={modelLists[models.rerank.provider]}
            loadingModels={loadingList === models.rerank.provider}
            onProvider={(pid) => patchModel("rerank", { provider: pid, model: "" })}
            onModel={(m) => patchModel("rerank", { model: m })}
            onLoadModels={() => loadModels(models.rerank.provider)}
          >
            <label className="flex items-center gap-2 text-sm text-accent-700">
              <input type="checkbox" checked={models.rerank.enabled} onChange={(e) => patchModel("rerank", { enabled: e.target.checked })} className="h-4 w-4 rounded border-accent-300 text-brand-600 focus:ring-brand-500" />
              เปิดใช้ Rerank
            </label>
          </ModelRow>
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

      {editing && (
        <ConnectionModal
          conn={editing === "new" ? null : editing}
          protocols={protocols}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            const id = editing === "new" ? null : editing.id;
            await load();
            if (id) setModelLists((m) => { const n = { ...m }; delete n[id]; return n; });
          }}
        />
      )}

      {confirm && (
        <Modal title="ยืนยันการเปลี่ยน embedding" onClose={() => setConfirm(null)}>
          <div className="flex flex-col gap-4 text-sm text-accent-700">
            <p>KB ต่อไปนี้สร้างด้วย embedding ตัวเดิม หลังเปลี่ยนแล้วจะค้นหาไม่ได้และอัปโหลดเพิ่มไม่ได้ ต้องสร้าง KB ใหม่แล้วอัปโหลดเอกสารใหม่:</p>
            <ul className="list-disc space-y-1 pl-5">{confirm.map((n) => <li key={n}>{n}</li>)}</ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>ยกเลิก</Button>
              <Button onClick={() => handleSaveModels(true)} disabled={savingModels}>เปลี่ยน embedding</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
