/*
 * Drain armed-flow fires for a chat thread.
 *
 * Arming a flow is half the loop: it fires LATER, when no request is in flight
 * to answer into. A browser can only be drained, so the server writes each
 * fire to a per-thread mailbox and this polls it. It only polls when the
 * events service answers /api/events/status with enabled:true.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/useEventsInbox.ts
 * (Copyright IBM Corp., Apache-2.0). The original appends to Carbon's
 * ChatInstance; this one hands the new fires to `onFires`, and the chat
 * appends them at the end of its transcript.
 */
import * as React from "react"

import * as api from "@/lib/events/api"

export interface InboxFire {
  /** Stable id for the transcript: `fire-<mailbox id>`. */
  id: string
  text: string
  flowName?: string
}

export function useEventsInbox(threadId: string | null, onFires: (fires: InboxFire[]) => void): void {
  const onFiresRef = React.useRef(onFires)
  React.useEffect(() => {
    onFiresRef.current = onFires
  })

  React.useEffect(() => {
    // Every exit says so once: a poller that never started otherwise looks
    // exactly like a poller with nothing to deliver.
    const say = (...a: unknown[]) => console.info("[events:inbox]", ...a)
    if (!threadId) {
      say("poller NOT started — this chat has no threadId yet; a fire will land in the mailbox but")
      say("nothing polls for it. Send a message first, then re-open the conversation.")
      return
    }
    say("poller starting for thread", threadId)
    let cancelled = false
    let cursor = 0

    const drain = async () => {
      if (cancelled) return
      try {
        const res = await api.getEventsInbox(threadId, cursor)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const messages: { id?: unknown; text?: unknown; flow_name?: unknown }[] = data?.messages ?? []
        if (!messages.length) return
        cursor = data.cursor ?? cursor
        if (cancelled) return
        onFiresRef.current(
          messages.map((m) => ({
            id: `fire-${String(m.id)}`,
            text: String(m.text ?? ""),
            flowName: m.flow_name ? String(m.flow_name) : undefined,
          }))
        )
      } catch {
        /* an unreachable mailbox must never break the chat */
      }
    }

    // Only poll when the events layer is mounted: vanilla CUGA has no /api/events/*.
    let timer: ReturnType<typeof setInterval> | null = null
    let first: ReturnType<typeof setTimeout> | null = null
    api
      .getEventsStatus()
      .then((s) => {
        if (cancelled) return
        if (!s) {
          say("poller NOT started — /api/events/status did not answer with enabled:true.")
          say("Check it by hand:  await (await fetch(`${location.origin}/api/ui/config`)).json()")
          say("then GET <events_api_url>/api/events/status from this tab. A CORS error here is the")
          say("split-origin case: the events service must allow this origin (EVENTS_CORS_ORIGINS).")
          return
        }
        // Hold the first drain briefly: switching threads reloads the history
        // asynchronously, and a fire injected into that window would be wiped.
        first = setTimeout(() => void drain(), 2500)
        timer = setInterval(() => void drain(), 15000)
      })
      .catch((e) => say("poller NOT started — /api/events/status threw:", e))
    return () => {
      cancelled = true
      if (first) clearTimeout(first)
      if (timer) clearInterval(timer)
    }
  }, [threadId])
}
