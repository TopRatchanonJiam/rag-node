import { Bot, Download, FileText, Paperclip, Sigma, User } from "lucide-react";
import { API_BASE } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-accent-200 text-accent-700" : "bg-ink bg-ink-grad text-brand-300 shadow-ink"
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      <div className={`flex max-w-[75%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {message.usedSkill && (
          <span className="flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
            <Sigma size={10} /> คำนวณจากสูตร
          </span>
        )}
        {message.attachmentName && (
          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            <Paperclip size={10} /> {message.attachmentName}
          </span>
        )}
        {message.streaming && message.status && (
          <span className="italic text-[11px] text-slate-400">{message.status}</span>
        )}
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-soft ${
            isUser ? "rounded-tr-sm bg-brand-600 bg-brand-grad text-white shadow-brand" : "rounded-tl-sm bg-white text-accent-800 ring-1 ring-accent-200/60"
          } ${message.pending ? "italic text-slate-400" : ""}`}
        >
          {message.streaming && !message.content ? (
            <span className="flex items-center gap-1 py-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </span>
          ) : (
            <>
              {message.content}
              {message.streaming && <span className="animate-pulse text-slate-400">▍</span>}
            </>
          )}
        </div>

        {message.export && (
          <a
            href={`${API_BASE}${message.export.download_url}`}
            className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-soft transition-colors hover:bg-slate-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <FileText size={15} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-slate-800">{message.export.filename}</span>
              <span className="text-xs uppercase text-slate-400">{message.export.format}</span>
            </span>
            <Download size={15} className="ml-2 shrink-0 text-slate-400" />
          </a>
        )}
      </div>
    </div>
  );
}
