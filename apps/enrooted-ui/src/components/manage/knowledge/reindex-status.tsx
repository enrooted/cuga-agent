/*
 * Knowledge panel > Settings: the re-index block. One of: in-flight progress
 * tile, completion notice, or the "Re-index to apply your changes" banner.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, CircleAlertIcon, MinusIcon } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import type { ReindexProgress, ReindexTask } from "@/lib/manage/knowledge-types"
import { cn } from "@/lib/utils"
import {
  formatElapsedSeconds,
  getReindexPhaseHeadline,
  getReindexStatusLabel,
  getReindexTaskError,
  getReindexTaskProgressLabel,
} from "./knowledge-helpers"
import { Notice, StatusBadge, Tile, type StatusTone } from "./parts"

function taskTone(status: ReindexTask["status"]): StatusTone {
  if (status === "completed") return "ok"
  if (status === "failed") return "warn"
  if (status === "running") return "active"
  return "neutral"
}

function ReindexProgressTile({ progress }: { progress: ReindexProgress }) {
  // The labels from knowledge-helpers are translated at render time; this hook
  // re-renders the tile when the language changes.
  const { t } = useTranslation("knowledge")
  // Ticks once per second so the elapsed-time label advances between polls.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1000))
  const finished = progress.completed + progress.failed
  const pct = progress.total > 0 ? (finished / progress.total) * 100 : 0
  return (
    <Tile className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        {/* Phase-narrative headline: during the model-download phase the backend
            has not started per-file work yet, so lead with what is happening. */}
        <h4 className="text-sm font-semibold">{getReindexPhaseHeadline(progress.tasks)}</h4>
        <p className="text-xs text-muted-foreground">
          {t("reindex.progressLine", {
            count: progress.total,
            finished,
            elapsed: formatElapsedSeconds(elapsed),
          })}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={t("reindex.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={finished}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            progress.failed > 0 ? "bg-status-warn" : "bg-accent-line"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Per-file status list */}
      <div className="flex flex-col">
        <div className="flex justify-between border-b pb-1.5 text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
          <span>{t("reindex.columnDocument")}</span>
          <span>{t("reindex.columnStatus")}</span>
        </div>
        <ul className="max-h-60 divide-y overflow-y-auto">
          {progress.tasks.map((task) => {
            const taskError = getReindexTaskError(task)
            const progressLabel = getReindexTaskProgressLabel(task)
            return (
              <li key={task.task_id} className="flex items-start gap-2.5 py-1.5">
                <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {task.status === "completed" && <CheckIcon className="size-3.5 text-status-ok" />}
                  {(task.status === "failed" || task.status === "cancelled") && (
                    <CircleAlertIcon className="size-3.5 text-status-warn" />
                  )}
                  {task.status === "running" && <Spinner className="size-3.5" />}
                  {task.status === "pending" && <MinusIcon className="size-3.5 text-muted-foreground" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm" title={task.filename || task.task_id}>
                    {task.filename || task.task_id}
                  </span>
                  {task.status === "running" && progressLabel && (
                    <span className="text-xs text-muted-foreground">{progressLabel}</span>
                  )}
                  {task.status === "failed" && taskError && (
                    <span className="text-xs break-words text-warn-text">{taskError}</span>
                  )}
                </span>
                <StatusBadge tone={taskTone(task.status)} icon={false}>
                  {getReindexStatusLabel(task.status)}
                </StatusBadge>
              </li>
            )
          })}
        </ul>
      </div>
    </Tile>
  )
}

export function ReindexStatus({
  agentLevelEnabled,
  reindexProgress,
  onDismissProgress,
  hidePrompt,
  needsReindex,
  canReindex,
  knowledgeReindexing,
  onReindexNow,
}: {
  agentLevelEnabled: boolean
  reindexProgress: ReindexProgress | null
  onDismissProgress: () => void
  /** The guided preset flow is showing its own re-index step. */
  hidePrompt: boolean
  /** knowledgeReindexNeeded || knowledgeStale || knowledgeReindexDeferred */
  needsReindex: boolean
  /** The page supplied `onReindex`, so the banner carries the action. */
  canReindex: boolean
  knowledgeReindexing?: boolean
  onReindexNow: () => void
}) {
  const { t } = useTranslation("knowledge")
  if (!agentLevelEnabled) return null

  if (reindexProgress && !reindexProgress.done) {
    return <ReindexProgressTile progress={reindexProgress} />
  }

  if (reindexProgress?.done) {
    const failed = reindexProgress.failed > 0
    return (
      <Notice
        kind={failed ? "warning" : "success"}
        title={failed ? t("reindex.finishedWithErrors") : t("reindex.complete")}
        // No close button on success: the notice dismisses itself. On failure
        // the user closes it after reading the count.
        onClose={failed ? onDismissProgress : undefined}
      >
        {failed
          ? t("reindex.succeededFailed", { completed: reindexProgress.completed, failed: reindexProgress.failed })
          : t("reindex.succeeded", { completed: reindexProgress.completed })}
      </Notice>
    )
  }

  // Re-index recommended. The save-status pill only confirms "draft persisted";
  // it does NOT mean "vectors are current". This banner is how the user learns
  // that a config change requires re-embedding.
  if (!hidePrompt && needsReindex) {
    return canReindex ? (
      <Notice
        kind="info"
        title={t("reindex.bannerTitle")}
        actionLabel={knowledgeReindexing ? t("reindex.reindexing") : t("shared.reindexNow")}
        onAction={onReindexNow}
      >
        {t("reindex.bannerText")}
      </Notice>
    ) : (
      <Notice kind="info" title={t("reindex.bannerTitle")}>
        {t("reindex.bannerText")}
      </Notice>
    )
  }

  return null
}
