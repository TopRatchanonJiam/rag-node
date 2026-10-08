import type { AdminStatus, Chatbot, CheckItem, CheckResult, KnowledgeBase, ModelRole, NodeSettings, ProtocolId, ProtocolInfo, ProviderConn, ProviderModel, RealtimeSource, RealtimeSourceInput, RealtimeSyncResult, SkillSet } from "./types";

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

export async function createKnowledgeBase(name: string, description: string, embeddingModelId?: string): Promise<KnowledgeBase> {
  return request("/api/kb", {
    method: "POST",
    body: JSON.stringify({ name, description, embedding_model_id: embeddingModelId || null }),
  });
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

// ── แหล่งข้อมูลสด (Realtime API) ───────────────────────

export async function listRealtimeSources(kbId: string): Promise<{ sources: RealtimeSource[] }> {
  return request(`/api/kb/${encodeURIComponent(kbId)}/sources`);
}

export async function createRealtimeSource(kbId: string, body: RealtimeSourceInput): Promise<RealtimeSource> {
  return request(`/api/kb/${encodeURIComponent(kbId)}/sources`, { method: "POST", body: JSON.stringify(body) });
}

export async function updateRealtimeSource(id: string, body: RealtimeSourceInput): Promise<RealtimeSource> {
  return request(`/api/sources/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteRealtimeSource(id: string): Promise<{ message: string }> {
  return request(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testRealtimeSource(body: RealtimeSourceInput): Promise<{ total_records: number; fields: string[]; sample: Record<string, unknown>[]; too_many: boolean }> {
  return request("/api/sources/test", { method: "POST", body: JSON.stringify(body) });
}

export async function syncRealtimeSource(id: string): Promise<RealtimeSyncResult> {
  return request(`/api/sources/${encodeURIComponent(id)}/sync`, { method: "POST" });
}

export async function toggleRealtimeSource(id: string, enabled: boolean): Promise<RealtimeSource> {
  return request(`/api/sources/${encodeURIComponent(id)}/toggle`, { method: "PATCH", body: JSON.stringify({ enabled }) });
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
  llm_model_id?: string;
  rerank_model_id?: string;
  welcome_label?: string;
  welcome_message?: string;
  welcome_icon?: string;
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
    llm_model_id: string;
    rerank_model_id: string;
    welcome_label: string;
    welcome_message: string;
    welcome_icon: string;
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

// ถอดเสียงจากปุ่มไมค์ — node ส่งต่อให้ central พร้อมโมเดลถอดเสียงของบอท
export async function transcribeAudio(botId: string, audio: Blob): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append("file", audio, "voice.wav");
  return request(`/api/bots/${encodeURIComponent(botId)}/transcribe`, { method: "POST", body: formData });
}

// ── หลังบ้าน: การเชื่อมต่อ / สถานะ ──────────────────────

// ค่าที่ส่งไปบันทึก (ส่งเฉพาะส่วนที่แก้) — ช่อง key: ไม่ส่ง/ว่าง = ใช้ค่าเดิม, null = ลบ
type Primitive = string | number | boolean | null | undefined;
export type SettingsInput = {
  providers?: Record<string, Record<string, Primitive>>;
  models?: Record<string, Record<string, Primitive>>;
  vector?: Record<string, Primitive>;
  central?: Record<string, Primitive>;
};

export async function getSettings(): Promise<{
  settings: NodeSettings;
  protocols: Record<ProtocolId, ProtocolInfo>;
}> {
  return request("/api/admin/settings");
}

// การเชื่อมต่อผู้ให้บริการ (ผู้ใช้เพิ่มเองได้) — api_key: "" = ใช้ค่าเดิม, null = ลบ
export type ProviderInput = { name: string; base_url: string; api_key: string | null; type?: ProtocolId };

export async function createProvider(body: ProviderInput): Promise<ProviderConn> {
  return request("/api/admin/providers", { method: "POST", body: JSON.stringify(body) });
}

export async function updateProvider(id: string, body: ProviderInput): Promise<ProviderConn> {
  return request(`/api/admin/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteProvider(id: string): Promise<{ message: string }> {
  return request(`/api/admin/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testProvider(body: Partial<ProviderInput> & { id?: string }): Promise<{ models: ProviderModel[] }> {
  return request("/api/admin/providers/test", { method: "POST", body: JSON.stringify(body) });
}

export async function listProviderModels(providerId: string): Promise<{ models: ProviderModel[] }> {
  return request(`/api/admin/providers/${encodeURIComponent(providerId)}/models`, { method: "POST" });
}

export async function saveSettings(settings: SettingsInput): Promise<{ settings: NodeSettings }> {
  return request("/api/admin/settings", { method: "PUT", body: JSON.stringify({ settings }) });
}

// ── คลังโมเดล ────────────────────────────────────────

export type ModelInput = { name: string; kind: ModelRole; provider: string; model: string; dim?: number; make_default?: boolean; params?: string };

export async function createModel(body: ModelInput): Promise<{ id: string }> {
  return request("/api/admin/models", { method: "POST", body: JSON.stringify(body) });
}

export async function updateModel(id: string, body: ModelInput): Promise<{ id: string }> {
  return request(`/api/admin/models/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteModel(id: string): Promise<{ message: string }> {
  return request(`/api/admin/models/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setDefaultModel(id: string): Promise<{ message: string }> {
  return request(`/api/admin/models/${encodeURIComponent(id)}/default`, { method: "POST" });
}

export async function testModel(body: { kind: ModelRole; provider: string; model: string; params?: string }): Promise<CheckItem> {
  return request("/api/admin/models/test", { method: "POST", body: JSON.stringify(body) });
}

export async function getAdminStatus(): Promise<AdminStatus> {
  return request("/api/admin/status");
}

// ย้าย license มาใช้ที่เครื่องนี้ (หลังถูกเครื่องอื่นแทนที่)
export async function claimLicense(): Promise<{ ok: boolean }> {
  return request("/api/admin/license/claim", { method: "POST" });
}

// ── แพ็กเกจ / ชำระเงิน ──
export type BillingPrice = { amount: number; currency: string };
export type BillingStatus = {
  enabled: boolean;
  message?: string;
  license_type?: string;
  valid_until?: string | null;
  billing_status?: string | null;
  plan?: string;
  has_subscription?: boolean;
  subscription_live?: boolean;
  prices?: Partial<Record<"month" | "year", BillingPrice>>;
};

export async function getBillingStatus(): Promise<BillingStatus> {
  return request("/api/admin/billing");
}

export async function startCheckout(interval: "month" | "year", returnUrl: string): Promise<{ url: string }> {
  return request("/api/admin/billing/checkout", { method: "POST", body: JSON.stringify({ interval, return_url: returnUrl }) });
}

export async function openBillingPortal(returnUrl: string): Promise<{ url: string }> {
  return request("/api/admin/billing/portal", { method: "POST", body: JSON.stringify({ return_url: returnUrl }) });
}

export async function runFullCheck(): Promise<CheckResult> {
  return request("/api/admin/check", { method: "POST" });
}
