/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/SandboxSettings.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * Code sandbox (execd) on/off. Applied to the running server immediately and
 * stored on its own — not part of the agent config draft/publish cycle.
 *
 * The connection comes from the mounted sandbox secret, so switching on is all
 * it takes; the server checks the sandbox answers as soon as it is on. Shown
 * only when such a connection exists (GET /api/manage/sandbox → `available`).
 */
import * as React from "react"
import { CircleCheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import * as api from "@/lib/manage/tools-api"
import type { SandboxSettingsStatus } from "@/lib/manage/tools-types"

import { Notice } from "./shared"

export interface SandboxSettingsProps {
  onError: (title: string, message: string) => void
  onSaved?: (message: string) => void
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown } | null
    return typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body)
  } catch {
    return `HTTP ${res.status}`
  }
}

export function SandboxSettings({ onError, onSaved }: SandboxSettingsProps) {
  const [status, setStatus] = React.useState<SandboxSettingsStatus | null>(null)
  const [checked, setChecked] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loadError, setLoadError] = React.useState("")
  // The parent passes fresh callbacks on every render (each toast re-renders it).
  // Read them through refs so `call` stays stable and the mount effect runs once,
  // instead of re-fetching and re-testing the sandbox after every toast.
  const onErrorRef = React.useRef(onError)
  const onSavedRef = React.useRef(onSaved)
  onErrorRef.current = onError
  onSavedRef.current = onSaved

  const applyStatus = React.useCallback((s: SandboxSettingsStatus) => {
    setStatus(s)
    setChecked(s.enabled)
  }, [])

  const call = React.useCallback(
    async (fn: () => Promise<Response>, okMessage?: string): Promise<SandboxSettingsStatus | null> => {
      setBusy(true)
      setLoadError("")
      try {
        const res = await fn()
        if (!res.ok) {
          const message = await readError(res)
          setLoadError(message)
          onErrorRef.current("Code sandbox", message)
          return null
        }
        const s = (await res.json()) as SandboxSettingsStatus
        applyStatus(s)
        if (okMessage) onSavedRef.current?.(okMessage)
        return s
      } catch (e) {
        setLoadError(String(e))
        onErrorRef.current("Code sandbox", String(e))
        return null
      } finally {
        setBusy(false)
      }
    },
    [applyStatus]
  )

  React.useEffect(() => {
    void (async () => {
      const s = await call(() => api.getSandboxSettings())
      // Already on: check it still answers rather than showing a stale state.
      if (s?.enabled && !s.error) await call(() => api.refreshSandboxSettings())
    })()
  }, [call])

  if (!status) {
    return loadError ? (
      <Notice title="Code sandbox">{loadError}</Notice>
    ) : (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading sandbox settings…">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  const toggle = async (enable: boolean) => {
    setChecked(enable)
    const s = await call(
      () => api.putSandboxSettings({ enabled: enable }),
      enable ? "Sandbox enabled" : "Sandbox disabled"
    )
    // Refused or failed: show the state the server still has.
    if (!s) setChecked(status.enabled)
  }

  const on = status.enabled && checked
  // What is wrong, in words. Like the LLM settings, success needs no detail and
  // the URL / HTTP status belong in the server log, not here.
  const problem = !on ? null : (status.error ?? status.probe_error ?? null)
  const ok = status.reachable === true && !problem
  const disabled = busy || status.required_by_config

  return (
    <div className="flex flex-col gap-4">
      <Field orientation="horizontal" data-disabled={disabled || undefined}>
        <FieldContent>
          <FieldLabel htmlFor="sandbox-enabled">Sandbox</FieldLabel>
          <FieldDescription>
            {(status.required_by_config
              ? 'Required by the deployment (sandbox_mode = "execd"). '
              : "Run generated code in a remote execd sandbox. Applies to this server process; " +
                "other replicas pick it up when they restart. ") +
              "Applies to all agents and users. Conversations are isolated by the sandbox, not by CUGA."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="sandbox-enabled"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => void toggle(next)}
        />
      </Field>

      {/* Kept while a re-check runs, so the box does not vanish and come back. */}
      {problem && <Notice title="Sandbox unavailable">{problem}</Notice>}

      {/* One fixed row: the status changes in place instead of boxes appearing around it. */}
      {checked && (
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {on && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void call(() => api.refreshSandboxSettings())}
            >
              Test again
            </Button>
          )}
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Spinner />
              Checking…
            </span>
          ) : (
            on &&
            ok && (
              <span className="flex items-center gap-1.5 text-sm text-foreground" aria-live="polite">
                <CircleCheckIcon className="size-4 text-status-ok" aria-hidden="true" />
                Connected
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
}
