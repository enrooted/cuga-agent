/*
 * Chat cards shown when a policy acted on a message: an intent guard blocked
 * the request, or a playbook was activated.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PolicyBlockComponent.tsx
 * and PolicyPlaybookComponent.tsx (Copyright IBM Corp., Apache-2.0).
 * The policies editor does not use them; the chat renders them for
 * `policy_block` / `policy_playbook` step payloads.
 */

import * as React from "react"
import { BookOpenIcon, CircleAlertIcon, InfoIcon, LightbulbIcon, ShieldIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"

export interface PolicyBlockData {
  type: "policy_block"
  content: string
  metadata: {
    policy_blocked: boolean
    policy_id: string
    policy_name: string
    policy_reasoning: string
    policy_confidence: number
  }
}

export interface PolicyPlaybookData {
  type: "policy_playbook"
  content: string
  metadata: {
    policy_matched: boolean
    policy_id: string
    policy_name: string
    policy_type: string
    policy_confidence: number
    playbook_guidance?: string
    playbook_steps?: {
      step_number: number
      instruction: string
      expected_outcome: string
      tools_allowed?: string[]
    }[]
  }
}

function CardShell({
  icon,
  title,
  badge,
  tone,
  children,
}: {
  icon: React.ReactNode
  title: string
  badge: string
  tone: "warn" | "neutral"
  children: React.ReactNode
}) {
  return (
    <div
      className={
        tone === "warn"
          ? "overflow-hidden rounded-xl border border-status-warn/60 bg-card"
          : "overflow-hidden rounded-xl border bg-card"
      }
    >
      <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-3">
        {icon}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <Badge variant="outline">{badge}</Badge>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  )
}

function Details({
  nameLabel,
  name,
  id,
  confidence,
}: {
  nameLabel: string
  name: string
  id: string
  confidence: number
}) {
  const percent = Math.round(confidence * 100)
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{nameLabel}</dt>
      <dd className="font-semibold">{name}</dd>
      <dt className="text-muted-foreground">Policy ID:</dt>
      <dd className="font-mono text-xs break-all">{id}</dd>
      <dt className="text-muted-foreground" aria-hidden="true">
        Match Confidence:
      </dt>
      <dd>
        <Progress value={percent} className="max-w-xs items-center gap-x-3 gap-y-1">
          <ProgressLabel className="sr-only">Match Confidence</ProgressLabel>
          <ProgressValue className="order-last ml-0 w-10 text-right" />
        </Progress>
      </dd>
    </dl>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <InfoIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h4>
      {children}
    </section>
  )
}

export function PolicyBlock({ data }: { data: PolicyBlockData }) {
  const { content, metadata } = data
  return (
    <CardShell
      tone="warn"
      icon={<ShieldIcon className="size-6 shrink-0 text-status-warn" aria-hidden="true" />}
      title="Intent Blocked by Policy"
      badge="Security Policy"
    >
      <div className="flex items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-4.5 shrink-0 text-status-warn" aria-hidden="true" />
        <p className="text-sm text-warn-text">{content}</p>
      </div>
      <Details
        nameLabel="Policy Name:"
        name={metadata.policy_name}
        id={metadata.policy_id}
        confidence={metadata.policy_confidence}
      />
      <SubSection title="Reasoning">
        <p className="text-sm text-body">{metadata.policy_reasoning}</p>
      </SubSection>
    </CardShell>
  )
}

export function PolicyPlaybook({ data }: { data: PolicyPlaybookData }) {
  const { content, metadata } = data
  const steps = metadata.playbook_steps || []
  return (
    <CardShell
      tone="neutral"
      icon={<BookOpenIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />}
      title="Playbook Activated"
      badge="Guided Workflow"
    >
      <div className="flex items-start gap-2">
        <LightbulbIcon className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">{content || "I'll guide you through this process step by step."}</p>
      </div>
      <Details
        nameLabel="Playbook Name:"
        name={metadata.policy_name}
        id={metadata.policy_id}
        confidence={metadata.policy_confidence}
      />
      {steps.length > 0 && (
        <SubSection title={`Workflow Steps (${steps.length})`}>
          <ol className="flex flex-col gap-2">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums">
                  {step.step_number}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span>{step.instruction}</span>
                  {step.expected_outcome && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-semibold">Expected:</span> {step.expected_outcome}
                    </span>
                  )}
                  {step.tools_allowed && step.tools_allowed.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-semibold">Tools:</span> {step.tools_allowed.join(", ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </SubSection>
      )}
      {metadata.playbook_guidance && (
        <SubSection title="Guidance">
          <div className="text-sm whitespace-pre-wrap text-body">{metadata.playbook_guidance}</div>
        </SubSection>
      )}
    </CardShell>
  )
}
