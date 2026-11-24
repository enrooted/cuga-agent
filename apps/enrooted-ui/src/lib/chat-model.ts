/*
 * CUGA stream → chat message model.
 *
 * Faithful port of the Carbon UI's event handling:
 *   frontend/src/carbon-chat/customSendMessage.ts   (live SSE)
 *   frontend/src/carbon-chat/customLoadHistory.ts   (history replay)
 *   frontend/src/carbon-chat/carbonChatHelpers.ts   (parsers, approval card)
 * (Copyright IBM Corp., Apache-2.0). Only the rendering target changed:
 * Carbon "reasoning steps" / "cards" become plain data the React UI renders.
 */
import i18n from "@/i18n"
import { injectCitations, type MessageSource } from "@/lib/citations"

// ── model ──────────────────────────────────────────────────────────────────
export interface Step {
  title: string
  content: string // markdown (may contain <details>)
}

export interface MemoryDisclosure {
  count: number
  entityIds: string[]
}

export interface AttachmentSnapshot {
  knowledge_filename: string
  display_name: string
  mime_type?: string
  size_bytes?: number
  scope: "agent" | "session"
}

export interface ActionButton {
  label: string
  variant: "primary" | "secondary" | "danger"
  approved: boolean
  customEvent: "tool_approval_response" | "suggest_human_action"
  actionId?: string
  additionalData?: unknown
  threadId: string
}

export interface ActionCard {
  parts: string[] // markdown blocks, rendered in order
  buttons: ActionButton[]
  /** Label of the button the user clicked (buttons are then disabled). */
  answered?: string
}

export interface UserMessage {
  id: string
  role: "user"
  text: string
  time: string
}

export interface AssistantMessage {
  id: string
  role: "assistant"
  time: string
  /** pending = waiting for the first SSE event (Carbon's loading indicator) */
  status: "pending" | "streaming" | "done"
  steps: Step[]
  /** markdown; citations already injected as <cuga-cite> */
  text: string
  sources: MessageSource[]
  memoryUsed?: MemoryDisclosure | null
  memorySaved?: MemoryDisclosure | null
  card?: ActionCard
}

export type ChatMessage = UserMessage | AssistantMessage

export interface CugaStreamEvent {
  name: string
  data: string
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ── SSE parsing (multi-line data per spec) ─────────────────────────────────
export async function* parseCugaStream(response: Response): AsyncGenerator<CugaStreamEvent> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error(i18n.t("chat:stream.noBody"))
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split("\n\n")
      buffer = blocks.pop() || ""
      for (const block of blocks) {
        if (!block.trim()) continue
        let name: string | undefined
        const dataLines: string[] = []
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim()
          else if (line.startsWith("data:")) {
            const raw = line.slice(5)
            dataLines.push(raw.startsWith(" ") ? raw.slice(1) : raw)
          }
        }
        if (name && dataLines.length > 0) yield { name, data: dataLines.join("\n") }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── parsers (carbonChatHelpers.ts) ─────────────────────────────────────────
export function parseReasoningStepContent(data: string, title: string): Step {
  try {
    const parsed = JSON.parse(data)
    let content: string
    if (parsed.code) {
      content = "```python\n" + parsed.code + "\n```"
      if (parsed.summary) content = `${parsed.summary}\n\n${content}`
    } else if (parsed.execution_output) {
      content = i18n.t("chat:step.executionOutputHeading") + "\n```\n" + parsed.execution_output + "\n```"
      if (parsed.summary) content = `${parsed.summary}\n\n${content}`
    } else {
      content = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```"
    }
    return { title, content }
  } catch {
    return { title, content: data }
  }
}

export function parseMemoryUsage(value: unknown): MemoryDisclosure | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { count?: unknown; entity_ids?: unknown }
  const entityIds = Array.isArray(candidate.entity_ids)
    ? Array.from(
        new Set(
          candidate.entity_ids.filter(
            (item): item is string => typeof item === "string" && item.length > 0
          )
        )
      )
    : []
  const count =
    typeof candidate.count === "number" && Number.isFinite(candidate.count)
      ? Math.max(0, Math.floor(candidate.count))
      : entityIds.length
  if (count === 0 || entityIds.length === 0) return null
  return { count, entityIds }
}

interface PolicyInfo {
  response_content: string
  policy_reasoning: string
  policy_type: string
  policy_name: string
  is_playbook: boolean
}

interface ParsedAnswer {
  answerText: string
  policyInfo: PolicyInfo | null
  isToolApproval: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  policyData: any
  sources: MessageSource[]
  memoryUsage: MemoryDisclosure | null
  memorySaved: MemoryDisclosure | null
}

export function parseAnswerEventData(data: string, accumulatedText = ""): ParsedAnswer {
  const result: ParsedAnswer = {
    answerText: accumulatedText,
    policyInfo: null,
    isToolApproval: false,
    policyData: null,
    sources: [],
    memoryUsage: null,
    memorySaved: null,
  }
  try {
    const parsed = JSON.parse(data)
    let innerData = parsed.data
    if (Array.isArray(parsed.sources)) result.sources = parsed.sources
    result.memoryUsage = parseMemoryUsage(parsed.memory_usage)
    result.memorySaved = parseMemoryUsage(parsed.memory_saved)
    if (typeof innerData === "string") {
      try {
        innerData = JSON.parse(innerData)
      } catch {
        /* use as-is */
      }
    }
    const policyData =
      innerData?.type === "policy" ? innerData : (parsed.active_policies?.[0] ?? null)

    if (policyData && (policyData.policy_blocked || policyData.policy_matched)) {
      const isPlaybook = policyData.policy_type === "playbook"
      result.policyInfo = {
        response_content:
          policyData.metadata?.response_content ||
          policyData.content ||
          (isPlaybook ? "" : i18n.t("chat:policy.notAllowed")),
        policy_reasoning: policyData.metadata?.policy_reasoning || i18n.t("chat:policy.triggered"),
        policy_type: policyData.policy_type || policyData.metadata?.policy_type || "unknown",
        policy_name: policyData.policy_name || policyData.metadata?.policy_name || i18n.t("chat:policy.fallbackName"),
        is_playbook: isPlaybook,
      }
      result.policyData = policyData
      result.isToolApproval =
        policyData.policy_type === "tool_approval" && !!policyData.metadata?.approval_required
      if (result.isToolApproval) return result

      const info = result.policyInfo
      if (isPlaybook) {
        result.answerText =
          (accumulatedText || i18n.t("chat:policy.playbookIntro")) +
          `\n\n> ###### 📖 *${i18n.t("chat:policy.playbookInfo")}*\n>\n` +
          `> *${i18n.t("chat:policy.playbookName")}* **${info.policy_name}**\n>\n` +
          `> *${i18n.t("chat:policy.reasoning")}* ${info.policy_reasoning}`
      } else {
        result.answerText =
          info.response_content +
          `\n\n> ###### 🛡️ *${i18n.t("chat:policy.policyInfo")}*\n>\n` +
          `> *${i18n.t("chat:policy.policyName")}* **${info.policy_name}**\n>\n` +
          `> *${i18n.t("chat:policy.policyType")}* \`${info.policy_type}\`\n>\n` +
          `> *${i18n.t("chat:policy.reasoning")}* ${info.policy_reasoning}`
      }
    } else {
      result.answerText =
        accumulatedText || (typeof innerData === "string" ? innerData : (parsed.data ?? data))
    }
  } catch {
    result.answerText = accumulatedText || data
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildToolApprovalCard(policyInfo: PolicyInfo, policyData: any, threadId: string): ActionCard {
  const approvalMsg =
    policyData.metadata?.approval_message || i18n.t("chat:approval.defaultMessage")
  const tools: string[] = policyData.metadata?.required_tools || []
  const apps: string[] = policyData.metadata?.required_apps || []
  const codePreview: string[] = policyData.metadata?.code_preview || []
  const parts = [`### ✋ ${policyInfo.policy_name}`, approvalMsg]
  if (tools.length > 0) {
    parts.push(
      tools.includes("*")
        ? i18n.t("chat:approval.allTools")
        : i18n.t("chat:approval.tools", { tools: tools.join(", ") })
    )
  }
  if (apps.length > 0) parts.push(i18n.t("chat:approval.apps", { apps: apps.join(", ") }))
  if (codePreview.length > 0) {
    parts.push(i18n.t("chat:approval.codePreview"), "```python\n" + codePreview.join("\n") + "\n```")
  }
  return {
    parts,
    buttons: [
      { label: i18n.t("chat:approval.approve"), variant: "primary", approved: true, customEvent: "tool_approval_response", threadId },
      { label: i18n.t("chat:approval.deny"), variant: "danger", approved: false, customEvent: "tool_approval_response", threadId },
    ],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSuggestHumanActionCard(actionData: any, threadId: string): ActionCard {
  const parts = [`### ${actionData.action_name || i18n.t("chat:approval.actionRequired")}`]
  if (actionData.description) parts.push(actionData.description)
  const tool = actionData.additional_data?.tool
  if (tool) {
    if (tool.required_tools?.length > 0) parts.push(i18n.t("chat:approval.requiredTools", { tools: tool.required_tools.join(", ") }))
    if (tool.code_preview?.length > 0) {
      parts.push(i18n.t("chat:approval.codePreview"), "```python\n" + tool.code_preview.join("\n") + "\n```")
    }
    if (tool.policy_name) parts.push(i18n.t("chat:approval.policy", { name: tool.policy_name }))
    if (tool.agent_names?.length > 0) parts.push(i18n.t("chat:approval.agents", { agents: tool.agent_names.join(", ") }))
    if (tool.task_descriptions) parts.push(`${i18n.t("chat:approval.tasks")}\n${tool.task_descriptions}`)
  }
  const common = {
    customEvent: "suggest_human_action" as const,
    actionId: actionData.action_id,
    additionalData: actionData.additional_data,
    threadId,
  }
  const buttons: ActionButton[] = []
  if (actionData.button_text) {
    buttons.push({
      ...common,
      label: actionData.button_text,
      variant: actionData.color === "danger" ? "danger" : "primary",
      approved: true,
    })
  }
  if (actionData.type === "confirmation") {
    buttons.push({ ...common, label: i18n.t("common:action.cancel"), variant: "secondary", approved: false })
  }
  return { parts, buttons }
}

// ── sub-agent accumulation (shared by live + history) ──────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subAgentIteration(data: any, raw: string): { title: string; content: string } | null {
  if (data.type === "start") return { title: i18n.t("chat:step.task"), content: data.task || "" }
  if (data.type === "result") {
    return {
      title: i18n.t("chat:step.result"),
      content: i18n.t("chat:step.executionOutputHeading") + "\n```\n" + (data.answer || "") + "\n```",
    }
  }
  if (data.code || data.execution_output) {
    return {
      title: data.code ? i18n.t("chat:step.code") : i18n.t("chat:step.executionOutput"),
      content: parseReasoningStepContent(raw, "").content,
    }
  }
  return null
}

const nestIterations = (iterations: Array<{ title: string; content: string }>) =>
  iterations
    .map(({ title, content }) => `<details>\n<summary>${title}</summary>\n\n${content}\n\n</details>`)
    .join("\n\n")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subAgentLabel = (d: any) => {
  const name = d.agent_name || i18n.t("chat:step.subAgentFallback")
  return d.spawn_id
    ? i18n.t("chat:step.subAgentWithId", { name, id: String(d.spawn_id).slice(0, 12) })
    : i18n.t("chat:step.subAgent", { name })
}

// ── live turn (customSendMessage.ts) ───────────────────────────────────────
export type TurnOutcome =
  | { kind: "continue" }
  | { kind: "final" }
  /** A card was produced; the stream is abandoned until the user answers. */
  | { kind: "card"; card: ActionCard }

/** Accumulates one /stream response into an AssistantMessage, event by event. */
export class LiveTurn {
  readonly message: AssistantMessage
  private collectedSteps: Step[] = []
  private pendingStep: Step | null = null
  private currentSubAgent = ""
  private subAgentIterations = new Map<string, Array<{ title: string; content: string }>>()
  private subAgentIndexes = new Map<string, number>()
  private accumulatedText = ""

  readonly threadId: string

  constructor(threadId: string, id = uuid()) {
    this.threadId = threadId
    this.message = {
      id,
      role: "assistant",
      time: new Date().toISOString(),
      status: "pending",
      steps: [],
      text: "",
      sources: [],
    }
  }

  private flushPendingStep() {
    const step = this.pendingStep
    if (!step || !step.title || !step.content) return
    if (this.currentSubAgent) {
      const idx = this.subAgentIndexes.get(this.currentSubAgent)
      if (idx !== undefined) this.collectedSteps[idx] = step
      else {
        this.subAgentIndexes.set(this.currentSubAgent, this.collectedSteps.length)
        this.collectedSteps.push(step)
      }
    } else {
      this.collectedSteps.push(step)
    }
    this.pendingStep = null
  }

  private publishSteps(withPending: boolean) {
    this.message.steps =
      withPending && this.pendingStep?.content
        ? [...this.collectedSteps, this.pendingStep]
        : [...this.collectedSteps]
  }

  private finalize(text: string) {
    this.flushPendingStep()
    this.publishSteps(false)
    this.message.text = text
    this.message.status = "done"
  }

  handle(event: CugaStreamEvent): TurnOutcome {
    this.message.status = "streaming"
    switch (event.name) {
      case "CodeAgent": {
        this.flushPendingStep()
        this.currentSubAgent = ""
        this.pendingStep = parseReasoningStepContent(event.data || "", "Code Agent")
        this.publishSteps(true)
        return { kind: "continue" }
      }
      case "CodeAgent_Reasoning":
      case "Thinking":
      case "Planning":
      case "Analyzing": {
        this.flushPendingStep()
        this.currentSubAgent = ""
        this.pendingStep = parseReasoningStepContent(event.data || "", event.name.replace(/_/g, " "))
        this.publishSteps(true)
        return { kind: "continue" }
      }
      case "SubAgent": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let d: any = {}
        try {
          d = JSON.parse(event.data)
        } catch {
          /* ignore */
        }
        const spawnKey = d.spawn_id || d.agent_name || "sub-agent"
        if (this.currentSubAgent !== spawnKey) {
          this.flushPendingStep()
          this.currentSubAgent = spawnKey
          if (!this.subAgentIterations.has(spawnKey)) this.subAgentIterations.set(spawnKey, [])
        }
        const it = subAgentIteration(d, event.data)
        if (!it) return { kind: "continue" }
        const iterations = this.subAgentIterations.get(spawnKey)!
        iterations.push(it)
        const updated: Step = { title: subAgentLabel(d), content: nestIterations(iterations) }
        const idx = this.subAgentIndexes.get(spawnKey)
        if (idx !== undefined) this.collectedSteps[idx] = updated
        else {
          this.subAgentIndexes.set(spawnKey, this.collectedSteps.length)
          this.collectedSteps.push(updated)
        }
        this.pendingStep = null
        this.publishSteps(false)
        return { kind: "continue" }
      }
      case "ToolCall":
      case "Action": {
        this.collectedSteps.push({ title: event.name, content: "```json\n" + event.data + "\n```" })
        this.publishSteps(true)
        return { kind: "continue" }
      }
      case "SuggestHumanActions": {
        try {
          const card = buildSuggestHumanActionCard(JSON.parse(event.data), this.threadId)
          this.publishSteps(true)
          this.message.status = "done"
          return { kind: "card", card }
        } catch {
          return this.defaultStep(event)
        }
      }
      case "FinalAnswerAgent": {
        try {
          const parsed = JSON.parse(event.data)
          this.accumulatedText = parsed.final_answer || parsed.data || event.data
        } catch {
          this.accumulatedText = event.data
        }
        return { kind: "continue" }
      }
      case "Answer":
      case "FinalAnswer": {
        const parsed = parseAnswerEventData(event.data, this.accumulatedText)
        if (parsed.isToolApproval && parsed.policyInfo && parsed.policyData) {
          const card = buildToolApprovalCard(parsed.policyInfo, parsed.policyData, this.threadId)
          this.publishSteps(true)
          this.message.status = "done"
          return { kind: "card", card }
        }
        this.message.sources = parsed.sources
        this.message.memoryUsed = parsed.memoryUsage
        this.message.memorySaved = parsed.memorySaved
        this.finalize(injectCitations(parsed.answerText, parsed.sources, this.message.id))
        return { kind: "final" }
      }
      case "Error":
        this.finalize(i18n.t("chat:stream.error", { message: event.data }))
        return { kind: "final" }
      case "Complete":
      case "Done":
        this.finalize(this.accumulatedText || i18n.t("chat:stream.taskCompleted"))
        return { kind: "final" }
      default:
        return this.defaultStep(event)
    }
  }

  private defaultStep(event: CugaStreamEvent): TurnOutcome {
    if (event.data) {
      this.collectedSteps.push({ title: event.name, content: event.data })
      this.publishSteps(true)
    }
    return { kind: "continue" }
  }

  /** Stream closed without a terminal event. */
  endOfStream() {
    this.finalize(this.accumulatedText || i18n.t("chat:stream.responseCompleted"))
  }

  cancelled() {
    this.finalize(i18n.t("chat:stream.cancelled"))
  }

  failed(message: string) {
    this.finalize(i18n.t("chat:stream.failed", { message, url: window.location.origin }))
  }
}

// ── history replay (customLoadHistory.ts) ──────────────────────────────────
interface StoredStreamEvent {
  event_name: string
  event_data: string
  timestamp: string
  sequence: number
}

function extractEventData(eventData: string): string {
  if (eventData.includes("data: ")) {
    const m = eventData.match(/data: (.+?)(?:\n\n|$)/s)
    if (m) return m[1].trim()
  }
  return eventData
}

export function historyFromStreamEvents(events: StoredStreamEvent[], threadId: string): ChatMessage[] {
  const history: ChatMessage[] = []
  let steps: Step[] = []
  let answerText = ""
  const subAgents = new Map<string, Array<{ title: string; content: string }>>()

  for (const event of events) {
    const data = extractEventData(event.event_data)
    switch (event.event_name) {
      case "UserMessage": {
        let text = data
        try {
          const parsed = JSON.parse(data)
          if (typeof parsed?.text === "string") text = parsed.text
        } catch {
          /* legacy plain text */
        }
        history.push({ id: uuid(), role: "user", text, time: event.timestamp })
        break
      }
      case "FinalAnswerAgent":
        try {
          const parsed = JSON.parse(data)
          answerText = parsed.final_answer || parsed.data || data
        } catch {
          answerText = data
        }
        break
      case "CodeAgent":
      case "CodeAgent_Reasoning":
      case "Thinking":
      case "Planning":
      case "Analyzing":
        steps.push(parseReasoningStepContent(data, event.event_name.replace(/_/g, " ")))
        break
      case "SubAgent": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let d: any = {}
        try {
          d = JSON.parse(data)
        } catch {
          /* ignore */
        }
        const spawnKey = d.spawn_id || d.agent_name || "sub-agent"
        if (!subAgents.has(spawnKey)) subAgents.set(spawnKey, [])
        const it = subAgentIteration(d, data)
        if (!it) break
        const iterations = subAgents.get(spawnKey)!
        iterations.push(it)
        const label = subAgentLabel(d)
        const updated = { title: label, content: nestIterations(iterations) }
        const idx = steps.findIndex((s) => s.title === label)
        if (idx >= 0) steps[idx] = updated
        else steps.push(updated)
        break
      }
      case "Answer":
      case "FinalAnswer": {
        const parsed = parseAnswerEventData(data, answerText)
        const id = uuid()
        if (parsed.isToolApproval && parsed.policyInfo && parsed.policyData) {
          history.push({
            id,
            role: "assistant",
            time: event.timestamp,
            status: "done",
            steps,
            text: "",
            sources: [],
            card: buildToolApprovalCard(parsed.policyInfo, parsed.policyData, threadId),
          })
        } else {
          history.push({
            id,
            role: "assistant",
            time: event.timestamp,
            status: "done",
            steps,
            text: injectCitations(parsed.answerText, parsed.sources, id),
            sources: parsed.sources,
            memoryUsed: parsed.memoryUsage,
            memorySaved: parsed.memorySaved,
          })
        }
        steps = []
        answerText = ""
        subAgents.clear()
        break
      }
      default:
        steps.push({ title: event.event_name.replace(/_/g, " "), content: data })
    }
  }
  return history
}

interface StoredMessage {
  role: string
  content: string
  timestamp: string
}

export function historyFromBasicMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === "user" || msg.role === "human") {
      return { id: uuid(), role: "user", text: msg.content, time: msg.timestamp }
    }
    const parsed = parseAnswerEventData(msg.content)
    return {
      id: uuid(),
      role: "assistant",
      time: msg.timestamp,
      status: "done",
      steps: [],
      text: parsed.answerText,
      sources: [],
      memoryUsed: parsed.memoryUsage,
      memorySaved: parsed.memorySaved,
    }
  })
}
