/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/types/tools.ts,
 * ToolsConfig.tsx (ConnectedApp, ConnectedTool), SecretsManager.tsx (SecretMeta,
 * SecretsConfig), api.ts (SandboxSettingsStatus) and ManagePage.tsx
 * (normalizeTools, connected tool id fallback)
 * (Copyright IBM Corp., Apache-2.0)
 */

export type ToolType = "mcp" | "openapi"

export type AuthType =
  | "none"
  | "header"
  | "bearer"
  | "api-key"
  | "basic"
  | "query"
  /** MCP gateway instance API key, exchanged by the registry for an instance token. */
  | "account_iam_apikey"

export const KEYCLOAK_USER_EXCHANGE = "keycloak_user_exchange"

export type ToolAuth =
  | { type: AuthType; key?: string; value?: string; mode?: never; profile?: never }
  // The registry also accepts the legacy `type` spelling for delegated MCP tools.
  | { mode?: typeof KEYCLOAK_USER_EXCHANGE; type?: typeof KEYCLOAK_USER_EXCHANGE; profile: string; key?: never; value?: never }

export type McpTransport = "sse" | "stdio" | "http"

/** Who the gateway sees on a tool call: the signed-in user, or the instance API key's service ID. */
export type GatewayRunAs = "user" | "service"

/** A tool definition as the gateway lists it (saved with signed-in user entries). */
export interface GatewayToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

/** MCP gateway instance entry. `url` holds the instance URL (https://<gateway>/?instance=<id>). */
export interface ToolGateway {
  instance_url: string
  run_as: GatewayRunAs
  /** Signed-in user mode: the selected tools' definitions, so the registry needs no API key. */
  tools?: GatewayToolDef[]
}

/** A tool the gateway instance exposes, grouped by the gateway's MCP server. */
export interface GatewayServer {
  name: string
  tools: GatewayToolDef[]
}

const GATEWAY_INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

/** The instance ID of a gateway instance URL, or null when the URL is not one. */
export function parseGatewayInstanceUrl(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    const id = (u.searchParams.get("instance") ?? "").trim()
    return GATEWAY_INSTANCE_RE.test(id) ? id : null
  } catch {
    return null
  }
}

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
  /** Set for an MCP gateway instance; `include` then lists the selected gateway tools. */
  gateway?: ToolGateway
}

/** `labelKey` is a translation key in the "tools" namespace; translate it where it is rendered. */
export const AUTH_TYPE_OPTIONS: { value: AuthType; labelKey: string; needsKey: boolean }[] = [
  { value: "none", labelKey: "authType.none", needsKey: false },
  { value: "header", labelKey: "authType.header", needsKey: true },
  { value: "bearer", labelKey: "authType.bearer", needsKey: false },
  { value: "api-key", labelKey: "authType.apiKey", needsKey: true },
  { value: "basic", labelKey: "authType.basic", needsKey: false },
  { value: "query", labelKey: "authType.query", needsKey: true },
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
    } else if (type === "mcp" && t.gateway != null && typeof t.gateway === "object") {
      const gw = t.gateway as Record<string, unknown>
      entry.gateway = {
        instance_url: String(gw.instance_url ?? entry.url ?? ""),
        run_as: gw.run_as === "user" ? "user" : "service",
        ...(Array.isArray(gw.tools) ? { tools: gw.tools as GatewayToolDef[] } : {}),
      }
      entry.transport = "http"
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
