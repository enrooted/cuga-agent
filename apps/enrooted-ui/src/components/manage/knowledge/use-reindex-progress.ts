/*
 * Re-index progress of the Knowledge panel: arms the in-flight tile and the 2 s
 * task polling, for both the manual "Re-index now" button and a server-side
 * auto-reindex pushed down by the page.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"

import i18n from "@/i18n"
import * as api from "@/lib/manage/knowledge-api"
import type {
  AutoReindexTrigger,
  KnowledgeReindexResult,
  KnowledgeToast,
  ReindexProgress,
  ReindexTask,
} from "@/lib/manage/knowledge-types"
import { mergeTasksById, readJson, tasksFromBody } from "./knowledge-helpers"

export function useReindexProgress({
  loadDocuments,
  checkHealth,
  onToast,
  onReindex,
  onReindexFinished,
  onAutoReindexComplete,
  autoReindexTrigger,
  onAutoReindexConsumed,
}: {
  loadDocuments: () => void
  checkHealth: () => void
  onToast?: KnowledgeToast
  onReindex?: () => Promise<KnowledgeReindexResult | null>
  onReindexFinished?: () => void
  onAutoReindexComplete?: () => void
  autoReindexTrigger?: AutoReindexTrigger | null
  onAutoReindexConsumed?: () => void
}) {
  const [reindexProgress, setReindexProgress] = React.useState<ReindexProgress | null>(null)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const done = reindexProgress?.done
  const failedCount = reindexProgress?.failed

  // Auto-dismiss the success notification ~3.5 s after a clean re-index, so a
  // following "Re-index to apply your changes" banner (gated on no progress
  // state) can surface. On failure the banner stays: the user needs to see what
  // failed and dismisses it with the close button.
  React.useEffect(() => {
    if (!done) return
    if ((failedCount ?? 0) > 0) return
    const t = setTimeout(() => setReindexProgress(null), 3500)
    return () => clearTimeout(t)
  }, [done, failedCount])

  // Cleanup polling on unmount.
  React.useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // The callbacks are read when a run is armed and then kept for that whole
  // run, like the closure in the original (so `onAutoReindexComplete` snapshots
  // the config the run was started with).
  const latest = React.useRef({
    loadDocuments,
    checkHealth,
    onToast,
    onReindex,
    onReindexFinished,
    onAutoReindexComplete,
    onAutoReindexConsumed,
  })
  latest.current = {
    loadDocuments,
    checkHealth,
    onToast,
    onReindex,
    onReindexFinished,
    onAutoReindexComplete,
    onAutoReindexConsumed,
  }

  // Arms the in-flight tile + 2 s polling for the given task ids. Used by the
  // manual button (which POSTs first, via `onReindex`) AND the server-side
  // auto-reindex path (the tasks already exist, so we just subscribe).
  const armReindexFromTaskIds = React.useCallback(
    async (taskIds: string[], total: number, seedTasks?: { task_id: string; filename: string }[]) => {
      if (!taskIds.length) return
      const run = latest.current

      // Seed placeholders with filenames if the POST response carried them, so
      // the tile shows real names from frame 0 instead of task ids.
      const seedById = new Map<string, string>((seedTasks ?? []).map((t) => [t.task_id, t.filename]))
      const placeholders: ReindexTask[] = taskIds.map((id): ReindexTask => {
        const seedFilename = seedById.get(id)
        return seedFilename
          ? { task_id: id, status: "pending", filename: seedFilename }
          : { task_id: id, status: "pending" }
      })
      let initialTasks: ReindexTask[] = placeholders
      try {
        const res = await api.getKnowledgeTasks()
        if (res.ok) {
          const relevantTasks = tasksFromBody(await readJson(res)).filter((t) =>
            taskIds.includes(t.task_id)
          )
          initialTasks = mergeTasksById(taskIds, placeholders, relevantTasks)
        }
      } catch {
        // Fall back to placeholders; polling enriches as filenames load.
      }
      setReindexProgress({
        taskIds,
        total: total || taskIds.length,
        completed: 0,
        failed: 0,
        tasks: initialTasks,
        done: false,
        startedAt: Date.now(),
      })

      // Poll task statuses every 2 s.
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.getKnowledgeTasks()
          if (!res.ok) return
          const relevantTasks = tasksFromBody(await res.json()).filter((t) =>
            taskIds.includes(t.task_id)
          )
          const completed = relevantTasks.filter((t) => t.status === "completed").length
          // Count "cancelled" as terminal/failed. A superseded worker writes
          // status="cancelled"; if only "failed" counted, completed+failed could
          // never reach taskIds.length and the tile would spin forever.
          const failed = relevantTasks.filter(
            (t) => t.status === "failed" || t.status === "cancelled"
          ).length
          const isDone = completed + failed >= taskIds.length

          setReindexProgress((prev) => ({
            taskIds,
            total: taskIds.length,
            completed,
            failed,
            // Merge by id so transient polls that don't see every task don't
            // shrink the tile to fewer rows.
            tasks: mergeTasksById(taskIds, prev?.tasks ?? placeholders, relevantTasks),
            done: isDone,
            startedAt: prev?.startedAt ?? Date.now(),
          }))

          if (isDone) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            // Refresh the document list after the re-index completes.
            run.loadDocuments()
            run.checkHealth()
            // ALWAYS fire onReindexFinished at terminal state: both success and
            // partial failure mean "workers stopped, the page can resume
            // autosave PATCHes". Distinct from onAutoReindexComplete (success only).
            run.onReindexFinished?.()
            if (failed === 0) {
              run.onToast?.(
                "success",
                i18n.t("knowledge:reindex.complete"),
                i18n.t("knowledge:reindex.toast.completeBody", { completed })
              )
              // Tell the page to refresh its saved-config snapshot so the
              // "Re-index needed" banner (snapshot-vs-current diff) clears.
              run.onAutoReindexComplete?.()
            } else {
              // Partial failure: the deferred flip is strict (no promotion
              // unless ALL tasks succeeded), so the previous embedder is still
              // active. Do NOT call onAutoReindexComplete: that would refresh
              // the snapshot to the new (unapplied) config and clear the banner,
              // both of which would lie about the engine's actual state.
              const failedNames = relevantTasks
                .filter((t) => t.status === "failed" || t.status === "cancelled")
                .map((t) => t.filename || t.task_id)
                .slice(0, 3)
                .join(", ")
              run.onToast?.(
                "error",
                i18n.t("knowledge:reindex.toast.incompleteTitle"),
                i18n.t(
                  failed > 3
                    ? "knowledge:reindex.toast.incompleteBodyMore"
                    : "knowledge:reindex.toast.incompleteBody",
                  { completed, total: taskIds.length, failed, names: failedNames, more: failed - 3 }
                )
              )
            }
          }
        } catch {
          // Polling failure is transient, keep trying.
        }
      }, 2000)
    },
    []
  )

  // Manual Re-index button: POST first (through the page's `onReindex`) to get
  // the task ids, then arm. `result.tasks` carries [{task_id, filename}] pairs.
  const startReindexWithProgress = React.useCallback(async () => {
    const onReindexNow = latest.current.onReindex
    if (!onReindexNow) return
    const result = await onReindexNow()
    if (!result || !result.task_ids?.length) return
    await armReindexFromTaskIds(result.task_ids, result.count, result.tasks)
  }, [armReindexFromTaskIds])

  // Server-side auto-reindex: the page extracts task ids from a draft PATCH
  // response and pushes them down. Arm the tile + polling without another POST
  // (the tasks already exist on the engine). `triggerKey` dedupes; arm once per
  // distinct payload and tell the page it was consumed.
  const consumedTriggerKeyRef = React.useRef<string | null>(null)
  const triggerKey = autoReindexTrigger?.triggerKey
  const triggerRef = React.useRef(autoReindexTrigger)
  triggerRef.current = autoReindexTrigger
  React.useEffect(() => {
    const t = triggerRef.current
    if (!t || t.taskIds.length === 0) return
    if (consumedTriggerKeyRef.current === t.triggerKey) return
    consumedTriggerKeyRef.current = t.triggerKey
    void armReindexFromTaskIds(t.taskIds, t.total)
    latest.current.onAutoReindexConsumed?.()
  }, [triggerKey, armReindexFromTaskIds])

  const clearReindexProgress = React.useCallback(() => setReindexProgress(null), [])

  return { reindexProgress, startReindexWithProgress, clearReindexProgress }
}
