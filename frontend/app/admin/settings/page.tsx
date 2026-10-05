"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Lock, PlugZap, Save, XCircle } from "lucide-react";
import { ErrorNote, PageHeader, StatusPill } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  EmbeddingChangeError,
  getSettings,
  saveSettings,
  testSettings,
  type SettingsInput,
} from "@/lib/api";
import type { CheckItem, CheckResult, NodeSettings, SecretMask } from "@/lib/types";

// ── ตัวเลือก provider ──────────────────────────────────

type ProviderOption = { value: string; label: string; needsUrl: boolean; keyOptional: boolean; urlPlaceholder?: string };

const LLM_PROVIDERS: ProviderOption[] = [
  { value: "google", label: "Google Gemini", needsUrl: false, keyOptional: false },
  { value: "ollama", label: "Ollama (เซิร์ฟเวอร์ในองค์กร)", needsUrl: true, keyOptional: true, urlPlaceholder: "http://192.168.1.10:11434" },
  { value: "openai_compatible", label: "OpenAI / SiliconFlow / อื่น ๆ ที่ใช้ API แบบ OpenAI", needsUrl: true, keyOptional: true, urlPlaceholder: "https://api.openai.com/v1" },
];

const URL_SUGGESTIONS = ["https://api.openai.com/v1", "https://api.siliconflow.com/v1", "https://openrouter.ai/api/v1"];

// ── state ของฟอร์ม: ช่อง key "" = ใช้ค่าเดิม, ข้อความ = key ใหม่, null = ลบ ──

type SecretInput = string | null;
type Form = {
  llm: { provider: string; model: string; base_url: string; api_key: SecretInput };
  embedding: { provider: string; model: string; base_url: string; dim: number; api_key: SecretInput };
  rerank: { enabled: boolean; model: string; base_url: string; api_key: SecretInput };
  vector: { url: string; api_key: SecretInput };
  central: { url: string; license_key: SecretInput };
};

function formFrom(s: NodeSettings): Form {
  return {
    llm: { provider: s.llm.provider, model: s.llm.model, base_url: s.llm.base_url ?? "", api_key: "" },
    embedding: { provider: s.embedding.provider, model: s.embedding.model, base_url: s.embedding.base_url ?? "", dim: s.embedding.dim, api_key: "" },
    rerank: { enabled: s.rerank.enabled, model: s.rerank.model ?? "", base_url: s.rerank.base_url ?? "", api_key: "" },
    vector: { url: s.vector.url ?? "", api_key: "" },
    central: { url: s.central.url ?? "", license_key: "" },
  };
}

function toInput(f: Form): SettingsInput {
  // ส่ง key เฉพาะที่ผู้ใช้กรอกใหม่หรือกดลบ — ช่องว่างไม่ส่ง = ใช้ค่าเดิม
  const secret = (v: SecretInput) => (v === null ? null : v.trim() ? v.trim() : undefined);
  return {
    llm: { ...f.llm, api_key: secret(f.llm.api_key) },
    embedding: { ...f.embedding, api_key: secret(f.embedding.api_key) },
    rerank: { ...f.rerank, api_key: secret(f.rerank.api_key) },
    vector: { ...f.vector, api_key: secret(f.vector.api_key) },
    central: { ...f.central, license_key: secret(f.central.license_key) },
  };
}

// ── ชิ้นส่วน UI ───────────────────────────────────────

function Section({ title, description, status, children }: { title: string; description: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-accent-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-accent-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-accent-900">{title}</h2>
          <p className="mt-0.5 text-xs text-accent-500">{description}</p>
        </div>
        {status}
      </header>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-accent-400">{hint}</p>}
    </div>
  );
}

function SecretField({
  label,
  mask,
  value,
  onChange,
  optional,
}: {
  label: string;
  mask: SecretMask;
  value: SecretInput;
  onChange: (v: SecretInput) => void;
  optional?: boolean;
}) {
  const cleared = value === null;
  return (
    <Field
      label={label}
      hint={
        cleared
          ? "จะลบ key นี้เมื่อกดบันทึก"
          : mask.set
            ? "เว้นว่างไว้ = ใช้ key เดิม"
            : optional
              ? "ไม่บังคับ — เซิร์ฟเวอร์ในองค์กรส่วนใหญ่ไม่ต้องใช้ key"
              : "ยังไม่ได้ใส่ key"
      }
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
            placeholder={mask.set ? `${mask.hint} (ตั้งไว้แล้ว)` : "วาง key ที่นี่"}
            className="field pl-8"
          />
        </div>
        {mask.set && (
          <button
            type="button"
            onClick={() => onChange(cleared ? "" : null)}
            className="shrink-0 rounded-lg px-2.5 text-xs font-medium text-accent-500 hover:bg-accent-100"
          >
            {cleared ? "ยกเลิก" : "ลบ"}
          </button>
        )}
      </div>
    </Field>
  );
}

function CheckLine({ item, okText }: { item?: CheckItem; okText?: string }) {
  if (!item) return null;
  if (item.ok === null || item.ok === undefined) {
    return <span className="text-xs text-accent-400">{String(item.message ?? "ไม่ได้ตั้งค่า")}</span>;
  }
  return item.ok ? (
    <span className="flex items-center gap-1 text-xs font-medium text-brand-700">
      <CheckCircle2 size={14} /> {okText ?? "เชื่อมต่อได้"}
    </span>
  ) : (
    <span className="flex max-w-md items-start gap-1 text-xs font-medium text-rose-700">
      <XCircle size={14} className="mt-px shrink-0" /> {String(item.message ?? item.error_code ?? "เชื่อมต่อไม่ได้")}
    </span>
  );
}

// ── หน้า ──────────────────────────────────────────────

export default function SettingsPage() {
  const [masks, setMasks] = useState<NodeSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [kbCount, setKbCount] = useState(0);
  const [lockedEmbedding, setLockedEmbedding] = useState<{ model: string; dim: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  function load() {
    return getSettings().then(({ settings, kb_count }) => {
      setMasks(settings);
      setForm(formFrom(settings));
      setKbCount(kb_count);
      setLockedEmbedding({ model: settings.embedding.model, dim: settings.embedding.dim });
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ"));
  }, []);

  if (!form || !masks) {
    return (
      <div className="flex items-center gap-2 text-sm text-accent-400">
        {error ? <ErrorNote message={error} /> : <><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</>}
      </div>
    );
  }

  function patch<K extends keyof Form>(section: K, values: Partial<Form[K]>) {
    setForm((f) => (f ? { ...f, [section]: { ...f[section], ...values } } : f));
    setNotice(null);
  }

  async function handleTest() {
    if (!form) return;
    setTesting(true);
    setError(null);
    try {
      setResult(await testSettings(toInput(form)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(confirmChange = false) {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await saveSettings(toInput(form), confirmChange);
      setConfirm(null);
      await load();
      setNotice("บันทึกแล้ว — มีผลทันที ไม่ต้องรีสตาร์ต");
    } catch (e) {
      if (e instanceof EmbeddingChangeError) setConfirm(e.affected);
      else setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const llmOpt = LLM_PROVIDERS.find((p) => p.value === form.llm.provider) ?? LLM_PROVIDERS[2];
  const embOpt = LLM_PROVIDERS.find((p) => p.value === form.embedding.provider) ?? LLM_PROVIDERS[2];
  const embeddingChanged =
    lockedEmbedding && (form.embedding.model !== lockedEmbedding.model || Number(form.embedding.dim) !== lockedEmbedding.dim);
  const detectedDim = typeof result?.embedding?.dim === "number" ? result.embedding.dim : null;

  return (
    <div className="pb-24">
      <PageHeader
        title="การเชื่อมต่อ AI"
        description="เลือกผู้ให้บริการและใส่ key ของ AI ที่ใช้ตอบคำถาม — แก้แล้วกดบันทึก มีผลทันทีโดยไม่ต้องรีสตาร์ต key ทุกตัวถูกเข้ารหัสก่อนเก็บ"
      />
      <ErrorNote message={error} />

      <div className="flex flex-col gap-5">
        {/* LLM */}
        <Section
          title="AI สำหรับตอบคำถาม (LLM)"
          description="โมเดลที่อ่าน context แล้วตอบผู้ใช้ รวมถึงช่วยจัดข้อมูลตอนอัปโหลดเอกสาร"
          status={<CheckLine item={result?.llm} />}
        >
          <Field label="ผู้ให้บริการ" wide>
            <select
              className="field"
              value={form.llm.provider}
              onChange={(e) => patch("llm", { provider: e.target.value, base_url: e.target.value === "google" ? "" : form.llm.base_url })}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="ชื่อโมเดล" hint={form.llm.provider === "ollama" ? "ตามที่แสดงใน `ollama list` ทุกตัวอักษร" : undefined}>
            <input className="field" value={form.llm.model} onChange={(e) => patch("llm", { model: e.target.value })} placeholder="เช่น gemini-2.5-flash" />
          </Field>
          {llmOpt.needsUrl ? (
            <Field label="ที่อยู่เซิร์ฟเวอร์ (URL)" hint={form.llm.provider === "ollama" ? "ไม่ต้องใส่ /v1 ระบบเติมให้เอง" : "ปกติลงท้ายด้วย /v1"}>
              <input className="field" list="url-suggestions" value={form.llm.base_url} onChange={(e) => patch("llm", { base_url: e.target.value })} placeholder={llmOpt.urlPlaceholder} />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <SecretField label="API key" mask={masks.llm.api_key} value={form.llm.api_key} optional={llmOpt.keyOptional} onChange={(v) => patch("llm", { api_key: v })} />
        </Section>

        {/* Embedding */}
        <Section
          title="Embedding (แปลงเอกสารเป็นเวกเตอร์เพื่อค้นหา)"
          description="ต้องใช้ตัวเดียวกันตลอดอายุของ KB — KB ที่สร้างไว้แล้วผูกกับโมเดลนี้"
          status={<CheckLine item={result?.embedding} okText={detectedDim ? `เชื่อมต่อได้ · ${detectedDim} มิติ` : undefined} />}
        >
          {kbCount > 0 && (
            <div className={`sm:col-span-2 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${embeddingChanged ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" : "bg-accent-50 text-accent-600"}`}>
              {embeddingChanged ? <AlertTriangle size={14} className="mt-px shrink-0" /> : <Lock size={14} className="mt-px shrink-0" />}
              <span>
                {embeddingChanged
                  ? `กำลังเปลี่ยน embedding — KB ที่มีอยู่ ${kbCount} รายการจะค้นหาไม่ได้ ต้องสร้าง KB ใหม่และอัปโหลดเอกสารใหม่`
                  : `ล็อกอยู่กับ ${lockedEmbedding?.model} (${lockedEmbedding?.dim} มิติ) เพราะมี KB ${kbCount} รายการใช้อยู่`}
              </span>
            </div>
          )}
          <Field label="ผู้ให้บริการ" wide>
            <select
              className="field"
              value={form.embedding.provider}
              onChange={(e) => patch("embedding", { provider: e.target.value, base_url: e.target.value === "google" ? "" : form.embedding.base_url })}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="ชื่อโมเดล">
            <input className="field" value={form.embedding.model} onChange={(e) => patch("embedding", { model: e.target.value })} placeholder="เช่น Qwen/Qwen3-Embedding-4B" />
          </Field>
          <Field
            label="จำนวนมิติ (dim)"
            hint={detectedDim && detectedDim !== Number(form.embedding.dim) ? undefined : "ต้องตรงกับโมเดล — กดทดสอบเพื่อตรวจ"}
          >
            <input type="number" min={1} className="field" value={form.embedding.dim || ""} onChange={(e) => patch("embedding", { dim: Number(e.target.value) })} />
            {detectedDim && detectedDim !== Number(form.embedding.dim) && (
              <button type="button" onClick={() => patch("embedding", { dim: detectedDim })} className="mt-1 text-xs font-medium text-amber-700 underline">
                โมเดลนี้ให้ {detectedDim} มิติ — กดเพื่อใช้ค่านี้
              </button>
            )}
          </Field>
          {embOpt.needsUrl && (
            <Field label="ที่อยู่เซิร์ฟเวอร์ (URL)">
              <input className="field" list="url-suggestions" value={form.embedding.base_url} onChange={(e) => patch("embedding", { base_url: e.target.value })} placeholder={embOpt.urlPlaceholder} />
            </Field>
          )}
          <SecretField label="API key" mask={masks.embedding.api_key} value={form.embedding.api_key} optional={embOpt.keyOptional} onChange={(v) => patch("embedding", { api_key: v })} />
        </Section>

        {/* Rerank */}
        <Section
          title="Rerank (ไม่บังคับ)"
          description="จัดอันดับผลค้นหาใหม่ให้แม่นขึ้น ใช้เมื่อบอทเปิด ‘ใช้ Rerank’ — endpoint แบบ /rerank (เช่น SiliconFlow)"
          status={<CheckLine item={result?.rerank} />}
        >
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.rerank.enabled} onChange={(e) => patch("rerank", { enabled: e.target.checked })} className="h-4 w-4 rounded border-accent-300 text-brand-600 focus:ring-brand-500" />
            เปิดใช้ Rerank
          </label>
          {form.rerank.enabled && (
            <>
              <Field label="ชื่อโมเดล">
                <input className="field" value={form.rerank.model} onChange={(e) => patch("rerank", { model: e.target.value })} placeholder="Qwen/Qwen3-Reranker-0.6B" />
              </Field>
              <Field label="ที่อยู่เซิร์ฟเวอร์ (URL)">
                <input className="field" list="url-suggestions" value={form.rerank.base_url} onChange={(e) => patch("rerank", { base_url: e.target.value })} placeholder="https://api.siliconflow.com/v1" />
              </Field>
              <SecretField label="API key" mask={masks.rerank.api_key} value={form.rerank.api_key} onChange={(v) => patch("rerank", { api_key: v })} />
            </>
          )}
        </Section>

        {/* Qdrant */}
        <Section title="ฐานข้อมูลเวกเตอร์ (Qdrant)" description="ที่เก็บเอกสารที่แปลงแล้วขององค์กรคุณ" status={<CheckLine item={result?.vector} />}>
          <Field label="Qdrant URL">
            <input className="field" value={form.vector.url} onChange={(e) => patch("vector", { url: e.target.value })} placeholder="https://xxxx.cloud.qdrant.io" />
          </Field>
          <SecretField label="Qdrant API key" mask={masks.vector.api_key} value={form.vector.api_key} optional onChange={(v) => patch("vector", { api_key: v })} />
        </Section>

        {/* Central */}
        <Section
          title="บริการประมวลผลกลาง (central) และ license"
          description="ที่อยู่ของ central และ license ที่ได้รับจากผู้ให้บริการ"
          status={
            result?.license ? (
              <StatusPill ok={result.license.ok} okText={`license ${result.license.status ?? "active"}`} failText="license ใช้ไม่ได้" />
            ) : (
              <CheckLine item={result?.central} />
            )
          }
        >
          <Field label="ที่อยู่ central" hint="เช่น http://192.168.30.108:9000">
            <input className="field" value={form.central.url} onChange={(e) => patch("central", { url: e.target.value })} />
          </Field>
          <SecretField label="License key" mask={masks.central.license_key} value={form.central.license_key} onChange={(v) => patch("central", { license_key: v })} />
          {result?.license && !result.license.ok && (
            <p className="text-xs text-rose-700 sm:col-span-2">{String(result.license.message ?? "")}</p>
          )}
          {result?.license?.ok && result.license.valid_until && (
            <p className="text-xs text-accent-500 sm:col-span-2">
              ใช้ได้ถึง {new Date(result.license.valid_until).toLocaleDateString("th-TH", { dateStyle: "long" })}
              {result.license.warnings?.map((w) => ` · ${w.message}`)}
            </p>
          )}
        </Section>
      </div>

      <datalist id="url-suggestions">
        {URL_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {/* แถบปุ่มปักล่าง */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-accent-200 bg-white/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          {notice && <span className="mr-auto flex items-center gap-1.5 text-sm text-brand-700"><CheckCircle2 size={15} /> {notice}</span>}
          <Button variant="secondary" onClick={handleTest} disabled={testing || saving}>
            {testing ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} ทดสอบการเชื่อมต่อ
          </Button>
          <Button onClick={() => handleSave(false)} disabled={saving || testing}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </Button>
        </div>
      </div>

      {confirm && (
        <Modal title="ยืนยันการเปลี่ยน embedding" onClose={() => setConfirm(null)}>
          <div className="flex flex-col gap-4 text-sm text-accent-700">
            <p>KB ต่อไปนี้สร้างด้วย embedding ตัวเดิม หลังเปลี่ยนแล้วจะค้นหาไม่ได้และอัปโหลดเพิ่มไม่ได้ ต้องสร้าง KB ใหม่แล้วอัปโหลดเอกสารใหม่:</p>
            <ul className="list-disc space-y-1 pl-5">
              {confirm.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>ยกเลิก</Button>
              <Button onClick={() => handleSave(true)} disabled={saving} className="from-amber-500 to-amber-700">
                เปลี่ยน embedding
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
