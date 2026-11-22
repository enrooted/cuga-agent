import * as React from "react"
import { BrainIcon, FileTextIcon, ListChecksIcon } from "lucide-react"

import { AgentMark } from "@/components/agent-mark"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { Markdown } from "@/components/markdown"
import { CommandText } from "@/components/chat/composer"
import { MessageSources } from "@/components/chat/sources"
import type { ActionButton, AssistantMessage, AttachmentSnapshot, Step, UserMessage } from "@/lib/chat-model"
import type { MessageSource } from "@/lib/citations"

export interface AgentProfile {
  nickname: string
}

const formatTime = (iso: string) => {
  const d = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function StepItem({ step }: { step: Step }) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <ListChecksIcon />
          </TraceIcon>
          <TraceTitle>{step.title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Markdown size="sm">{step.content}</Markdown>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/**
 * Reasoning steps. Carbon renders these as a "Show details / Hide details"
 * toggle (CUGA relabels Carbon's "Show reasoning"); same here.
 */
function StepsTrace({ steps, running }: { steps: Step[]; running: boolean }) {
  const [open, setOpen] = React.useState(false)
  if (steps.length === 0) return null
  const last = steps[steps.length - 1]
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>{running ? last.title : open ? "Hide details" : "Show details"}</TraceTitle>
          <TraceDescription>
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {steps.map((step, i) => (
            <StepItem key={i} step={step} />
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ActionCardView({
  message,
  disabled,
  onAction,
}: {
  message: AssistantMessage
  disabled: boolean
  onAction: (button: ActionButton) => void
}) {
  const card = message.card!
  return (
    <Card size="sm" className="w-full max-w-xl">
      <CardContent className="flex flex-col gap-2">
        {card.parts.map((part, i) => (
          <Markdown key={i}>{part}</Markdown>
        ))}
      </CardContent>
      {card.buttons.length > 0 && (
        <CardFooter className="flex gap-2">
          {card.buttons.map((b) => (
            <Button
              key={b.label}
              variant={b.variant === "primary" ? "default" : b.variant === "danger" ? "destructive" : "outline"}
              disabled={disabled || !!card.answered}
              onClick={() => onAction(b)}
            >
              {b.label}
            </Button>
          ))}
          {card.answered && <span className="text-xs text-muted-foreground">You chose “{card.answered}”</span>}
        </CardFooter>
      )}
    </Card>
  )
}

export function AssistantMessageView({
  message,
  profile,
  actionsDisabled,
  onAction,
  onOpenSources,
  onOpenMemoryUsage,
}: {
  message: AssistantMessage
  profile: AgentProfile
  actionsDisabled: boolean
  onAction: (messageId: string, button: ActionButton) => void
  onOpenSources: (sources: MessageSource[], n: number | null) => void
  onOpenMemoryUsage?: (entityIds: string[], relationship: "used" | "saved") => void
}) {
  const running = message.status !== "done"
  const hasText = message.text.trim().length > 0
  return (
    <Message align="start" className="gap-2.5">
      {/* Avatar column at the top of the turn (after OpenClaw's grouped layout). */}
      <MessageAvatar className="self-start! translate-y-0! rounded-none bg-transparent">
        <AgentMark className="size-7" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          {profile.nickname}
          <span className="ml-2 font-normal">{formatTime(message.time)}</span>
        </MessageHeader>
        {message.status === "pending" && (
          <TraceLine status="running" className="px-3">
            <TraceTitle>Thinking…</TraceTitle>
          </TraceLine>
        )}
        {message.steps.length > 0 && (
          <div className="px-3">
            <StepsTrace steps={message.steps} running={running} />
          </div>
        )}
        {hasText && (
          <Bubble variant="ghost" className="px-3">
            <BubbleContent render={<div />}>
              <Markdown
                sources={message.sources}
                onOpenCitation={(n) => onOpenSources(message.sources, n)}
              >
                {message.text}
              </Markdown>
            </BubbleContent>
          </Bubble>
        )}
        {message.card && (
          <div className="px-3">
            <ActionCardView
              message={message}
              disabled={actionsDisabled}
              onAction={(b) => onAction(message.id, b)}
            />
          </div>
        )}
        {(message.sources.length > 0 || message.memoryUsed || message.memorySaved) && (
          <MessageFooter className="flex-wrap gap-2">
            <MessageSources sources={message.sources} onOpen={(n) => onOpenSources(message.sources, n)} />
            {onOpenMemoryUsage &&
              (["used", "saved"] as const).map((rel) => {
                const d = rel === "used" ? message.memoryUsed : message.memorySaved
                if (!d) return null
                return (
                  <Button key={rel} variant="link" size="xs" onClick={() => onOpenMemoryUsage(d.entityIds, rel)}>
                    {d.count} {d.count === 1 ? "memory" : "memories"} {rel}
                  </Button>
                )
              })}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

export function UserMessageView({
  message,
  attachments,
  knownCommands,
  onPreviewAttachment,
}: {
  message: UserMessage
  attachments: AttachmentSnapshot[]
  knownCommands: Set<string>
  onPreviewAttachment?: (a: AttachmentSnapshot) => void
}) {
  return (
    <Message align="end">
      <MessageContent>
        {attachments.length > 0 && (
          <AttachmentGroup className="justify-end">
            {attachments.map((a) => (
              <Attachment key={a.knowledge_filename} size="xs">
                <AttachmentMedia>
                  <FileTextIcon />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTrigger onClick={() => onPreviewAttachment?.(a)}>
                    <AttachmentTitle>{a.display_name}</AttachmentTitle>
                  </AttachmentTrigger>
                </AttachmentContent>
              </Attachment>
            ))}
          </AttachmentGroup>
        )}
        <Bubble align="end" variant="secondary">
          <BubbleContent className="rounded-2xl rounded-br-sm whitespace-pre-wrap">
            <CommandText text={message.text} known={knownCommands} />
          </BubbleContent>
        </Bubble>
        <MessageFooter>{formatTime(message.time)}</MessageFooter>
      </MessageContent>
    </Message>
  )
}
