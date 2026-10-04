"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChatBubble } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import type { ChatMessage } from "@/lib/types";

export function ChatWindow({
  messages,
  isTyping,
  onSend,
  headerActions,
}: {
  messages: ChatMessage[];
  isTyping: boolean;
  onSend: (message: string, file: File | null) => void;
  // ปุ่มลอยมุมขวาบน (สลับบอท/quick chat) — โชว์เฉพาะจอแคบเพราะจอกว้างมีแถวแยกอยู่แล้วเหนือ ChatWindow
  headerActions?: ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className="relative flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-soft">
      {headerActions && <div className="absolute right-3 top-3 z-10 flex gap-2 lg:hidden">{headerActions}</div>}
      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={onSend} disabled={isTyping} />
    </div>
  );
}
