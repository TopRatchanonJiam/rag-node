"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/admin/AdminShell";
import {
  createChannel, deleteChannel, listBots, listChannels, testChannel, updateChannel,
  type ChannelInfo, type ChannelsResponse,
} from "@/lib/api";
import { errorText, useI18n } from "@/lib/i18n";
import type { Chatbot } from "@/lib/types";

export default function ChannelsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [bots, setBots] = useState<Chatbot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([listChannels(), listBots()])
      .then(([c, b]) => {
        setData(c);
        setBots(b.bots);
        setError(null);
      })
      .catch((e) => setError(errorText(t, e)));
  }, [t]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000); // สถานะท่อ/ข้อความล่าสุดเปลี่ยนเอง
    return () => window.clearInterval(timer);
  }, [load]);

  const tunnel = data?.tunnel.status ?? "stopped";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("channels.title")} description={t("channels.subtitle")} />
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {!data ? (
        <Loader2 className="animate-spin text-accent-400" />
      ) : (
        <section className="surface">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-accent-100 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <MessageCircle size={18} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-accent-900">{t("channels.line.title")}</h2>
                <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-accent-500">{t("channels.line.desc")}</p>
              </div>
            </div>
            <p className="flex items-center gap-2 text-xs text-accent-500">
              {t("channels.status.tunnel")}:
              <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${tunnel === "connected" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                {t(`channels.status.${tunnel}`)}
              </span>
            </p>
          </header>
          <div className="flex flex-col gap-5 p-5">
            {!data.central_https && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("channels.line.not_https")}</p>}
            <p className="text-xs text-accent-400">{t("channels.line.pc_note")}</p>
            {data.channels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} bots={bots} onChanged={load} />
            ))}
            <NewChannel bots={bots} onCreated={load} first={data.channels.length === 0} />
          </div>
        </section>
      )}
    </div>
  );
}

function useBusy() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, note, setNote, run };
}

function Steps() {
  const { t } = useI18n();
  return (
    <div className="rounded-xl bg-accent-50 p-4">
      <p className="mb-2 text-xs font-semibold text-accent-700">{t("channels.line.steps_title")}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-accent-600">
        {["step1", "step2", "step3", "step4"].map((k) => (
          <li key={k}>{t(`channels.line.${k}`)}</li>
        ))}
      </ol>
    </div>
  );
}

function BotSelect({ bots, value, onChange }: { bots: Chatbot[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{t("channels.line.bot")}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {bots.length === 0 && <option value="">{t("channels.line.no_bots")}</option>}
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewChannel({ bots, onCreated, first }: { bots: Chatbot[]; onCreated: () => void; first: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(first);
  const [botId, setBotId] = useState("");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const { busy, err, run } = useBusy();
  useEffect(() => {
    if (!botId && bots[0]) setBotId(bots[0].id);
  }, [bots, botId]);

  if (!open)
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus size={15} /> {t("channels.line.add")}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-accent-100 p-4">
      <Steps />
      <BotSelect bots={bots} value={botId} onChange={setBotId} />
      <label className="flex flex-col gap-1.5">
        <span className="field-label">{t("channels.line.secret")}</span>
        <input className="field font-mono text-[13px]" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">{t("channels.line.token")}</span>
        <input className="field font-mono text-[13px]" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
      <div className="flex justify-end">
        <Button
          disabled={busy || !botId || !secret.trim() || !token.trim()}
          onClick={() =>
            run(async () => {
              await createChannel({ bot_id: botId, channel_secret: secret.trim(), access_token: token.trim(), enabled: true, welcome: true });
              setSecret("");
              setToken("");
              onCreated();
            })
          }
        >
          {busy && <Loader2 size={15} className="animate-spin" />} {t("channels.line.create")}
        </Button>
      </div>
    </div>
  );
}

function ChannelCard({ channel, bots, onChanged }: { channel: ChannelInfo; bots: Chatbot[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [botId, setBotId] = useState(channel.bot_id);
  const [enabled, setEnabled] = useState(channel.enabled);
  const [welcome, setWelcome] = useState(channel.welcome);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const { busy, err, note, setNote, run } = useBusy();
  const dirty = botId !== channel.bot_id || enabled !== channel.enabled || welcome !== channel.welcome || secret !== "" || token !== "";
  const last = channel.last_event_at ? new Date(channel.last_event_at).toLocaleString(locale === "th" ? "th-TH" : "en-GB") : t("channels.line.never");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-accent-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-accent-900">{channel.account_name || t("channels.line.unnamed")}</p>
        <p className="text-xs text-accent-500">
          {t("channels.line.messages")}: <b>{channel.messages_total}</b> · {t("channels.line.last")}: {last}
        </p>
      </div>
      {channel.last_error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {t("channels.line.last_error")}: {channel.last_error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("channels.line.webhook")}</span>
        <div className="flex gap-2">
          <input className="field font-mono text-[12px]" readOnly value={channel.webhook_url ?? ""} onFocus={(e) => e.currentTarget.select()} />
          <Button
            variant="secondary"
            className="shrink-0 whitespace-nowrap"
            disabled={!channel.webhook_url}
            onClick={async () => {
              await navigator.clipboard.writeText(channel.webhook_url ?? "");
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />} {t(copied ? "channels.line.copied" : "channels.line.copy")}
          </Button>
        </div>
      </div>
      <BotSelect bots={bots} value={botId} onChange={setBotId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">{t("channels.line.secret")}</span>
          <input className="field font-mono text-[13px]" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={`${channel.secret.hint}`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">{t("channels.line.token")}</span>
          <input className="field font-mono text-[13px]" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`${channel.token.hint}`} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-accent-400">{t("channels.line.keep")}</p>
      <div className="flex flex-wrap gap-5 text-sm text-accent-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("channels.line.enabled")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={welcome} onChange={(e) => setWelcome(e.target.checked)} /> {t("channels.line.welcome")}
        </label>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
      {note && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{note}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("channels.line.confirm_delete"))) run(async () => (await deleteChannel(channel.id), onChanged()));
          }}
        >
          <Trash2 size={15} /> {t("channels.line.delete")}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(async () => setNote(t("channels.line.test_ok", { name: (await testChannel(channel.id)).account_name })))}>
            {t("channels.line.test")}
          </Button>
          <Button
            disabled={busy || !dirty || !botId}
            onClick={() =>
              run(async () => {
                await updateChannel(channel.id, { bot_id: botId, channel_secret: secret.trim(), access_token: token.trim(), enabled, welcome });
                setSecret("");
                setToken("");
                onChanged();
              })
            }
          >
            {busy && <Loader2 size={15} className="animate-spin" />} {t("channels.line.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
