import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

// ฝังไฟล์ฟอนต์ตอน build (ไม่โหลดจาก Google ตอนใช้งาน) — ใช้ได้แม้เครื่องลูกค้าไม่ต่ออินเทอร์เน็ต
const plex = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Chatbot",
  description: "ถาม-ตอบจากเอกสารขององค์กร",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={plex.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
