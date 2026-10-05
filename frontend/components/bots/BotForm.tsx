"use client";

import { useState, type KeyboardEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { KnowledgeBase, RegistryModel, SkillSet } from "@/lib/types";

export const QUICK_CHAT_MAX_TAGS = 5;
export const QUICK_CHAT_MAX_TAG_LENGTH = 100;

export interface BotFormValues {
  name: string;
  description: string;
  kb_ids: string[];
  skill_set_ids: string[];
  system_prompt: string;
  use_rerank: boolean;
  quick_chat_enabled: boolean;
  quick_chat_tags: string[];
  llm_model_id: string;
  rerank_model_id: string;
}

export function BotForm({
  knowledgeBases,
  skillSets,
  models = [],
  initial,
  submitLabel,
  onSubmit,
}: {
  knowledgeBases: KnowledgeBase[];
  skillSets: SkillSet[];
  models?: RegistryModel[];
  initial?: Partial<BotFormValues>;
  submitLabel: string;
  onSubmit: (values: BotFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kbIds, setKbIds] = useState<string[]>(initial?.kb_ids ?? []);
  const [skillSetIds, setSkillSetIds] = useState<string[]>(initial?.skill_set_ids ?? []);
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [useRerank, setUseRerank] = useState(initial?.use_rerank ?? false);
  const [quickChatEnabled, setQuickChatEnabled] = useState(initial?.quick_chat_enabled ?? false);
  const [quickChatTags, setQuickChatTags] = useState<string[]>(initial?.quick_chat_tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [llmModelId, setLlmModelId] = useState(initial?.llm_model_id ?? "");
  const [rerankModelId, setRerankModelId] = useState(initial?.rerank_model_id ?? "");
  const llms = models.filter((m) => m.kind === "llm");
  const reranks = models.filter((m) => m.kind === "rerank");
  const defaultLlm = llms.find((m) => m.is_default);
  const defaultRerank = reranks.find((m) => m.is_default);
  const [submitting, setSubmitting] = useState(false);

  function toggleKb(id: string) {
    setKbIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));
  }

  function toggleSkillSet(id: string) {
    setSkillSetIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));
  }

  function addTag() {
    const trimmed = tagInput.trim();
    if (!trimmed || quickChatTags.length >= QUICK_CHAT_MAX_TAGS) return;
    setQuickChatTags((prev) => [...prev, trimmed.slice(0, QUICK_CHAT_MAX_TAG_LENGTH)]);
    setTagInput("");
  }

  function removeTag(index: number) {
    setQuickChatTags((prev) => prev.filter((_, i) => i !== index));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        kb_ids: kbIds,
        skill_set_ids: skillSetIds,
        system_prompt: systemPrompt.trim(),
        use_rerank: useRerank,
        quick_chat_enabled: quickChatEnabled,
        quick_chat_tags: quickChatTags,
        llm_model_id: llmModelId,
        rerank_model_id: rerankModelId,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อ Chatbot</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น HR Policy Bot"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">คำอธิบาย (ไม่บังคับ)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Knowledge Base ที่ใช้ดึงข้อมูล (เลือกได้หลายรายการ)
        </label>
        {knowledgeBases.length === 0 ? (
          <p className="text-xs text-slate-400">ยังไม่มี Knowledge Base — ไปสร้างที่แท็บ Knowledge Bases ก่อน</p>
        ) : (
          <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {knowledgeBases.map((kb) => (
              <label key={kb.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={kbIds.includes(kb.id)}
                  onChange={() => toggleKb(kb.id)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span className="text-slate-700">{kb.name}</span>
                <span className="text-xs text-slate-400">({kb.chunk_count} chunks)</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Skill Set สำหรับคำนวณสูตร (ไม่บังคับ — ใช้เมื่อหาคำตอบตรงๆ ใน KB ไม่เจอ)
        </label>
        {skillSets.length === 0 ? (
          <p className="text-xs text-slate-400">ยังไม่มี Skill Set — ไปสร้างที่แท็บ Skills ก่อน</p>
        ) : (
          <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {skillSets.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={skillSetIds.includes(s.id)}
                  onChange={() => toggleSkillSet(s.id)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span className="text-slate-700">{s.name}</span>
                <span className="text-xs text-slate-400">({s.skills_count} สูตร)</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">LLM ที่ใช้ตอบ</label>
        <select
          value={llmModelId}
          onChange={(e) => setLlmModelId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        >
          <option value="">ค่าเริ่มต้น{defaultLlm ? ` (${defaultLlm.name})` : ""}</option>
          {llms.map((m) => (
            <option key={m.id} value={m.id}>{m.name} — {m.provider_name}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
        <input
          type="checkbox"
          checked={useRerank}
          onChange={(e) => setUseRerank(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
        />
        <span className="text-slate-700">ใช้ Rerank</span>
        <span className="text-xs text-slate-400">(จัดอันดับ chunk ที่ค้นเจอใหม่ก่อนตอบ — แม่นขึ้นแต่ช้าขึ้น)</span>
      </label>
      {useRerank && (
        <div className="-mt-1 pl-7">
          {reranks.length === 0 ? (
            <p className="text-xs text-amber-700">ยังไม่มีโมเดล Rerank ในคลัง — เพิ่มที่หลังบ้าน → การเชื่อมต่อ AI</p>
          ) : (
            <select
              value={rerankModelId}
              onChange={(e) => setRerankModelId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="">Rerank ค่าเริ่มต้น{defaultRerank ? ` (${defaultRerank.name})` : ""}</option>
              {reranks.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {m.provider_name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-3">
        <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
          <input
            type="checkbox"
            checked={quickChatEnabled}
            onChange={(e) => setQuickChatEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          <span className="text-slate-700">เปิดใช้ Quick Chat</span>
          <span className="text-xs text-slate-400">(ปุ่มคำถามลัดในหน้าแชท กดแล้วส่งได้ทันที)</span>
        </label>

        {quickChatEnabled && (
          <div className="mt-2 flex flex-col gap-2 px-1.5">
            <div className="flex items-center gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value.slice(0, QUICK_CHAT_MAX_TAG_LENGTH))}
                onKeyDown={handleTagKeyDown}
                disabled={quickChatTags.length >= QUICK_CHAT_MAX_TAGS}
                placeholder={
                  quickChatTags.length >= QUICK_CHAT_MAX_TAGS
                    ? `ครบ ${QUICK_CHAT_MAX_TAGS} รายการแล้ว`
                    : "เช่น ค่าบริการเท่าไหร่, ติดต่อยังไง"
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:bg-slate-50 disabled:text-slate-300"
              />
              <button
                type="button"
                onClick={addTag}
                disabled={!tagInput.trim() || quickChatTags.length >= QUICK_CHAT_MAX_TAGS}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="เพิ่ม Quick Chat"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{tagInput.length}/{QUICK_CHAT_MAX_TAG_LENGTH} ตัวอักษร</span>
              <span>{quickChatTags.length}/{QUICK_CHAT_MAX_TAGS} รายการ</span>
            </div>

            {quickChatTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quickChatTags.map((tag, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(i)}
                      aria-label={`เอา "${tag}" ออก`}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">System Prompt (ไม่บังคับ — ใช้ค่าเริ่มต้นถ้าเว้นว่าง)</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          placeholder="กำหนดบุคลิก/กติกาการตอบของ Chatbot นี้"
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>

      <Button onClick={handleSubmit} disabled={!name.trim() || submitting} className="self-end">
        {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}
