import * as React from "react"
import { MessagesSquareIcon, PanelLeftCloseIcon, SearchIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import lockupOnDark from "@/assets/brand/enrooted-logotyp-mork-bakgrund.svg"
import lockupOnLight from "@/assets/brand/enrooted-logotyp-ljus-bakgrund.svg"
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
  if (s < 10) return "Just now"
  if (s < 60) return `${s}s ago`
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Compact time for the right edge of a row: "now", "5m", "3h", "2d", "Nov 3". */
function shortTime(isoString: string): string {
  const date = toDate(isoString)
  const m = Math.floor((Date.now() - date.getTime()) / 60000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  if (m < 10080) return `${Math.floor(m / 1440)}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const

function groupOf(isoString: string): (typeof GROUPS)[number] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.ceil((startOfToday.getTime() - toDate(isoString).getTime()) / 86400000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days <= 7) return "Previous 7 days"
  return "Older"
}

/**
 * Conversation list next to the rail (layout after OpenClaw's session list):
 * brand on top, a title filter, one-line rows grouped by day. Same data and
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
  const [filter, setFilter] = React.useState("")
  const q = filter.trim().toLowerCase()
  const visible = q ? threads.filter((t) => (t.first_message || "").toLowerCase().includes(q)) : threads
  const grouped = GROUPS.map((g) => ({ label: g, items: visible.filter((t) => groupOf(t.updated_at) === g) })).filter(
    (g) => g.items.length > 0
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* enrooted lockup: original files, one per background (UTF-1), ≥120 px (MIN-1). */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-3">
        <a href="/" aria-label="enrooted, home" className="flex shrink-0 items-center">
          <img src={lockupOnLight} alt="enrooted" className="h-[22px] w-auto min-w-[120px] dark:hidden" />
          <img src={lockupOnDark} alt="enrooted" className="hidden h-[22px] w-auto min-w-[120px] dark:block" />
        </a>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Close panel" className="text-muted-foreground" onClick={onClose} />}
          >
            <PanelLeftCloseIcon />
          </TooltipTrigger>
          <TooltipContent>Close panel</TooltipContent>
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
            placeholder="Search conversations"
            aria-label="Search conversations"
            onChange={(e) => setFilter(e.target.value)}
          />
        </InputGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-2 p-2" aria-label="Loading conversations…">
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
              <EmptyTitle>No conversations yet.</EmptyTitle>
              <EmptyDescription>Start a new chat to begin.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : grouped.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No conversations match “{filter.trim()}”.</p>
        ) : (
          grouped.map((group) => (
            <section key={group.label} aria-label={group.label} className="mb-3">
              {/* enrooted eyebrow: Poppins medium, capitals, 0.1 em, turquoise link tone. */}
              <h3 className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">{group.label}</h3>
              <ul className="flex flex-col gap-px">
                {group.items.map((t) => {
                  const active = selectedThreadId === t.thread_id
                  const title = t.first_message || "Untitled conversation"
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
        <span>{loading ? "Loading…" : `${threads.length} conversation${threads.length !== 1 ? "s" : ""}`}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove all"
                className="text-muted-foreground"
                disabled={threads.length === 0}
                onClick={onRemoveAll}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>Remove all conversations</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
