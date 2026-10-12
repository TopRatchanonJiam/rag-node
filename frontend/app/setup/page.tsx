"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { finishSetup, getSetup, saveLicenseKey, setupAi, setupPassword, startTrial, type SetupStatus } from "@/lib/api";
import { I18nProvider, LOCALES, errorText, useI18n, type Locale } from "@/lib/i18n";
import { AppMark } from "@/components/ui/AppMark";

const STEPS = ["license", "ai", "password"] as const;
type Step = (typeof STEPS)[number] | "finish";

export default function SetupPage() {
  return (
    <I18nProvider>
      <Wizard />
    </I18nProvider>
  );
}

function Wizard() {
  const { t, locale, setLocale } = useI18n();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step>("license");

  useEffect(() => {
    getSetup()
      .then((s) => {
        setStatus(s);
        setStep(!s.has_license ? "license" : !(s.has_llm && s.has_embedding) ? "ai" : "password");
      })
      .catch(() => setStatus(null));
  }, []);

  const index = step === "finish" ? STEPS.length : STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AppMark size={40} />
          <div>
            <h1 className="text-xl font-semibold text-accent-900">{t("setup.title")}</h1>
            <p className="text-sm text-accent-500">{t("setup.subtitle")}</p>
          </div>
        </div>
        <select
          aria-label={t("setup.language")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="field !w-auto py-1.5 text-xs"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </header>

      {step !== "finish" && (
        <div className="flex items-center gap-3">
          <div className="flex flex-1 gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-brand-grad" : "bg-accent-200"}`} />
            ))}
          </div>
          <span className="text-xs text-accent-500">{t("setup.step", { n: index + 1, total: STEPS.length })}</span>
        </div>
      )}

      {!status ? (
        <Loader2 className="mx-auto animate-spin text-accent-400" />
      ) : step === "license" ? (
        <LicenseStep status={status} onDone={(s) => (setStatus(s), go("ai"))} />
      ) : step === "ai" ? (
        <AiStep status={status} onBack={() => go("license")} onDone={(s) => (setStatus(s), go("password"))} />
      ) : step === "password" ? (
        <PasswordStep status={status} onBack={() => go("ai")} onDone={() => go("finish")} />
      ) : (
        <FinishStep />
      )}
    </main>
  );
}

function Card({ icon, title, desc, children }: { icon: ReactNode; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-float ring-1 ring-accent-100">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <div>
          <h2 className="text-base font-semibold text-accent-900">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-accent-500">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Ready({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700">
      <CheckCircle2 size={16} /> {text}
    </p>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</p> : null;
}

function useAction<T>() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setErr(null);
    try {
      then(await fn());
    } catch (e) {
      setErr(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, run };
}

function LicenseStep({ status, onDone }: { status: SetupStatus; onDone: (s: SetupStatus) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"trial" | "key">("trial");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const { busy, err, run } = useAction<SetupStatus>();
  // ช่วง Free Beta เปิดรับ = แจก license beta, ปิดรับแล้ว = ทดลอง N ชั่วโมง (central บอกมา)
  const beta = status.program ? status.program.signup_open : true;
  const desc = beta ? t("setup.license.beta_desc") : t("setup.license.trial_desc", { hours: status.program?.trial_hours ?? 24 });

  return (
    <Card icon={<Sparkles size={18} />} title={t("setup.license.title")} desc={desc}>
      {status.has_license ? (
        <Ready text={t("setup.license.ready")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-accent-100 p-1 text-sm">
            {(["trial", "key"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-lg py-2 font-medium transition ${tab === k ? "bg-white text-accent-900 shadow-soft" : "text-accent-500"}`}
              >
                {t(k === "key" ? "setup.license.tab_key" : beta ? "setup.license.tab_beta" : "setup.license.tab_trial")}
              </button>
            ))}
          </div>
          {tab === "trial" ? (
            <label className="flex flex-col gap-1.5">
              <span className="field-label">{t("setup.license.email")}</span>
              <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <span className="text-xs text-accent-400">{t("setup.license.email_hint")}</span>
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="field-label">{t("setup.license.key")}</span>
              <input className="field font-mono text-[13px]" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} />
              <span className="text-xs text-accent-400">{t("setup.license.key_hint")}</span>
            </label>
          )}
          <ErrorLine text={err} />
        </>
      )}
      <div className="flex justify-end">
        {status.has_license ? (
          <Button onClick={() => onDone(status)}>{t("setup.next")}</Button>
        ) : (
          <Button
            disabled={busy || (tab === "trial" ? !email.includes("@") : !key.trim())}
            onClick={() => run(() => (tab === "trial" ? startTrial(email.trim()) : saveLicenseKey(key.trim())), onDone)}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {t(tab === "key" ? "setup.license.save_key" : beta ? "setup.license.start_beta" : "setup.license.start_trial")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function AiStep({ status, onBack, onDone }: { status: SetupStatus; onBack: () => void; onDone: (s: SetupStatus) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"gemini" | "gemini_siliconflow">("gemini");
  const [gkey, setGkey] = useState("");
  const [skey, setSkey] = useState("");
  const { busy, err, run } = useAction<SetupStatus>();
  const ready = status.has_llm && status.has_embedding;

  return (
    <Card icon={<KeyRound size={18} />} title={t("setup.ai.title")} desc={t("setup.ai.desc")}>
      {ready && <Ready text={t("setup.ai.ready")} />}
      <div className="grid gap-2 sm:grid-cols-2">
        {(["gemini", "gemini_siliconflow"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-xl p-3 text-left ring-1 ring-inset transition ${mode === m ? "bg-brand-50 ring-brand-400" : "bg-white ring-accent-200 hover:ring-brand-300"}`}
          >
            <p className="text-sm font-semibold text-accent-900">{t(m === "gemini" ? "setup.ai.mode_gemini" : "setup.ai.mode_both")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-accent-500">
              {t(m === "gemini" ? "setup.ai.mode_gemini_desc" : "setup.ai.mode_both_desc")}
            </p>
          </button>
        ))}
      </div>
      <KeyInput label={t("setup.ai.gemini_key")} help={t("setup.ai.gemini_help")} href="https://aistudio.google.com/apikey" value={gkey} onChange={setGkey} />
      {mode === "gemini_siliconflow" && (
        <KeyInput label={t("setup.ai.sf_key")} help={t("setup.ai.sf_help")} href="https://cloud.siliconflow.com/account/ak" value={skey} onChange={setSkey} />
      )}
      <p className="text-xs leading-relaxed text-accent-400">{t("setup.ai.privacy_note")}</p>
      <ErrorLine text={err} />
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("setup.back")}
        </Button>
        <div className="flex gap-2">
          {ready && (
            <Button variant="secondary" onClick={() => onDone(status)}>
              {t("setup.next")}
            </Button>
          )}
          <Button
            disabled={busy || !gkey.trim() || (mode === "gemini_siliconflow" && !skey.trim())}
            onClick={() => run(() => setupAi({ mode, gemini_key: gkey.trim(), siliconflow_key: skey.trim() || undefined }), onDone)}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {t(busy ? "setup.ai.verifying" : "setup.ai.verify")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function KeyInput({ label, help, href, value, onChange }: { label: string; help: string; href: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <input className="field font-mono text-[13px]" type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
        {help} <ExternalLink size={12} />
      </a>
    </label>
  );
}

function PasswordStep({ status, onBack, onDone }: { status: SetupStatus; onBack: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  const { busy, err, run } = useAction<SetupStatus>();
  const done = status.has_password;

  return (
    <Card icon={<Lock size={18} />} title={t("setup.password.title")} desc={t("setup.password.desc")}>
      {status.password_from_env ? (
        <Ready text={t("setup.password.from_env")} />
      ) : done ? (
        <Ready text={t("setup.password.ready")} />
      ) : (
        <>
          <p className="text-sm text-accent-600">{t("setup.password.user", { user: status.admin_user })}</p>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t("setup.password.password")}</span>
            <input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className="text-xs text-accent-400">{t("setup.password.login_note")}</span>
          </label>
          <ErrorLine text={err} />
        </>
      )}
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("setup.back")}
        </Button>
        {done || status.password_from_env ? (
          <Button onClick={onDone}>{t("setup.next")}</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onDone}>
              {t("setup.skip")}
            </Button>
            <Button disabled={busy || pw.length < 8} onClick={() => run(() => setupPassword(pw), onDone)}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t("setup.password.save")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function FinishStep() {
  const { t } = useI18n();
  useEffect(() => {
    finishSetup().catch(() => undefined);
  }, []);
  return (
    <Card icon={<CheckCircle2 size={18} />} title={t("setup.finish.title")} desc={t("setup.finish.desc")}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => (window.location.href = "/admin/")}>
          {t("setup.finish.go_admin")}
        </Button>
        <Button onClick={() => (window.location.href = "/kb/")}>{t("setup.finish.go_kb")}</Button>
      </div>
    </Card>
  );
}
