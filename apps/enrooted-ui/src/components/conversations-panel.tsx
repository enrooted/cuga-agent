import * as React from "react"
import { useTranslation } from "react-i18next"
import { MessagesSquareIcon, PanelLeftCloseIcon, SearchIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import i18n from "@/i18n"
import { cn } from "@/lib/utils"

export interface ConversationThread {
  thread_id: string
  status: string
  first_message: string
  updated_at: string
}

const toDate = (iso: string) => new Date(iso.endsWith("Z") ? iso : `${iso}Z`)

export function formatTimestamp(isoString: string): string {
  const date = toDate(isoString)
  const diffMs = Date.now() - date.getTime()
  const s = Math.floor(diffMs / 1000)
  const m = Math.floor(diffMs / 60000)
  const h = Math.floor(diffMs / 3600000)
  const d = Math.floor(diffMs / 86400000)
  if (s < 10) return i18n.t("time.justNow")
  if (s < 60) return i18n.t("time.secondsAgo", { count: s })
  if (m < 60) return i18n.t("time.minutesAgo", { count: m })
  if (h < 24) return i18n.t("time.hoursAgo", { count: h })
  if (d < 7) return i18n.t("time.daysAgo", { count: d })
  return date.toLocaleDateString(i18n.language, { month: "short", day: "numeric" })
}

/** Compact time for the right edge of a row: "now", "5m", "3h", "2d", "Nov 3". */
function shortTime(isoString: string): string {
  const date = toDate(isoString)
  const m = Math.floor((Date.now() - date.getTime()) / 60000)
  if (m < 1) return i18n.t("time.now")
  if (m < 60) return i18n.t("time.minutes", { count: m })
  if (m < 1440) return i18n.t("time.hours", { count: Math.floor(m / 60) })
  if (m < 10080) return i18n.t("time.days", { count: Math.floor(m / 1440) })
  return date.toLocaleDateString(i18n.language, { month: "short", day: "numeric" })
}

const GROUPS = ["today", "yesterday", "week", "older"] as const

function groupOf(isoString: string): (typeof GROUPS)[number] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.ceil((startOfToday.getTime() - toDate(isoString).getTime()) / 86400000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days <= 7) return "week"
  return "older"
}

/**
 * Conversation list next to the rail (layout after OpenClaw's session list):
 * a heading on top (the brand mark is in the rail beside it), a title filter, one-line rows grouped by day. Same data and
 * actions as the Carbon UI's left panel.
 */
export function ConversationsPanel({
  threads,
  loading,
  selectedThreadId,
  onSelect,
  onRemoveAll,
  onClose,
}: {
  threads: ConversationThread[]
  loading: boolean
  selectedThreadId: string | null
  onSelect: (threadId: string) => void
  onRemoveAll: () => void
  onClose: () => void
}) {
  const { t: tr } = useTranslation()
  const [filter, setFilter] = React.useState("")
  const q = filter.trim().toLowerCase()
  const visible = q ? threads.filter((t) => (t.first_message || "").toLowerCase().includes(q)) : threads
  const grouped = GROUPS.map((g) => ({ label: g, items: visible.filter((t) => groupOf(t.updated_at) === g) })).filter(
    (g) => g.items.length > 0
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A heading, not the enrooted lockup: the trilogin already sits in the rail right beside this panel. */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <h2 className="truncate font-heading text-sm font-semibold text-foreground">{tr("conversations.title")}</h2>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={tr("action.closePanel")} className="text-muted-foreground" onClick={onClose} />}
          >
            <PanelLeftCloseIcon />
          </TooltipTrigger>
          <TooltipContent>{tr("action.closePanel")}</TooltipContent>
        </Tooltip>
      </div>

      <div className="px-2 pb-2">
        <InputGroup className="bg-background">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={filter}
            placeholder={tr("conversations.search")}
            aria-label={tr("conversations.search")}
            onChange={(e) => setFilter(e.target.value)}
          />
        </InputGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-2 p-2" aria-label={tr("conversations.loading")}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5" style={{ width: `${85 - i * 9}%` }} />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>{tr("conversations.empty")}</EmptyTitle>
              <EmptyDescription>{tr("conversations.emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : grouped.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{tr("conversations.noMatch", { query: filter.trim() })}</p>
        ) : (
          grouped.map((group) => (
            <section key={group.label} aria-label={tr(`conversations.group.${group.label}`)} className="mb-3">
              {/* enrooted eyebrow: Poppins medium, capitals, 0.1 em, turquoise link tone. */}
              <h3 className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">{tr(`conversations.group.${group.label}`)}</h3>
              <ul className="flex flex-col gap-px">
                {group.items.map((t) => {
                  const active = selectedThreadId === t.thread_id
                  const title = t.first_message || tr("conversations.untitled")
                  return (
                    <li key={t.thread_id}>
                      <button
                        type="button"
                        data-slot="conversation-item"
                        aria-current={active ? "true" : undefined}
                        title={title}
                        onClick={() => onSelect(t.thread_id)}
                        className={cn(
                          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-body outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
                          active && "bg-foreground/8 font-bold text-foreground hover:bg-foreground/8"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{title}</span>
                        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{shortTime(t.updated_at)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-between border-t pr-2 pl-4 text-xs text-muted-foreground">
        <span>{loading ? tr("state.loading") : tr("conversations.count", { count: threads.length })}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tr("conversations.removeAll")}
                className="text-muted-foreground"
                disabled={threads.length === 0}
                onClick={onRemoveAll}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>{tr("conversations.removeAllTooltip")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
