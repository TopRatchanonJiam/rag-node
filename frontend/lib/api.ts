import type { AdminStatus, Chatbot, CheckResult, KnowledgeBase, NodeSettings, SkillSet } from "./types";

// หน้าเว็บถูกเสิร์ฟจาก node ตัวเดียวกับ API (origin เดียวกัน) — ใช้ path แบบ relative
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function parseErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail || fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, `Request failed (${res.status})`));
  }
  return res.json();
}

// ── Knowledge Bases ──────────────────────────────────────

export async function listKnowledgeBases(): Promise<{ knowledge_bases: KnowledgeBase[] }> {
  return request("/api/kb");
}

export async function getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
  return request(`/api/kb/${encodeURIComponent(kbId)}`);
}

export async function createKnowledgeBase(name: string, description: string): Promise<KnowledgeBase> {
  return request("/api/kb", { method: "POST", body: JSON.stringify({ name, description }) });
}

export async function deleteKnowledgeBase(kbId: string): Promise<{ message: string }> {
  return request(`/api/kb/${encodeURIComponent(kbId)}`, { method: "DELETE" });
}

export async function uploadKnowledgeBaseFile(kbId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ message: string; chunks: number; chunk_types: Record<string, number>; filename: string; type: string }>(
    `/api/kb/${encodeURIComponent(kbId)}/upload`,
    { method: "POST", body: formData }
  );
}

export async function deleteKnowledgeBaseFile(kbId: string, filename: string): Promise<{ message: string }> {
  return request(`/api/kb/${encodeURIComponent(kbId)}/files/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export async function getKnowledgeBaseFileChunks(kbId: string, filename: string) {
  return request<{ filename: string; total_chunks: number; chunks: Array<{ id: string; text: string; length: number; metadata: Record<string, unknown>; index: number }> }>(
    `/api/kb/${encodeURIComponent(kbId)}/files/${encodeURIComponent(filename)}/chunks`
  );
}

// ── Skill Sets ───────────────────────────────────────────

export async function listSkillSets(): Promise<{ skill_sets: SkillSet[] }> {
  return request("/api/skills");
}

export async function getSkillSet(skillId: string): Promise<SkillSet> {
  return request(`/api/skills/${encodeURIComponent(skillId)}`);
}

export async function createSkillSet(name: string, description: string): Promise<SkillSet> {
  return request("/api/skills", { method: "POST", body: JSON.stringify({ name, description }) });
}

export async function deleteSkillSet(skillId: string): Promise<{ message: string }> {
  return request(`/api/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
}

export async function uploadSkillSetFile(skillId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ message: string; skills_parsed: number; filename: string }>(
    `/api/skills/${encodeURIComponent(skillId)}/upload`,
    { method: "POST", body: formData }
  );
}

export async function deleteSkillSetFile(skillId: string, filename: string): Promise<{ message: string }> {
  return request(`/api/skills/${encodeURIComponent(skillId)}/files/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

// ── Chatbots ─────────────────────────────────────────────

export async function listBots(): Promise<{ bots: Chatbot[] }> {
  return request("/api/bots");
}

export async function getBot(botId: string): Promise<Chatbot> {
  return request(`/api/bots/${encodeURIComponent(botId)}`);
}

export async function createBot(payload: {
  name: string;
  description: string;
  kb_ids: string[];
  skill_set_ids: string[];
  system_prompt?: string;
  use_rerank?: boolean;
  quick_chat_enabled?: boolean;
  quick_chat_tags?: string[];
}): Promise<Chatbot> {
  return request("/api/bots", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateBot(
  botId: string,
  payload: Partial<{
    name: string;
    description: string;
    kb_ids: string[];
    skill_set_ids: string[];
    system_prompt: string;
    use_rerank: boolean;
    quick_chat_enabled: boolean;
    quick_chat_tags: string[];
  }>
): Promise<Chatbot> {
  return request(`/api/bots/${encodeURIComponent(botId)}`, { method: "PUT", body: JSON.stringify(payload) });
}

export async function deleteBot(botId: string): Promise<{ message: string }> {
  return request(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
}

type ChatStreamDoneMeta = {
  used_skill: boolean;
  export?: { id: string; format: string; title: string; filename: string; download_url: string };
};

// ยิงคำถามไปยัง /chat/stream (SSE) แล้วเรียก handler ทีละ event — node ส่งต่อมาจาก central
export async function streamChatWithBot(
  botId: string,
  message: string,
  file: File | null,
  handlers: {
    onChunk: (text: string) => void;
    onStatus?: (text: string) => void;
    onDone: (meta: ChatStreamDoneMeta) => void;
  }
): Promise<void> {
  const formData = new FormData();
  formData.append("message", message);
  if (file) formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/bots/${encodeURIComponent(botId)}/chat/stream`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok || !res.body) {
    throw new Error(await parseErrorDetail(res, `Request failed (${res.status})`));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice("data: ".length));

      if (event.type === "chunk") handlers.onChunk(event.text);
      else if (event.type === "status") handlers.onStatus?.(event.text);
      else if (event.type === "error") handlers.onChunk(`\n[${event.error?.code ?? "error"}] ${event.error?.message ?? ""}`);
      else if (event.type === "done") handlers.onDone({ used_skill: event.used_skill, export: event.export });
    }
  }
}

// ── หลังบ้าน: การเชื่อมต่อ / สถานะ ──────────────────────

// ค่าที่ส่งไปบันทึก: ช่อง key — ไม่ส่ง/ว่าง = ใช้ค่าเดิม, null = ลบ
export type SettingsInput = Record<string, Record<string, string | number | boolean | null | undefined>>;

export async function getSettings(): Promise<{ settings: NodeSettings; kb_count: number }> {
  return request("/api/admin/settings");
}

export async function testSettings(settings: SettingsInput): Promise<CheckResult> {
  return request("/api/admin/settings/test", { method: "POST", body: JSON.stringify({ settings }) });
}

export class EmbeddingChangeError extends Error {
  affected: string[];
  constructor(message: string, affected: string[]) {
    super(message);
    this.affected = affected;
  }
}

export async function saveSettings(settings: SettingsInput, confirmEmbeddingChange = false): Promise<{ settings: NodeSettings }> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, confirm_embedding_change: confirmEmbeddingChange }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body?.code === "embedding_change") {
    throw new EmbeddingChangeError(body.detail, body.affected_kbs ?? []);
  }
  if (!res.ok) throw new Error(body?.detail || `Request failed (${res.status})`);
  return body;
}

export async function getAdminStatus(): Promise<AdminStatus> {
  return request("/api/admin/status");
}

export async function runFullCheck(): Promise<CheckResult> {
  return request("/api/admin/check", { method: "POST" });
}
