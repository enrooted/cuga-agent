/*
 * Manage (agent configuration) endpoints. Ported from
 * cuga-agent/src/frontend_workspaces/frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0). Paths, methods and bodies are unchanged.
 */
import { apiFetch, getKnowledgeAgentId } from "@/lib/api"

const agentQuery = (agentId?: string) => (agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "")
const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
})

// ── agents ─────────────────────────────────────────────────────────────────
export const createAgent = (name: string, description: string, kind: "single" | "supervisor") =>
  apiFetch("/api/agents", json("POST", { name, description, kind }))

export const deleteAgent = (agentId: string) => apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" })

// ── config: read ───────────────────────────────────────────────────────────
export function getManageConfigVersion(version: string, agentId?: string) {
  const params = new URLSearchParams({ version })
  if (agentId) params.set("agent_id", agentId)
  return apiFetch(`/api/manage/config?${params.toString()}`)
}

export const getManageConfigHistory = (agentId?: string) => apiFetch(`/api/manage/config/history${agentQuery(agentId)}`)

export function getLlmModels(apiKey: string, disableSsl?: boolean, provider?: string) {
  const params = new URLSearchParams()
  if (disableSsl) params.set("disable_ssl", "true")
  if (provider) params.set("provider", provider)
  const q = params.toString() ? `?${params.toString()}` : ""
  const headers: Record<string, string> = {}
  if (apiKey) headers["X-LLM-API-Key"] = apiKey
  return apiFetch(`/api/manage/llm/models${q}`, { headers })
}

// ── config: draft + publish ────────────────────────────────────────────────
// Each autosave helper takes an optional AbortSignal so a newer save can cancel
// an in-flight one.
export const postManageConfigDraft = (config: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config/draft${agentQuery(agentId)}`, json("POST", { config }, signal))

export const patchManageConfigDraftAgent = (
  agent: { name?: string; description?: string; kind?: "single" | "supervisor" },
  agentId?: string,
  signal?: AbortSignal
) => apiFetch(`/api/manage/config/draft/agent${agentQuery(agentId)}`, json("PATCH", { agent }, signal))

export const patchManageConfigDraftLlm = (llm: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config/draft/llm${agentQuery(agentId)}`, json("PATCH", { llm }, signal))

export const patchManageConfigDraftTools = (tools: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config/draft/tools${agentQuery(agentId)}`, json("PATCH", { tools }, signal))

export const patchManageConfigDraftPolicies = (policies: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config/draft/policies${agentQuery(agentId)}`, json("PATCH", { policies }, signal))

export const patchManageConfigDraftSupervisor = (supervisor: unknown, agentId?: string, signal?: AbortSignal, saveSeq?: number) =>
  apiFetch(
    `/api/manage/config/draft/supervisor${agentQuery(agentId)}`,
    json("PATCH", { supervisor, ...(saveSeq != null ? { saveSeq } : {}) }, signal)
  )

export const patchManageConfigDraftSpecialInstructions = (specialInstructions: string, agentId?: string, signal?: AbortSignal) =>
  apiFetch(
    `/api/manage/config/draft/special_instructions${agentQuery(agentId)}`,
    json("PATCH", { special_instructions: specialInstructions }, signal)
  )

export const patchManageConfigDraftKnowledge = (knowledge: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config/draft/knowledge${agentQuery(agentId)}`, json("PATCH", { knowledge }, signal))

export const postManageConfig = (config: unknown, agentId?: string, signal?: AbortSignal) =>
  apiFetch(`/api/manage/config${agentQuery(agentId)}`, json("POST", { config }, signal))

/** Migrate + re-index after a vector-config change (embedder, chunking, metric). */
export const triggerKnowledgeReindexForConfig = (agentId?: string) =>
  apiFetch(`/api/manage/knowledge/reindex_for_config${agentQuery(agentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })

// ── knowledge calls made by the page itself (the panel has its own module) ──
const knowledgeHeaders = (extra?: Record<string, string>) => ({ ...extra, "X-Agent-ID": getKnowledgeAgentId() })

export const getKnowledgeSettings = () => apiFetch("/api/knowledge/settings", { headers: knowledgeHeaders() })

/** Plain re-index of the agent's collection (no config change). */
export const triggerKnowledgeReindex = () =>
  apiFetch("/api/knowledge/reindex", {
    method: "POST",
    headers: knowledgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ scope: "agent" }),
  })
