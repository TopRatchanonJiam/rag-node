"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ChatSubNav } from "@/components/chat/ChatSubNav";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SkillSetList } from "@/components/skills/SkillSetList";
import { SkillSetDetail } from "@/components/skills/SkillSetDetail";
import {
  listSkillSets,
  getSkillSet,
  createSkillSet,
  deleteSkillSet,
  uploadSkillSetFile,
  deleteSkillSetFile,
} from "@/lib/api";
import type { SkillSet } from "@/lib/types";

export default function SkillsPage() {
  const [skillSets, setSkillSets] = useState<SkillSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillSet | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  async function refreshList(selectAfter?: string) {
    const { skill_sets } = await listSkillSets();
    setSkillSets(skill_sets);
    if (selectAfter) {
      setSelectedId(selectAfter);
    } else if (!selectedId && skill_sets.length > 0) {
      setSelectedId(skill_sets[0].id);
    }
  }

  useEffect(() => {
    refreshList()
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการ Skill Set ไม่สำเร็จ"))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoadingDetail(true);
    getSkillSet(selectedId)
      .then(setSelected)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายละเอียด Skill Set ไม่สำเร็จ"))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const s = await createSkillSet(newName.trim(), newDescription.trim());
      setShowCreate(false);
      setNewName("");
      setNewDescription("");
      await refreshList(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้าง Skill Set ไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File) {
    if (!selectedId) return;
    setUploading(true);
    setError(null);
    try {
      await uploadSkillSetFile(selectedId, file);
      const detail = await getSkillSet(selectedId);
      setSelected(detail);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(filename: string) {
    if (!selectedId) return;
    if (!window.confirm(`ลบไฟล์ '${filename}' ออกจาก Skill Set นี้?`)) return;
    setDeletingFile(filename);
    setError(null);
    try {
      await deleteSkillSetFile(selectedId, filename);
      const detail = await getSkillSet(selectedId);
      setSelected(detail);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบไฟล์ไม่สำเร็จ");
    } finally {
      setDeletingFile(null);
    }
  }

  async function handleDeleteSkillSet() {
    if (!selectedId) return;
    if (!window.confirm("ลบ Skill Set นี้? Chatbot ที่ผูกไว้จะถูกถอดออกโดยอัตโนมัติ")) return;
    setError(null);
    try {
      await deleteSkillSet(selectedId);
      setSelectedId(null);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบ Skill Set ไม่สำเร็จ");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading eyebrow="Chatbot System" title="Skills" />
        <ChatSubNav />
      </div>

      <p className="max-w-2xl text-sm text-slate-500">
        Skill Set แยกออกจาก Knowledge Base โดยตั้งใจ — เก็บไฟล์สูตรคำนวณ (.md) ที่ parse ตรงๆ ไม่ผ่าน embedding
        เวลาผูกกับ Chatbot ระบบจะจับคู่สูตรจากคำถาม แล้วดึงตัวแปรที่สูตรต้องใช้จาก Knowledge Base ของบอทมาคำนวณให้
      </p>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card>
            <SkillSetList
              skillSets={skillSets}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreateClick={() => setShowCreate(true)}
            />
          </Card>

          <Card>
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
              </div>
            ) : selected ? (
              <SkillSetDetail
                skillSet={selected}
                uploading={uploading}
                deletingFile={deletingFile}
                onUpload={handleUpload}
                onDeleteFile={handleDeleteFile}
                onDeleteSkillSet={handleDeleteSkillSet}
              />
            ) : (
              <p className="text-sm text-slate-400">เลือก Skill Set ทางซ้าย หรือสร้างใหม่</p>
            )}
          </Card>
        </div>
      )}

      {showCreate && (
        <Modal title="สร้าง Skill Set ใหม่" onClose={() => setShowCreate(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อ</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="เช่น สูตรการเงิน, สูตรภาษี"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">คำอธิบาย (ไม่บังคับ)</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating} className="self-end">
              {creating ? <Loader2 size={15} className="animate-spin" /> : null}
              สร้าง
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
