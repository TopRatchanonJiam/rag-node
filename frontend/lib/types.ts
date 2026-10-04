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
}

