"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createApiKey, deleteApiKey, listApiKeys, toggleApiKey, type ApiKeyCreated, type ApiKeysResponse } from "@/lib/api";
import { errorText, useI18n } from "@/lib/i18n";
import type { Chatbot } from "@/lib/types";

function CopyField({ label, value, empty }: { label: string; value: string; empty?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <div className="flex gap-2">
        <input className="field font-mono text-[12px]" readOnly value={value} placeholder={empty} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          className="shrink-0 whitespace-nowrap"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />} {t(copied ? "apikeys.copied" : "apikeys.copy")}
        </Button>
      </div>
    </div>
  );
}

// API key ให้ระบบภายนอก (n8n, Make, สคริปต์) ถามบอท / ดันข้อมูลสดเข้า node — เรียกตรงที่ node หรือผ่าน URL สาธารณะของ central
export function ApiKeysSection({ bots }: { bots: Chatbot[] }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<ApiKeysResponse | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"chat" | "data">("chat");
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listApiKeys()
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(errorText(t, e)));
  }, [t]);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
    const timer = window.setInterval(load, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!botId && bots[0]) setBotId(bots[0].id);
  }, [bots, botId]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const base = data?.relay_base || (origin ? `${origin}${data?.direct_path ?? "/api/v1"}` : "<URL>");
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === "th" ? "th-TH" : "en-GB") : t("apikeys.never"));

  return (
    <section className="surface">
      <header className="flex items-start gap-3 border-b border-accent-100 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <KeyRound size={18} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-accent-900">{t("apikeys.title")}</h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-accent-500">{t("apikeys.desc")}</p>
        </div>
      </header>
      <div className="flex flex-col gap-5 p-5">
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label={t("apikeys.relay")} value={data?.relay_base ?? ""} empty={t("apikeys.relay_off")} />
          <CopyField label={t("apikeys.direct")} value={origin ? `${origin}${data?.direct_path ?? "/api/v1"}` : ""} />
        </div>

        {created && (
          <div className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
            <p className="text-sm font-semibold text-amber-900">{t("apikeys.created_title", { name: created.name })}</p>
            <p className="text-xs text-amber-800">{t("apikeys.created_note")}</p>
            <div className="flex gap-2">
              <input className="field font-mono text-[12px]" readOnly value={created.key} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.key);
                  setCopiedKey(true);
                  window.setTimeout(() => setCopiedKey(false), 1800);
                }}
              >
                {copiedKey ? <CheckCircle2 size={15} /> : <Copy size={15} />} {t(copiedKey ? "apikeys.copied" : "apikeys.copy")}
              </Button>
            </div>
            <button type="button" className="self-end text-xs font-medium text-amber-900 underline" onClick={() => setCreated(null)}>
              {t("apikeys.done")}
            </button>
          </div>
        )}

        {data && data.keys.length === 0 && <p className="text-xs text-accent-400">{t("apikeys.empty")}</p>}
        {data?.keys.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-100 p-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-accent-900">
                {k.name}
                <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-600">{t(`apikeys.scope_${k.scope}_short`)}</span>
                <span className="font-mono text-xs font-normal text-accent-400">n9_…{k.hint}</span>
              </p>
              <p className="mt-0.5 text-xs text-accent-500">
                {k.scope === "chat" && k.bot_name ? `${k.bot_name} · ` : ""}
                {t("apikeys.last_used")}: {when(k.last_used_at)} · {k.calls_total} {t("apikeys.calls")}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-accent-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={k.enabled} disabled={busy} onChange={(e) => act(() => toggleApiKey(k.id, e.target.checked))} /> {t("apikeys.enabled")}
              </label>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("apikeys.confirm_delete"))) act(() => deleteApiKey(k.id));
                }}
              >
                <Trash2 size={15} /> {t("apikeys.delete")}
              </Button>
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-3 rounded-xl border border-accent-100 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">{t("apikeys.name")}</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("apikeys.name_ph")} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">{t("apikeys.scope")}</span>
              <select className="field" value={scope} onChange={(e) => setScope(e.target.value as "chat" | "data")}>
                <option value="chat">{t("apikeys.scope_chat")}</option>
                <option value="data">{t("apikeys.scope_data")}</option>
              </select>
            </label>
            {scope === "chat" && (
              <label className="flex flex-col gap-1.5">
                <span className="field-label">{t("apikeys.bot")}</span>
                <select className="field" value={botId} onChange={(e) => setBotId(e.target.value)}>
                  {bots.length === 0 && <option value="">{t("channels.line.no_bots")}</option>}
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="text-xs text-accent-400">{t(`apikeys.hint_${scope}`)}</p>
          <div className="flex justify-end">
            <Button
              disabled={busy || !name.trim() || (scope === "chat" && !botId)}
              onClick={() =>
                act(async () => {
                  setCreated(await createApiKey({ name: name.trim(), scope, bot_id: scope === "chat" ? botId : undefined }));
                  setName("");
                  setCopiedKey(false);
                })
              }
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {t("apikeys.create")}
            </Button>
          </div>
        </div>

        <details className="rounded-xl bg-accent-50 p-4 text-xs text-accent-600">
          <summary className="cursor-pointer font-semibold text-accent-700">{t("apikeys.example")}</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-accent-700">{`# ${t("apikeys.ex_chat")}
curl -X POST "${base}/chat" \\
  -H "Authorization: Bearer n9_…" -H "Content-Type: application/json" \\
  -d '{"message": "..."}'

# ${t("apikeys.ex_push")}
curl -X PUT "${base}/sources/<source id>/rows" \\
  -H "Authorization: Bearer n9_…" -H "Content-Type: application/json" \\
  -d '{"rows": [{"sku": "A1", "price": 95, "stock": 30}]}'`}</pre>
        </details>
      </div>
    </section>
  );
}
