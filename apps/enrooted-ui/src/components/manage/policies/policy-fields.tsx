/*
 * Form controls of the Policies editor.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0). Carbon TextArea / NumberInput / Select /
 * Slider / MultiSelect and the local TagInput, rebuilt on shadcn primitives.
 * MultiSelect and TagInput do not exist in src/components/ui, so they are
 * composed here from Popover, Checkbox, Badge and Input.
 */

import * as React from "react"
import { ChevronsUpDownIcon, TriangleAlertIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"

// ── textarea ───────────────────────────────────────────────────────────────
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
  helperText,
  mono,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  helperText?: string
  mono?: boolean
}) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        // The shadcn textarea sizes to its content; `rows` only sets the floor.
        style={{ minHeight: `${rows * 1.25 + 1}rem` }}
        className={mono ? "font-mono" : undefined}
        disabled={disabled}
        aria-describedby={helperText ? `${id}-help` : undefined}
      />
      {helperText && <FieldDescription id={`${id}-help`}>{helperText}</FieldDescription>}
    </Field>
  )
}

// ── number ─────────────────────────────────────────────────────────────────
/**
 * Carbon NumberInput: reports the typed number, or `emptyValue` when the box
 * is empty. Like Carbon it marks an out-of-range number as invalid but still
 * reports it (no clamping).
 */
export function NumberField({
  id,
  label,
  value,
  emptyValue,
  onChange,
  min,
  max,
  placeholder,
  disabled,
  helperText,
}: {
  id: string
  label: string
  value: number | undefined
  emptyValue: number | undefined
  onChange: (value: number | undefined) => void
  min?: number
  max?: number
  placeholder?: string
  disabled?: boolean
  helperText?: string
}) {
  const toText = (v: number | undefined) => (v === undefined ? "" : String(v))
  const [text, setText] = React.useState(() => toText(value))
  const [prevValue, setPrevValue] = React.useState(value)
  const parse = (t: string) => (t === "" ? emptyValue : Number(t))
  if (value !== prevValue) {
    // Changed from outside (import, reload): show it, unless it is what was typed.
    setPrevValue(value)
    if (parse(text) !== value) setText(toText(value))
  }

  const typed = text === "" ? undefined : Number(text)
  const invalid =
    typed !== undefined &&
    (Number.isNaN(typed) || (min !== undefined && typed < min) || (max !== undefined && typed > max))
  const rangeHint =
    min !== undefined && max !== undefined
      ? `Enter a number between ${min} and ${max}.`
      : min !== undefined
        ? `Enter a number of at least ${min}.`
        : "Enter a valid number."

  return (
    <Field data-disabled={disabled || undefined} data-invalid={invalid || undefined} className="max-w-xs">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={text}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          const parsed = parse(next)
          if (parsed === undefined || !Number.isNaN(parsed)) onChange(parsed)
        }}
        onBlur={() => setText(toText(value))}
      />
      <div id={`${id}-help`} className="flex flex-col gap-1">
        {invalid && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-warn-text">
            <TriangleAlertIcon className="size-3.5 shrink-0 text-status-warn" aria-hidden="true" />
            {rangeHint}
          </p>
        )}
        {helperText && <FieldDescription>{helperText}</FieldDescription>}
      </div>
    </Field>
  )
}

// ── select ─────────────────────────────────────────────────────────────────
export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  helperText,
}: {
  id: string
  label: string
  value: T
  options: readonly { value: T; text: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  helperText?: string
}) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="w-full max-w-md"
        value={value}
        disabled={disabled}
        aria-describedby={helperText ? `${id}-help` : undefined}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value)
          if (next) onChange(next.value)
        }}
      >
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {helperText && <FieldDescription id={`${id}-help`}>{helperText}</FieldDescription>}
    </Field>
  )
}

export const KEYWORD_OPERATOR_OPTIONS = [
  { value: "and", text: "Match ALL keywords (AND)" },
  { value: "or", text: "Match ANY keyword (OR)" },
] as const

// ── checkbox ───────────────────────────────────────────────────────────────
export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
  helperText,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  helperText?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(next) => onChange(next)} disabled={disabled} />
        <span>{label}</span>
      </label>
      {helperText && <p className="pl-6 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}

// ── similarity threshold ───────────────────────────────────────────────────
/** Carbon Slider 0.50–1.00 in steps of 0.05; a missing threshold shows as 0.70. */
export function ThresholdSlider({
  id,
  threshold,
  onChange,
  disabled,
}: {
  id: string
  threshold: number | undefined
  onChange: (threshold: number) => void
  disabled?: boolean
}) {
  const value = threshold || 0.7
  return (
    <Field data-disabled={disabled || undefined}>
      <div id={`${id}-label`} className="text-sm font-medium group-data-[disabled=true]/field:opacity-50">
        Similarity Threshold: <span className="tabular-nums">{value.toFixed(2)}</span>
      </div>
      <div className="flex max-w-md items-center gap-3 text-xs text-muted-foreground tabular-nums">
        <span aria-hidden="true">0.5</span>
        <Slider
          id={id}
          aria-labelledby={`${id}-label`}
          min={0.5}
          max={1}
          step={0.05}
          value={[value]}
          disabled={disabled}
          onValueChange={(next) => {
            const n = Array.isArray(next) ? next[0] : next
            if (typeof n === "number") onChange(Math.round(n * 100) / 100)
          }}
        />
        <span aria-hidden="true">1</span>
      </div>
    </Field>
  )
}

// ── tag input ──────────────────────────────────────────────────────────────
/**
 * Free-text list: Enter or comma adds the typed text, Backspace in an empty
 * box removes the last tag, leaving the box adds what is still typed.
 * Duplicates and blanks are ignored.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
  disabled,
  labelText,
  helperText,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  labelText: string
  helperText?: string
}) {
  const id = React.useId()
  const [inputValue, setInputValue] = React.useState("")

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed])
    setInputValue("")
  }
  const removeTag = (index: number) => onChange(values.filter((_, i) => i !== index))

  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{labelText}</FieldLabel>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={labelText}>
          {values.map((tag, index) => (
            <li key={`${index}-${tag}`}>
              <Badge variant="secondary" className="h-6 max-w-full gap-1 pr-1">
                <span className="truncate">{tag}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  aria-label={`Remove ${tag}`}
                  disabled={disabled}
                  onClick={() => removeTag(index)}
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            addTag(inputValue)
          } else if (e.key === "Backspace" && !inputValue && values.length > 0) {
            removeTag(values.length - 1)
          }
        }}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue)
        }}
        placeholder={values.length === 0 ? placeholder : "Type and press enter..."}
        disabled={disabled}
        aria-describedby={helperText ? `${id}-help` : undefined}
      />
      {helperText && <FieldDescription id={`${id}-help`}>{helperText}</FieldDescription>}
    </Field>
  )
}

// ── multi select ───────────────────────────────────────────────────────────
export interface MultiSelectItem {
  id: string
  text: string
}

/**
 * Carbon MultiSelect: a dropdown of checkboxes. As in the original, only the
 * listed items can be selected, and a change reports the selected listed items
 * (so a "*" wildcard or a name that is no longer available is dropped by the
 * first change). `wildcardLabel` only names the "*" state in the closed control.
 */
export function MultiSelectField({
  id,
  label,
  placeholder,
  items,
  value,
  onChange,
  disabled,
  helperText,
  wildcardLabel,
}: {
  id: string
  label: string
  placeholder: string
  items: MultiSelectItem[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  helperText?: string
  wildcardLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState("")

  const known = new Set(items.map((item) => item.id))
  const selected = value.filter((v, i) => known.has(v) && value.indexOf(v) === i)
  const selectedSet = new Set(selected)
  const textOf = (itemId: string) => items.find((item) => item.id === itemId)?.text ?? itemId

  const toggle = (itemId: string, checked: boolean) =>
    onChange(checked ? [...selected, itemId] : selected.filter((s) => s !== itemId))

  const needle = filter.trim().toLowerCase()
  const visible = needle ? items.filter((item) => item.text.toLowerCase().includes(needle)) : items
  const summary =
    selected.length > 0
      ? `${selected.length} selected`
      : wildcardLabel && value.includes("*")
        ? wildcardLabel
        : placeholder

  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setFilter("")
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              className="w-full max-w-md justify-between font-normal"
              disabled={disabled}
              aria-describedby={helperText ? `${id}-help` : undefined}
            />
          }
        >
          <span className={selected.length > 0 ? "truncate" : "truncate text-muted-foreground"}>{summary}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-72 gap-0 p-0">
          {items.length > 8 && (
            <div className="border-b p-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                aria-label={`Filter ${label}`}
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1" role="group" aria-label={label}>
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {items.length === 0 ? "Nothing available." : "No matches."}
              </p>
            ) : (
              visible.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-foreground/5"
                >
                  <Checkbox
                    checked={selectedSet.has(item.id)}
                    onCheckedChange={(checked) => toggle(item.id, checked)}
                  />
                  <span className="min-w-0 break-words">{item.text}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <span className="text-xs text-muted-foreground">{selected.length} selected</span>
            <Button variant="ghost" size="sm" disabled={selected.length === 0} onClick={() => onChange([])}>
              Clear selection
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected: ${label}`}>
          {selected.map((itemId) => (
            <li key={itemId}>
              <Badge variant="secondary" className="h-6 max-w-full gap-1 pr-1">
                <span className="truncate">{textOf(itemId)}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  aria-label={`Remove ${textOf(itemId)}`}
                  disabled={disabled}
                  onClick={() => toggle(itemId, false)}
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {helperText && <FieldDescription id={`${id}-help`}>{helperText}</FieldDescription>}
    </Field>
  )
}
