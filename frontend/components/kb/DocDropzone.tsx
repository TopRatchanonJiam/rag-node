"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";

const DEFAULT_ACCEPTED_EXT = [".pdf", ".txt", ".docx", ".csv", ".xlsx"];

export function DocDropzone({
  onFileSelected,
  disabled,
  acceptedExt = DEFAULT_ACCEPTED_EXT,
}: {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  acceptedExt?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (!acceptedExt.includes(ext)) {
        alert(`รองรับเฉพาะไฟล์ ${acceptedExt.join(", ")}`);
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected, acceptedExt]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptedExt.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <FileUp className="mb-2 text-slate-400" size={24} />
      <p className="text-sm font-medium text-slate-700">ลากไฟล์มาวาง หรือคลิกเพื่ออัปโหลด</p>
      <p className="mt-1 text-xs text-slate-400">{acceptedExt.join(", ")}</p>
    </div>
  );
}
