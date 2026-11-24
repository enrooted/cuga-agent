/*
 * Shared pieces of the Studio sections: the fetch hook, loading / error
 * states, tags, cards, and the confirm / prompt / notify feedback the Carbon
 * UI gets from CarbonFeedback.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (helpers at the top of the file), frontend/src/CarbonFeedback.tsx and
 * agentic_chat/src/LoadingState.tsx (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { AlertDialog } from "@/components/confirm-dialog"
import { Notice } from "@/components/manage/form"
import { InlineLoading, StatusBadge } from "@/components/manage/knowledge/parts"
import i18n from "@/i18n"
import { cn } from "@/lib/utils"

/** A JSON object from the events API. The server owns the shape; the UI only renders it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>

// ── formatting ─────────────────────────────────────────────────────────────
export function fmtTime(s?: string): string {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleString(i18n.language)
  } catch {
    return s
  }
}

/** subscription.created_at is epoch SECONDS (a float); AP timestamps are ISO strings. */
export function fmtEpoch(secs?: number): string {
  if (!secs) return "—"
  try {
    return new Date(secs * 1000).toLocaleString(i18n.language)
  } catch {
    return String(secs)
  }
}

// ── tags ───────────────────────────────────────────────────────────────────
export type TagTone = "ok" | "warn" | "neutral" | "outline"

/**
 * Carbon `Tag`. The original tells tags apart by colour; here the label is the
 * information, and only the two status tones add an icon (check / alert).
 */
export function Tag({ tone = "neutral", title, className, children }: { tone?: TagTone; title?: string; className?: string; children: React.ReactNode }) {
  if (tone === "ok" || tone === "warn") {
    return (
      <StatusBadge tone={tone} title={title} className={className}>
        {children}
      </StatusBadge>
    )
  }
  return (
    <Badge variant={tone === "outline" ? "outline" : "secondary"} title={title} className={className}>
      {children}
    </Badge>
  )
}

const STATUS_TAG: Record<string, { tone: TagTone; labelKey: string }> = {
  connected: { tone: "ok", labelKey: "parts.status.connected" },
  not_connected: { tone: "neutral", labelKey: "parts.status.notConnected" },
  auto_connect_pending: { tone: "outline", labelKey: "parts.status.autoConnectPending" },
  not_configured: { tone: "neutral", labelKey: "parts.status.notConfigured" },
  ap_not_configured: { tone: "neutral", labelKey: "parts.status.apNotConfigured" },
  unknown: { tone: "neutral", labelKey: "parts.status.unknown" },
}
export function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation("studio")
  const s = STATUS_TAG[status]
  return <Tag tone={s?.tone ?? "neutral"}>{s ? t(s.labelKey) : status}</Tag>
}

const RUN_FAILED = new Set(["FAILED", "TIMEOUT", "INTERNAL_ERROR"])
/** Run status: green for success, the alert tone for failures, neutral otherwise. */
export function RunStatusTag({ status }: { status?: string }) {
  const s = String(status ?? "")
  return <Tag tone={s === "SUCCEEDED" ? "ok" : RUN_FAILED.has(s) ? "warn" : "neutral"}>{s || "—"}</Tag>
}

// ── cards ──────────────────────────────────────────────────────────────────
export const STUDIO_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4"

export function StudioCard({ className, ...props }: React.ComponentProps<"article">) {
  return <article className={cn("glass-card flex min-h-36 flex-col gap-2 rounded-xl border p-4", className)} {...props} />
}
export function CardHead({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between gap-2", className)} {...props} />
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h4">) {
  return <h4 className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold [&>svg]:size-4.5 [&>svg]:shrink-0 [&>svg]:text-link", className)} {...props} />
}
export function CardFoot({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-auto flex flex-wrap items-center gap-2 pt-3", className)} {...props} />
}
/** Secondary text (the original's `.studio-muted`). */
export function Muted({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm leading-normal text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[0.8125rem]", className)} {...props} />
}

// ── data hook (dumb fetch → render) ────────────────────────────────────────
export function useEndpoint<T>(fn: () => Promise<Response>, pick: (d: Rec) => T, dep: number) {
  const [data, setData] = React.useState<T | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fn()
      // Name the status and the path: the status code alone says "server-side,
      // not your session" without a trip to the console.
      .then((r) => {
        if (!r.ok) {
          const where = (() => {
            try {
              return new URL(r.url).pathname
            } catch {
              return ""
            }
          })()
          throw new Error(`HTTP ${r.status}${r.statusText ? " " + r.statusText : ""}${where ? ` — ${where}` : ""}`)
        }
        return r.json()
      })
      .then((d) => {
        if (!cancelled) setData(pick(d))
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : i18n.t("studio:parts.loadFailed")
        // A bare TypeError from fetch means the request never completed: CORS,
        // DNS, or the events service being down.
        setError(
          /failed to fetch|networkerror|load failed/i.test(msg)
            ? i18n.t("studio:parts.unreachable", { message: msg })
            : msg
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
  return { data, loading: loading && data === null, refreshing: loading && data !== null, error }
}

export type SkeletonKind = "cards" | "table" | "list"

/** Placeholder with the shape of the content it stands for. */
export function ContentSkeleton({ label, kind = "list", rows = 4 }: { label: string; kind?: SkeletonKind; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className={kind === "cards" ? STUDIO_GRID : "flex flex-col gap-2"}>
      {kind === "cards"
        ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)
        : Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={kind === "table" ? "h-9 rounded-md" : "h-14 rounded-lg"} />)}
    </div>
  )
}

export function Loader({ loading, refreshing = false, error, kind = "cards" }: { loading: boolean; refreshing?: boolean; error: string | null; kind?: SkeletonKind }) {
  const { t } = useTranslation("studio")
  if (loading) return <ContentSkeleton label={t("parts.loading")} kind={kind} />
  if (refreshing) return <InlineLoading>{t("parts.refreshing")}</InlineLoading>
  if (error) {
    return (
      <Notice kind="error" title={t("error")}>
        {error}
      </Notice>
    )
  }
  return null
}

// ── buttons ────────────────────────────────────────────────────────────────
/** Button that shows a spinner and its busy label while an action runs. */
export function AsyncButton({
  busy,
  busyLabel,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy: boolean; busyLabel: string }) {
  return (
    <Button disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy ? (
        <>
          <Spinner data-icon="inline-start" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}

// ── confirm / prompt / notify ──────────────────────────────────────────────
type NoticeKind = "info" | "success" | "warning" | "error"
type DialogRequest =
  | { kind: "confirm"; message: string; actionLabel: string }
  // pragma: allowlist secret -- boolean input-mask flag
  | { kind: "prompt"; message: string; secret: boolean }

interface Feedback {
  confirm: (message: string, actionLabel: string) => Promise<boolean>
  prompt: (message: string, secret?: boolean, defaultValue?: string) => Promise<string | null>
  notify: (message: string, kind?: NoticeKind) => void
}

const FeedbackContext = React.createContext<Feedback | null>(null)

export function useStudioFeedback(): Feedback {
  const value = React.useContext(FeedbackContext)
  if (!value) throw new Error("useStudioFeedback must be used inside StudioFeedbackProvider")
  return value
}

/**
 * Promise-based confirm and prompt dialogs plus toasts, so the section code
 * reads like the original (`await confirm(…)`, `await prompt(…)`). One request
 * at a time; cancelling resolves false / null.
 */
export function StudioFeedbackProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("studio")
  const [request, setRequest] = React.useState<DialogRequest | null>(null)
  const [value, setValue] = React.useState("")
  const resolveRef = React.useRef<((result: boolean | string | null) => void) | null>(null)

  const settle = React.useCallback((result: boolean | string | null) => {
    const resolve = resolveRef.current
    if (!resolve) return
    resolveRef.current = null
    setRequest(null)
    resolve(result)
  }, [])

  // A pending request dies with the page that opened it.
  React.useEffect(
    () => () => {
      resolveRef.current?.(null)
      resolveRef.current = null
    },
    []
  )

  const feedback = React.useMemo<Feedback>(
    () => ({
      confirm: (message, actionLabel) => {
        if (resolveRef.current) return Promise.resolve(false)
        return new Promise<boolean>((resolve) => {
          resolveRef.current = (result) => resolve(result === true)
          setRequest({ kind: "confirm", message, actionLabel })
        })
      },
      prompt: (message, secret = false, defaultValue = "") => {
        if (resolveRef.current) return Promise.resolve(null)
        return new Promise<string | null>((resolve) => {
          resolveRef.current = (result) => resolve(typeof result === "string" ? result : null)
          setValue(defaultValue)
          setRequest({ kind: "prompt", message, secret })
        })
      },
      notify: (message, kind = "info") => {
        // Long enough to read a link instruction or a note about a restart.
        toast[kind](message, { duration: 10000 })
      },
    }),
    []
  )

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}
      <AlertDialog
        open={request?.kind === "confirm"}
        title={t("parts.confirmTitle")}
        description={request?.kind === "confirm" ? request.message : ""}
        confirmLabel={request?.kind === "confirm" ? request.actionLabel : t("common:action.confirm")}
        onConfirm={() => settle(true)}
        onCancel={() => settle(null)}
      />
      <Dialog open={request?.kind === "prompt"} disablePointerDismissal onOpenChange={(o) => !o && settle(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("parts.promptTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("parts.promptDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              settle(value)
            }}
          >
            <Field>
              <FieldLabel htmlFor="studio-feedback-value" className="whitespace-pre-line">
                {request?.kind === "prompt" ? request.message : ""}
              </FieldLabel>
              <Input
                id="studio-feedback-value"
                type={request?.kind === "prompt" && request.secret ? "password" : "text"}
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => settle(null)}>
                {t("common:action.cancel")}
              </Button>
              <Button type="submit">{t("common:action.continue")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </FeedbackContext.Provider>
  )
}

/** One action at a time: `pending` is the key of the running one. Failures are toasted. */
export function useStudioAction() {
  const { notify } = useStudioFeedback()
  const [pending, setPending] = React.useState<string | null>(null)
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (pending) return
    setPending(key)
    try {
      await action()
    } catch (error) {
      notify(error instanceof Error ? error.message : i18n.t("studio:parts.requestFailed"), "error")
    } finally {
      setPending(null)
    }
  }
  return { pending, run }
}
