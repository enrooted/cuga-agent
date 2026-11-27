/*
 * Studio → Concierge: a DUMB chat surface over POST /api/concierge.
 *
 * It carries no business logic: it sends the text, shows the reply (or the
 * dry-run plan), and lists the exchange. All reuse / create / classify / arm
 * decisions happen server-side. `draft` / `setDraft` are lifted so the
 * Examples section can prefill this box.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/ConciergeChat.tsx
 * (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { SendIcon, ZapIcon } from "lucide-react"

import { AiDisclosure } from "@/components/ai-disclosure"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageContent, MessageHeader } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { InlineLoading, Notice } from "@/components/manage/knowledge/parts"
import { Muted, Tag, type Rec } from "@/components/events/studio-parts"
import i18n from "@/i18n"
import * as api from "@/lib/events/api"

type ArmSummary = { trigger?: string; prompt?: string; delivery?: string; agent?: string }

export interface ConciergeMessage {
  role: "user" | "concierge"
  text: string
  meta?: string
  /** HITL arming state: needs_input | confirm | armed | cancelled (absent for plain chat). */
  state?: string
  /** The proposal shown at the CONFIRM gate: what will run, when, where it goes. */
  summary?: ArmSummary
  /** True for a message the server pushed later: an armed flow firing, not a reply to anything. */
  fire?: boolean
}

/** The thread this surface talks on. It is also the delivery address a fire comes back to. */
const THREAD_ID = "web:studio"

export function ConciergeChat({ draft, setDraft }: { draft: string; setDraft: (v: string) => void }) {
  const { t } = useTranslation("studio")
  const disclosureId = React.useId()
  const [messages, setMessages] = React.useState<ConciergeMessage[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dryRun, setDryRun] = React.useState(false)
  /** Mailbox cursor: the ts of the last fire rendered. A ref, so it does not re-trigger the poll. */
  const cursor = React.useRef(0)

  // ── Asynchronous flow fires ──────────────────────────────────────────────
  // Arming is only half the loop. The flow fires later, with no request in
  // flight to answer. A browser can only be drained, so the server delivers
  // into a per-thread mailbox and this polls it. `since=0` on the first pass
  // recovers everything that fired while the tab was closed.
  React.useEffect(() => {
    let cancelled = false
    const drain = async () => {
      try {
        const res = await api.getEventsInbox(THREAD_ID, cursor.current)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const msgs: Rec[] = data?.messages ?? []
        if (!msgs.length || cancelled) return
        cursor.current = data.cursor ?? cursor.current
        setMessages((m) => [
          ...m,
          ...msgs.map((x) => ({
            role: "concierge" as const,
            text: String(x.text ?? ""),
            meta: x.flow_name ? i18n.t("studio:concierge.metaFlow", { name: x.flow_name }) : i18n.t("studio:concierge.metaFlowFired"),
            fire: true,
          })),
        ])
      } catch {
        /* a mailbox that is unreachable must never break the chat */
      }
    }
    void drain()
    const id = setInterval(() => void drain(), 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const send = async (override?: string) => {
    const text = (override ?? draft).trim()
    if (!text || busy) return
    setError(null)
    setBusy(true)
    setMessages((m) => [...m, { role: "user", text }])
    if (override === undefined) setDraft("")
    try {
      const res = await api.postConcierge(text, { threadId: THREAD_ID, dryRun })
      const data = await res.json()
      if (!res.ok && !data?.plan && !data?.reply) {
        throw new Error(data?.error || res.statusText)
      }
      // The server owns the shape: live → {reply}, dry-run → {decision, ...}.
      let reply: string
      let meta: string | undefined
      if (dryRun) {
        const mode = data?.decision?.mode ?? data?.plan?.decision?.mode ?? "?"
        reply = "```json\n" + JSON.stringify(data.decision ?? data.plan ?? data, null, 2) + "\n```"
        meta = t("concierge.metaDryRun", { mode })
      } else {
        reply = typeof data.reply === "string" ? data.reply : JSON.stringify(data.reply ?? data, null, 2)
        meta = data?.scope ? `scope=${data.scope}` : undefined
      }
      // HITL arming: `state` says whether this thread is mid-dialogue. At the
      // CONFIRM gate the server also sends the proposal, rendered as a card
      // with real buttons, so the human sees the exact fire-time prompt before
      // anything arms.
      setMessages((m) => [...m, { role: "concierge", text: reply, meta, state: data?.state, summary: data?.summary }])
    } catch (e) {
      setError(e instanceof Error ? e.message : t("concierge.requestFailed"))
    } finally {
      setBusy(false)
    }
  }

  // The newest message that is part of the arming dialogue (fires arrive out-of-band and don't count).
  const lastDialogueIndex = messages.reduce((best, m, i) => (m.fire ? best : i), -1)

  return (
    <div className="flex h-[calc(100dvh-17rem)] min-h-90 flex-col gap-3">
      <div className="glass-card min-h-0 flex-1 overflow-hidden rounded-xl border">
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 p-4" role="log" aria-label={t("concierge.logLabel")}>
                {messages.length === 0 && (
                  <Muted>
                    <Trans t={t} i18nKey="concierge.intro" shouldUnescape components={{ em: <em />, strong: <strong />, code: <code />, br: <br /> }} />
                  </Muted>
                )}
                {messages.map((m, i) => (
                  <MessageScrollerItem key={i} messageId={`concierge-${i}`} scrollAnchor={m.role === "user"}>
                    <Message align={m.role === "user" ? "end" : "start"}>
                      <MessageContent>
                        <MessageHeader className="gap-2">
                          {m.role === "user" ? (
                            t("concierge.you")
                          ) : m.fire ? (
                            <span className="inline-flex items-center gap-1">
                              <ZapIcon className="size-3.5 text-link" aria-hidden="true" />
                              {t("concierge.flow")}
                            </span>
                          ) : (
                            t("concierge.name")
                          )}
                          {m.meta && <Tag tone="outline">{m.meta}</Tag>}
                        </MessageHeader>
                        {m.state === "confirm" && m.summary ? (
                          // "live" is the newest message of the DIALOGUE: a flow firing
                          // mid-arming is not a reply and must not retire the card the
                          // human is still looking at.
                          <ArmConfirmCard summary={m.summary} busy={busy} live={i === lastDialogueIndex} onSay={(text) => void send(text)} setDraft={setDraft} />
                        ) : (
                          <Bubble variant={m.role === "user" ? "default" : m.fire ? "outline" : "secondary"} align={m.role === "user" ? "end" : "start"}>
                            <BubbleContent className="break-words whitespace-pre-wrap">{m.text}</BubbleContent>
                          </Bubble>
                        )}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))}
                {busy && <InlineLoading>{t("concierge.thinking")}</InlineLoading>}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      {error && (
        <Notice kind="error" title={t("error")} onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className="flex flex-col gap-2">
        <AiDisclosure id={disclosureId} />
        <Textarea
          aria-label={t("concierge.inputLabel")}
          aria-describedby={disclosureId}
          placeholder={t("concierge.placeholder")}
          rows={2}
          className="glass-card"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-body">
            <Switch id="studio-dryrun" size="sm" checked={dryRun} onCheckedChange={setDryRun} aria-label={t("concierge.previewLabel")} />
            {dryRun ? t("concierge.preview") : t("concierge.live")}
          </label>
          <Button disabled={busy || !draft.trim()} onClick={() => void send()}>
            {t("concierge.send")}
            <SendIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The CONFIRM gate, rendered.
 *
 * Nothing is armed until the human approves the exact prompt the agent will be
 * handed on every fire. The card exists so that prompt is impossible to miss.
 *
 * The buttons are shortcuts, not a separate protocol: each sends the same plain
 * text a user could type ("yes" / "cancel"), so web, Slack, Discord and
 * Telegram all drive one dialogue. Only the newest card stays interactive;
 * older ones are history.
 */
function ArmConfirmCard({
  summary,
  busy,
  live,
  onSay,
  setDraft,
}: {
  summary: ArmSummary
  busy: boolean
  live: boolean
  onSay: (text: string) => void
  setDraft: (v: string) => void
}) {
  const { t } = useTranslation("studio")
  const rows: [string, string | undefined][] = [
    [t("concierge.confirm.when"), summary.trigger],
    [t("concierge.confirm.resultsTo"), summary.delivery],
    [t("concierge.confirm.agent"), summary.agent],
  ]
  return (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-xl border border-l-[3px] border-l-accent-line bg-card p-4 text-sm">
      <p className="font-semibold">{t("concierge.confirm.title")}</p>
      <div>
        <p className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">{t("concierge.confirm.promptLabel")}</p>
        <blockquote className="rounded-md border-l-2 bg-muted px-3 py-2 leading-normal break-words whitespace-pre-wrap text-body italic">{summary.prompt}</blockquote>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) =>
          v ? (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </React.Fragment>
          ) : null
        )}
      </dl>
      {live ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => onSay("yes")}>
            {t("concierge.confirm.arm")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft(`change the prompt to ${summary.prompt ?? ""}`)}>
            {t("concierge.confirm.editPrompt")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSay("cancel")}>
            {t("common:action.cancel")}
          </Button>
        </div>
      ) : (
        <Muted className="text-xs">{t("concierge.confirm.superseded")}</Muted>
      )}
    </div>
  )
}
