/*
 * CUGA HTTP API client for the shadcn chat UI.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0) — only the endpoints the chat page uses.
 *
 * The UI is served by its own nginx container in the same pod as CUGA; nginx
 * proxies every non-UI path (/stream, /stop, /api/*, /auth/*) to CUGA, so the
 * API is always same-origin.
 */

export function getApiBaseUrl(): string {
  return window.location.origin
}

let agentIdContext = "cuga-default"
/** Default X-Agent-ID / agent_id for calls made without an explicit agent. */
export function setKnowledgeAgentId(agentId: string) {
  agentIdContext = agentId
}
export function getKnowledgeAgentId(): string {
  return agentIdContext
}

// ── auth ───────────────────────────────────────────────────────────────────
export type AuthConfig = { enabled: boolean; authorization_enabled: boolean }
let authConfigCache: AuthConfig | null = null
export async function getAuthConfig(): Promise<AuthConfig> {
  if (authConfigCache) return authConfigCache
  const res = await fetch("/api/auth/config", { credentials: "include" })
  if (!res.ok) throw new Error(`Cannot read authentication settings (HTTP ${res.status})`)
  const data = await res.json()
  authConfigCache = {
    enabled: !!data.enabled,
    authorization_enabled: !!data.authorization_enabled,
  }
  return authConfigCache
}

// One login redirect per attempt: a failed callback or userinfo must not loop
// between this page and the identity provider (Carbon UI auth.ts).
const LOGIN_IN_PROGRESS_KEY = "cuga_login_in_progress"
export function isLoginInProgress(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_IN_PROGRESS_KEY) === "1"
  } catch {
    return false
  }
}
export function markLoginInProgress() {
  try {
    sessionStorage.setItem(LOGIN_IN_PROGRESS_KEY, "1")
  } catch {
    /* storage unavailable */
  }
}
export function clearLoginInProgress() {
  try {
    sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY)
  } catch {
    /* storage unavailable */
  }
}

// Set by "Sign out" so the app shows a signed-out page with a Sign in button
// instead of sending the user straight back to the identity provider.
const SIGNED_OUT_KEY = "cuga_signed_out"
export function isSignedOut(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === "1"
  } catch {
    return false
  }
}
function setSignedOut(value: boolean) {
  try {
    if (value) localStorage.setItem(SIGNED_OUT_KEY, "1")
    else localStorage.removeItem(SIGNED_OUT_KEY)
  } catch {
    /* storage unavailable */
  }
}
export const clearSignedOut = () => setSignedOut(false)

/** Start a sign-in the user asked for (Sign in / Try again buttons). */
export function login() {
  setSignedOut(false)
  clearLoginInProgress()
  markLoginInProgress()
  window.location.href = "/auth/login"
}

let loginRedirecting = false
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "include" })
  if (res.status === 401 && !loginRedirecting) {
    const config = await getAuthConfig().catch(() => null)
    if (config?.enabled && !isSignedOut()) {
      loginRedirecting = true
      window.location.href = "/auth/login"
    }
  }
  return res
}

export type UserInfo = {
  sub?: string
  name?: string
  email?: string
  roles?: string[]
  canManage?: boolean
}
export async function getUserInfo(): Promise<UserInfo | null> {
  // AuthProvider owns the initial redirect and the one-time PKCE transaction.
  const res = await fetch("/auth/userinfo", { credentials: "include" })
  if (!res.ok) return null
  const data = await res.json()
  return {
    name: data.name,
    email: data.email,
    sub: data.sub,
    roles: data.roles || [],
    canManage: data.can_manage === true,
  }
}

/** OIDC redirect lands with ?code&state: exchange it like the Carbon UI does. */
export async function handleOidcCallback(code: string, state: string) {
  const res = await fetch("/auth/callback", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  })
  const url = new URL(window.location.href)
  url.searchParams.delete("code")
  url.searchParams.delete("state")
  window.history.replaceState(null, "", url.pathname + url.search + url.hash)
  return res.ok
}
export async function logout(): Promise<void> {
  const res = await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined)
  // End the identity provider's session too, or SSO signs the user straight back in.
  const data = (await res?.json().catch(() => null)) as { end_session_url?: string } | null
  setSignedOut(true)
  window.location.href = data?.end_session_url || "/"
}

// ── ui config ──────────────────────────────────────────────────────────────
export type UiConfig = {
  hide_cuga_logo: boolean
  brand_name: string
  agent_registry: boolean
  evolve_memory_enabled: boolean
  /** Origin of the events service in a split deployment ("" = same origin). */
  events_api_url: string
}
let uiConfigCache: Promise<UiConfig> | null = null
export function getUiConfig(): Promise<UiConfig> {
  uiConfigCache ??= fetch("/api/ui/config", { credentials: "include" })
    .then((r) => r.json())
    .catch(() => ({}))
    .then((data) => ({
      hide_cuga_logo: !!data.hide_cuga_logo,
      brand_name:
        data.brand_name && String(data.brand_name).trim()
          ? String(data.brand_name).trim()
          : "CUGA Agent",
      agent_registry: !!data.agent_registry,
      evolve_memory_enabled: !!data.evolve_memory_enabled,
      events_api_url: String(data.events_api_url ?? "").replace(/\/$/, ""),
    }))
  return uiConfigCache
}

// ── the eventing layer's origin ────────────────────────────────────────────
// EVENTS_API_URL unset: same origin (also the fallback when /api/ui/config
// cannot be read). Split deployment: /api/events/*, /api/concierge and /invoke
// live on the events service, and /api/ui/config says where. Resolved once.
// The callers are in @/lib/events/api.
let eventsBaseCache: string | null = null
export async function getEventsBaseUrl(): Promise<string> {
  if (eventsBaseCache !== null) return eventsBaseCache
  const resolved = await getUiConfig()
    .then((c) => c.events_api_url || getApiBaseUrl())
    .catch(() => getApiBaseUrl())
  eventsBaseCache = resolved
  return resolved
}
/**
 * The resolved events origin, synchronously, for `window.open` inside a click
 * handler (awaiting first loses the user gesture and the popup is blocked).
 * A cold cache falls back to same origin and starts the resolution.
 */
export function eventsBaseUrlSync(): string {
  if (eventsBaseCache !== null) return eventsBaseCache
  void getEventsBaseUrl()
  return getApiBaseUrl()
}


// ── agent / config ─────────────────────────────────────────────────────────
export const getAgentContext = () => apiFetch("/api/agent/context")
export const getAgents = () => apiFetch("/api/agents")

export function getManageConfig(draft?: boolean, agentId?: string) {
  const params = new URLSearchParams()
  if (draft) params.set("draft", "1")
  if (agentId) params.set("agent_id", agentId)
  const q = params.toString()
  return apiFetch(`/api/manage/config${q ? `?${q}` : ""}`)
}

export function getToolsList(draft = false, agentId = getKnowledgeAgentId()) {
  const params = new URLSearchParams({ agent_id: agentId })
  if (draft) params.set("draft", "1")
  return apiFetch(`/api/tools/list?${params}`)
}

export const getSkills = () => apiFetch("/api/skills")

export interface SlashCommandInfo {
  name: string
  kind: "skill"
  description: string
  argument_hint: string | null
}
export async function getCommands(): Promise<SlashCommandInfo[]> {
  const res = await apiFetch("/api/commands")
  if (!res.ok) throw new Error(`Failed to load slash commands: HTTP ${res.status}`)
  const data = await res.json().catch(() => ({ commands: [] }))
  const commands: unknown[] = Array.isArray(data?.commands) ? data.commands : []
  return commands.map((c) => {
    const cmd = c as Record<string, unknown>
    return {
      name: String(cmd?.name ?? ""),
      kind: "skill" as const,
      description: typeof cmd?.description === "string" ? cmd.description : "",
      argument_hint: typeof cmd?.argument_hint === "string" ? cmd.argument_hint : null,
    }
  })
}

// ── chat transport ─────────────────────────────────────────────────────────
export function postStream(
  body: object,
  options: {
    threadId: string
    agentId?: string
    useDraft?: boolean
    disableHistory?: boolean
    signal?: AbortSignal
  }
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Thread-ID": options.threadId,
    "X-Agent-ID": options.agentId || getKnowledgeAgentId(),
  }
  if (options.useDraft) headers["X-Use-Draft"] = "true"
  if (options.disableHistory) headers["X-Disable-History"] = "true"
  return apiFetch("/stream", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  })
}

export function postStop(threadId: string) {
  return apiFetch("/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Thread-ID": threadId },
    body: JSON.stringify({ thread_id: threadId }),
  })
}

// ── conversations ──────────────────────────────────────────────────────────
const agentParam = (agentId?: string) =>
  encodeURIComponent(agentId || getKnowledgeAgentId())

export async function getConversationThreads(agentId: string) {
  const res = await apiFetch(`/api/conversations?agent_id=${agentParam(agentId)}`)
  if (!res.ok) throw new Error(`Cannot load conversations (HTTP ${res.status})`)
  const rows: { id: string; title: string; timestamp: number; status: string }[] = await res.json()
  return rows.map((row) => ({
    thread_id: row.id, first_message: row.title, updated_at: new Date(row.timestamp).toISOString(), status: row.status,
  }))
}

export const getConversationStreamEvents = (threadId: string, agentId?: string) =>
  apiFetch(
    `/api/conversation-stream-events/${threadId}?agent_id=${agentParam(agentId)}&user_id=default_user`
  )

export const getConversationMessages = (threadId: string, agentId?: string) =>
  apiFetch(
    `/api/conversation-messages/${threadId}?agent_id=${agentParam(agentId)}&user_id=default_user`
  )

export const deleteConversation = (threadId: string, agentId?: string) =>
  apiFetch(`/api/conversations/${threadId}?agent_id=${agentParam(agentId)}`, {
    method: "DELETE",
  })

// ── workspace ──────────────────────────────────────────────────────────────
export function getWorkspaceTree(threadId?: string, forceRefresh = false) {
  const params = new URLSearchParams()
  if (threadId) params.set("thread_id", threadId)
  if (forceRefresh) params.set("_", String(Date.now()))
  const q = params.toString()
  return apiFetch(`/api/workspace/tree${q ? `?${q}` : ""}`)
}
export function getWorkspaceFile(path: string, threadId?: string) {
  const params = new URLSearchParams({ path })
  if (threadId) params.set("thread_id", threadId)
  return apiFetch(`/api/workspace/file?${params}`)
}
export function getWorkspaceDownload(path: string, threadId?: string) {
  const params = new URLSearchParams({ path })
  if (threadId) params.set("thread_id", threadId)
  return apiFetch(`/api/workspace/download?${params}`)
}
export function uploadWorkspaceFile(file: File, threadId: string) {
  const form = new FormData()
  form.append("file", file)
  return apiFetch(`/api/workspace/upload?${new URLSearchParams({ thread_id: threadId })}`, {
    method: "POST",
    headers: { "X-Thread-ID": threadId },
    body: form,
  })
}

// ── knowledge ──────────────────────────────────────────────────────────────
function knowledgeFetch(url: string, init?: RequestInit, threadId?: string) {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
    "X-Agent-ID": agentIdContext,
  }
  if (threadId) headers["X-Thread-ID"] = threadId
  return apiFetch(url, { ...init, headers })
}

export const listKnowledgeDocuments = () =>
  knowledgeFetch("/api/knowledge/documents?scope=agent")

export const listSessionKnowledgeDocuments = (threadId: string) =>
  knowledgeFetch("/api/knowledge/documents?scope=session", undefined, threadId)

function uploadKnowledge(scope: "agent" | "session", files: File[], threadId?: string) {
  const form = new FormData()
  files.forEach((f) => form.append("files", f))
  form.append("scope", scope)
  form.append("replace_duplicates", "true")
  return knowledgeFetch("/api/knowledge/documents", { method: "POST", body: form }, threadId)
}
export const uploadKnowledgeDocuments = (files: File[]) => uploadKnowledge("agent", files)
export const uploadSessionKnowledgeDocuments = (threadId: string, files: File[]) =>
  uploadKnowledge("session", files, threadId)

function deleteKnowledge(scope: "agent" | "session", filename: string, threadId?: string) {
  return knowledgeFetch(
    "/api/knowledge/documents",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, filename }),
    },
    threadId
  )
}
export const deleteKnowledgeDocument = (filename: string) => deleteKnowledge("agent", filename)
export const deleteSessionKnowledgeDocument = (threadId: string, filename: string) =>
  deleteKnowledge("session", filename, threadId)

export const deleteSessionKnowledgeCollection = (threadId: string) =>
  knowledgeFetch("/api/knowledge/session", { method: "DELETE" }, threadId)

export function getKnowledgeDocumentFile(
  scope: "agent" | "session",
  filename: string,
  threadId?: string
) {
  return knowledgeFetch(
    `/api/knowledge/documents/file?${new URLSearchParams({ scope, filename })}`,
    undefined,
    threadId
  )
}

export async function getSessionKnowledgeSettings(threadId: string) {
  const res = await knowledgeFetch("/api/knowledge/session/settings", { method: "GET" }, threadId)
  if (!res.ok) throw new Error(`session settings: ${res.status}`)
  return (await res.json()) as { overrides: Record<string, unknown> }
}

export async function patchSessionKnowledgeSettings(
  threadId: string,
  patch: { citations_enabled?: boolean }
) {
  const res = await knowledgeFetch(
    "/api/knowledge/session/settings",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    threadId
  )
  if (!res.ok) throw new Error(`session settings patch: ${res.status}`)
  return res.json()
}

// ── helpers ────────────────────────────────────────────────────────────────
/** Save a fetched blob as a file (same technique as the Carbon UI). */
export async function saveResponseAsFile(res: Response, filename: string) {
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
