"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bot, Database, LayoutDashboard, MessageSquareText, PlugZap, Sigma } from "lucide-react";

// เมนูหลังบ้านแบ่ง 2 กลุ่มตามหน้าที่: งานของ "คนดูแลความรู้" (เนื้อหา/บอท) กับงานของ "คนดูแลระบบ"
// (การเชื่อมต่อ AI/key) — ให้มอบหมายงานแยกคนได้ และไม่หลงไปแก้ key ระหว่างอัปโหลดเอกสาร
const GROUPS = [
  {
    label: "",
    eyebrow: "Overview",
    items: [{ href: "/admin", label: "ภาพรวม", icon: LayoutDashboard }],
  },
  {
    label: "จัดการความรู้",
    eyebrow: "Knowledge",
    items: [
      { href: "/admin/knowledge", label: "คลังความรู้ (KB)", icon: Database },
      { href: "/admin/skills", label: "ชุดสูตร", icon: Sigma },
      { href: "/admin/bots", label: "Chatbots", icon: Bot },
    ],
  },
  {
    label: "ระบบ",
    eyebrow: "System",
    items: [{ href: "/admin/settings", label: "การเชื่อมต่อ AI", icon: PlugZap }],
  },
];

function isActive(pathname: string, href: string) {
  const p = pathname.replace(/\/$/, "") || "/";
  return href === "/admin" ? p === "/admin" : p === href || p.startsWith(`${href}/`);
}

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/1n9-icon.svg" alt="1n9 AI" width={32} height={32} className="h-8 w-8 shrink-0 drop-shadow-sm" />
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  return (
    <div className="min-h-full lg:flex">
      {/* แถบข้างลอย (จอกว้าง) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 p-3 lg:block">
        <div className="flex h-full flex-col rounded-2xl bg-white/75 shadow-float ring-1 ring-white backdrop-blur-xl">
          <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
            <Logo />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-accent-900">หลังบ้าน</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-accent-400">1n9 AI · Console</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-3">
            {GROUPS.map((g) => (
              <div key={g.eyebrow} className="flex flex-col gap-1">
                {g.label && <p className="eyebrow px-3 pb-1.5">{g.eyebrow}</p>}
                {g.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={`${item.href}/`}
                      className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all ${
                        active
                          ? "bg-ink bg-ink-grad font-medium text-white shadow-ink"
                          : "text-accent-600 hover:bg-white hover:text-accent-900 hover:shadow-soft"
                      }`}
                    >
                      <Icon size={16} className={active ? "text-brand-300" : "text-accent-400 group-hover:text-accent-700"} />
                      <span className="flex-1">{item.label}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-azure-grad shadow-glow" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="p-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-xl bg-accent-100/70 px-3 py-2.5 text-sm font-medium text-accent-700 transition-colors hover:bg-gradient-to-r hover:from-brand-50 hover:to-white hover:text-brand-700"
            >
              <MessageSquareText size={16} className="text-brand-600" />
              เปิดหน้าแชท
            </Link>
          </div>
        </div>
      </aside>

      {/* แถบบน (จอแคบ) */}
      <div className="sticky top-0 z-30 border-b border-white/70 bg-white/75 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Logo /> หลังบ้าน
          </span>
          <Link href="/" className="text-xs font-medium text-brand-700">
            เปิดหน้าแชท
          </Link>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">
          {GROUPS.flatMap((g) => g.items).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={`${item.href}/`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-ink bg-ink-grad text-white" : "bg-white text-accent-600 ring-1 ring-accent-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const pathname = usePathname() || "/";
  const group = GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)));
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {group && (
          <p className="eyebrow mb-2.5 flex items-center gap-2.5">
            <span className="h-[3px] w-6 rounded-full bg-azure-grad" />
            {group.eyebrow}
          </p>
        )}
        <h1 className="title-grad text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm font-light leading-relaxed text-accent-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusPill({ ok, okText = "ใช้งานได้", failText = "มีปัญหา" }: { ok?: boolean | null; okText?: string; failText?: string }) {
  if (ok === undefined || ok === null) {
    return <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-500">ยังไม่ได้ตรวจ</span>;
  }
  return ok ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">{okText}</span>
  ) : (
    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">{failText}</span>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{message}</p>;
}
