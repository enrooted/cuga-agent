/*
 * Knowledge endpoints used by the Manage > Knowledge panel that the chat page's
 * client (@/lib/api) does not already have.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0). Paths, methods, headers and bodies are
 * unchanged.
 */
import { apiFetch, getKnowledgeAgentId } from "@/lib/api"

// Already in @/lib/api and reused as-is by the panel.
export { deleteKnowledgeDocument, listKnowledgeDocuments } from "@/lib/api"

/**
 * Central knowledge API helper. Injects X-Agent-ID (and optionally X-Thread-ID)
 * on every /api/knowledge/* request, like knowledgeApiFetch in the original.
 */
function knowledgeApiFetch(url: string, init?: RequestInit, threadId?: string): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
    "X-Agent-ID": getKnowledgeAgentId(),
  }
  if (threadId) headers["X-Thread-ID"] = threadId
  return apiFetch(url, { ...init, headers })
}

// ── health & settings ──────────────────────────────────────────────────────
export function getKnowledgeHealth(): Promise<Response> {
  return knowledgeApiFetch("/api/knowledge/health")
}

export function getKnowledgeAccelerator(): Promise<Response> {
  return apiFetch("/api/manage/knowledge/accelerator")
}

export function getKnowledgeDefaults(): Promise<Response> {
  return apiFetch("/api/manage/knowledge/defaults")
}

// Detected embedding-provider presets from .env / shell environment. Returns
// booleans + suggested config only, never the actual credential values.
export function getKnowledgeEnvPresets(): Promise<Response> {
  return apiFetch("/api/manage/knowledge/env-presets")
}

export function testEmbeddingsConnection(body: {
  provider: string
  model?: string
  api_key?: string
  base_url?: string
  extra_params?: Record<string, unknown>
}): Promise<Response> {
  return apiFetch("/api/manage/knowledge/test_embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Start the knowledge engine on demand. */
export function enableKnowledge(): Promise<Response> {
  return knowledgeApiFetch("/api/knowledge/enable", { method: "POST" })
}

// ── documents (agent scope) ────────────────────────────────────────────────
/**
 * Upload one file. With wait=false the server answers 202 + task_id and the
 * caller polls the task endpoint (the panel's upload flow).
 */
export function uploadKnowledgeDocument(
  file: File,
  replaceDuplicates = true,
  wait = true,
  signal?: AbortSignal
): Promise<Response> {
  const formData = new FormData()
  formData.append("files", file)
  formData.append("scope", "agent")
  formData.append("replace_duplicates", String(replaceDuplicates))
  formData.append("wait", String(wait))
  return knowledgeApiFetch("/api/knowledge/documents", {
    method: "POST",
    body: formData,
    signal,
  })
}

// ── search ─────────────────────────────────────────────────────────────────
export function searchKnowledge(query: string, limit = 10, scoreThreshold = 0): Promise<Response> {
  return knowledgeApiFetch("/api/knowledge/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "agent",
      query,
      limit,
      score_threshold: scoreThreshold,
      include_scores: true,
    }),
  })
}

// ── tasks ──────────────────────────────────────────────────────────────────
export function getKnowledgeTasks(): Promise<Response> {
  return knowledgeApiFetch("/api/knowledge/tasks?scope=agent")
}

export function getKnowledgeTaskStatus(taskId: string, signal?: AbortSignal): Promise<Response> {
  return knowledgeApiFetch(
    `/api/knowledge/tasks/${encodeURIComponent(taskId)}`,
    signal ? { signal } : undefined
  )
}

export function cancelKnowledgeTask(taskId: string): Promise<Response> {
  return knowledgeApiFetch(`/api/knowledge/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  })
}
