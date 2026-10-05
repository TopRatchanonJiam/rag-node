"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Database, Loader2, PlugZap, RefreshCw, Sigma } from "lucide-react";
import { ErrorNote, PageHeader, StatusPill } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/Button";
import { getAdminStatus, runFullCheck } from "@/lib/api";
import type { AdminStatus, CheckItem, CheckResult } from "@/lib/types";

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google Gemini",
  ollama: "Ollama",
  openai_compatible: "OpenAI-compatible",
};

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-accent-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-accent-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-accent-500">{label}</span>
      <span className="min-w-0 text-right text-accent-900">{children}</span>
    </div>
  );
}

function Stat({ label, value, href, icon }: { label: string; value: number; href: string; icon: ReactNode }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-accent-200 bg-white p-4 transition-colors hover:border-brand-300">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span className="flex-1">
        <span className="block text-2xl font-semibold tabular-nums text-accent-900">{value.toLocaleString()}</span>
        <span className="text-xs text-accent-500">{label}</span>
      </span>
      <ArrowRight size={15} className="text-accent-300 transition-colors group-hover:text-brand-600" />
    </Link>
  );
}

function checkText(item?: CheckItem) {
  if (!item) return "—";
  if (item.ok) return item.dim ? `ใช้ได้ (${item.dim} มิติ)` : "ใช้ได้";
  if (item.ok === null || item.ok === undefined) return String(item.message ?? "ไม่ได้ตั้งค่า");
  return String(item.message ?? item.error_code ?? "ใช้ไม่ได้");
}

export default function AdminOverviewPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดสถานะไม่สำเร็จ"));
  }, []);

  async function handleCheck() {
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

  if (!status) {
    return error ? <ErrorNote message={error} /> : (
      <div className="flex items-center gap-2 text-sm text-accent-400"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>
    );
  }

  const u = status.usage;
  const lic = status.license;

  return (
    <div>
      <PageHeader title="ภาพรวม" description="สถานะการเชื่อมต่อ ข้อมูลในระบบ และการใช้งาน AI ที่ผ่านเครื่องนี้" />
      <ErrorNote message={error} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="คลังความรู้ (KB)" value={status.counts.kbs} href="/admin/knowledge/" icon={<Database size={18} />} />
        <Stat label="Chatbots" value={status.counts.bots} href="/admin/bots/" icon={<Bot size={18} />} />
        <Stat label="ชุดสูตร" value={status.counts.skills} href="/admin/skills/" icon={<Sigma size={18} />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="การเชื่อมต่อ"
          action={
            <Button variant="secondary" onClick={handleCheck} disabled={checking} className="px-3 py-1.5 text-xs">
              {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} ตรวจทุกส่วน
            </Button>
          }
        >
          <Row label="central">
            <span className="flex items-center justify-end gap-2">
              <span className="truncate font-mono text-xs text-accent-500">{status.central.url}</span>
              <StatusPill ok={status.central.ok} okText="ออนไลน์" failText="ติดต่อไม่ได้" />
            </span>
          </Row>
          <Row label="license">
            {lic?.ok ? (
              <span className="flex items-center justify-end gap-2">
                {lic.valid_until && (
                  <span className="text-xs text-accent-500">ถึง {new Date(lic.valid_until).toLocaleDateString("th-TH", { dateStyle: "medium" })}</span>
                )}
                <StatusPill ok okText={lic.status ?? "active"} />
              </span>
            ) : (
              <span className="text-xs text-rose-700">{String(lic?.message ?? "—")}</span>
            )}
          </Row>
          {lic?.warnings?.map((w) => (
            <p key={w.code} className="mt-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">{w.message}</p>
          ))}
          {check && (
            <div className="mt-3 border-t border-accent-100 pt-2">
              {(["llm", "embedding", "vector", "rerank"] as const).map((k) => (
                <Row key={k} label={{ llm: "LLM", embedding: "Embedding", vector: "Qdrant", rerank: "Rerank" }[k]}>
                  <span className={check[k]?.ok === false ? "text-xs text-rose-700" : "text-xs text-accent-700"}>{checkText(check[k])}</span>
                </Row>
              ))}
            </div>
          )}
          {!status.central.ok && (
            <p className="mt-2 text-xs text-rose-700">{String(status.central.message ?? "")}</p>
          )}
        </Panel>

        <Panel
          title="โมเดลที่ใช้อยู่"
          action={
            <Link href="/admin/settings/" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <PlugZap size={13} /> แก้ไข
            </Link>
          }
        >
          <Row label="LLM">
            {PROVIDER_LABEL[status.models.llm.provider] ?? status.models.llm.provider} · <span className="font-mono text-xs">{status.models.llm.model}</span>
          </Row>
          <Row label="Embedding">
            <span className="font-mono text-xs">{status.models.embedding.model}</span> · {status.models.embedding.dim} มิติ
          </Row>
          <Row label="Rerank">{status.models.rerank ? "เปิด" : "ปิด"}</Row>
          <Row label="เอกสารทั้งหมด">
            {status.counts.files.toLocaleString()} ไฟล์ · {status.counts.chunks.toLocaleString()} chunks
          </Row>
        </Panel>

        <Panel title="การใช้งาน AI (สะสมที่เครื่องนี้)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["คำขอ", u.requests],
              ["เรียก LLM", u.llm_calls],
              ["token เข้า", u.llm_input_tokens],
              ["token ออก", u.llm_output_tokens],
              ["embedding token", u.embed_tokens],
              ["เรียก embedding", u.embed_calls],
              ["เรียก rerank", u.rerank_calls],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-accent-50 px-3 py-2.5">
                <p className="text-lg font-semibold tabular-nums text-accent-900">{(value as number).toLocaleString()}</p>
                <p className="text-xs text-accent-500">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-accent-400">ค่าใช้จ่ายจริงดูได้ที่หน้า billing ของผู้ให้บริการ AI แต่ละเจ้า</p>
        </Panel>
      </div>
    </div>
  );
}
