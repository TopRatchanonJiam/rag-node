"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getBillingStatus, openBillingPortal, startCheckout, type BillingPrice, type BillingStatus } from "@/lib/api";

function money(p: BillingPrice, divide = 1) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: 2 }).format(
    p.amount / 100 / divide,
  );
}

const PLAN_LABEL: Record<string, string> = { business_monthly: "รายเดือน", business_yearly: "รายปี" };

// แพ็กเกจ/ชำระเงิน — ราคามาจาก Stripe ผ่าน central (ไม่ฝังในหน้า) · central ไม่เปิดระบบชำระเงิน = ไม่แสดงอะไร
export function PlanCard({ onActivated }: { onActivated: () => void }) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("billing");
    if (result) window.history.replaceState(null, "", window.location.pathname);

    async function load() {
      const b = await getBillingStatus().catch(() => null);
      if (alive) setBilling(b);
      return b;
    }

    if (result === "cancel") setNote({ ok: false, text: "ยกเลิกการชำระเงินแล้ว — ยังไม่มีการตัดเงิน" });
    if (result === "success") {
      // webhook ของ Stripe มาถึง central ช้ากว่าการพากลับหน้านี้เล็กน้อย — รอจนสิทธิ์เปิดจริง
      setNote({ ok: true, text: "ชำระเงินสำเร็จ — กำลังเปิดสิทธิ์การใช้งาน..." });
      (async () => {
        for (let i = 0; i < 15 && alive; i++) {
          const b = await load();
          if (b?.subscription_live) {
            setNote({ ok: true, text: "เปิดสิทธิ์แล้ว — ใช้ license เดิมต่อได้ทันที ไม่ต้องตั้งค่าใหม่" });
            onActivated();
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (alive) setNote({ ok: false, text: "ได้รับเงินแล้วแต่สิทธิ์ยังไม่อัปเดต — รอสักครู่แล้วรีเฟรชหน้า" });
      })();
    } else {
      load();
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(kind: "month" | "year" | "portal") {
    setBusy(kind);
    setNote(null);
    const returnUrl = `${window.location.origin}/admin/`;
    try {
      const { url } = kind === "portal" ? await openBillingPortal(returnUrl) : await startCheckout(kind, returnUrl);
      window.location.href = url;
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "เปิดหน้าชำระเงินไม่สำเร็จ" });
      setBusy(null);
    }
  }

  if (!billing?.enabled) return null;
  const month = billing.prices?.month;
  const year = billing.prices?.year;

  return (
    <div className="mt-3 border-t border-accent-100 pt-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent-900">
        <CreditCard size={15} className="text-brand-600" /> แพ็กเกจ
      </div>

      {billing.subscription_live ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-accent-600">
            Business {PLAN_LABEL[billing.plan ?? ""] ?? ""} · ต่ออายุอัตโนมัติ
            {billing.billing_status === "payment_failed" || billing.billing_status === "past_due" ? (
              <span className="ml-1 font-medium text-rose-700">— ตัดบัตรไม่ผ่าน กรุณาอัปเดตบัตร</span>
            ) : null}
          </p>
          <Button variant="secondary" onClick={() => go("portal")} disabled={!!busy} className="px-3 py-1.5 text-xs">
            {busy === "portal" ? <Loader2 size={13} className="animate-spin" /> : <Settings2 size={13} />} จัดการการชำระเงิน
          </Button>
        </div>
      ) : month || year ? (
        <>
          <p className="mb-2 text-xs text-accent-500">
            {billing.license_type === "demo" ? "สมัครแล้วใช้ license เดิมต่อได้ทันที ข้อมูลและการตั้งค่าอยู่ครบ" : "ต่ออายุด้วยการสมัครแพ็กเกจ — ตัดเงินอัตโนมัติทุกรอบ ยกเลิกเมื่อไรก็ได้"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {month && (
              <button
                type="button"
                onClick={() => go("month")}
                disabled={!!busy}
                className="rounded-xl p-3 text-left ring-1 ring-accent-200 transition-all hover:ring-brand-300 disabled:opacity-60"
              >
                <span className="block text-xs text-accent-500">รายเดือน</span>
                <span className="text-lg font-semibold text-accent-900">{money(month)}</span>
                <span className="text-xs text-accent-500"> / เดือน</span>
                {busy === "month" && <Loader2 size={13} className="ml-2 inline animate-spin" />}
              </button>
            )}
            {year && (
              <button
                type="button"
                onClick={() => go("year")}
                disabled={!!busy}
                className="rounded-xl p-3 text-left ring-2 ring-brand-300 transition-all hover:ring-brand-500 disabled:opacity-60"
              >
                <span className="block text-xs text-accent-500">รายปี · คุ้มกว่า</span>
                <span className="text-lg font-semibold text-accent-900">{money(year, 12)}</span>
                <span className="text-xs text-accent-500"> / เดือน</span>
                <span className="block text-[11px] text-accent-400">เรียกเก็บ {money(year)} ต่อปี</span>
                {busy === "year" && <Loader2 size={13} className="ml-2 inline animate-spin" />}
              </button>
            )}
          </div>
          {billing.has_subscription && (
            <button type="button" onClick={() => go("portal")} disabled={!!busy} className="mt-2 text-xs text-accent-500 underline hover:text-accent-800">
              ดูใบเสร็จเก่า / จัดการการชำระเงิน
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-accent-400">ยังไม่ได้ตั้งราคาในระบบชำระเงิน — ติดต่อผู้ให้บริการ</p>
      )}

      {note && (
        <p className={`mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {note.ok && <CheckCircle2 size={14} className="mt-px shrink-0" />}
          {note.text}
        </p>
      )}
    </div>
  );
}
