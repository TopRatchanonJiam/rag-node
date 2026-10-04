"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, MessageSquareText, Plus, Zap } from "lucide-react";
import { ChatSubNav } from "@/components/chat/ChatSubNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { QuickChatButton } from "@/components/chat/QuickChatButton";
import { BotSelector } from "@/components/bots/BotSelector";
import { BotSwitchButton } from "@/components/bots/BotSwitchButton";
import { listBots, streamChatWithBot } from "@/lib/api";
import type { ChatMessage, Chatbot } from "@/lib/types";

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function welcomeMessage(bot: Chatbot): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `สวัสดีครับ! ผมคือ ${bot.name} ${bot.description ? `— ${bot.description}` : ""} ลองถามอะไรก็ได้เลยครับ`,
  };
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const [bots, setBots] = useState<Chatbot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [messagesByBot, setMessagesByBot] = useState<Record<string, ChatMessage[]>>({});

  useEffect(() => {
    listBots()
      .then(({ bots }) => {
        setBots(bots);
        const requested = searchParams.get("bot");
        const initial = (requested && bots.find((b) => b.id === requested)?.id) || bots[0]?.id || null;
        setActiveBotId(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการ Chatbot ไม่สำเร็จ"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBot = bots.find((b) => b.id === activeBotId) ?? null;
  const messages = (activeBotId && messagesByBot[activeBotId]) || (activeBot ? [welcomeMessage(activeBot)] : []);

  async function handleSend(content: string, file: File | null) {
    if (!activeBotId) return;
    const botId = activeBotId;
    const userMessage: ChatMessage = { id: newId(), role: "user", content, attachmentName: file?.name };
    const assistantId = newId();
    const baseline = messages;

    // ใช้ functional update เสมอ (ไม่พึ่ง closure ของ `messages`) เพราะ event ของ stream
    // (chunk/status/done) ยิงเข้ามาถี่ๆ นอก React batching — ต้อง apply บน state ล่าสุดจริงๆ
    // ไม่งั้น chunk ที่มาไล่ๆ กันจะเขียนทับกันเอง (ตัวหลังชนะ ตัวก่อนหน้าหาย)
    function patchBotMessages(fn: (prev: ChatMessage[]) => ChatMessage[]) {
      setMessagesByBot((prev) => ({ ...prev, [botId]: fn(prev[botId] ?? baseline) }));
    }

    patchBotMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setIsTyping(true);

    try {
      await streamChatWithBot(botId, content, file, {
        onChunk: (text) =>
          patchBotMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: undefined } : m))
          ),
        onStatus: (text) =>
          patchBotMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: text } : m))),
        onDone: (meta) =>
          patchBotMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, streaming: false, status: undefined, usedSkill: meta.used_skill, export: meta.export }
                : m
            )
          ),
      });
    } catch (e) {
      const errText = `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${e instanceof Error ? e.message : "unknown error"}`;
      patchBotMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false, status: undefined, content: m.content || errText } : m
        )
      );
    } finally {
      setIsTyping(false);
    }
  }

  return (
    // ความสูงรวมทั้งหน้าต้องไม่เกิน viewport เพราะงั้นล็อกความสูงเป็น "viewport ลบ chrome คงที่"
    // (navbar 57px + main py-10 = 80px, ดู app/layout.tsx) แล้วให้ ChatWindow (flex-1) กินพื้นที่
    // ที่เหลือเองแบบ dynamic — ส่วนหัว (bot selector/quick chat) สูงเท่าไหร่ก็ไม่ล้นจอ เพราะ
    // ChatWindow หดให้พอดีเสมอ ไม่ใช้ h-[70vh] แบบเดิมที่กะจากสัดส่วนจอเฉย ๆ ไม่รู้จักความสูงจริง
    // ของส่วนอื่นบนหน้า (ใช้ 100dvh แทน 100vh กัน mobile browser bar บังคับ scroll ซ้อน)
    <div className="flex h-[calc(100dvh-137px)] min-h-0 flex-col gap-6">
      <div>
        <SectionHeading eyebrow="Chatbot System" title="AI Chatbot" />
        <ChatSubNav />
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : bots.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-slate-500">ยังไม่มี Chatbot ให้คุยด้วย — สร้างตัวแรกแล้วเลือก Knowledge Base ที่ต้องการ</p>
          <Link
            href="/chat/bots"
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={15} /> ไปสร้าง Chatbot
          </Link>
        </Card>
      ) : (
        <>
          {/* จอกว้าง (lg+): bot selector + quick chat เป็นแถวแยกเหนือ ChatWindow มีที่เหลือเฟือ */}
          <div className="hidden lg:flex lg:flex-col lg:gap-6">
            <BotSelector bots={bots} activeBotId={activeBotId} onSelect={setActiveBotId} />
            {activeBot?.quick_chat_enabled && activeBot.quick_chat_tags.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Zap size={12} /> กดเพื่อถามได้เลย
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {activeBot.quick_chat_tags.map((tag, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSend(tag, null)}
                      disabled={isTyping}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
                    >
                      <MessageSquareText size={12} />
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* จอแคบ: ปุ่มลอยมุมขวาบนของ ChatWindow เอง (ดู headerActions) กันกินพื้นที่แนวตั้งถาวร */}
          <ChatWindow
            messages={messages}
            isTyping={isTyping}
            onSend={handleSend}
            headerActions={
              <>
                <BotSwitchButton bots={bots} activeBotId={activeBotId} onSelect={setActiveBotId} />
                {activeBot?.quick_chat_enabled && activeBot.quick_chat_tags.length > 0 && (
                  <QuickChatButton
                    tags={activeBot.quick_chat_tags}
                    onPick={(tag) => handleSend(tag, null)}
                    disabled={isTyping}
                  />
                )}
              </>
            }
          />
        </>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400">กำลังโหลด...</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
