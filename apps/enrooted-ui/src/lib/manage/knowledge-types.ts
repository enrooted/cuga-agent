/*
 * Shared types for the Knowledge configuration panel.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx,
 * agentic_chat/src/ClientAdaptationPanel.tsx, agentic_chat/src/EnvPresetsPanel.tsx and
 * frontend/src/manage/hooks/useKnowledgeDraftSave.ts (Copyright IBM Corp., Apache-2.0).
 */

// Mirrors the backend schema in src/cuga/backend/knowledge/config.py
// (_validate_glossary). Definition is optional; aliases is a flat list of
// synonyms / abbreviations / cross-language equivalents used both for prompt
// rendering AND for query expansion at search time.
export interface GlossaryEntry {
  term: string
  aliases: string[]
  definition?: string
}

/** Structured server error matching ClientAdaptationError.to_dict() in config.py. */
export interface AdaptationServerErrorShape {
  error:
    | "length_exceeded"
    | "bidi_override"
    | "control_char"
    | "contract_override_phrase"
    | "type_error"
    | "null_byte"
  message: string
  // Per-error extras
  phrase?: string
  pattern?: string
  codepoint?: string
  length?: number
  max?: number
}
/** Name used by the original panel; same shape. */
export type AdaptationServerError = AdaptationServerErrorShape

/** Draft autosave status, driven by the real PATCH lifecycle in the page's save hook. */
export type DraftSaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saving-slow" }
  | { kind: "saved" }
  | { kind: "failed"; error: string }

export type KnowledgeExtraParams = Record<string, string | number | boolean>

/** The `knowledge` block of the manage config (what the draft PATCH sends). */
export interface KnowledgeConfigValues {
  enabled?: boolean
  agent_level_enabled?: boolean
  session_level_enabled?: boolean
  // Citations toggle: numbered source markers ([1]) with clickable snippets in
  // answers. Agent-level default; the per-session override lives in the session
  // settings API, not this config.
  citations_enabled?: boolean
  rag_profile?: string
  embedding_provider?: string
  embedding_model?: string
  // For OpenAI-compatible providers (Groq, Together, Fireworks, OpenRouter, ...)
  // set embedding_provider="openai" and override these two fields.
  embedding_api_key?: string
  embedding_base_url?: string
  embedding_extra_params?: KnowledgeExtraParams
  use_gpu?: boolean
  chunk_size?: number
  chunk_overlap?: number
  metric_type?: string
  max_pending_tasks?: number
  max_upload_size_mb?: number
  max_url_download_size_mb?: number
  max_files_per_request?: number
  max_chunks_per_document?: number
  // Adapter batching. Saved with the config snapshot when published.
  embedding_batch_size?: number
  embedding_concurrency?: number
  vector_insert_batch_size?: number
  // Docling parsing level: "fast" | "balanced" | "accurate".
  docling_pdf_mode?: string
  docling_layout_engine?: string
  // Docling page-chrome filter: "off" | "dry_run" | "enforce". Profile-driven.
  docling_drop_page_chrome?: string
  // Reranker knobs, driven by the active profile.
  rerank_enabled?: boolean
  rerank_top_k_in?: number
  rerank_model?: string
  // Search-side knobs, same story as rerank.
  search_hybrid_mode?: string
  search_junk_filter?: string
  max_search_attempts?: number
  default_limit?: number
  default_score_threshold?: number
  // How many concurrent Docling parses the engine permits.
  max_ingest_workers?: number
  // Query transformation (LLM): "off" | "multi_query" | "hyde". Search-only,
  // not part of vector_config_hash, no re-index.
  search_query_transform?: string
  // Client adaptation ("Knowledge harness"): operator-supplied prompt rules +
  // glossary. Never part of vector_config_hash.
  client_adaptation_text?: string
  client_adaptation_glossary?: GlossaryEntry[]
  // The server may send fields this UI does not know; they are passed through.
  [key: string]: unknown
}

export interface RagProfileMeta {
  name: string
  description: string
  search: {
    max_search_attempts?: number
    default_limit?: number
    default_score_threshold?: number
    hybrid_mode?: string
    junk_filter?: string
    query_transform?: string
  }
  chunking: { chunk_size?: number; chunk_overlap?: number }
  embeddings?: { model?: string; batch_size?: number; concurrency?: number }
  docling?: { pdf_mode?: string; layout_engine?: string; drop_page_chrome?: string }
  rerank?: { enabled?: boolean; top_k_in?: number; model?: string }
  engine?: { max_ingest_workers?: number; vector_insert_batch_size?: number }
}

// String-union name for each top-level tab in the modal. Used by parents to
// deep-link the modal to a specific tab. TAB_INDEX keeps the original ordering.
export type KnowledgeTabName = "documents" | "search" | "behavior" | "settings"
export const TAB_INDEX: Record<KnowledgeTabName, number> = {
  documents: 0,
  search: 1,
  behavior: 2,
  settings: 3,
}

export type KnowledgeToastKind = "error" | "success" | "warning"
export type KnowledgeToast = (kind: KnowledgeToastKind, title: string, message: string) => void

/** What `onReindex` resolves to (the reindex POST response), or null on failure. */
export interface KnowledgeReindexResult {
  count: number
  task_ids: string[]
  // [{task_id, filename}] pairs so the tile can show real filenames from the start.
  tasks?: { task_id: string; filename: string }[]
}

export interface AutoReindexTrigger {
  taskIds: string[]
  total: number
  triggerKey: string
}

// ── engine payloads ────────────────────────────────────────────────────────
export interface KnowledgeDocument {
  filename: string
  ingested_at?: string
  task_id?: string
}

export interface KnowledgeSearchResult {
  filename: string
  page?: number
  text?: string
  content?: string
  score: number
  metadata?: Record<string, unknown>
}

export type ReindexTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export interface ReindexFileTask {
  filename?: string
  status?: string
  error?: string
  // Granular progress emitted by the engine during ingest: per-stage events
  // between "processing" and "completed"; rendered as "<stage> (done/total)".
  stage?: string
  progress?: { done?: number; total?: number }
}

export interface ReindexTask {
  task_id: string
  filename?: string
  status: ReindexTaskStatus
  file_tasks?: Record<string, ReindexFileTask>
}

export interface ReindexProgress {
  taskIds: string[]
  total: number
  completed: number
  failed: number
  tasks: ReindexTask[]
  done: boolean
  // Wall-clock start for the honest elapsed timer ("Running for 47s").
  startedAt: number
}

/** One row of GET /api/manage/knowledge/env-presets. */
export interface EnvPreset {
  id: string
  label: string
  default_provider: string
  default_model: string
  ready: boolean
  env_vars: Record<string, boolean>
  // Non-secret detected values (URL / project ID / region ...). Credential
  // material is filtered server-side and never reaches the client.
  env_values?: Record<string, string>
  missing: string[]
}

/** What the live engine actually loaded (GET /api/manage/knowledge/accelerator). */
export interface AcceleratorStatus {
  device_label: string
  fallback_to_cpu: boolean
  embedding_relevant: boolean
  key_source?: { required: boolean; source: string }
}

export interface EmbeddingsTestResult {
  ok: boolean
  dim?: number
  latency_ms?: number
  error?: string
}

/** A file row in the upload list (in-flight or just finished). */
export interface UploadingFile {
  /** Original browser name (shown in the UI). */
  name: string
  /** Sanitized name the backend stored (used for matching against documents). */
  backendName?: string
  status: "uploading" | "success" | "error" | "cancelled"
  error?: string
  taskId?: string
  /** 0..1 overall fraction from the backend's weighted_pct. */
  progress?: number
  /** Backend reports ui_phase=queued (waiting on the per-collection ingest lock). */
  queued?: boolean
  /** The server refused a cancel because the ingest is past its point of no return. */
  finishing?: boolean
}
