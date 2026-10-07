"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, ChevronDown, Loader2, MessageSquareText, Settings2, Sparkles } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { listBots, streamChatWithBot } from "@/lib/api";
import type { ChatMessage, Chatbot } from "@/lib/types";

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function BotPicker({ bots, activeId, onSelect }: { bots: Chatbot[]; activeId: string | null; onSelect: (id: string) => void }) {
  const active = bots.find((b) => b.id === activeId);
  if (bots.length <= 1) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-accent-900">
        <span className="truncate">{active?.name ?? "AI Chatbot"}</span>
      </span>
    );
  }
  return (
    <div className="relative min-w-0">
      <select
        value={activeId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="เลือกบอท"
        className="w-full max-w-[16rem] appearance-none truncate rounded-lg border border-transparent bg-transparent py-1.5 pl-2 pr-7 text-sm font-semibold text-accent-900 hover:border-accent-200 focus:border-brand-500 focus:outline-none"
      >
        {bots.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-accent-400" />
    </div>
  );
}

function EmptyState({ bot, onPick, disabled }: { bot: Chatbot; onPick: (q: string) => void; disabled: boolean }) {
  const tags = bot.quick_chat_enabled ? bot.quick_chat_tags : [];
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <p className="eyebrow mb-5">AI Assistant</p>
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-brand-300 shadow-ink">
        <Sparkles size={22} />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-accent-900">{bot.name}</h1>
      <p className="mt-2 max-w-md text-sm font-light leading-relaxed text-accent-500">
        {bot.description || "ถามอะไรก็ได้เกี่ยวกับเอกสารขององค์กร บอทจะตอบจากข้อมูลที่มีอยู่"}
      </p>
      {tags.length > 0 && (
        <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {tags.map((t, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onPick(t)}
              className="flex items-start gap-2 rounded-xl bg-white/80 px-3.5 py-3 text-left text-sm text-accent-700 shadow-soft ring-1 ring-accent-200/60 transition-all hover:-translate-y-0.5 hover:shadow-float hover:ring-brand-200 disabled:opacity-50"
            >
              <MessageSquareText size={15} className="mt-0.5 shrink-0 text-brand-600" />
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatApp() {
  const searchParams = useSearchParams();
  const [bots, setBots] = useState<Chatbot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [messagesByBot, setMessagesByBot] = useState<Record<string, ChatMessage[]>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listBots()
      .then(({ bots }) => {
        setBots(bots);
        const requested = searchParams.get("bot");
        setActiveBotId((requested && bots.find((b) => b.id === requested)?.id) || bots[0]?.id || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการบอทไม่สำเร็จ"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBot = bots.find((b) => b.id === activeBotId) ?? null;
  const messages = (activeBotId && messagesByBot[activeBotId]) || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  async function handleSend(content: string, file: File | null) {
    if (!activeBotId) return;
    const botId = activeBotId;
    const assistantId = newId();
    const baseline = messages;

    // functional update เสมอ — event ของ stream เข้ามาถี่ ต้อง apply บน state ล่าสุดจริง
    function patch(fn: (prev: ChatMessage[]) => ChatMessage[]) {
      setMessagesByBot((prev) => ({ ...prev, [botId]: fn(prev[botId] ?? baseline) }));
    }

    patch((prev) => [
      ...prev,
      { id: newId(), role: "user", content, attachmentName: file?.name },
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setIsTyping(true);

    try {
      await streamChatWithBot(botId, content, file, {
        onChunk: (text) => patch((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: undefined } : m))),
        onStatus: (text) => patch((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: text } : m))),
        onDone: (meta) =>
          patch((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, streaming: false, status: undefined, usedSkill: meta.used_skill, export: meta.export } : m))
          ),
      });
    } catch (e) {
      const errText = `เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : "unknown error"}`;
      patch((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false, status: undefined, content: m.content || errText } : m)));
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/70 bg-white/70 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink text-brand-300 shadow-ink">
            <Bot size={16} />
          </span>
          <BotPicker bots={bots} activeId={activeBotId} onSelect={setActiveBotId} />
        </div>
        <Link
          href="/admin/"
          aria-label="หลังบ้าน"
          title="หลังบ้าน"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-accent-400 transition-colors hover:bg-accent-100 hover:text-accent-700"
        >
          <Settings2 size={17} />
        </Link>
      </header>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
          {loading ? (
            <div className="m-auto flex items-center gap-2 text-sm text-accent-400"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>
          ) : error ? (
            <p className="m-auto rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
          ) : !activeBot ? (
            <div className="m-auto max-w-sm text-center">
              <p className="text-sm text-accent-500">ยังไม่มีบอทให้ใช้งาน</p>
              <Link href="/admin/bots/" className="mt-3 inline-block rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white shadow-ink hover:shadow-glow">
                ไปสร้างบอทในหลังบ้าน
              </Link>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState bot={activeBot} onPick={(q) => handleSend(q, null)} disabled={isTyping} />
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {activeBot && (
        <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-5">
          <div className="surface mx-auto w-full max-w-3xl overflow-hidden">
            {messages.length > 0 && activeBot.quick_chat_enabled && activeBot.quick_chat_tags.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto px-4 pt-3">
                {activeBot.quick_chat_tags.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={isTyping}
                    onClick={() => handleSend(t, null)}
                    className="shrink-0 rounded-full bg-accent-100/80 px-3 py-1 text-xs text-accent-700 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <ChatInput onSend={handleSend} disabled={isTyping} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatApp />
    </Suspense>
  );
}
