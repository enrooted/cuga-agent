/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0) — the endpoints used by the tools,
 * secrets and sandbox parts of Manage. Same paths, methods, headers and bodies.
 */
import { apiFetch, getKnowledgeAgentId } from "@/lib/api"

// ── tools ──────────────────────────────────────────────────────────────────
/** Connected apps and tools of an agent: `{ apps, tools }`. */
export function getToolsList(draft?: boolean, agentId: string = getKnowledgeAgentId()): Promise<Response> {
  const params = new URLSearchParams({ agent_id: agentId })
  if (draft) params.set("draft", "1")
  return apiFetch(`/api/tools/list?${params.toString()}`)
}

/** Save the tools list of the draft config. */
export function patchManageConfigDraftTools(
  tools: unknown,
  agentId?: string,
  signal?: AbortSignal
): Promise<Response> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""
  return apiFetch(`/api/manage/config/draft/tools${q}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tools }),
    signal,
  })
}

/** List an MCP gateway instance's servers and tools: with the API key (plain value or saved secret ref), or in signed-in user mode with the caller's own sign-in. */
export function discoverGateway(
  url: string,
  key: { apiKey?: string; apiKeyRef?: string; runAs?: "user" | "service" },
  agentId?: string
): Promise<Response> {
  return apiFetch("/api/manage/gateway/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      api_key: key.apiKey,
      api_key_ref: key.apiKeyRef,
      run_as: key.runAs,
      agent_id: agentId,
    }),
  })
}

// ── secrets ────────────────────────────────────────────────────────────────
export function getSecrets(agentId?: string): Promise<Response> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""
  return apiFetch(`/api/secrets${q}`)
}

export function getSecretsConfig(): Promise<Response> {
  return apiFetch("/api/secrets/config")
}

export function createSecret(
  id: string,
  value: string,
  description?: string,
  tags?: Record<string, string>,
  agentId?: string
): Promise<Response> {
  return apiFetch("/api/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, value, description, tags, agent_id: agentId }),
  })
}

export function updateSecret(
  id: string,
  value: string,
  description?: string,
  tags?: Record<string, string>
): Promise<Response> {
  return apiFetch(`/api/secrets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, description, tags }),
  })
}

export function deleteSecret(id: string): Promise<Response> {
  return apiFetch(`/api/secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

// ── code sandbox ───────────────────────────────────────────────────────────
export function getSandboxSettings(): Promise<Response> {
  return apiFetch(`/api/manage/sandbox`)
}

export function putSandboxSettings(body: { enabled: boolean }): Promise<Response> {
  return apiFetch(`/api/manage/sandbox`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function refreshSandboxSettings(): Promise<Response> {
  return apiFetch(`/api/manage/sandbox/refresh`, { method: "POST" })
}
