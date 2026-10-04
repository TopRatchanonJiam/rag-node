import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Chatbot",
  description: "RAG Chatbot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        {/* แถบบนสูง 57px คงที่ — หน้าแชทคำนวณความสูงจากค่านี้ (ดู app/chat/page.tsx) */}
        <header className="sticky top-0 z-50 h-[57px] border-b border-slate-200 bg-white/80 shadow-soft backdrop-blur">
          <div className="mx-auto flex h-full max-w-6xl items-center px-4 sm:px-6">
            <Link href="/chat/" className="text-lg font-bold tracking-tight text-slate-900">
              AI <span className="text-accent-600">Chatbot</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto min-h-[calc(100vh-57px)] max-w-6xl px-4 py-10 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
