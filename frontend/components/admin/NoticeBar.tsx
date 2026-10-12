"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getAlerts, getNotice, type AdminAlert, type Notice } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ปุ่มพาไปหน้าที่แก้ปัญหาได้ ของแต่ละรหัสเตือน
const ALERT_LINK: Record<AdminAlert["code"], { href: string; label: string }> = {
  source_held: { href: "/admin/knowledge/", label: "notice.alerts.open_kb" },
  source_error: { href: "/admin/knowledge/", label: "notice.alerts.open_kb" },
  ai_quota: { href: "/admin/settings/", label: "notice.alerts.open_settings" },
  ai_key: { href: "/admin/settings/", label: "notice.alerts.open_settings" },
  line_error: { href: "/admin/channels/", label: "notice.alerts.open_channels" },
};

// แถบแจ้งเตือนบนทุกหน้าหลังบ้าน:
// - Free Beta ใกล้จบ (มีวันที่) / จบแล้ว — ข้อมูลจาก central ผ่าน /api/admin/notice
// - เรื่องที่ทำให้บอทตอบผิด/ไม่ตอบโดยเจ้าของไม่รู้ตัว (ข้อมูลสดถูกพัก/ดึงไม่ได้, AI key หมดโควตา/ผิด) — /api/admin/alerts
export function NoticeBar() {
  const { t, locale } = useI18n();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);

  useEffect(() => {
    getNotice()
      .then((r) => setNotice(r.notice))
      .catch(() => undefined);
    getAlerts()
      .then((r) => setAlerts(r.alerts))
      .catch(() => undefined);
  }, []);

  const ended = notice?.code === "beta_ended";
  const date = notice?.ends_at
    ? new Date(notice.ends_at).toLocaleDateString(
        { th: "th-TH", ja: "ja-JP", zh: "zh-CN" }[locale as string] ?? "en-US",
        { dateStyle: "long" },
      )
    : "";
  return (
    <>
      {notice && (
        <div
          role="status"
          className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ring-inset ${
            ended ? "bg-rose-50 text-rose-900 ring-rose-200" : "bg-amber-50 text-amber-900 ring-amber-200"
          }`}
        >
          <AlertTriangle size={16} className="shrink-0" />
          <p className="min-w-0 flex-1">{ended ? t("notice.beta_ended") : t("notice.beta_ending", { date })}</p>
          <Link href="/admin/" className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-soft ring-1 ring-inset ring-black/5">
            {t("notice.renew")}
          </Link>
        </div>
      )}
      {alerts.map((a, i) => (
        <div
          key={`${a.code}-${a.name}-${i}`}
          role="alert"
          className={`mb-3 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ring-inset ${
            a.code === "source_held" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-rose-50 text-rose-900 ring-rose-200"
          }`}
        >
          <AlertTriangle size={16} className="shrink-0" />
          <p className="min-w-0 flex-1">{t(`notice.alerts.${a.code}`, { name: a.name, detail: a.detail ?? "" })}</p>
          <Link
            href={ALERT_LINK[a.code].href}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-soft ring-1 ring-inset ring-black/5"
          >
            {t(ALERT_LINK[a.code].label)}
          </Link>
        </div>
      ))}
    </>
  );
}
