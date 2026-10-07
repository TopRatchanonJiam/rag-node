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
  source_count?: number;
  chunk_count: number;
  files?: KbFile[];
  embedding?: { model_id?: string; model?: string; dim?: number; name?: string };
  embedding_available?: boolean;
}

export type RealtimeAuth = "none" | "bearer" | "api_key_header" | "api_key_query";

export interface RealtimeSource {
  id: string;
  kb_id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  query_params: Record<string, string>;
  body: Record<string, unknown>;
  auth_type: RealtimeAuth;
  auth_token: SecretMask;
  auth_header_name: string;
  auth_query_param: string;
  records_path: string;
  poll_interval_sec: number;
  enabled: boolean;
  syncing?: boolean;
  last_synced_at: string | null;
  last_status: "never" | "success" | "error";
  last_error: string | null;
  last_record_count: number;
  last_chunks?: number;
  last_mode?: "full" | "incremental" | "unchanged" | null;
}

export type RealtimeSourceInput = Omit<RealtimeSource, "id" | "kb_id" | "auth_token" | "enabled" | "syncing" | "last_synced_at" | "last_status" | "last_error" | "last_record_count" | "last_chunks" | "last_mode"> & {
  auth_token: string | null;
  id?: string;
};

export interface RealtimeSyncResult {
  status: "success" | "error" | "busy";
  error?: string;
  mode?: string;
  patched_rows?: number;
  record_count?: number;
  source?: RealtimeSource | null;
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
  welcome_label: string;
  welcome_message: string;
  welcome_icon: string;
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
