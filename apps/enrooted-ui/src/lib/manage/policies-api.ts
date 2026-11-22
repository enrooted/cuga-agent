/*
 * Policies editor: data types and HTTP calls.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * and cuga-agent/src/frontend_workspaces/frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0).
 *
 * Paths, methods, headers and bodies are the same as in the Carbon UI. The
 * Carbon editor never sends an agent id (the server then resolves the default
 * agent); `agentId` is optional here and, when left out, the requests are
 * byte-for-byte the original ones.
 */

import { apiFetch, getKnowledgeAgentId } from "@/lib/api"

// ── policy model ───────────────────────────────────────────────────────────
export interface PolicyTrigger {
  type: "keyword" | "natural_language" | "app" | "always"
  value?: string | string[]
  target?: string
  case_sensitive?: boolean
  threshold?: number
  operator?: "and" | "or"
}

export interface IntentGuardPolicy {
  id: string
  name: string
  description: string
  policy_type: "intent_guard"
  enabled: boolean
  triggers: PolicyTrigger[]
  response: {
    response_type: "natural_language" | "json"
    content: string
  }
  allow_override: boolean
  priority: number
}

export interface PlaybookStep {
  step_number: number
  instruction: string
  expected_outcome: string
  tools_allowed?: string[]
}

export interface PlaybookPolicy {
  id: string
  name: string
  description: string
  policy_type: "playbook"
  enabled: boolean
  triggers: PolicyTrigger[]
  markdown_content: string
  steps: PlaybookStep[]
  priority: number
}

export interface ToolGuardData {
  violating_examples?: string[]
  compliance_examples?: string[]
  policy_code?: string
}

export interface ToolGuidePolicy {
  id: string
  name: string
  description: string
  policy_type: "tool_guide"
  enabled: boolean
  triggers: PolicyTrigger[]
  target_tools: string[]
  target_apps?: string[]
  guide_content: string
  prepend: boolean
  priority: number
  tool_guards?: Record<string, ToolGuardData> | null
  guards_enabled?: boolean
}

export interface ToolApprovalPolicy {
  id: string
  name: string
  description: string
  policy_type: "tool_approval"
  enabled: boolean
  triggers: PolicyTrigger[]
  required_tools: string[]
  required_apps?: string[]
  approval_message?: string
  show_code_preview: boolean
  auto_approve_after?: number
  priority: number
}

export interface OutputFormatterPolicy {
  id: string
  name: string
  description: string
  policy_type: "output_formatter"
  enabled: boolean
  triggers: PolicyTrigger[]
  format_type: "markdown" | "json_schema" | "direct"
  format_config: string
  priority: number
}

export type Policy =
  | IntentGuardPolicy
  | PlaybookPolicy
  | ToolGuidePolicy
  | ToolApprovalPolicy
  | OutputFormatterPolicy

export type PolicyType = Policy["policy_type"]

export interface PoliciesConfigData {
  enablePolicies: boolean
  policies: Policy[]
}

export interface ToolInfo {
  name: string
  app: string
  app_type: string
  description: string
}

export interface AppInfo {
  name: string
  type: string
  tool_count: number
}

/** Result of POST /api/config/policies/{id}/tool-guards/generate. */
export interface ToolGuardGenerateResult {
  config_synced?: boolean
  sync_error?: string | null
  tool_guards?: Record<string, ToolGuardData>
  results?: { tool: string; status: string }[]
}

// ── helpers ────────────────────────────────────────────────────────────────
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * A natural-language trigger's value is always sent and edited as a list; older
 * configs stored a single string. Same normalisation as the Carbon editor
 * (applied on load, on import and before save).
 */
export function normalizePolicies(policies: readonly unknown[]): Policy[] {
  return policies.filter(isRecord).map((raw) => {
    const policy = raw as unknown as Policy
    const triggers: PolicyTrigger[] = Array.isArray(policy.triggers) ? policy.triggers : []
    return {
      ...policy,
      triggers: triggers.map((trigger) => {
        if (trigger.type === "natural_language" && trigger.value !== undefined) {
          const value = Array.isArray(trigger.value)
            ? trigger.value
            : typeof trigger.value === "string"
              ? [trigger.value]
              : []
          return { ...trigger, value }
        }
        return trigger
      }),
    }
  })
}

/** Reads `error` / `message` from a JSON error body, else the raw text, else the fallback. */
export async function readErrorMessage(
  response: Response,
  fallback: string,
  keys: readonly string[] = ["error", "message"]
): Promise<string> {
  const text = await response.text().catch(() => "")
  try {
    const data: unknown = JSON.parse(text)
    if (isRecord(data)) {
      for (const key of keys) {
        const value = data[key]
        if (typeof value === "string" && value) return value
      }
    }
    return fallback
  } catch {
    return text || fallback
  }
}

const agentQuery = (agentId?: string) => (agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "")

// ── endpoints ──────────────────────────────────────────────────────────────
/** GET /api/manage/config[?draft=1][&agent_id=…] → `{ config: { policies: {enablePolicies, policies}, … } }` */
export function getManageConfig(draft?: boolean, agentId?: string): Promise<Response> {
  const params = new URLSearchParams()
  if (draft) params.set("draft", "1")
  if (agentId) params.set("agent_id", agentId)
  const q = params.toString()
  return apiFetch(`/api/manage/config${q ? `?${q}` : ""}`)
}

/** GET /api/tools/list?agent_id=…[&draft=1] → `{ tools: ToolInfo[], apps: AppInfo[] }` */
export function getToolsList(draft?: boolean, agentId: string = getKnowledgeAgentId()): Promise<Response> {
  const params = new URLSearchParams({ agent_id: agentId })
  if (draft) params.set("draft", "1")
  return apiFetch(`/api/tools/list?${params.toString()}`)
}

/** PATCH /api/manage/config/draft/policies — body `{ policies: {enablePolicies, policies} }` */
export function patchManageConfigDraftPolicies(policies: unknown, agentId?: string): Promise<Response> {
  return apiFetch(`/api/manage/config/draft/policies${agentQuery(agentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policies }),
  })
}

/** POST /api/manage/config — body `{ config: <whole config> }` (non-draft save). */
export function postManageConfig(config: unknown, agentId?: string): Promise<Response> {
  return apiFetch(`/api/manage/config${agentQuery(agentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  })
}

/** POST /api/config/policies/{id}/tool-guards/generate — no body; `X-Use-Draft: true` in draft mode. */
export function generateToolGuards(policyId: string, draft?: boolean): Promise<Response> {
  const headers: Record<string, string> = {}
  if (draft) headers["X-Use-Draft"] = "true"
  return apiFetch(`/api/config/policies/${encodeURIComponent(policyId)}/tool-guards/generate`, {
    method: "POST",
    headers,
  })
}

/**
 * Save the policies section. Draft: one PATCH. Published: load the whole
 * config first and POST it back with only `policies` replaced, so the other
 * sections are not overwritten. `loadFailed` carries the GET response when
 * that first step failed (nothing was written).
 */
export async function savePolicies(
  data: PoliciesConfigData,
  draft: boolean,
  agentId?: string
): Promise<{ response: Response; loadFailed: boolean }> {
  if (draft) return { response: await patchManageConfigDraftPolicies(data, agentId), loadFailed: false }
  const loadResponse = await getManageConfig(false, agentId)
  if (!loadResponse.ok) return { response: loadResponse, loadFailed: true }
  const loadData: unknown = await loadResponse.json()
  const existing = isRecord(loadData) && isRecord(loadData.config) ? loadData.config : {}
  return { response: await postManageConfig({ ...existing, policies: data }, agentId), loadFailed: false }
}
