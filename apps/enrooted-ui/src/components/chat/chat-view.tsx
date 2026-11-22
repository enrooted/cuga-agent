import * as React from "react"
import { LockIcon, RotateCcwIcon, UploadIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AgentMark } from "@/components/agent-mark"
import { Composer } from "@/components/chat/composer"
import { AssistantMessageView, UserMessageView, type AgentProfile } from "@/components/chat/messages"
import { SourcesSheet } from "@/components/chat/sources"
import { useCugaChat } from "@/hooks/use-cuga-chat"
import { useSessionKnowledgeAttachments } from "@/hooks/use-session-knowledge-attachments"
import * as api from "@/lib/api"
import type { AttachmentSnapshot } from "@/lib/chat-model"
import type { MessageSource } from "@/lib/citations"
import { pageFragment } from "@/lib/citations"
import { cn } from "@/lib/utils"

export interface RecentConversation {
  id: string
  title: string
  time: string
}

export interface HomescreenConfig {
  isOn?: boolean
  greeting?: string
  starters?: string[]
}

const DEFAULT_HOMESCREEN = {
  isOn: true,
  greeting: "Hello, how can I help you today?",
  starters: ["Hi, what can you do for me?"],
}

export function ChatView({
  agentId,
  threadId,
  title,
  isReadonly,
  headerStart,
  headerEnd,
  recent = [],
  onSelectRecent,
  useDraft = false,
  disableHistory = false,
  attachmentScope = "session",
  homescreen,
  profile,
  knowledgeEnabled,
  sessionKnowledgeEnabled,
  sessionDocsVersion,
  onSessionDocsChanged,
  onThreadChange,
  onRestart,
  onOpenKnowledge,
  onOpenMemoryUsage,
  onPreviewAttachment,
}: {
  agentId: string
  threadId: string
  /** Conversation title shown in the chat header (first message, or "New conversation"). */
  title: string
  isReadonly: boolean
  /** Header slots: navigation toggles (left) and panel toggles (right). */
  headerStart?: React.ReactNode
  headerEnd?: React.ReactNode
  /** Latest conversations, listed under the composer on the new-conversation page. */
  recent?: RecentConversation[]
  onSelectRecent?: (threadId: string) => void
  /** Manage "try it out": run against the agent's draft config, keep no history. */
  useDraft?: boolean
  disableHistory?: boolean
  /** Where attached documents go: this conversation ("session") or the agent's knowledge ("agent"). */
  attachmentScope?: "agent" | "session"
  homescreen?: HomescreenConfig
  profile: AgentProfile
  knowledgeEnabled: boolean
  sessionKnowledgeEnabled: boolean
  sessionDocsVersion: number
  onSessionDocsChanged: () => void
  onThreadChange: (threadId: string) => void
  onRestart: () => void
  onOpenKnowledge: () => void
  onOpenMemoryUsage?: (entityIds: string[], relationship: "used" | "saved") => void
  onPreviewAttachment: (attachment: AttachmentSnapshot) => void
}) {
  const hs = homescreen ?? DEFAULT_HOMESCREEN
  const starters = (hs.starters ?? DEFAULT_HOMESCREEN.starters).filter(Boolean).slice(0, 4)

  const attachments = useSessionKnowledgeAttachments({
    threadId,
    scope: attachmentScope,
    enabled: sessionKnowledgeEnabled,
    sessionDocsVersion,
    onSessionDocsChanged,
    visibleDocumentMode: "all",
  })
  const attachmentsEnabled = knowledgeEnabled && sessionKnowledgeEnabled && attachments.isAvailable

  const chat = useCugaChat({
    agentId,
    threadId,
    useDraft,
    disableHistory,
    onThreadChange,
    getAttachmentSnapshot: attachments.createMessageAttachmentSnapshot,
  })

  // Slash commands (also used for pills in sent bubbles).
  const [commands, setCommands] = React.useState<api.SlashCommandInfo[]>([])
  const [commandsLoading, setCommandsLoading] = React.useState(true)
  const [commandsError, setCommandsError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    api
      .getCommands()
      .then((c) => !cancelled && setCommands(c))
      .catch((e) => !cancelled && setCommandsError(e instanceof Error ? e.message : "Failed to load commands"))
      .finally(() => !cancelled && setCommandsLoading(false))
    return () => {
      cancelled = true
    }
  }, [])
  const knownCommands = React.useMemo(() => new Set(commands.map((c) => c.name)), [commands])

  const [sources, setSources] = React.useState<{ sources: MessageSource[]; activeN: number | null } | null>(null)
  React.useEffect(() => setSources(null), [threadId])

  // Drag & drop onto the chat attaches session documents.
  const [dragOver, setDragOver] = React.useState(false)
  const dragCounter = React.useRef(0)

  const busy = chat.historyLoading
  const showHomescreen = !isReadonly && !busy && chat.messages.length === 0 && (hs.isOn ?? true)
  const inputDisabled = isReadonly || busy

  // The transcript scrolls underneath the (glass) composer: keep its bottom
  // padding in step with the composer's height (attachments, multi-line text).
  const rootRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = composerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => rootRef.current?.style.setProperty("--composer-h", `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  let userIndex = -1
  return (
    <div
      ref={rootRef}
      className="relative flex size-full min-h-0 flex-col"
      onDragEnter={(e) => {
        if (!attachmentsEnabled || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        dragCounter.current++
        setDragOver(true)
      }}
      onDragOver={(e) => {
        if (!attachmentsEnabled || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={() => {
        if (!attachmentsEnabled) return
        dragCounter.current--
        if (dragCounter.current <= 0) {
          dragCounter.current = 0
          setDragOver(false)
        }
      }}
      onDrop={(e) => {
        if (!attachmentsEnabled || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        dragCounter.current = 0
        setDragOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) void attachments.uploadFiles(files)
      }}
    >
      {/* Chat header: conversation title + agent, restart, panel toggles. */}
      <div className="glass-chrome absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 border-b px-3">
        {headerStart}
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{profile.nickname}</span>
        {isReadonly && (
          <Badge variant="outline">
            <LockIcon data-icon="inline-start" />
            Read-only
          </Badge>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Restart conversation"
                  className="text-muted-foreground"
                  disabled={chat.isStreaming}
                  onClick={onRestart}
                />
              }
            >
              <RotateCcwIcon />
            </TooltipTrigger>
            <TooltipContent>Restart conversation</TooltipContent>
          </Tooltip>
          {headerEnd}
        </div>
      </div>

      {/* One column. On the new-conversation page the greeting, composer and
          suggestions sit together in the middle; otherwise the transcript fills
          the space and the composer rests at the bottom. The composer keeps its
          place in the tree in both cases, so it never remounts. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", showHomescreen && "justify-center overflow-y-auto pt-12 pb-[8vh]")}>
        <div className={cn(!showHomescreen && "relative min-h-0 flex-1")}>
          {busy ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 pt-18" aria-label="Loading conversation history…">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <div className="flex gap-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </div>
              <Skeleton className="ml-auto h-10 w-2/5" />
            </div>
          ) : showHomescreen ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 pb-6 text-center">
              <AgentMark className="size-12" />
              <h2 className="text-2xl font-semibold">{hs.greeting ?? DEFAULT_HOMESCREEN.greeting}</h2>
            </div>
          ) : (
            <MessageScrollerProvider autoScroll>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 pt-18 pb-[calc(var(--composer-h,9rem)+1.5rem)]">
                    {chat.messages.map((m) => {
                      if (m.role === "user") userIndex++
                      return (
                        <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                          {m.role === "user" ? (
                            <UserMessageView
                              message={m}
                              attachments={chat.messageAttachments[userIndex] ?? []}
                              knownCommands={knownCommands}
                              onPreviewAttachment={onPreviewAttachment}
                            />
                          ) : (
                            <AssistantMessageView
                              message={m}
                              profile={profile}
                              actionsDisabled={chat.isStreaming || isReadonly}
                              onAction={(id, b) => void chat.respondToAction(id, b)}
                              onOpenSources={(s, n) => setSources({ sources: s, activeN: n })}
                              onOpenMemoryUsage={onOpenMemoryUsage}
                            />
                          )}
                        </MessageScrollerItem>
                      )
                    })}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="data-[direction=end]:bottom-[calc(var(--composer-h,9rem)+0.75rem)]" />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
        </div>

        <div
          ref={composerRef}
          className={cn(
            "mx-auto w-full shrink-0 px-4",
            showHomescreen ? "max-w-2xl" : "pointer-events-none absolute inset-x-0 bottom-0 z-10 max-w-3xl pb-4 *:pointer-events-auto"
          )}
        >
          <Composer
            disabled={inputDisabled}
            isStreaming={chat.isStreaming}
            onSend={(text) => void chat.send(text)}
            onStop={chat.stop}
            commands={commands}
            commandsLoading={commandsLoading}
            commandsError={commandsError}
            attachmentItems={attachments.attachmentItems}
            attachmentsEnabled={attachmentsEnabled}
            attachmentScope={attachmentScope}
            onAttachFiles={(files) => void attachments.uploadFiles(files)}
            onDeleteDocument={(f) => void attachments.deleteDocument(f)}
            onRetryUpload={(id) => void attachments.retryUpload(id)}
            onDismissUpload={attachments.dismissUpload}
            onPreviewAttachment={onPreviewAttachment}
            onOpenKnowledge={onOpenKnowledge}
            placeholder={isReadonly ? "This conversation is read-only — start a new conversation to chat" : "Type something..."}
          />
        </div>

        {showHomescreen && (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-4">
            {starters.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {starters.map((label) => (
                  <Button key={label} variant="outline" size="sm" className="rounded-full" onClick={() => void chat.send(label)}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <section aria-label="Recent conversations">
                <h3 className="px-2 pb-1 text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">Recent</h3>
                <ul className="flex flex-col gap-px">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        title={r.title}
                        onClick={() => onSelectRecent?.(r.id)}
                        className="flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-sm text-body outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1 truncate">{r.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{r.time}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          <UploadIcon className="mr-2 size-4" />
          Drop files to attach them to this conversation
        </div>
      )}

      <SourcesSheet
        sources={sources?.sources ?? []}
        activeN={sources?.activeN ?? null}
        open={!!sources}
        onOpenChange={(o) => !o && setSources(null)}
        onOpenDocument={async (source) => {
          try {
            const scope = source.scope === "session" ? "session" : "agent"
            const res = await api.getKnowledgeDocumentFile(scope, source.filename, threadId)
            if (!res.ok) return false
            const blobUrl = URL.createObjectURL(await res.blob())
            window.open(blobUrl + pageFragment(source), "_blank", "noopener,noreferrer")
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
            return true
          } catch {
            return false
          }
        }}
      />
    </div>
  )
}
