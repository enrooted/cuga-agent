/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/types/tools.ts,
 * ToolsConfig.tsx (ConnectedApp, ConnectedTool), SecretsManager.tsx (SecretMeta,
 * SecretsConfig), api.ts (SandboxSettingsStatus) and ManagePage.tsx
 * (normalizeTools, connected tool id fallback)
 * (Copyright IBM Corp., Apache-2.0)
 */

export type ToolType = "mcp" | "openapi"

export type AuthType = "none" | "header" | "bearer" | "api-key" | "basic" | "query"

export interface ToolAuth {
  type: AuthType
  key?: string
  value?: string
}

export type McpTransport = "sse" | "stdio" | "http"

export interface ToolEntry {
  name: string
  type: ToolType
  url?: string
  description?: string
  auth?: ToolAuth
  /** When set, only these tool/operation ids are enabled (registry include list). Omit or empty = all enabled. */
  include?: string[]
  /** Command-based MCP (e.g. npx). When set, transport is stdio. */
  command?: string
  args?: string[]
  /** Environment variables for command-based (stdio) MCP servers. Values may be literal strings or secret refs. */
  env?: Record<string, string>
  transport?: McpTransport
}

export const AUTH_TYPE_OPTIONS: { value: AuthType; label: string; needsKey: boolean }[] = [
  { value: "none", label: "No auth", needsKey: false },
  { value: "header", label: "Header", needsKey: true },
  { value: "bearer", label: "Bearer token", needsKey: false },
  { value: "api-key", label: "API key (query)", needsKey: true },
  { value: "basic", label: "Basic (user:pass)", needsKey: false },
  { value: "query", label: "Query parameter", needsKey: true },
]

export interface ConnectedTool {
  name: string
  id: string
  app: string
  app_type: string
  description: string
}

export interface ConnectedApp {
  name: string
  type: string
  tool_count: number
}

export interface SecretMeta {
  id: string
  agent_id?: string
  created_by?: string
  description?: string
  created_at?: string
  updated_at?: string
  source?: "env" | "vault" | "db"
}

export interface SecretsConfig {
  mode: string
  force_env: boolean
}

/** Code sandbox (execd) settings — independent of agent config draft/publish. */
export interface SandboxSettingsStatus {
  enabled: boolean
  required_by_config: boolean
  /** A sandbox is configured (the binding is mounted), so it can be switched on. */
  available: boolean
  connection: "secret" | "settings"
  effective_url?: string | null
  /** Configuration problem (no URL, no callback URL), or null. */
  error: string | null
  reachable?: boolean | null
  /** Short reason the sandbox did not answer properly; details are in the server log. */
  probe_error?: string
}

/** One variable as the stream reports it (VariablesSidebar / VariablePopup). */
export interface VariableInfo {
  type?: string
  description?: string
  value_preview?: string
  count_items?: number
}

export interface VariablesHistoryItem {
  id: string
  title: string
  timestamp: number
  variables: Record<string, unknown>
}

/**
 * Shape raw `tools` entries of a manage config into ToolEntry[] (ManagePage
 * normalizeTools): string auth becomes bearer, empty include/env are dropped,
 * command entries default to stdio and URL MCP entries to sse.
 */
export function normalizeTools(raw: unknown): ToolEntry[] {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  return list.map((item) => {
    const t = (item ?? {}) as Record<string, unknown>
    const type: ToolType = t.type === "openapi" ? "openapi" : "mcp"
    let auth = t.auth as ToolAuth | string | undefined
    if (typeof auth === "string" && auth) {
      auth = { type: "bearer", value: auth }
    }
    const entry: ToolEntry = {
      name: (t.name as string | undefined) ?? type,
      type,
      url: (t.url as string) || undefined,
      description: t.description as string | undefined,
      auth: auth as ToolAuth | undefined,
    }
    if (Array.isArray(t.include) && t.include.length > 0) {
      entry.include = t.include as string[]
    }
    const envIsObject = t.env != null && typeof t.env === "object" && !Array.isArray(t.env)
    if (envIsObject && Object.keys(t.env as Record<string, unknown>).length > 0) {
      entry.env = t.env as Record<string, string>
    }
    if (t.command != null && String(t.command).trim()) {
      entry.command = String(t.command).trim()
      entry.args = Array.isArray(t.args) ? (t.args as string[]) : []
      if (envIsObject) {
        entry.env = Object.fromEntries(
          Object.entries(t.env as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
        )
      }
      entry.transport = (t.transport as McpTransport) || "stdio"
    } else if (type === "mcp" && entry.url) {
      entry.transport = (t.transport as McpTransport) || "sse"
    }
    return entry
  })
}

/** Shape a `/api/tools/list` response (ManagePage): tools without an id use their name. */
export function normalizeToolsList(data: unknown): { apps: ConnectedApp[]; tools: ConnectedTool[] } {
  const d = (data ?? {}) as { apps?: ConnectedApp[]; tools?: (Omit<ConnectedTool, "id"> & { id?: string })[] }
  return {
    apps: d.apps ?? [],
    tools: (d.tools ?? []).map((t) => ({ ...t, id: t.id ?? t.name })),
  }
}
