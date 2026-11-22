/*
 * Chat state for one CUGA conversation — the behaviour of the Carbon UI's
 * CarbonChat.tsx + customSendMessage.ts, minus the Carbon widget.
 */
import * as React from "react"
import * as api from "@/lib/api"
import {
  LiveTurn,
  historyFromBasicMessages,
  historyFromStreamEvents,
  parseCugaStream,
  uuid,
  type ActionButton,
  type AssistantMessage,
  type AttachmentSnapshot,
  type ChatMessage,
} from "@/lib/chat-model"

interface Options {
  agentId: string
  threadId: string
  useDraft?: boolean
  disableHistory?: boolean
  /** Called after a send/approval completes on this thread (parent marks it active). */
  onThreadChange?: (threadId: string) => void
  /** Snapshot of session documents attached to the next message. */
  getAttachmentSnapshot?: () => AttachmentSnapshot[]
}

export function useCugaChat({
  agentId,
  threadId,
  useDraft = false,
  disableHistory = false,
  onThreadChange,
  getAttachmentSnapshot,
}: Options) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [isStreaming, setIsStreaming] = React.useState(false)
  /** Attachment snapshots per user message (index-aligned), from conversation metadata. */
  const [messageAttachments, setMessageAttachments] = React.useState<AttachmentSnapshot[][]>([])
  const scope = `${agentId}|${threadId}|${useDraft}`
  const scopeRef = React.useRef(scope)
  scopeRef.current = scope
  const abortRef = React.useRef<AbortController | null>(null)
  const ctxRef = React.useRef({ onThreadChange, getAttachmentSnapshot })
  ctxRef.current = { onThreadChange, getAttachmentSnapshot }

  const refreshMessageAttachments = React.useCallback(
    async (tid: string) => {
      if (disableHistory || !tid) {
        setMessageAttachments([])
        return
      }
      try {
        const res = await api.getConversationMessages(tid, agentId)
        if (!res.ok) return setMessageAttachments([])
        const data = await res.json()
        const msgs = (data.messages ?? []) as Array<{ role: string; metadata?: { attachments?: AttachmentSnapshot[] } }>
        if (scopeRef.current.startsWith(`${agentId}|${tid}|`)) {
          setMessageAttachments(
            msgs.filter((m) => m.role === "user" || m.role === "human").map((m) => m.metadata?.attachments ?? [])
          )
        }
      } catch {
        /* decorative only */
      }
    },
    [agentId, disableHistory]
  )

  // ── history (customLoadHistory) ─────────────────────────────────────────
  React.useEffect(() => {
    abortRef.current = null
    setIsStreaming(false)
    setMessages([])
    setMessageAttachments([])
    if (disableHistory || !threadId) return
    let cancelled = false
    setHistoryLoading(true)
    ;(async () => {
      try {
        let history: ChatMessage[] = []
        const res = await api.getConversationStreamEvents(threadId, agentId)
        const events = res.ok ? ((await res.json()).events ?? []) : []
        if (events.length > 0) {
          history = historyFromStreamEvents(events, threadId)
        } else {
          const basic = await api.getConversationMessages(threadId, agentId)
          if (basic.ok) history = historyFromBasicMessages((await basic.json()).messages ?? [])
        }
        if (!cancelled) setMessages(history)
      } catch (error) {
        console.error("Error loading history:", error)
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    void refreshMessageAttachments(threadId)
    return () => {
      cancelled = true
    }
  }, [agentId, disableHistory, refreshMessageAttachments, threadId, useDraft])

  // ── streaming (customSendMessage) ───────────────────────────────────────
  const runStream = React.useCallback(
    async (body: object) => {
      const sentScope = scopeRef.current
      const isCurrent = () => scopeRef.current === sentScope
      const turn = new LiveTurn(threadId)
      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setMessages((ms) => [...ms, { ...turn.message }])
      const publish = () => {
        if (!isCurrent()) return
        const snapshot: AssistantMessage = { ...turn.message, steps: [...turn.message.steps] }
        setMessages((ms) => ms.map((m) => (m.id === snapshot.id ? snapshot : m)))
      }
      try {
        const res = await api.postStream(body, {
          threadId,
          agentId,
          useDraft,
          disableHistory,
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}, message: ${await res.text()}`)
        }
        let terminated = false
        for await (const event of parseCugaStream(res)) {
          if (controller.signal.aborted) break
          const outcome = turn.handle(event)
          publish()
          if (outcome.kind === "card") {
            if (isCurrent()) {
              const cardMessage: AssistantMessage = {
                id: uuid(),
                role: "assistant",
                time: new Date().toISOString(),
                status: "done",
                steps: [],
                text: "",
                sources: [],
                card: outcome.card,
              }
              setMessages((ms) => [...ms, cardMessage])
            }
            terminated = true
            break
          }
          if (outcome.kind === "final") {
            terminated = true
            break
          }
        }
        if (!terminated) {
          if (controller.signal.aborted) turn.cancelled()
          else turn.endOfStream()
          publish()
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") turn.cancelled()
        else turn.failed((error as Error)?.message || "Failed to connect to CUGA backend")
        publish()
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (isCurrent()) setIsStreaming(false)
      }
      if (isCurrent()) {
        // The thread id does not change on send, so the history effect does not
        // re-run: the live transcript (and its citation state) is kept.
        ctxRef.current.onThreadChange?.(threadId)
        void refreshMessageAttachments(threadId)
      }
    },
    [agentId, disableHistory, refreshMessageAttachments, threadId, useDraft]
  )

  const send = React.useCallback(
    async (text: string) => {
      const query = text.trim()
      if (!query || isStreaming) return
      const attachments = ctxRef.current.getAttachmentSnapshot?.() ?? []
      setMessages((ms) => [...ms, { id: uuid(), role: "user", text: query, time: new Date().toISOString() }])
      setMessageAttachments((cur) => {
        const userCount = messages.filter((m) => m.role === "user").length
        const next = cur.slice(0, userCount)
        while (next.length < userCount) next.push([])
        next.push(attachments)
        return next
      })
      await runStream({ query, ...(attachments.length > 0 ? { attachments } : {}) })
    },
    [isStreaming, messages, runStream]
  )

  /** Approve/deny a tool-approval or suggested-action card (MESSAGE_ITEM_CUSTOM). */
  const respondToAction = React.useCallback(
    async (messageId: string, button: ActionButton) => {
      if (button.threadId && button.threadId !== threadId) return
      setMessages((ms) =>
        ms.map((m) =>
          m.id === messageId && m.role === "assistant" && m.card
            ? { ...m, card: { ...m.card, answered: button.label } }
            : m
        )
      )
      await runStream({
        action_id: button.actionId,
        response_type: "confirmation",
        timestamp: new Date().toISOString(),
        confirmed: button.approved,
        additional_data: button.additionalData,
      })
    },
    [runStream, threadId]
  )

  const stop = React.useCallback(() => {
    void api.postStop(threadId).catch(() => undefined)
    abortRef.current?.abort()
  }, [threadId])

  return {
    messages,
    messageAttachments,
    historyLoading,
    isStreaming,
    send,
    stop,
    respondToAction,
  }
}
