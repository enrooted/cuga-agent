/*
 * Small building blocks of the Knowledge panel, standing in for the Carbon
 * primitives the original uses (InlineNotification / ActionableNotification,
 * Tag, InlineLoading, NumberInput, TextInput, Select, Tile).
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// ── Tile ───────────────────────────────────────────────────────────────────
/** A flat card row. `accent` draws the 3 px status line on the left. */
export function Tile({
  accent,
  className,
  ...props
}: React.ComponentProps<"div"> & { accent?: "ok" | "warn" | "active" | "neutral" | "none" }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 text-card-foreground",
        accent && "border-l-[3px]",
        accent === "ok" && "border-l-status-ok",
        accent === "warn" && "border-l-status-warn",
        accent === "active" && "border-l-accent-line",
        accent === "neutral" && "border-l-border",
        accent === "none" && "border-l-transparent",
        className
      )}
      {...props}
    />
  )
}

/** Tile with a heading and a line of secondary text (the "disabled" states). */
export function MessageTile({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Tile className="flex flex-col gap-1">
      {title && <h4 className="text-sm font-semibold">{title}</h4>}
      <p className="text-[0.8125rem] leading-normal text-muted-foreground">{children}</p>
    </Tile>
  )
}

// ── Notice ─────────────────────────────────────────────────────────────────
export type NoticeKind = "info" | "success" | "warning" | "error"

const NOTICE_ICON: Record<NoticeKind, React.ReactNode> = {
  info: <InfoIcon className="text-muted-foreground" />,
  success: <CircleCheckIcon className="text-status-ok" />,
  warning: <TriangleAlertIcon className="text-status-warn" />,
  error: <CircleAlertIcon className="text-status-warn" />,
}

/**
 * Inline notification. Status is carried by the icon and the left border;
 * the text keeps the normal text colour. With `actionLabel` it is the
 * "actionable" variant; with `onClose` it gets a close button.
 */
export function Notice({
  kind,
  title,
  children,
  actionLabel,
  onAction,
  actionDisabled,
  onClose,
  className,
}: {
  kind: NoticeKind
  title: string
  children?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
  onClose?: () => void
  className?: string
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-l-[3px] bg-card px-3 py-2.5 text-sm",
        kind === "success" && "border-l-status-ok",
        (kind === "warning" || kind === "error") && "border-l-status-warn",
        kind === "info" && "border-l-accent-line",
        className
      )}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:size-4" aria-hidden="true">
        {NOTICE_ICON[kind]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold text-warn-text">{title}</p>
        {children && <div className="break-words text-muted-foreground">{children}</div>}
      </div>
      {actionLabel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
      {onClose && (
        <IconButton label="Dismiss" onClick={onClose} className="-my-0.5 -mr-1 shrink-0">
          <XIcon />
        </IconButton>
      )}
    </div>
  )
}

// ── StatusBadge ────────────────────────────────────────────────────────────
export type StatusTone = "ok" | "warn" | "active" | "neutral"

/**
 * Compact status chip. Green/orange only ever appear as the icon or dot; the
 * label stays in the normal text colour.
 */
export function StatusBadge({
  tone,
  icon,
  title,
  children,
  className,
}: {
  tone: StatusTone
  /** Icon to show; defaults to a check (ok) or an alert (warn). `false` hides it. */
  icon?: React.ReactNode | false
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const defaultIcon =
    tone === "ok" ? (
      <CheckIcon className="text-status-ok" />
    ) : tone === "warn" ? (
      <CircleAlertIcon className="text-status-warn" />
    ) : null
  return (
    <Badge variant={tone === "neutral" ? "secondary" : "outline"} title={title} className={className}>
      {icon === false ? null : (icon ?? defaultIcon)}
      {children}
    </Badge>
  )
}

/** 8 px status dot (null = unknown / off). */
export function StatusDot({ state, title }: { state: "ok" | "warn" | "off"; title?: string }) {
  return (
    <span
      aria-hidden="true"
      title={title}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "ok" && "bg-status-ok",
        state === "warn" && "bg-status-warn",
        state === "off" && "bg-muted-foreground/40"
      )}
    />
  )
}

// ── InlineLoading ──────────────────────────────────────────────────────────
export function InlineLoading({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <Spinner aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  )
}

// ── IconButton ─────────────────────────────────────────────────────────────
/** Icon-only ghost button with an `aria-label` and a tooltip. */
export function IconButton({
  label,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "aria-label" | "render"> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={className}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// ── form fields ────────────────────────────────────────────────────────────
function FieldShell({
  id,
  label,
  hideLabel,
  helperText,
  invalid,
  invalidText,
  className,
  children,
}: {
  id: string
  label: string
  hideLabel?: boolean
  helperText?: React.ReactNode
  invalid?: boolean
  invalidText?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Field data-invalid={invalid || undefined} className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </FieldLabel>
      {children}
      {invalid && invalidText ? (
        <FieldError id={`${id}-error`} className="flex items-start gap-1.5 text-xs">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-warn" aria-hidden="true" />
          <span>{invalidText}</span>
        </FieldError>
      ) : (
        helperText && (
          <FieldDescription id={`${id}-help`} className="text-xs">
            {helperText}
          </FieldDescription>
        )
      )}
    </Field>
  )
}

function describedBy(id: string, invalid?: boolean, invalidText?: React.ReactNode, helperText?: React.ReactNode) {
  if (invalid && invalidText) return `${id}-error`
  return helperText ? `${id}-help` : undefined
}

export function TextField({
  id,
  label,
  hideLabel,
  helperText,
  invalid,
  invalidText,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "id"> & {
  id: string
  label: string
  hideLabel?: boolean
  helperText?: React.ReactNode
  invalid?: boolean
  invalidText?: React.ReactNode
}) {
  return (
    <FieldShell
      id={id}
      label={label}
      hideLabel={hideLabel}
      helperText={helperText}
      invalid={invalid}
      invalidText={invalidText}
      className={className}
    >
      <Input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(id, invalid, invalidText, helperText)}
        {...props}
      />
    </FieldShell>
  )
}

export function SelectField({
  id,
  label,
  helperText,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof NativeSelect>, "id"> & {
  id: string
  label: string
  helperText?: React.ReactNode
}) {
  return (
    <FieldShell id={id} label={label} helperText={helperText} className={className}>
      <NativeSelect id={id} className="w-full" aria-describedby={helperText ? `${id}-help` : undefined} {...props}>
        {children}
      </NativeSelect>
    </FieldShell>
  )
}

/**
 * Number input. Keeps the typed text locally so the field can be cleared while
 * editing; `onChange` only fires with finite numbers.
 */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  helperText,
  invalid,
  invalidText,
  onChange,
  className,
}: {
  id: string
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  helperText?: React.ReactNode
  invalid?: boolean
  invalidText?: React.ReactNode
  onChange: (value: number) => void
  className?: string
}) {
  const [draft, setDraft] = React.useState(String(value))
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    // The value changed from outside (profile switch, reset, another field).
    setLastValue(value)
    if (Number(draft) !== value) setDraft(String(value))
  }

  const outOfRange =
    draft.trim() === "" ||
    !Number.isFinite(Number(draft)) ||
    (min !== undefined && Number(draft) < min) ||
    (max !== undefined && Number(draft) > max)
  const isInvalid = !!invalid || outOfRange
  const errorText = invalid && invalidText ? invalidText : outOfRange ? "Number is not valid" : undefined

  return (
    <FieldShell
      id={id}
      label={label}
      helperText={helperText}
      invalid={isInvalid}
      invalidText={errorText}
      className={className}
    >
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-invalid={isInvalid || undefined}
        aria-describedby={describedBy(id, isInvalid, errorText, helperText)}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === "") return
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => {
          if (draft.trim() === "" || !Number.isFinite(Number(draft))) setDraft(String(value))
        }}
      />
    </FieldShell>
  )
}
