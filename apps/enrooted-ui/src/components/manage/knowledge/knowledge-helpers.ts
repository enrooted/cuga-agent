/*
 * Pure helpers for the Knowledge panel: re-index labels, provider field spec,
 * in-flight upload persistence, abortable sleep and JSON narrowing.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import type { ReindexTask } from "@/lib/manage/knowledge-types"

// ── JSON narrowing ─────────────────────────────────────────────────────────
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

/** Parse a response body as JSON; null when it is not JSON. */
export async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

/** First file_tasks entry's error of a task payload, if any. */
export function firstFileTaskError(task: Record<string, unknown> | null): string | undefined {
  const fileTasks = asRecord(task?.file_tasks)
  if (!fileTasks) return undefined
  const first = asRecord(Object.values(fileTasks)[0])
  return asString(first?.error) || undefined
}

// ── re-index progress labels ───────────────────────────────────────────────
export function getReindexTaskProgressLabel(task: ReindexTask): string | undefined {
  if (!task.file_tasks) return undefined
  const firstEntry = Object.values(task.file_tasks)[0]
  if (!firstEntry?.stage) return undefined
  const { stage, progress } = firstEntry
  const done = progress?.done
  const total = progress?.total
  // Map raw backend stage names to friendly labels.
  const friendly: Record<string, string> = {
    parsed: "Parsed",
    embed: "Embedding",
    insert_start: "Saving",
    insert: "Saving",
  }
  const label = friendly[stage] ?? stage
  if (typeof done === "number" && typeof total === "number" && total > 0) {
    return `${label} (${done}/${total})`
  }
  return label
}

export function getReindexTaskFilename(task: ReindexTask): string | undefined {
  if (task.filename) return task.filename
  if (!task.file_tasks) return undefined
  return Object.values(task.file_tasks)[0]?.filename
}

export function getReindexTaskError(task: ReindexTask): string | undefined {
  if (!task.file_tasks) return undefined
  return Object.values(task.file_tasks)[0]?.error || undefined
}

export function getReindexStatusLabel(status: ReindexTask["status"]): string {
  if (status === "running") return "Indexing"
  if (status === "completed") return "Completed"
  if (status === "failed") return "Failed"
  return "Pending"
}

// Narrative phase headline for the re-index tile: says what is happening right
// now so a 90-second model download does not read as "stuck on 0 of 1". Driven
// by the per-task `stage` the engine emits (parsed / embed / insert /
// insert_start); no stage yet = still preparing.
export function getReindexPhaseHeadline(tasks: ReindexTask[]): string {
  // "Preparing" only while EVERY task is still pending. Once any task is
  // running the worker is doing real work even if no stage event arrived yet.
  if (tasks.length === 0 || tasks.every((t) => t.status === "pending")) {
    return "Preparing your new reading model"
  }
  const stages = tasks
    .flatMap((t) => Object.values(t.file_tasks ?? {}).map((ft) => ft.stage))
    .filter(Boolean)
  if (stages.some((s) => s === "insert" || s === "insert_start")) {
    return "Filing everything in its new place"
  }
  return "Re-reading your documents"
}

// Honest elapsed timer: "Running for 47s" beats a fake countdown. Bands switch
// at 60 s / 5 min to keep the unit readable.
export function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 300) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 60)}m`
}

// Merge backend tasks by task_id over the placeholder list so a partial poll
// (some tasks not yet visible in metadata) does not drop placeholder rows: the
// tile keeps showing all N rows, enriched with filename + status as they arrive.
export function mergeTasksById(
  taskIds: string[],
  placeholders: ReindexTask[],
  backendTasks: ReindexTask[]
): ReindexTask[] {
  const byId = new Map<string, ReindexTask>(placeholders.map((t) => [t.task_id, t]))
  for (const t of backendTasks) {
    const enriched = { ...t, filename: getReindexTaskFilename(t) }
    const prev = byId.get(t.task_id)
    byId.set(t.task_id, prev ? { ...prev, ...enriched } : enriched)
  }
  return taskIds.map((id) => byId.get(id) ?? { task_id: id, status: "pending" as const })
}

/** `tasks` array of a GET /api/knowledge/tasks body. */
export function tasksFromBody(body: unknown): ReindexTask[] {
  const tasks = asRecord(body)?.tasks
  if (!Array.isArray(tasks)) return []
  return tasks.filter(
    (t): t is ReindexTask => asRecord(t) !== null && typeof (t as ReindexTask).task_id === "string"
  )
}

// ── provider field spec ────────────────────────────────────────────────────
// Each provider carries its own needsKey/needsBaseUrl/keyRequired/modelRequired/
// cloud so field visibility, required-ness, the security-critical field RESET and
// the "not detected" logic all derive from ONE source.
// (`cloud` = participates in the server's detected env-preset list.)
export interface ProviderSpec {
  id?: string
  needsKey?: boolean
  needsBaseUrl?: boolean
  keyRequired?: boolean
  modelRequired?: boolean
  cloud?: boolean
}

export const KNOWLEDGE_PROVIDER_ITEMS: ProviderSpec[] = [
  { id: "auto" },
  { id: "fastembed" },
  { id: "ollama", needsKey: true, needsBaseUrl: true },
  { id: "huggingface" },
  { id: "openai", needsKey: true, needsBaseUrl: true, cloud: true },
  { id: "openrouter", needsKey: true, keyRequired: true, modelRequired: true, cloud: true },
  { id: "litellm", needsKey: true, needsBaseUrl: true, modelRequired: true, cloud: true },
]

// Field spec for a provider id (an empty spec for auto/fastembed/huggingface/
// unknown, which need no credentials).
export const providerSpec = (id: string | undefined | null): ProviderSpec =>
  KNOWLEDGE_PROVIDER_ITEMS.find((it) => it.id === id) ?? {}

// Live URL validation, conservative: empty is OK (optional fields), anything
// non-empty must start with http:// or https://.
export function validateBaseUrl(url: string | undefined): string | null {
  const trimmed = (url ?? "").trim()
  if (!trimmed) return null
  if (!/^https?:\/\/.+/i.test(trimmed)) return "Must start with http:// or https://"
  return null
}

// ── in-flight upload persistence ───────────────────────────────────────────
// Survives modal close + page reload so the user sees the row continue rather
// than vanish. Cleared whenever a task lands in a terminal state.
const ACTIVE_UPLOADS_LS_KEY = "cuga.knowledge.activeUploads"
// Drop entries older than 1 h to avoid resurrecting tasks the server has long
// since garbage-collected.
const ACTIVE_UPLOADS_TTL_MS = 60 * 60 * 1000

export interface PersistedUpload {
  taskId: string
  name: string
  createdAt: number
}

export function loadActiveUploads(): PersistedUpload[] {
  try {
    const raw = localStorage.getItem(ACTIVE_UPLOADS_LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed.filter((entry): entry is PersistedUpload => {
      const e = asRecord(entry)
      if (!e) return false
      return (
        typeof e.taskId === "string" &&
        typeof e.name === "string" &&
        typeof e.createdAt === "number" &&
        now - e.createdAt < ACTIVE_UPLOADS_TTL_MS
      )
    })
  } catch {
    // Quota errors, private-mode storage, etc.: degrade silently; resume just
    // won't work, uploads still do.
    return []
  }
}

function saveActiveUploads(entries: PersistedUpload[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(ACTIVE_UPLOADS_LS_KEY)
    else localStorage.setItem(ACTIVE_UPLOADS_LS_KEY, JSON.stringify(entries))
  } catch {
    // Persistence is best-effort.
  }
}

export function addActiveUpload(entry: PersistedUpload): void {
  const current = loadActiveUploads().filter((e) => e.taskId !== entry.taskId)
  current.push(entry)
  saveActiveUploads(current)
}

export function removeActiveUpload(taskId: string): void {
  saveActiveUploads(loadActiveUploads().filter((e) => e.taskId !== taskId))
}

// ── "Advanced settings" preference ─────────────────────────────────────────
const ADVANCED_LS_KEY = "cuga.knowledge.advanced"

export function loadShowAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_LS_KEY) === "1"
  } catch {
    return false
  }
}

export function saveShowAdvanced(value: boolean): void {
  try {
    localStorage.setItem(ADVANCED_LS_KEY, value ? "1" : "0")
  } catch {
    /* localStorage might be disabled: non-fatal */
  }
}

// ── abort helpers ──────────────────────────────────────────────────────────
// Sleep that rejects with an AbortError as soon as `signal` aborts, so closing
// the modal mid-poll does not wait the full interval for the loop to notice.
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export function isAbortError(e: unknown): boolean {
  return asRecord(e)?.name === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
}
