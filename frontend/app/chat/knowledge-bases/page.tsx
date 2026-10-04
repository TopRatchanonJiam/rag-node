"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ChatSubNav } from "@/components/chat/ChatSubNav";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { KnowledgeBaseList } from "@/components/kb/KnowledgeBaseList";
import { KnowledgeBaseDetail } from "@/components/kb/KnowledgeBaseDetail";
import {
  listKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  deleteKnowledgeBase,
  uploadKnowledgeBaseFile,
  deleteKnowledgeBaseFile,
} from "@/lib/api";
import type { KnowledgeBase } from "@/lib/types";

export default function KnowledgeBasesPage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
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
    const { knowledge_bases } = await listKnowledgeBases();
    setKbs(knowledge_bases);
    if (selectAfter) {
      setSelectedId(selectAfter);
    } else if (!selectedId && knowledge_bases.length > 0) {
      setSelectedId(knowledge_bases[0].id);
    }
  }

  useEffect(() => {
    refreshList()
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการ Knowledge Base ไม่สำเร็จ"))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedKb(null);
      return;
    }
    setLoadingDetail(true);
    getKnowledgeBase(selectedId)
      .then(setSelectedKb)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายละเอียด Knowledge Base ไม่สำเร็จ"))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const kb = await createKnowledgeBase(newName.trim(), newDescription.trim());
      setShowCreate(false);
      setNewName("");
      setNewDescription("");
      await refreshList(kb.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้าง Knowledge Base ไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File) {
    if (!selectedId) return;
    setUploading(true);
    setError(null);
    try {
      await uploadKnowledgeBaseFile(selectedId, file);
      const detail = await getKnowledgeBase(selectedId);
      setSelectedKb(detail);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(filename: string) {
    if (!selectedId) return;
    if (!window.confirm(`ลบไฟล์ '${filename}' ออกจาก Knowledge Base นี้?`)) return;
    setDeletingFile(filename);
    setError(null);
    try {
      await deleteKnowledgeBaseFile(selectedId, filename);
      const detail = await getKnowledgeBase(selectedId);
      setSelectedKb(detail);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบไฟล์ไม่สำเร็จ");
    } finally {
      setDeletingFile(null);
    }
  }

  async function handleDeleteKb() {
    if (!selectedId) return;
    if (!window.confirm("ลบ Knowledge Base นี้? ไฟล์และ chunk ทั้งหมดจะถูกลบ และ Chatbot ที่ผูกไว้จะถูกถอดออกโดยอัตโนมัติ")) return;
    setError(null);
    try {
      await deleteKnowledgeBase(selectedId);
      setSelectedId(null);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบ Knowledge Base ไม่สำเร็จ");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading eyebrow="Chatbot System" title="Knowledge Bases" />
        <ChatSubNav />
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card>
            <KnowledgeBaseList
              kbs={kbs}
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
            ) : selectedKb ? (
              <KnowledgeBaseDetail
                kb={selectedKb}
                uploading={uploading}
                deletingFile={deletingFile}
                onUpload={handleUpload}
                onDeleteFile={handleDeleteFile}
                onDeleteKb={handleDeleteKb}
              />
            ) : (
              <p className="text-sm text-slate-400">เลือก Knowledge Base ทางซ้าย หรือสร้างใหม่</p>
            )}
          </Card>
        </div>
      )}

      {showCreate && (
        <Modal title="สร้าง Knowledge Base ใหม่" onClose={() => setShowCreate(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อ</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="เช่น ข้อมูลสินค้า, นโยบายบริษัท"
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
