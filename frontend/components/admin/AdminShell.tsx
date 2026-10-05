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
    items: [{ href: "/admin", label: "ภาพรวม", icon: LayoutDashboard }],
  },
  {
    label: "จัดการความรู้",
    items: [
      { href: "/admin/knowledge", label: "คลังความรู้ (KB)", icon: Database },
      { href: "/admin/skills", label: "ชุดสูตร", icon: Sigma },
      { href: "/admin/bots", label: "Chatbots", icon: Bot },
    ],
  },
  {
    label: "ระบบ",
    items: [{ href: "/admin/settings", label: "การเชื่อมต่อ AI", icon: PlugZap }],
  },
];

function isActive(pathname: string, href: string) {
  const p = pathname.replace(/\/$/, "") || "/";
  return href === "/admin" ? p === "/admin" : p === href || p.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  return (
    <div className="min-h-full lg:flex">
      {/* แถบข้าง (จอกว้าง) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-accent-200 bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-accent-100 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Bot size={15} />
          </span>
          <span className="text-sm font-semibold text-accent-900">หลังบ้าน</span>
        </div>
        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
          {GROUPS.map((g) => (
            <div key={g.label || "top"} className="flex flex-col gap-0.5">
              {g.label && (
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-400">{g.label}</p>
              )}
              {g.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={`${item.href}/`}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-accent-600 hover:bg-accent-50 hover:text-accent-900"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-brand-600" : "text-accent-400"} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-accent-100 p-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-accent-600 hover:bg-accent-50 hover:text-accent-900"
          >
            <MessageSquareText size={16} className="text-accent-400" />
            เปิดหน้าแชท
          </Link>
        </div>
      </aside>

      {/* แถบบน (จอแคบ) */}
      <div className="sticky top-0 z-30 border-b border-accent-200 bg-white lg:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <span className="text-sm font-semibold">หลังบ้าน</span>
          <Link href="/" className="text-xs font-medium text-brand-700">
            เปิดหน้าแชท
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {GROUPS.flatMap((g) => g.items).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={`${item.href}/`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-brand-600 text-white" : "bg-accent-100 text-accent-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-accent-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-accent-500">{description}</p>}
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
    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">{okText}</span>
  ) : (
    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">{failText}</span>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{message}</p>;
}
