"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { ChatSubNav } from "@/components/chat/ChatSubNav";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Modal } from "@/components/ui/Modal";
import { BotForm, type BotFormValues } from "@/components/bots/BotForm";
import { BotCard } from "@/components/bots/BotCard";
import { listBots, createBot, updateBot, deleteBot, listKnowledgeBases, listSkillSets } from "@/lib/api";
import type { Chatbot, KnowledgeBase, SkillSet } from "@/lib/types";

export default function BotsPage() {
  const [bots, setBots] = useState<Chatbot[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [skillSets, setSkillSets] = useState<SkillSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingBot, setEditingBot] = useState<Chatbot | null>(null);

  async function refresh() {
    const [botsRes, kbsRes, skillsRes] = await Promise.all([listBots(), listKnowledgeBases(), listSkillSets()]);
    setBots(botsRes.bots);
    setKbs(kbsRes.knowledge_bases);
    setSkillSets(skillsRes.skill_sets);
  }

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(values: BotFormValues) {
    setError(null);
    try {
      await createBot(values);
      setShowCreate(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้าง Chatbot ไม่สำเร็จ");
    }
  }

  async function handleUpdate(values: BotFormValues) {
    if (!editingBot) return;
    setError(null);
    try {
      await updateBot(editingBot.id, values);
      setEditingBot(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "แก้ไข Chatbot ไม่สำเร็จ");
    }
  }

  async function handleDelete(bot: Chatbot) {
    if (!window.confirm(`ลบ Chatbot '${bot.name}'?`)) return;
    setError(null);
    try {
      await deleteBot(bot.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบ Chatbot ไม่สำเร็จ");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading eyebrow="Chatbot System" title="Chatbots" />
        <ChatSubNav />
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      <button
        type="button"
        onClick={() => setShowCreate(true)}
        className="flex w-fit items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        <Plus size={15} /> สร้าง Chatbot ใหม่
      </button>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : bots.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">ยังไม่มี Chatbot — สร้างตัวแรกโดยเลือก Knowledge Base ที่จะใช้ตอบคำถาม</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} onEdit={() => setEditingBot(bot)} onDelete={() => handleDelete(bot)} />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="สร้าง Chatbot ใหม่" onClose={() => setShowCreate(false)}>
          <BotForm knowledgeBases={kbs} skillSets={skillSets} submitLabel="สร้าง Chatbot" onSubmit={handleCreate} />
        </Modal>
      )}

      {editingBot && (
        <Modal title={`แก้ไข ${editingBot.name}`} onClose={() => setEditingBot(null)}>
          <BotForm
            knowledgeBases={kbs}
            skillSets={skillSets}
            initial={{
              name: editingBot.name,
              description: editingBot.description,
              kb_ids: editingBot.kb_ids,
              skill_set_ids: editingBot.skill_set_ids,
              system_prompt: editingBot.system_prompt,
              use_rerank: editingBot.use_rerank,
              quick_chat_enabled: editingBot.quick_chat_enabled,
              quick_chat_tags: editingBot.quick_chat_tags,
            }}
            submitLabel="บันทึกการแก้ไข"
            onSubmit={handleUpdate}
          />
        </Modal>
      )}
    </div>
  );
}
