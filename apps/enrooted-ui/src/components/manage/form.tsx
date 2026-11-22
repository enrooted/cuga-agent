/* Small form and layout pieces shared by the Manage pages. */
import * as React from "react"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"

import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/** One collapsible section of the configuration (Carbon: AccordionItem). */
export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className="px-4 font-heading text-sm font-medium">{title}</AccordionTrigger>
      <AccordionContent className="px-4">
        <div className="flex flex-col gap-4 pt-1 pb-2">{children}</div>
      </AccordionContent>
    </AccordionItem>
  )
}

export type NoticeKind = "error" | "warning" | "success" | "info"

/**
 * Inline message (Carbon: InlineNotification). Orange and green are status
 * colours, never text: the words stay in the normal colour and the icon and
 * the left edge carry the status.
 */
export function Notice({ kind, title, children, className }: { kind: NoticeKind; title?: string; children?: React.ReactNode; className?: string }) {
  const Icon = kind === "success" ? CircleCheckIcon : kind === "info" ? InfoIcon : TriangleAlertIcon
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-md border border-l-4 bg-background/60 px-3 py-2 text-sm text-body",
        kind === "success" ? "border-l-status-ok" : kind === "info" ? "border-l-accent-line" : "border-l-status-warn",
        className
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          kind === "success" ? "text-status-ok" : kind === "info" ? "text-link" : "text-status-warn"
        )}
      />
      <div className="min-w-0">
        {title && <span className="font-bold text-foreground">{title}</span>}
        {title && children ? " " : null}
        {children}
      </div>
    </div>
  )
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
}

type InputProps = Omit<React.ComponentProps<typeof Input>, "id">

export function TextField({
  id,
  label,
  helper,
  error,
  className,
  ...props
}: InputProps & { id: string; label: string; helper?: string; error?: string }) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} aria-invalid={error ? true : undefined} {...props} />
      {error ? <FieldError>{error}</FieldError> : helper ? <FieldDescription>{helper}</FieldDescription> : null}
    </Field>
  )
}

export function TextAreaField({
  id,
  label,
  helper,
  error,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "id"> & { id: string; label?: string; helper?: string; error?: string }) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      {label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <Textarea id={id} aria-invalid={error ? true : undefined} aria-label={label ? undefined : props["aria-label"]} {...props} />
      {error ? <FieldError>{error}</FieldError> : helper ? <FieldDescription>{helper}</FieldDescription> : null}
    </Field>
  )
}

/**
 * Number input (Carbon: NumberInput). `onValue` gets a number, or "" when the
 * box is empty (only meaningful with `allowEmpty`).
 */
export function NumberField({
  id,
  label,
  helper,
  value,
  onValue,
  allowEmpty,
  className,
  ...props
}: Omit<InputProps, "value" | "onChange" | "type"> & {
  id: string
  label: string
  helper?: string
  value: number | ""
  onValue: (value: number | "") => void
  allowEmpty?: boolean
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === "") return onValue(allowEmpty ? "" : (Number.NaN as number))
          onValue(Number(raw))
        }}
        className="max-w-40 tabular-nums"
        {...props}
      />
      {helper && <FieldDescription>{helper}</FieldDescription>}
    </Field>
  )
}

export function CheckField({
  id,
  label,
  helper,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  helper?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <Field orientation="horizontal" className="items-start">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="font-sans font-normal">
          {label}
        </FieldLabel>
        {helper && <FieldDescription>{helper}</FieldDescription>}
      </div>
    </Field>
  )
}
