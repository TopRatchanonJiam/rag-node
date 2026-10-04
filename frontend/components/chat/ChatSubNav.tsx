"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareText, Bot, Database, Sigma } from "lucide-react";

const TABS = [
  { href: "/chat", label: "Chat", icon: MessageSquareText },
  { href: "/chat/bots", label: "Chatbots", icon: Bot },
  { href: "/chat/knowledge-bases", label: "Knowledge Bases", icon: Database },
  { href: "/chat/skills", label: "Skills", icon: Sigma },
];

export function ChatSubNav() {
  // static export ใช้ trailingSlash — ตัด "/" ท้ายออกก่อนเทียบ
  const pathname = (usePathname() || "").replace(/\/$/, "") || "/";

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}/`}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Icon size={14} />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
