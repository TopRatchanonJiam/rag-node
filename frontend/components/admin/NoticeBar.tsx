"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getNotice, type Notice } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// แถบแจ้งเตือนบนทุกหน้าหลังบ้าน: Free Beta ใกล้จบ (มีวันที่) / จบแล้ว — ข้อมูลจาก central ผ่าน /api/admin/notice
export function NoticeBar() {
  const { t, locale } = useI18n();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    getNotice()
      .then((r) => setNotice(r.notice))
      .catch(() => undefined);
  }, []);

  if (!notice) return null;
  const ended = notice.code === "beta_ended";
  const date = notice.ends_at
    ? new Date(notice.ends_at).toLocaleDateString(
        { th: "th-TH", ja: "ja-JP", zh: "zh-CN" }[locale as string] ?? "en-US",
        { dateStyle: "long" },
      )
    : "";
  return (
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
  );
}
