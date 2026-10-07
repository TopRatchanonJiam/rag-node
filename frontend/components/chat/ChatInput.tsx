"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Paperclip, Send, X } from "lucide-react";

const ALLOWED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — จำกัดให้เบา (ระบบ demo)

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string, file: File | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, file);
    setValue("");
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;

    if (!ALLOWED_FILE_TYPES.includes(picked.type)) {
      setFileError("รองรับเฉพาะไฟล์รูปภาพ JPEG/PNG/WEBP หรือ PDF เท่านั้น");
      setFile(null);
      return;
    }
    if (picked.size > MAX_FILE_SIZE) {
      setFileError(`ไฟล์ใหญ่เกินไป (จำกัด ${MAX_FILE_SIZE / (1024 * 1024)}MB)`);
      setFile(null);
      return;
    }

    setFileError(null);
    setFile(picked);
  }

  function removeFile() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2 bg-white p-3">
      {(file || fileError) && (
        <div className="flex items-center gap-2 text-xs">
          {file && (
            <span className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              <Paperclip size={11} /> {file.name}
              <button type="button" onClick={removeFile} aria-label="เอาไฟล์แนบออก" className="text-brand-500 hover:text-brand-800">
                <X size={12} />
              </button>
            </span>
          )}
          {fileError && <span className="text-rose-600">{fileError}</span>}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_FILE_TYPES.join(",")}
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
          aria-label="แนบไฟล์รูปภาพหรือ PDF"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="พิมพ์คำถาม... (Enter เพื่อส่ง)"
          className="max-h-32 flex-1 resize-none rounded-xl border border-accent-200 bg-accent-50/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-400/15 disabled:bg-slate-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-brand-300 shadow-ink transition-all hover:shadow-glow disabled:bg-accent-200 disabled:text-white disabled:shadow-none"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
