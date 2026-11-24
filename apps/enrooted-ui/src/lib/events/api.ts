/*
 * The events layer's HTTP surface: every /api/events/*, /api/concierge and
 * /invoke call. Ported from
 * cuga-agent/src/frontend_workspaces/frontend/src/events/api.ts and the
 * "eventing layer's origin" routing in frontend/src/api.ts
 * (Copyright IBM Corp., Apache-2.0).
 *
 * Same paths, methods, headers and bodies as the original. The origin of a
 * call is decided here instead of inside `apiFetch`: events paths go to
 * `events_api_url` when /api/ui/config sets it, otherwise same origin.
 */
import { apiFetch, eventsBaseUrlSync, getApiBaseUrl, getEventsBaseUrl } from "@/lib/api"

const EVENTS_PATHS = ["/api/events", "/api/concierge", "/invoke"]
// ...except the admin endpoints. Those need the gateway token on the events
// service, which a browser cannot hold, so they go to CUGA: it attaches the
// token and forwards, behind the same auth that protects Manage.
const CORE_ONLY_PATHS = ["/api/events/admin"]

/** `apiFetch` with the original's origin routing for events paths. */
export async function eventsFetch(path: string, init?: RequestInit): Promise<Response> {
  const isEvents = EVENTS_PATHS.some((p) => path.startsWith(p)) && !CORE_ONLY_PATHS.some((p) => path.startsWith(p))
  const base = isEvents ? await getEventsBaseUrl() : getApiBaseUrl()
  return apiFetch(`${base}${path}`, init)
}

const JSON_HEADERS = { "Content-Type": "application/json" }

export interface EventsStatus {
  ok: boolean
  enabled: boolean
  scope: string
  backends: string[]
  /** Who does the hard work of answering (cuga by default). */
  worker_backend?: string
  /** NL → flow control plane (react). */
  concierge_backend?: string
  ap_configured: boolean
  project_grain: string
  features: Record<string, boolean>
}

/**
 * Null unless the events service actually answers; callers use that to hide
 * Studio entirely. With no events service the path is unrouted and a catch-all
 * may answer 200 with HTML, so `res.ok` alone is not trusted: the reply must be
 * JSON and say `enabled: true`.
 */
export async function getEventsStatus(): Promise<EventsStatus | null> {
  try {
    const res = await eventsFetch("/api/events/status")
    if (!res.ok) return null
    const contentType = res.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) return null
    const data = (await res.json()) as EventsStatus
    return data && data.enabled === true ? data : null
  } catch {
    return null
  }
}

export const getEventsChannels = () => eventsFetch("/api/events/channels")
export const getEventsIntegrations = () => eventsFetch("/api/events/integrations")
export const getEventsSubscriptions = () => eventsFetch("/api/events/subscriptions")
export const getEventsFlowDetail = (id: string) => eventsFetch(`/api/events/subscriptions/${encodeURIComponent(id)}/flow`)

// Execution log: recent runs (joined to their subscription), and one run's
// detail with the agent's output.
export const getEventsRuns = () => eventsFetch("/api/events/runs")
export const getEventsRunDetail = (id: string) => eventsFetch(`/api/events/runs/${encodeURIComponent(id)}`)

/**
 * The web channel's mailbox: asynchronous flow fires waiting for this browser.
 *
 * `since` is exclusive: send back the `cursor` you were given and a message is
 * never rendered twice; send 0 to recover the backlog after a reload.
 * `maxAgeSeconds` bounds that first load (the server applies the cutoff with
 * its own clock).
 */
export function getEventsInbox(threadId: string, since = 0, maxAgeSeconds = 86400): Promise<Response> {
  const age = since > 0 ? "" : `&max_age=${encodeURIComponent(String(maxAgeSeconds))}`
  return eventsFetch(`/api/events/inbox?thread_id=${encodeURIComponent(threadId)}&since=${encodeURIComponent(String(since))}${age}`)
}

// The one agent CUGA's sub-agent roster; read-only, the supervisor picks among them.
export const getEventsAgents = () => eventsFetch("/api/events/agents")
// The tool servers a builder can attach to an agent (drives the agent editor).
export const getEventsMcpServers = () => eventsFetch("/api/events/mcp-servers")

export interface AgentSpecBody {
  name: string
  prompt?: string
  /** cuga | react */
  backend?: string
  mcp_servers?: string[]
  channels?: string[]
  /** `triggers` = which of the app's events this agent handles; absent or empty = all. */
  integrations?: { app: string; ownership: string; triggers?: string[] }[]
  access?: string[]
}
/** Create (or upsert) an agent. Idempotent by name. */
export const postEventsAgent = (spec: AgentSpecBody) =>
  eventsFetch("/api/events/agents", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(spec) })
/** Update an existing agent. */
export const putEventsAgent = (name: string, spec: AgentSpecBody) =>
  eventsFetch(`/api/events/agents/${encodeURIComponent(name)}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(spec) })

export const getEventsExamples = () => eventsFetch("/api/events/examples")
// The trigger registry: every (integration, event) the platform can watch, per app.
export const getEventsTriggers = () => eventsFetch("/api/events/triggers")
// The caller's own connected integrations.
export const getEventsConnections = () => eventsFetch("/api/events/connections")
// Per-connector setup guides (how to connect, creds present?, ownership options, steps).
export const getEventsSetupGuides = () => eventsFetch("/api/events/setup-guides")

/**
 * Where to send the user to log in for an integration (OAuth consent). Built on
 * the events origin, synchronously, because it is opened from a click handler.
 */
export function eventsConnectUrl(app: string, ownership?: string): string {
  const own = ownership ? `?ownership=${encodeURIComponent(ownership)}` : ""
  return `${eventsBaseUrlSync()}/api/events/connect/${encodeURIComponent(app)}${own}`
}

/** Set one connector credential (its .env variable). Admin only. */
export const postEventsSetCredential = (key: string, value: string) =>
  eventsFetch("/api/events/admin/credential", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ key, value }) })

/** Token apps (GitHub PAT / Telegram bot): store a pasted token as a per-user or tenant connection. */
export const postEventsConnectToken = (app: string, token: string, ownership?: string) =>
  eventsFetch(`/api/events/connect/${encodeURIComponent(app)}/token`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token, ownership: ownership || "per_user" }),
  })

/** The caller's profile: who they are, roles, linked channels, connections. */
export const getEventsMe = () => eventsFetch("/api/events/me")
/** Issue a link token to bind a channel (Telegram / Discord) to this profile. */
export const postEventsLinkChannel = (channel: string) =>
  eventsFetch(`/api/events/link/${encodeURIComponent(channel)}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) })

// Admin: list / add users (tenant).
export const getEventsAdminUsers = () => eventsFetch("/api/events/admin/users")
export const postEventsAdminUser = (user: { user_id: string; email?: string; roles?: string[]; password?: string }) =>
  eventsFetch("/api/events/admin/users", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(user) })

// Admin: OAuth app credentials (client id / secret per provider).
export const getEventsAdminOAuthApps = () => eventsFetch("/api/events/admin/oauth-apps")
export const postEventsAdminOAuthApp = (app: { app: string; client_id: string; client_secret: string; scopes?: string }) =>
  eventsFetch("/api/events/admin/oauth-apps", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(app) })

/**
 * Talk to the concierge (NL → reuse / create a worker and arm a trigger).
 * `dryRun` returns the plan with no side effects.
 */
export function postConcierge(text: string, opts?: { threadId?: string; dryRun?: boolean; agent?: string }): Promise<Response> {
  const q = opts?.dryRun ? "?dry_run=1" : ""
  return eventsFetch(`/api/concierge${q}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      text,
      thread_id: opts?.threadId ?? "web:studio",
      ...(opts?.agent ? { agent: opts.agent } : {}),
    }),
  })
}

// Flow lifecycle: CUGA drives Activepieces internally, so operators never open the AP console.
export const pauseFlow = (id: string) => eventsFetch(`/api/events/subscriptions/${encodeURIComponent(id)}/pause`, { method: "POST" })
export const resumeFlow = (id: string) => eventsFetch(`/api/events/subscriptions/${encodeURIComponent(id)}/resume`, { method: "POST" })
export const deleteFlow = (id: string) => eventsFetch(`/api/events/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" })
