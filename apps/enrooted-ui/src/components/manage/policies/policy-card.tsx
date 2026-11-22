/*
 * One policy in a list: enable checkbox, name, expand/collapse, delete, a
 * one-line summary while collapsed and the editor while expanded.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0).
 */

import * as React from "react"
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function IconAction({
  label,
  onClick,
  disabled,
  expanded,
  controls,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  expanded?: boolean
  controls?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={controls}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function PolicyCard({
  domId,
  name,
  namePlaceholder,
  enabled,
  expanded,
  disabled,
  onEnabledChange,
  onNameChange,
  onToggleExpanded,
  onRemove,
  actions,
  summary,
  children,
}: {
  /** Unique within the dialog; used for input ids. */
  domId: string
  name: string
  namePlaceholder: string
  enabled: boolean
  expanded: boolean
  /** The global policy switch is off: everything but expand/collapse is locked. */
  disabled: boolean
  onEnabledChange: (enabled: boolean) => void
  onNameChange: (name: string) => void
  onToggleExpanded: () => void
  onRemove: () => void
  actions?: React.ReactNode
  summary: React.ReactNode
  children: React.ReactNode
}) {
  const bodyId = `policy-body-${domId}`
  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <div className={cn("p-3", expanded && "bg-muted/50")}>
        <div className="flex items-center gap-3">
          <Checkbox
            aria-label="Enable Policy"
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked)}
            disabled={disabled}
          />
          <Input
            id={`name-${domId}`}
            aria-label="Policy Name"
            className="max-w-sm min-w-0 flex-1"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={namePlaceholder}
            disabled={disabled}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
            <IconAction
              label={expanded ? "Collapse" : "Expand"}
              expanded={expanded}
              controls={expanded ? bodyId : undefined}
              onClick={onToggleExpanded}
            >
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </IconAction>
            <IconAction label="Delete" onClick={onRemove} disabled={disabled}>
              <Trash2Icon />
            </IconAction>
          </div>
        </div>
        {!expanded && (
          <div className="mt-2 ml-7 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {summary}
          </div>
        )}
      </div>
      {expanded && (
        <div id={bodyId} className="flex flex-col gap-5 border-t p-4">
          {children}
        </div>
      )}
    </li>
  )
}
