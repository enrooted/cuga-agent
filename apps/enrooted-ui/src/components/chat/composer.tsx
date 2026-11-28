/*
 * Chat composer: textarea + knowledge-attachment toolbar + slash-command
 * autocomplete. Behaviour ported from the Carbon UI's CarbonChat.tsx
 * (ComposerToolbar) and SlashCommandDropdown.tsx (Copyright IBM Corp., Apache-2.0):
 *  - caret-scoped /command token detection (findSlashTokenAtCaret)
 *  - dropdown with ↑/↓, Enter/Tab accept, Escape dismiss (sticky until edited)
 *  - ghost-text completion of the highlighted match, accepted with Tab
 *  - translucent highlight pills behind known /commands
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpIcon, FileTextIcon, PaperclipIcon, RotateCwIcon, SquareIcon, TriangleAlertIcon, XIcon } from "lucide-react"

import { AiDisclosure } from "@/components/ai-disclosure"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Badge } from "@/components/ui/badge"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { SessionAttachmentItem } from "@/hooks/use-session-knowledge-attachments"
import type { SlashCommandInfo } from "@/lib/api"
import type { AttachmentSnapshot } from "@/lib/chat-model"
import { cn } from "@/lib/utils"

interface SlashToken {
  start: number
  end: number
  name: string
  queryToCaret: string
  caret: number
}

export function findSlashTokenAtCaret(value: string, caret: number): SlashToken | null {
  const c = Math.max(0, Math.min(caret, value.length))
  let start = c
  while (start > 0 && !/\s/.test(value[start - 1])) start -= 1
  if (value[start] !== "/") return null
  let end = c
  while (end < value.length && !/\s/.test(value[end])) end += 1
  return {
    start,
    end,
    name: value.slice(start + 1, end),
    queryToCaret: value.slice(start + 1, Math.max(c, start + 1)),
    caret: c,
  }
}

/** Split text into plain/command segments for known /commands (strict match). */
export function splitKnownCommands(text: string, known: Set<string>) {
  const out: Array<{ text: string; command: boolean }> = []
  const re = /(^|\s)\/(\S+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!known.has(m[2])) continue
    const start = m.index + m[1].length
    const end = start + 1 + m[2].length
    if (start > last) out.push({ text: text.slice(last, start), command: false })
    out.push({ text: text.slice(start, end), command: true })
    last = end
  }
  if (last < text.length) out.push({ text: text.slice(last), command: false })
  return out
}

function ComposerAttachments({
  items,
  onDeleteDocument,
  onRetryUpload,
  onDismissUpload,
  onPreview,
  onOpenKnowledge,
  scope,
}: {
  items: SessionAttachmentItem[]
  onDeleteDocument: (filename: string) => void
  onRetryUpload: (id: string) => void
  onDismissUpload: (id: string) => void
  onPreview?: (snapshot: AttachmentSnapshot) => void
  onOpenKnowledge?: () => void
  scope: "session" | "agent"
}) {
  const { t } = useTranslation("chat")
  if (items.length === 0) return null
  return (
    <InputGroupAddon align="block-start" className="flex-wrap border-b">
      <AttachmentGroup className="min-w-0 flex-1">
        {items.map((item) => {
          const busy = item.status === "uploading" || item.status === "deleting"
          const snapshot: AttachmentSnapshot | null =
            item.kind === "document" && item.knowledgeFilename
              ? {
                  knowledge_filename: item.knowledgeFilename,
                  display_name: item.displayName,
                  mime_type: item.mimeType,
                  size_bytes: item.sizeBytes,
                  scope,
                }
              : null
          return (
            <Attachment
              key={item.id}
              size="xs"
              state={item.status === "error" ? "error" : busy ? "uploading" : "done"}
              title={item.error}
            >
              <AttachmentMedia>{busy ? <Spinner /> : <FileTextIcon />}</AttachmentMedia>
              <AttachmentContent>
                {snapshot && onPreview ? (
                  <AttachmentTrigger onClick={() => onPreview(snapshot)}>
                    <AttachmentTitle>{item.displayName}</AttachmentTitle>
                  </AttachmentTrigger>
                ) : (
                  <AttachmentTitle>{item.displayName}</AttachmentTitle>
                )}
              </AttachmentContent>
              <AttachmentActions>
                {item.kind === "upload" && item.status === "error" && (
                  <AttachmentAction aria-label={t("composer.retryUpload", { name: item.displayName })} onClick={() => onRetryUpload(item.id)}>
                    <RotateCwIcon />
                  </AttachmentAction>
                )}
                <AttachmentAction
                  aria-label={t(item.kind === "document" ? "composer.removeFile" : "composer.dismiss", { name: item.displayName })}
                  disabled={item.status === "deleting"}
                  onClick={() =>
                    item.kind === "document" && item.knowledgeFilename
                      ? onDeleteDocument(item.knowledgeFilename)
                      : onDismissUpload(item.id)
                  }
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          )
        })}
      </AttachmentGroup>
      {onOpenKnowledge && (
        <InputGroupButton onClick={onOpenKnowledge}>{t("composer.manage")}</InputGroupButton>
      )}
    </InputGroupAddon>
  )
}

export function Composer({
  disabled,
  isStreaming,
  onSend,
  onStop,
  commands,
  commandsLoading,
  commandsError,
  onCommandsOpen,
  attachmentItems,
  attachmentsEnabled,
  attachmentScope,
  onAttachFiles,
  onDeleteDocument,
  onRetryUpload,
  onDismissUpload,
  onPreviewAttachment,
  onOpenKnowledge,
  placeholder,
}: {
  disabled: boolean
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  commands: SlashCommandInfo[]
  commandsLoading: boolean
  commandsError: string | null
  /** The slash dropdown opened: the list may be stale. */
  onCommandsOpen?: () => void
  attachmentItems: SessionAttachmentItem[]
  attachmentsEnabled: boolean
  attachmentScope: "session" | "agent"
  onAttachFiles: (files: File[]) => void
  onDeleteDocument: (filename: string) => void
  onRetryUpload: (id: string) => void
  onDismissUpload: (id: string) => void
  onPreviewAttachment?: (snapshot: AttachmentSnapshot) => void
  onOpenKnowledge?: () => void
  placeholder?: string
}) {
  const { t } = useTranslation("chat")
  const [value, setValue] = React.useState("")
  const disclosureId = React.useId()
  const [caret, setCaret] = React.useState(0)
  const [highlight, setHighlight] = React.useState(0)
  const [dismissed, setDismissed] = React.useState<{ value: string; tokenStart: number } | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const mirrorRef = React.useRef<HTMLDivElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const known = React.useMemo(() => new Set(commands.map((c) => c.name)), [commands])

  const token = findSlashTokenAtCaret(value, caret)
  const isDismissed = !!token && dismissed?.value === value && dismissed.tokenStart === token.start
  const open = !!token && !isDismissed && !disabled
  const onCommandsOpenRef = React.useRef(onCommandsOpen)
  onCommandsOpenRef.current = onCommandsOpen
  React.useEffect(() => {
    if (open) onCommandsOpenRef.current?.()
  }, [open])
  const filtered = React.useMemo(() => {
    if (!token) return []
    const q = token.queryToCaret.toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().startsWith(q))
  }, [commands, token])
  const activeIndex = Math.min(highlight, Math.max(0, filtered.length - 1))
  const match = filtered[activeIndex]
  const ghost =
    open &&
    token &&
    match &&
    token.caret === token.end &&
    token.end === value.length &&
    match.name.length > token.name.length &&
    match.name.toLowerCase().startsWith(token.name.toLowerCase())
      ? match.name.slice(token.name.length)
      : ""

  const syncCaret = () => setCaret(textareaRef.current?.selectionStart ?? 0)

  // Auto-grow up to ~8 lines and keep the highlight layer scrolled with the textarea.
  React.useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
    if (mirrorRef.current) mirrorRef.current.scrollTop = ta.scrollTop
  }, [value])

  const replaceRange = (start: number, end: number, insert: string) => {
    const next = value.slice(0, start) + insert + value.slice(end)
    setValue(next)
    const pos = start + insert.length
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const accept = (command: SlashCommandInfo) => {
    if (token) {
      const end = value[token.end] === " " ? token.end + 1 : token.end
      replaceRange(token.start, end, `/${command.name} `)
    } else {
      replaceRange(0, value.length, `/${command.name} `)
    }
    setHighlight(0)
  }

  const submit = () => {
    if (disabled || isStreaming || !value.trim()) return
    onSend(value)
    setValue("")
    setCaret(0)
    setDismissed(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlight((activeIndex + 1) % filtered.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlight((activeIndex - 1 + filtered.length) % filtered.length)
        return
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault()
        accept(filtered[activeIndex])
        return
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault()
      setDismissed({ value, tokenStart: token!.start })
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const segments = splitKnownCommands(value, known)

  return (
    <div className="relative flex flex-col gap-1.5">
      <AiDisclosure id={disclosureId} />
      {open && (
        <div
          role="listbox"
          id="cuga-slash-options"
          aria-label={t("composer.slashCommands")}
          className="glass-card absolute inset-x-0 bottom-full z-20 mb-2 max-h-80 overflow-y-auto rounded-lg border p-1 text-popover-foreground shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          {commandsLoading ? (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Spinner /> {t("composer.loadingCommands")}
            </div>
          ) : commandsError ? (
            <div className="flex items-center gap-1.5 p-2 text-sm text-warn-text">
              <TriangleAlertIcon className="size-4 shrink-0 text-status-warn" />
              {commandsError}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">{t("composer.noMatchingCommands")}</div>
          ) : (
            <ItemGroup>
              {filtered.map((command, index) => (
                <Item
                  key={command.name}
                  id={`cuga-slash-option-${command.name}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  size="sm"
                  className={cn("cursor-pointer", index === activeIndex && "bg-muted")}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => accept(command)}
                >
                  <ItemContent>
                    <ItemTitle>
                      <span className="font-mono">/{command.name}</span>
                      {command.argument_hint && (
                        <span className="font-mono text-xs text-muted-foreground">{command.argument_hint}</span>
                      )}
                      <Badge variant="outline">{t("composer.skill")}</Badge>
                    </ItemTitle>
                    {command.description && <ItemDescription>{command.description}</ItemDescription>}
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      )}

      {/* Composer card (after OpenClaw): one rounded surface, text on top, controls below. */}
      <InputGroup
        className={cn(
          "glass-card h-auto flex-col rounded-xl has-disabled:opacity-100",
          // dim the contents, not the card: opacity on a glass surface lets the
          // text behind it show through unblurred
          disabled && "*:opacity-60"
        )}
      >
        <ComposerAttachments
          items={attachmentItems}
          onDeleteDocument={onDeleteDocument}
          onRetryUpload={onRetryUpload}
          onDismissUpload={onDismissUpload}
          onPreview={onPreviewAttachment}
          onOpenKnowledge={onOpenKnowledge}
          scope={attachmentScope}
        />
        <div className="relative w-full">
          {/* Highlight layer: same box/typography as the textarea, text transparent. */}
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden px-3.5 py-3 text-base whitespace-pre-wrap text-transparent wrap-break-word md:text-sm"
          >
            {segments.map((seg, i) =>
              seg.command ? (
                <span key={i} className="rounded-sm bg-primary/12 ring-1 ring-primary/25">
                  {seg.text}
                </span>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
            {ghost && <span className="text-muted-foreground">{ghost}</span>}
          </div>
          <InputGroupTextarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder ?? t("composer.placeholder")}
            aria-label={t("composer.message")}
            aria-describedby={disclosureId}
            aria-autocomplete="list"
            aria-controls={open ? "cuga-slash-options" : undefined}
            aria-activedescendant={open && match ? `cuga-slash-option-${match.name}` : undefined}
            className="relative max-h-50 min-h-14 w-full px-3.5 py-3"
            onChange={(e) => {
              setValue(e.target.value)
              setCaret(e.target.selectionStart ?? 0)
              setHighlight(0)
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
            }}
          />
        </div>
        <InputGroupAddon align="block-end" className="justify-between">
          <div className="flex items-center gap-1">
            {attachmentsEnabled && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton size="icon-sm" aria-label={t("composer.attachFiles")} disabled={disabled} onClick={() => fileInputRef.current?.click()} />
                  }
                >
                  <PaperclipIcon />
                </TooltipTrigger>
                <TooltipContent>{t("composer.attachFiles")}</TooltipContent>
              </Tooltip>
            )}
            <span className="hidden pl-1 text-xs font-normal text-muted-foreground sm:inline">
              {commands.length > 0 ? t("composer.hintWithCommands") : t("composer.hint")}
            </span>
          </div>
          {isStreaming ? (
            <InputGroupButton variant="default" size="icon-sm" className="size-8 rounded-full" aria-label={t("composer.stop")} onClick={onStop}>
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="size-8 rounded-full"
              aria-label={t("composer.send")}
              disabled={disabled || !value.trim()}
              onClick={submit}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onAttachFiles(files)
          e.target.value = ""
        }}
      />
    </div>
  )
}

/** Render text with known /commands as pills (used in sent user bubbles). */
export function CommandText({ text, known }: { text: string; known: Set<string> }) {
  return (
    <>
      {splitKnownCommands(text, known).map((seg, i) =>
        seg.command ? (
          <span key={i} className="rounded-sm bg-primary-foreground/20 px-1 font-mono text-[0.92em]">
            {seg.text}
          </span>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </>
  )
}
