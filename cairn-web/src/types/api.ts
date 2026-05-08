// 与后端 cairn/src/cairn/server/models.py 中的 Pydantic 模型一一对齐
export type ProjectStatus = 'active' | 'stopped' | 'completed';

export interface Settings {
  intent_timeout: number;
  reason_timeout: number;
}

export interface Fact {
  id: string;
  description: string;
}

export interface Intent {
  id: string;
  /** 后端字段是 "from"，TypeScript 中保留同名 */
  from: string[];
  to: string | null;
  description: string;
  creator: string;
  worker: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  concluded_at: string | null;
}

export interface Hint {
  id: string;
  content: string;
  creator: string;
  created_at: string;
}

export interface ProjectReason {
  worker: string;
  trigger: string;
  started_at: string;
  last_heartbeat_at: string;
}

export interface ProjectMeta {
  id: string;
  title: string;
  status: ProjectStatus;
  created_at: string;
  reason: ProjectReason | null;
}

export interface ProjectSummary extends ProjectMeta {
  fact_count: number;
  intent_count: number;
  working_intent_count: number;
  unclaimed_intent_count: number;
  hint_count: number;
}

export interface ProjectDetail {
  project: ProjectMeta;
  facts: Fact[];
  intents: Intent[];
  hints: Hint[];
}

export interface CreateHintInline {
  content: string;
  creator: string;
}

export interface CreateProjectRequest {
  title: string;
  origin: string;
  goal: string;
  hints?: CreateHintInline[];
}

export interface CreateHintRequest {
  content: string;
  creator: string;
}

export interface CreateIntentRequest {
  from: string[];
  description: string;
  creator: string;
  worker?: string | null;
}

export interface HeartbeatRequest {
  worker: string;
}

export interface ConcludeRequest {
  worker: string;
  description: string;
}

export interface CompleteRequest {
  from: string[];
  description: string;
  worker: string;
}

export interface ConcludeResponse {
  fact: Fact;
  intent: Intent;
}

export interface UpdateProjectStatusRequest {
  status: 'active' | 'stopped';
}

export interface UpdateProjectTitleRequest {
  title: string;
}

export interface ReopenRequest {
  description: string;
  creator: string;
}

export interface ReopenResponse {
  project: ProjectMeta;
  fact: Fact;
  intent: Intent;
}
