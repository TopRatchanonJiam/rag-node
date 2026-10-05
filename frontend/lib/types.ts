export interface ChatExport {
  id: string;
  format: string;
  title: string;
  filename: string;
  download_url: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  usedSkill?: boolean;
  attachmentName?: string;
  export?: ChatExport;
  streaming?: boolean;
  status?: string;
}

export interface KbFile {
  name: string;
  size: number;
  type: string;
  chunks?: number;
  uploaded_at?: string | null;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  collection_name: string;
  created_at: string;
  file_count: number;
  chunk_count: number;
  files?: KbFile[];
  embedding?: { model_id?: string; model?: string; dim?: number; name?: string };
  embedding_available?: boolean;
}

export interface SkillPreview {
  name: string;
  formula: string;
}

export interface SkillSet {
  id: string;
  name: string;
  description: string;
  created_at: string;
  file_count: number;
  skills_count: number;
  files?: KbFile[];
  skills?: SkillPreview[];
}

export interface Chatbot {
  id: string;
  name: string;
  description: string;
  kb_ids: string[];
  kb_names: string[];
  skill_set_ids: string[];
  skill_set_names: string[];
  system_prompt: string;
  use_rerank: boolean;
  created_at: string;
  last_chatted_at: string | null;
  quick_chat_enabled: boolean;
  quick_chat_tags: string[];
  llm_model_id: string;
  rerank_model_id: string;
  llm_name: string | null;
  rerank_name: string | null;
}


// ── หลังบ้าน: การเชื่อมต่อ ─────────────────────────────

export type SecretMask = { set: boolean; hint: string };

export type ModelRole = "llm" | "embedding" | "rerank";

export type ProtocolId = "openai_compatible" | "google" | "ollama";

export interface ProtocolInfo {
  label: string;
  needs_url: boolean;
  key: "optional" | "required" | "none";
  hint: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  type: ProtocolId;
  base_url: string;
}

export interface ProviderConn {
  id: string;
  name: string;
  type: ProtocolId;
  base_url: string;
  api_key: SecretMask;
  configured: boolean;
}

export interface RegistryModel {
  id: string;
  name: string;
  kind: ModelRole;
  provider: string;
  provider_name: string;
  model: string;
  dim?: number;
  is_default: boolean;
  used_by: { kbs: string[]; bots: string[] };
}

export interface NodeSettings {
  providers: ProviderConn[];
  models: RegistryModel[];
  defaults: Record<ModelRole, string | null>;
  vector: { url: string; api_key: SecretMask };
  central: { url: string; license_key: SecretMask };
}

export type ProviderModel = { id: string; kinds: string[] };

export type CheckItem = {
  ok?: boolean | null;
  message?: string;
  error_code?: string;
  code?: string;
  reply?: string;
  dim?: number;
  dim_mismatch?: { configured: number; actual: number };
  [key: string]: unknown;
};

export interface CheckResult {
  central?: CheckItem & { url?: string; api_version?: string };
  license?: CheckItem & { status?: string; valid_until?: string | null; plan?: string; warnings?: { code: string; message: string }[] };
  llm?: CheckItem;
  embedding?: CheckItem;
  vector?: CheckItem;
  rerank?: CheckItem;
}

export interface Usage {
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_calls: number;
  embed_tokens: number;
  embed_calls: number;
  rerank_calls: number;
  requests: number;
}

export type DefaultModelInfo = { id: string; name: string; model: string; dim?: number | null; provider_name: string } | null;

export interface AdminStatus {
  central: CheckItem & { url: string; api_version?: string };
  license: CheckResult["license"];
  defaults: Record<ModelRole, DefaultModelInfo>;
  model_counts: Record<ModelRole, number>;
  counts: { kbs: number; files: number; chunks: number; bots: number; skills: number };
  usage: Usage;
}
