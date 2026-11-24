/*
 * Schedules of one retention policy: list, add / edit (with a preview of the
 * next runs), start / stop and delete.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/memory/RetentionSchedules.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, PauseIcon, PlusIcon, RefreshCwIcon } from "lucide-react"

import { AlertDialog } from "@/components/confirm-dialog"
import {
  InlineLoading,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
  Tile,
} from "@/components/manage/knowledge/parts"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { NativeSelectOption } from "@/components/ui/native-select"
import i18n from "@/i18n"
import {
  changeSchedule,
  loadSchedules,
  previewSchedule,
  saveSchedule,
  type RetentionSchedule,
  type ScheduleSpec,
} from "@/lib/memory/api"
import { ContentSkeleton } from "./parts"

// Keys under `schedules.days` and `schedules.everyWeekdayAt`, in cron order.
const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]

const defaults: ScheduleSpec = {
  schedule: "0 2 * * *",
  timeZone: "Etc/UTC",
  concurrencyPolicy: "Forbid",
  startingDeadlineSeconds: null,
  suspend: true,
}

function localTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone,
  }).format(new Date(value))
}

function describe(spec: ScheduleSpec) {
  const match = /^(\d+) (\d+) \* \* (\*|[0-6])$/.exec(spec.schedule)
  if (!match) return spec.schedule
  const time = `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}`
  return match[3] === "*"
    ? i18n.t("memory:schedules.everyDayAt", { time })
    : i18n.t(`memory:schedules.everyWeekdayAt.${DAYS[Number(match[3])]}`, {
        time,
      })
}

function Fields({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

export function RetentionSchedules({
  policyId,
  enabled,
  readOnly = false,
}: {
  policyId: string
  enabled: boolean
  readOnly?: boolean
}) {
  const { t } = useTranslation("memory")
  const inputId = React.useId()
  const [items, setItems] = React.useState<RetentionSchedule[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [editing, setEditing] = React.useState<
    RetentionSchedule | "new" | null
  >(null)
  const [id, setId] = React.useState("")
  const [spec, setSpec] = React.useState<ScheduleSpec>(defaults)
  const [frequency, setFrequency] = React.useState("daily")
  const [time, setTime] = React.useState("02:00")
  const [day, setDay] = React.useState("0")
  const [preview, setPreview] = React.useState<string[]>([])
  const [deleteTarget, setDeleteTarget] =
    React.useState<RetentionSchedule | null>(null)

  const refresh = async () =>
    setItems(
      (await loadSchedules()).filter(
        (item) => item.definition.policy_id === policyId
      )
    )

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    loadSchedules()
      .then((rows) => {
        if (active)
          setItems(
            rows.filter((item) => item.definition.policy_id === policyId)
          )
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : t("schedules.loadFailed"))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [policyId, t])

  const perform = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("schedules.operationFailed"))
    } finally {
      setBusy(false)
    }
  }

  const edit = (item: RetentionSchedule | "new") => {
    setEditing(item)
    setError("")
    setPreview([])
    setDeleteTarget(null)
    const value = item === "new" ? { ...defaults } : { ...item.definition.spec }
    setSpec(value)
    setId(item === "new" ? "" : item.schedule_id)
    const match = /^(\d+) (\d+) \* \* (\*|[0-6])$/.exec(value.schedule)
    setFrequency(match ? (match[3] === "*" ? "daily" : "weekly") : "custom")
    setTime(
      match
        ? `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}`
        : "02:00"
    )
    setDay(match && match[3] !== "*" ? match[3] : "0")
  }

  const effectiveSpec = () => {
    if (frequency === "custom") return spec
    const [hours, minutes] = time.split(":")
    return {
      ...spec,
      schedule: `${Number(minutes)} ${Number(hours)} * * ${frequency === "weekly" ? day : "*"}`,
    }
  }

  return (
    <section aria-label={t("schedules.label")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          {t("schedules.title")}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await refresh()
                setEditing(null)
                setPreview([])
              })
            }
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t("schedules.refresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={readOnly || busy || !enabled}
            onClick={() => edit("new")}
          >
            <PlusIcon data-icon="inline-start" />
            {t("schedules.add")}
          </Button>
        </div>
      </div>
      {busy && <InlineLoading>{t("schedules.updating")}</InlineLoading>}
      {error && <Notice kind="error" title={error} />}
      {loading ? (
        <ContentSkeleton label={t("schedules.loading")} />
      ) : (
        !error &&
        !items.length && (
          <p className="text-sm text-muted-foreground">
            {t("schedules.empty")}
          </p>
        )
      )}
      {items.map((item) => (
        <Tile
          key={item.schedule_id}
          accent={item.definition.spec.suspend ? "neutral" : "ok"}
          className="flex flex-col gap-1.5 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="font-medium break-all text-foreground">
              {item.schedule_id}
            </strong>
            <StatusBadge
              tone={item.definition.spec.suspend ? "neutral" : "ok"}
              icon={
                item.definition.spec.suspend ? (
                  <PauseIcon />
                ) : (
                  <CheckIcon className="text-status-ok" />
                )
              }
            >
              {item.definition.spec.suspend
                ? t("schedules.stopped")
                : t("schedules.active")}
            </StatusBadge>
          </div>
          <p className="text-body">
            {describe(item.definition.spec)} · {item.definition.spec.timeZone}
          </p>
          <p className="text-muted-foreground">
            {item.definition.spec.suspend
              ? t("schedules.startHint")
              : item.next_runs?.[0]
                ? t("schedules.nextRun", {
                    time: localTime(
                      item.next_runs[0],
                      item.definition.spec.timeZone
                    ),
                  })
                : t("schedules.nextRunUnavailable")}
          </p>
          {item.definition.agent_id && (
            <p className="text-muted-foreground">
              {t("schedules.agentScope", { agent: item.definition.agent_id })}
            </p>
          )}
          {item.definition.dry_run && (
            <p className="text-muted-foreground">{t("schedules.dryRun")}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => edit(item)}
            >
              {t("common:action.edit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={
                readOnly || busy || (!enabled && item.definition.spec.suspend)
              }
              onClick={() =>
                void perform(async () => {
                  await changeSchedule(
                    item,
                    item.definition.spec.suspend ? "start" : "stop"
                  )
                  await refresh()
                })
              }
            >
              {item.definition.spec.suspend
                ? t("schedules.start")
                : t("schedules.stop")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => setDeleteTarget(item)}
            >
              {t("common:action.delete")}
            </Button>
          </div>
        </Tile>
      ))}
      <AlertDialog
        open={deleteTarget !== null}
        title={t("schedules.deleteDialog.title")}
        description={t("schedules.deleteDialog.body", {
          id: deleteTarget?.schedule_id ?? "",
        })}
        confirmLabel={t("schedules.deleteDialog.action")}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          if (!target || readOnly || busy) return
          setDeleteTarget(null)
          void perform(async () => {
            await changeSchedule(target, "delete")
            await refresh()
          })
        }}
      />
      {editing && (
        <form
          className="flex flex-col gap-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void perform(async () => {
              await saveSchedule(
                id,
                policyId,
                effectiveSpec(),
                editing === "new" ? 0 : editing.revision
              )
              setEditing(null)
              await refresh()
            })
          }}
          onChange={() => setPreview([])}
        >
          <h3 className="font-heading text-sm font-semibold text-foreground">
            {editing === "new" ? t("schedules.add") : t("schedules.edit")}
          </h3>
          <fieldset
            disabled={readOnly || busy}
            className="flex min-w-0 flex-col gap-4"
          >
            <Fields>
              <TextField
                id={`${inputId}-5`}
                label={t("schedules.field.id")}
                required
                maxLength={128}
                pattern="[A-Za-z0-9_.:\-]+"
                value={id}
                readOnly={editing !== "new"}
                onChange={(e) => setId(e.target.value)}
              />
              <SelectField
                id={`${inputId}-1`}
                label={t("schedules.field.frequency")}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <NativeSelectOption value="daily">
                  {t("schedules.field.daily")}
                </NativeSelectOption>
                <NativeSelectOption value="weekly">
                  {t("schedules.field.weekly")}
                </NativeSelectOption>
                <NativeSelectOption value="custom">
                  {t("schedules.field.custom")}
                </NativeSelectOption>
              </SelectField>
              {frequency !== "custom" && (
                <TextField
                  id={`${inputId}-6`}
                  label={t("schedules.field.time")}
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              )}
              {frequency === "weekly" && (
                <SelectField
                  id={`${inputId}-2`}
                  label={t("schedules.field.day")}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                >
                  {DAYS.map((name, index) => (
                    <NativeSelectOption key={name} value={index}>
                      {t(`schedules.days.${name}`)}
                    </NativeSelectOption>
                  ))}
                </SelectField>
              )}
              {frequency === "custom" && (
                <TextField
                  id={`${inputId}-7`}
                  label={t("schedules.field.cron")}
                  required
                  value={spec.schedule}
                  onChange={(e) =>
                    setSpec({ ...spec, schedule: e.target.value })
                  }
                />
              )}
              <TextField
                id={`${inputId}-8`}
                label={t("schedules.field.timeZone")}
                required
                value={spec.timeZone}
                onChange={(e) => setSpec({ ...spec, timeZone: e.target.value })}
                placeholder="America/Los_Angeles"
              />
            </Fields>
            <Accordion>
              <AccordionItem value="advanced">
                <AccordionTrigger>
                  {t("schedules.field.advanced")}
                </AccordionTrigger>
                <AccordionContent>
                  <Fields>
                    <SelectField
                      id={`${inputId}-3`}
                      label={t("schedules.field.concurrency")}
                      value={spec.concurrencyPolicy}
                      onChange={(e) =>
                        setSpec({
                          ...spec,
                          concurrencyPolicy: e.target
                            .value as ScheduleSpec["concurrencyPolicy"],
                        })
                      }
                    >
                      <NativeSelectOption value="Forbid">
                        {t("schedules.field.concurrencyForbid")}
                      </NativeSelectOption>
                      <NativeSelectOption value="Allow">
                        {t("schedules.field.concurrencyAllow")}
                      </NativeSelectOption>
                      <NativeSelectOption value="Replace">
                        {t("schedules.field.concurrencyReplace")}
                      </NativeSelectOption>
                    </SelectField>
                    <TextField
                      id={`${inputId}-9`}
                      label={t("schedules.field.deadline")}
                      type="number"
                      min={0}
                      step={1}
                      value={spec.startingDeadlineSeconds ?? ""}
                      onChange={(e) =>
                        setSpec({
                          ...spec,
                          startingDeadlineSeconds:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </Fields>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                void perform(async () =>
                  setPreview((await previewSchedule(effectiveSpec())).next_runs)
                )
              }
            >
              {t("schedules.preview.action")}
            </Button>
            {preview.length > 0 && (
              <div
                role="status"
                className="flex flex-col gap-1.5 rounded-lg border border-l-[3px] border-l-accent-line px-3 py-2.5 text-sm"
              >
                <strong className="font-semibold text-foreground">
                  {t("schedules.preview.title")}
                </strong>
                <ul className="list-disc pl-5 text-body">
                  {preview.map((value) => (
                    <li key={value}>{localTime(value, spec.timeZone)}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  {spec.suspend
                    ? t("schedules.preview.noteStopped")
                    : t("schedules.preview.note")}
                </p>
              </div>
            )}
            {editing === "new" && (
              <p className="text-sm text-muted-foreground">
                {t("schedules.createdStopped")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit">{t("schedules.saveChanges")}</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                {t("common:action.cancel")}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
