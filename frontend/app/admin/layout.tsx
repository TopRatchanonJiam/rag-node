import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { I18nProvider } from "@/lib/i18n";

export const metadata: Metadata = { title: "หลังบ้าน — AI Assistant" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AdminShell>{children}</AdminShell>
    </I18nProvider>
  );
}
