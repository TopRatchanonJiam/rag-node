"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Server,
  Settings2,
  XCircle,
} from "lucide-react";
import { ErrorNote, PageHeader } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  EmbeddingChangeError,
  getSettings,
  listProviderModels,
  runFullCheck,
  saveSettings,
  testSettings,
  type SettingsInput,
} from "@/lib/api";
import type {
  CheckItem,
  CheckResult,
  ModelRole,
  ModelsSettings,
  NodeSettings,
  ProviderCatalogItem,
  ProviderModel,
  SecretMask,
} from "@/lib/types";

// ── ตกแต่งการ์ดผู้ให้บริการ ──────────────────────────────

const PROVIDER_STYLE: Record<string, { bg: string; text: string; mark: string }> = {
  google: { bg: "bg-sky-50", text: "text-sky-700", mark: "G" },
  openai: { bg: "bg-accent-900", text: "text-white", mark: "AI" },
  siliconflow: { bg: "bg-violet-50", text: "text-violet-700", mark: "SF" },
  ollama: { bg: "bg-amber-50", text: "text-amber-700", mark: "OL" },
  custom: { bg: "bg-brand-50", text: "text-brand-700", mark: "</>" },
};

const ROLE_LABEL: Record<ModelRole, string> = { llm: "LLM", embedding: "Embedding", rerank: "Rerank" };

function ProviderMark({ pid, size = "md" }: { pid: string; size?: "md" | "lg" }) {
  const s = PROVIDER_STYLE[pid] ?? PROVIDER_STYLE.custom;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${s.bg} ${s.text} ${
        size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"
      }`}
    >
      {s.mark}
    </span>
  );
}

// ── ชิ้นส่วนฟอร์ม ─────────────────────────────────────

type SecretInput = string | null; // "" = ใช้ค่าเดิม, ข้อความ = ค่าใหม่, null = ลบ
const secretOut = (v: SecretInput) => (v === null ? null : v.trim() ? v.trim() : undefined);

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
    <Field
      label={label}
      hint={cleared ? "จะลบเมื่อกดบันทึก" : mask.set ? "เว้นว่างไว้ = ใช้ค่าเดิม" : optional ? "ไม่บังคับ" : undefined}
    >
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

// ── หน้าต่างตั้งค่าผู้ให้บริการ ───────────────────────────

function ProviderModal({
  pid,
  info,
  state,
  onClose,
  onSaved,
}: {
  pid: string;
  info: ProviderCatalogItem;
  state: NodeSettings["providers"][string];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(state.base_url ?? "");
  const [apiKey, setApiKey] = useState<SecretInput>("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  const creds = () => {
    const c: Record<string, string | null | undefined> = {};
    if (info.fields.includes("base_url")) c.base_url = baseUrl;
    if (info.fields.includes("api_key")) c.api_key = secretOut(apiKey);
    return c;
  };

  async function handleTest() {
    setTesting(true);
    setTest(null);
    try {
      const { models } = await listProviderModels(pid, creds());
      setTest({ ok: true, text: `เชื่อมต่อได้ — พบ ${models.length} โมเดล` });
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : "เชื่อมต่อไม่ได้" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettings({ providers: { [pid]: creds() } });
      await onSaved();
      onClose();
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`ตั้งค่า ${info.label}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-accent-50 px-3 py-2.5">
          <ProviderMark pid={pid} />
          <p className="text-xs text-accent-600">{info.hint}</p>
        </div>
        {info.fields.includes("base_url") && (
          <Field label="ที่อยู่เซิร์ฟเวอร์ (URL)">
            <input className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={pid === "ollama" ? "http://192.168.1.10:11434" : "https://example.com/v1"} />
          </Field>
        )}
        {info.fields.includes("api_key") && (
          <SecretField label="API key" mask={state.api_key} value={apiKey} onChange={setApiKey} optional={pid === "custom"} />
        )}
        {test && (
          <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${test.ok ? "bg-brand-50 text-brand-800" : "bg-rose-50 text-rose-700"}`}>
            {test.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <XCircle size={14} className="mt-px shrink-0" />}
            {test.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleTest} disabled={testing || saving}>
            {testing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} ทดสอบ
          </Button>
          <Button onClick={handleSave} disabled={saving || testing}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </Button>
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
  catalog,
  providers,
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
  catalog: Record<string, ProviderCatalogItem>;
  providers: NodeSettings["providers"];
  models: ProviderModel[] | undefined;
  loadingModels: boolean;
  onProvider: (pid: string) => void;
  onModel: (m: string) => void;
  onLoadModels: () => void;
  children?: ReactNode;
}) {
  const options = Object.entries(catalog).filter(([, c]) => c.roles.includes(role));
  const listId = `models-${role}`;
  const suggested = (models ?? []).filter((m) => m.kinds.includes(role));
  const shown = suggested.length ? suggested : models ?? [];
  const configured = providers[value.provider]?.configured;

  return (
    <div className="grid gap-4 border-b border-accent-100 py-5 first:pt-0 last:border-0 last:pb-0 lg:grid-cols-[220px_1fr]">
      <div>
        <p className="text-sm font-semibold text-accent-900">{title}</p>
        <p className="mt-0.5 text-xs text-accent-500">{description}</p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ผู้ให้บริการ" hint={!configured ? <span className="text-amber-700">ยังไม่ได้ตั้งค่าผู้ให้บริการนี้ — กด ‘ตั้งค่า’ ที่การ์ดด้านบนก่อน</span> : undefined}>
            <select className="field" value={value.provider} onChange={(e) => onProvider(e.target.value)}>
              {options.map(([pid, c]) => (
                <option key={pid} value={pid}>
                  {c.label}{providers[pid]?.configured ? "" : " (ยังไม่ได้ตั้งค่า)"}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="โมเดล"
            hint={
              models ? `พบ ${shown.length} โมเดล — เลือกจากรายการหรือพิมพ์ชื่อเองได้` : "กดปุ่มรีเฟรชเพื่อดึงรายชื่อโมเดลจากผู้ให้บริการ"
            }
          >
            <div className="flex gap-2">
              <input className="field" list={listId} value={value.model} onChange={(e) => onModel(e.target.value)} placeholder="ชื่อโมเดล" />
              <button
                type="button"
                onClick={onLoadModels}
                disabled={!configured || loadingModels}
                title="ดึงรายชื่อโมเดล"
                className="flex h-[38px] w-10 shrink-0 items-center justify-center rounded-lg border border-accent-200 text-accent-500 hover:bg-accent-50 disabled:opacity-40"
              >
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
            <datalist id={listId}>
              {shown.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
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
  const [catalog, setCatalog] = useState<Record<string, ProviderCatalogItem>>({});
  const [kbCount, setKbCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
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
    setCatalog(res.catalog);
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

  // ดึงรายชื่อโมเดลของผู้ให้บริการที่ถูกเลือกอยู่ให้อัตโนมัติ (เฉพาะที่ตั้งค่าแล้ว)
  useEffect(() => {
    if (!settings || !models) return;
    const pids = new Set([models.llm.provider, models.embedding.provider, models.rerank.provider]);
    pids.forEach((pid) => {
      if (settings.providers[pid]?.configured && !modelLists[pid]) loadModels(pid);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, models?.llm.provider, models?.embedding.provider, models?.rerank.provider]);

  const savedEmbedding = settings?.models.embedding;
  const embeddingChanged = useMemo(
    () => !!(models && savedEmbedding && kbCount > 0 && (models.embedding.model !== savedEmbedding.model || Number(models.embedding.dim) !== savedEmbedding.dim)),
    [models, savedEmbedding, kbCount]
  );

  if (!settings || !models) {
    return error ? <ErrorNote message={error} /> : (
      <div className="flex items-center gap-2 text-sm text-accent-400"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>
    );
  }

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
  const lic = check?.license;

  return (
    <div>
      <PageHeader
        title="การเชื่อมต่อ AI"
        description="ตั้งค่าผู้ให้บริการครั้งเดียว แล้วเลือกโมเดลที่ใช้ในแต่ละหน้าที่ — ทุกอย่างมีผลทันทีโดยไม่ต้องรีสตาร์ต และ key ถูกเข้ารหัสก่อนเก็บ"
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
            ["license", lic],
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
        {/* 1) ผู้ให้บริการ */}
        <Panel icon={<Cpu size={18} />} title="ผู้ให้บริการโมเดล" description="ใส่ key หรือที่อยู่เซิร์ฟเวอร์ของแต่ละเจ้า — ตั้งเฉพาะเจ้าที่ใช้ก็พอ">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(catalog).map(([pid, info]) => {
              const st = settings.providers[pid];
              return (
                <div key={pid} className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${st?.configured ? "border-brand-200 bg-brand-50/30" : "border-accent-200 bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <ProviderMark pid={pid} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-accent-900">{info.label}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {info.roles.map((r) => (
                          <span key={r} className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-600">{ROLE_LABEL[r]}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {st?.configured ? (
                      <span className="flex min-w-0 items-center gap-1 text-xs text-brand-700">
                        <CheckCircle2 size={13} className="shrink-0" />
                        <span className="truncate">{info.fields.includes("base_url") ? st.base_url : `key ${st.api_key.hint}`}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-accent-400">ยังไม่ได้ตั้งค่า</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(pid)}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-accent-200 bg-white px-2.5 py-1.5 text-xs font-medium text-accent-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      <Settings2 size={13} /> {st?.configured ? "แก้ไข" : "ตั้งค่า"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* 2) โมเดลที่ใช้ */}
        <Panel
          icon={<Server size={18} />}
          title="โมเดลที่ใช้ในระบบ"
          description="เลือกผู้ให้บริการและโมเดลสำหรับแต่ละหน้าที่"
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
            catalog={catalog}
            providers={settings.providers}
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
            catalog={catalog}
            providers={settings.providers}
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
                {dimCheck && (
                  detectedDim && detectedDim !== Number(models.embedding.dim) ? (
                    <button type="button" onClick={() => patchModel("embedding", { dim: detectedDim })} className="text-left text-xs font-medium text-amber-700 underline">
                      โมเดลนี้ให้ {detectedDim} มิติ — กดเพื่อใช้ค่านี้
                    </button>
                  ) : (
                    <Result item={dimCheck} okText={detectedDim ? `ถูกต้อง · ${detectedDim} มิติ` : undefined} />
                  )
                )}
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
            description="จัดอันดับผลค้นหาใหม่ให้แม่นขึ้น ใช้กับบอทที่เปิด ‘ใช้ Rerank’"
            value={models.rerank}
            catalog={catalog}
            providers={settings.providers}
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

      {editing && catalog[editing] && (
        <ProviderModal
          pid={editing}
          info={catalog[editing]}
          state={settings.providers[editing]}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            setModelLists((m) => {
              const next = { ...m };
              delete next[editing];
              return next;
            });
          }}
        />
      )}

      {confirm && (
        <Modal title="ยืนยันการเปลี่ยน embedding" onClose={() => setConfirm(null)}>
          <div className="flex flex-col gap-4 text-sm text-accent-700">
            <p>KB ต่อไปนี้สร้างด้วย embedding ตัวเดิม หลังเปลี่ยนแล้วจะค้นหาไม่ได้และอัปโหลดเพิ่มไม่ได้ ต้องสร้าง KB ใหม่แล้วอัปโหลดเอกสารใหม่:</p>
            <ul className="list-disc space-y-1 pl-5">
              {confirm.map((n) => <li key={n}>{n}</li>)}
            </ul>
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
