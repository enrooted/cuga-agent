/*
 * Memory on/off preferences: "Memory for me" for the signed-in user, and for
 * administrators "Memory for this service" plus the episodic memory switch.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/memory/MemoryPreferences.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"

import { InlineLoading, Notice } from "@/components/manage/knowledge/parts"
import { Switch } from "@/components/ui/switch"
import {
  loadMemoryPreferences,
  saveEpisodicMemoryPreference,
  saveMemoryPreference,
  type MemoryPreferencesState,
} from "@/lib/memory/api"
import { cn } from "@/lib/utils"
import { ContentSkeleton } from "./parts"

function PreferenceSwitch({
  id,
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  note: string
  checked: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation("memory")
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-description`}
          onCheckedChange={onChange}
        />
        <span aria-hidden="true" className="text-sm text-body">
          {checked ? t("preferences.on") : t("preferences.off")}
        </span>
      </div>
      <p id={`${id}-description`} className="text-sm text-muted-foreground">
        {note}
      </p>
    </div>
  )
}

export function MemoryPreferences({
  admin = false,
  className,
}: {
  admin?: boolean
  className?: string
}) {
  const { t } = useTranslation("memory")
  const [preferences, setPreferences] =
    React.useState<MemoryPreferencesState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    let active = true
    const refresh = () =>
      loadMemoryPreferences(admin)
        .then((value) => {
          if (active) {
            setPreferences(value)
            setError("")
          }
        })
        .catch(() => {
          if (active) setError(t("preferences.loadFailed"))
        })
    void refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("memory-preferences-changed", refresh)
    return () => {
      active = false
      window.removeEventListener("focus", refresh)
      window.removeEventListener("memory-preferences-changed", refresh)
    }
  }, [admin, t])

  const save = async (enabled: boolean, episodic = false) => {
    setSaving(true)
    setError("")
    try {
      setPreferences(
        await (episodic
          ? saveEpisodicMemoryPreference(enabled)
          : saveMemoryPreference(enabled, admin))
      )
      window.dispatchEvent(new Event("memory-preferences-changed"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("preferences.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  if (!preferences && !error)
    return (
      <ContentSkeleton label={t("preferences.loading")} rows={admin ? 2 : 1} />
    )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <PreferenceSwitch
        id={admin ? "instance-memory-enabled" : "user-memory-enabled"}
        label={
          admin ? t("preferences.service.label") : t("preferences.user.label")
        }
        checked={
          preferences
            ? admin
              ? preferences.instance_enabled
              : preferences.user_enabled
            : false
        }
        disabled={
          !preferences || saving || (!admin && !preferences.instance_enabled)
        }
        onChange={(enabled) => void save(enabled)}
        note={
          admin
            ? t("preferences.service.note")
            : preferences && !preferences.instance_enabled
              ? t("preferences.user.noteServiceOff")
              : t("preferences.user.note")
        }
      />
      {admin && (
        <PreferenceSwitch
          id="instance-episodic-memory-enabled"
          label={t("preferences.episodic.label")}
          checked={preferences?.episodic_enabled ?? false}
          disabled={!preferences || saving || !preferences.instance_enabled}
          onChange={(enabled) => void save(enabled, true)}
          note={t("preferences.episodic.note")}
        />
      )}
      {saving && <InlineLoading>{t("preferences.saving")}</InlineLoading>}
      {error && <Notice kind="error" title={error} />}
    </div>
  )
}
