/*
 * Small building blocks of the Memory workspace, standing in for the Carbon
 * primitives the original uses (ContentSkeleton, AsyncButton, Pagination, Tag,
 * the definition list and the master/detail layout).
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/memory/MemoryWorkspace.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { IconButton, StatusBadge } from "@/components/manage/knowledge/parts"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import i18n from "@/i18n"
import type { MemoryRecord, RetentionCapabilities } from "@/lib/memory/types"
import { cn } from "@/lib/utils"

export function displayType(value: string): string {
  if (value === "trajectory") return i18n.t("memory:type.conversationMemory")
  if (value === "user_preferences" || value === "preference")
    return i18n.t("memory:type.preference")
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

// Statuses are passed around as these identifiers and translated where shown.
const STATUS_KEYS: Record<string, string> = {
  Current: "current",
  Retained: "retained",
  "Needs attention": "needsAttention",
  Protected: "protected",
  Incomplete: "incomplete",
  Failed: "failed",
  Running: "running",
  Cancelled: "cancelled",
  Interrupted: "interrupted",
  Unavailable: "unavailable",
  "Status unavailable": "statusUnavailable",
  Disabled: "disabled",
  Enabled: "enabled",
  "Enabled and healthy": "enabledHealthy",
  Completed: "completed",
}

/** The words shown for a status identifier, in the current language. */
export function displayStatus(status: string): string {
  const key = STATUS_KEYS[status]
  return key ? i18n.t(`memory:status.${key}`) : status
}

export function statusTone(
  status: string
): "healthy" | "warning" | "neutral" | "error" {
  if (status === "Needs attention" || status === "Protected") {
    return "warning"
  }
  if (status === "Incomplete" || status === "Failed") return "error"
  if (status === "Running" || status === "Cancelled") return "neutral"
  if (status === "Interrupted") return "warning"
  if (
    status === "Unavailable" ||
    status === "Status unavailable" ||
    status === "Disabled"
  )
    return "neutral"
  return "healthy"
}

export function formatRule(
  rule: RetentionCapabilities["rules"][number]
): string {
  if (rule.sourceDeleted && rule.minSourceDeletedDays != null)
    return i18n.t("memory:rule.deleteAfterSourceDeleted", {
      days: rule.minSourceDeletedDays,
    })
  if (rule.sourceDeleted && rule.maxAgeDays != null)
    return i18n.t("memory:rule.deleteOldIfSourceDeleted", {
      days: rule.maxAgeDays,
    })
  if (rule.description) return rule.description
  if (rule.sourceDeleted) return i18n.t("memory:rule.deleteWhenSourcesDeleted")
  const action =
    rule.action === "delete" || rule.action === "flag" ? rule.action : "other"
  const days = rule.maxUnusedDays ?? rule.maxAgeDays
  const timing =
    days == null
      ? "always"
      : rule.maxUnusedDays != null
        ? "unused"
        : "afterDays"
  const target =
    rule.entityType === "trajectory"
      ? i18n.t("memory:rule.target.conversation")
      : rule.entityType === "guideline"
        ? i18n.t("memory:rule.target.guidelines")
        : rule.entityType
          ? i18n.t("memory:rule.target.typed", {
              type: displayType(rule.entityType).toLowerCase(),
            })
          : i18n.t("memory:rule.target.all")
  return i18n.t(`memory:rule.${action}.${timing}`, {
    action: displayType(rule.action),
    target,
    days,
  })
}

export function memoryStatusDetail(
  memory: MemoryRecord,
  capabilities: RetentionCapabilities | null
): string {
  if (memory.state !== "Needs attention") return memory.statusDetail
  const rule = capabilities?.rules.find(
    (candidate) => candidate.name === memory.retentionRule
  )
  if (!rule) return memory.statusDetail
  const type = rule.entityType
    ? displayType(rule.entityType).toLowerCase()
    : undefined
  if (rule.maxUnusedDays != null) {
    return i18n.t(
      type
        ? "memory:statusDetail.unusedTyped"
        : "memory:statusDetail.unusedMatching",
      { type, days: rule.maxUnusedDays }
    )
  }
  if (rule.maxAgeDays != null) {
    return i18n.t(
      type ? "memory:statusDetail.ageTyped" : "memory:statusDetail.ageMatching",
      { type, days: rule.maxAgeDays }
    )
  }
  return i18n.t("memory:statusDetail.matchedRule", {
    rule: displayType(rule.name).toLowerCase(),
  })
}

/** Status chip: the icon and the words carry the status, never colour alone. */
export function StatusPill({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const tone = statusTone(status)
  return (
    <StatusBadge
      tone={tone === "healthy" ? "ok" : tone === "neutral" ? "neutral" : "warn"}
      icon={
        tone === "healthy" ? (
          <CheckIcon className="text-status-ok" />
        ) : tone === "warning" ? (
          <TriangleAlertIcon className="text-status-warn" />
        ) : tone === "error" ? (
          <CircleAlertIcon className="text-status-warn" />
        ) : (
          <CircleDashedIcon className="text-muted-foreground" />
        )
      }
      className={className}
    >
      {displayStatus(status)}
    </StatusBadge>
  )
}

/** Placeholder rows while a section loads (Carbon UI: ContentSkeleton). */
export function ContentSkeleton({
  label,
  rows = 3,
  kind = "list",
}: {
  label: string
  rows?: number
  kind?: "list" | "table"
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="flex flex-col gap-2 py-2"
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className={kind === "table" ? "h-9 w-full" : "h-14 w-full"}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** Button that shows a spinner and a label while its action runs (Carbon UI: AsyncButton). */
export function AsyncButton({
  busy,
  busyLabel,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "render"> & {
  busy: boolean
  busyLabel: string
}) {
  return (
    <Button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner aria-hidden="true" className="size-3.5" />}
      <span aria-live="polite">{busy ? busyLabel : children}</span>
    </Button>
  )
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>
}) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-body">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function ReferenceLink({
  children,
  href,
  onClick,
}: {
  children: React.ReactNode
  href: string
  onClick: () => void
}) {
  return (
    <a
      href={href}
      className="text-link underline underline-offset-3 hover:text-foreground"
      onClick={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {children}
    </a>
  )
}

/** A titled block inside a detail panel (Carbon UI: memory-workspace__notice). */
export function DetailNote({
  title,
  tone = "info",
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title: string
  tone?: "info" | "muted" | "error"
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-l-[3px] px-3 py-2.5 text-sm",
        tone === "error"
          ? "border-l-status-warn"
          : tone === "muted"
            ? "border-l-border"
            : "border-l-accent-line"
      )}
      {...props}
    >
      <strong className="flex items-center gap-1.5 font-semibold text-foreground">
        {tone === "error" && (
          <CircleAlertIcon
            className="size-4 shrink-0 text-status-warn"
            aria-hidden="true"
          />
        )}
        {title}
      </strong>
      <div className="flex flex-col gap-1 break-words whitespace-pre-wrap text-body">
        {children}
      </div>
    </section>
  )
}

export function recordDomId(scope: string, id: string): string {
  return `memory-record-${scope}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

/** One selectable row of a memory list. */
export function RecordRow({
  id,
  scope,
  selected,
  title,
  meta,
  status,
  detail,
  onSelect,
}: {
  id: string
  scope: string
  selected: boolean
  title: string
  meta: string
  status: string
  detail: string
  onSelect: () => void
}) {
  return (
    <button
      id={recordDomId(scope, id)}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-l-[3px] border-l-transparent px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-l-accent-line bg-muted/60"
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="truncate font-medium text-foreground">
          {title}
        </strong>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className="flex max-w-[45%] min-w-0 shrink-0 flex-col items-end gap-1">
        <StatusPill status={status} />
        <span
          title={detail}
          className="max-w-full truncate text-xs text-muted-foreground"
        >
          {detail}
        </span>
      </span>
      <ArrowRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * List on the left, details on the right. Below the `lg` breakpoint the
 * details become a sheet that slides in over a scrim, as in the original.
 */
export function MasterDetail({
  listLabel,
  list,
  detail,
  detailLabel,
  sheetOpen,
  closeSheet,
}: {
  listLabel: string
  list: React.ReactNode
  detail: React.ReactNode
  detailLabel: string
  sheetOpen: boolean
  closeSheet: () => void
}) {
  const { t } = useTranslation("memory")
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,9fr)_minmax(0,7fr)]">
      <section aria-label={listLabel} data-memory-list className="min-w-0">
        {list}
      </section>
      <div className="min-w-0">
        <aside
          aria-label={detailLabel}
          data-open={sheetOpen}
          className={cn(
            "glass-card flex flex-col gap-4 overflow-y-auto p-4",
            // Sheet below `lg`: the drawer tier of glass, sliding in from the right.
            "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(28rem,100%)] max-lg:border-l max-lg:bg-(--glass-popover)! max-lg:transition-transform max-lg:data-[open=false]:invisible max-lg:data-[open=false]:translate-x-full",
            "lg:sticky lg:top-0 lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border"
          )}
        >
          <IconButton
            label={t("detailPanel.close")}
            onClick={closeSheet}
            className="self-end lg:hidden"
          >
            <XIcon />
          </IconButton>
          {detail}
        </aside>
        <button
          type="button"
          aria-label={t("detailPanel.close")}
          tabIndex={-1}
          onClick={closeSheet}
          className={cn(
            "fixed inset-0 z-30 bg-foreground/30 lg:hidden",
            !sheetOpen && "hidden"
          )}
        />
      </div>
    </div>
  )
}

export function DetailHeader({
  eyebrow,
  title,
  status,
}: {
  eyebrow?: string
  title: string
  status?: string
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {eyebrow && (
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </p>
      )}
      <h2 className="font-heading text-base font-semibold break-words text-foreground">
        {title}
      </h2>
      {status && <StatusPill status={status} />}
    </div>
  )
}

/**
 * Page controls (Carbon UI: Pagination). With `isLastPage` the total is only
 * informative and "next" follows the cursor, as with `pageInputDisabled`.
 */
export function Pagination({
  id,
  page,
  pageSize,
  pageSizes,
  totalItems,
  itemsPerPageText,
  isLastPage,
  disabled,
  onChange,
  className,
}: {
  id: string
  page: number
  pageSize: number
  pageSizes: number[]
  totalItems: number
  itemsPerPageText: string
  isLastPage?: boolean
  disabled?: boolean
  onChange: (next: { page: number; pageSize: number }) => void
  className?: string
}) {
  const { t } = useTranslation("memory")
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalItems)
  const atEnd = isLastPage ?? page >= totalPages
  return (
    <nav
      aria-label={t("pagination.label")}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-2 text-xs text-muted-foreground",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <label htmlFor={id}>{itemsPerPageText}</label>
        <NativeSelect
          id={id}
          size="sm"
          value={pageSize}
          disabled={disabled}
          onChange={(event) =>
            onChange({ page: 1, pageSize: Number(event.target.value) })
          }
        >
          {pageSizes.map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span aria-live="polite">
          {t("pagination.range", {
            first,
            last: Math.max(first, last),
            total: totalItems,
          })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span aria-live="polite" className="mr-1">
          {isLastPage === undefined
            ? t("pagination.pageOf", { page, totalPages })
            : t("pagination.page", { page })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("pagination.previous")}
          disabled={disabled || page <= 1}
          onClick={() => onChange({ page: page - 1, pageSize })}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("pagination.next")}
          disabled={disabled || atEnd}
          onClick={() => onChange({ page: page + 1, pageSize })}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}
