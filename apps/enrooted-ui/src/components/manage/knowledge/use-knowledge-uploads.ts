/*
 * Upload state machine of the Knowledge panel: POST with wait=false, poll the
 * task until terminal, cancel, resume after a reload, tear down on unmount.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"

import i18n from "@/i18n"
import * as api from "@/lib/manage/knowledge-api"
import type { KnowledgeToast, UploadingFile } from "@/lib/manage/knowledge-types"
import {
  abortableSleep,
  addActiveUpload,
  asNumber,
  asRecord,
  asString,
  firstFileTaskError,
  isAbortError,
  loadActiveUploads,
  readJson,
  removeActiveUpload,
} from "./knowledge-helpers"

// 600 ms is below the human-perception threshold for "live"; the backend does
// no work on these calls beyond a sqlite SELECT + weighted_pct.
const POLL_INTERVAL_MS = 600
const MAX_POLLS = 10 * 60 // 10 min hard cap

type Updater = (prev: UploadingFile[]) => UploadingFile[]

export function useKnowledgeUploads({
  agentLevelEnabled,
  loadDocuments,
  onToast,
}: {
  agentLevelEnabled: boolean
  loadDocuments: () => void
  onToast?: KnowledgeToast
}) {
  const [uploadingFiles, setUploadingFiles] = React.useState<UploadingFile[]>([])

  // Per-upload AbortControllers keyed by the backend task_id (or the local
  // entry id before the backend assigns one). Lets us tear down in-flight
  // fetches + polls on modal close or user cancel without leaking timers.
  const controllersRef = React.useRef<Map<string, AbortController>>(new Map())

  const loadDocumentsRef = React.useRef(loadDocuments)
  loadDocumentsRef.current = loadDocuments

  // Poll one task until it reaches a terminal state. The poll response's
  // weighted_pct (0..1) drives the inline progress strip: stage internals
  // (parse/embed/insert) are deliberately collapsed server-side. Shared by
  // fresh uploads and resume-on-mount; the local entry must already exist with
  // this taskId.
  const pollUntilTerminal = React.useCallback(
    async (backendTaskId: string, signal: AbortSignal): Promise<void> => {
      // Guarded setState: every late callback checks signal.aborted so nothing
      // is written after the modal unmounts or after a cancel.
      const safeSet = (updater: Updater): void => {
        if (signal.aborted) return
        setUploadingFiles(updater)
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        try {
          await abortableSleep(POLL_INTERVAL_MS, signal)
        } catch {
          // Aborted: modal closed or user cancelled. Bail without touching state.
          return
        }

        let taskResp: Response
        try {
          taskResp = await api.getKnowledgeTaskStatus(backendTaskId, signal)
        } catch (e) {
          if (isAbortError(e) || signal.aborted) return
          continue // transient network blip: keep polling
        }
        if (!taskResp.ok) {
          if (taskResp.status === 404) {
            removeActiveUpload(backendTaskId)
            safeSet((prev) =>
              prev.map((f) =>
                f.taskId === backendTaskId ? { ...f, status: "error", error: i18n.t("knowledge:documents.uploadError.taskNotFound") } : f
              )
            )
            return
          }
          continue
        }
        const task = asRecord(await readJson(taskResp))
        if (!task) continue

        const pct = asNumber(task.weighted_pct) ?? 0
        const status = asString(task.status)
        const uiPhase = asString(task.ui_phase)

        if (status === "completed") {
          removeActiveUpload(backendTaskId)
          const filename = asString(task.filename)
          safeSet((prev) =>
            prev.map((f) =>
              f.taskId === backendTaskId
                ? { ...f, status: "success", progress: 1, backendName: filename ?? f.backendName }
                : f
            )
          )
          // Refresh the doc list immediately on each completion (a sub-50 ms
          // sqlite read, so N near-simultaneous completions just fire N GETs).
          loadDocumentsRef.current()
          setTimeout(() => {
            safeSet((prev) => prev.filter((f) => f.taskId !== backendTaskId))
          }, 3000)
          return
        }
        if (status === "failed" || status === "cancelled") {
          removeActiveUpload(backendTaskId)
          const error = firstFileTaskError(task)
          safeSet((prev) =>
            prev.map((f) =>
              f.taskId === backendTaskId
                ? status === "cancelled"
                  ? { ...f, status: "cancelled", error: undefined }
                  : { ...f, status: "error", error: error || i18n.t("knowledge:documents.uploadError.ingestionFailed") }
                : f
            )
          )
          return
        }

        // Still in flight: only advance progress forward (never go backwards
        // because of a stale-read race with a later write). Carry the ui_phase
        // so the row can show "Queued" vs "Processing".
        const isQueued = uiPhase === "queued"
        safeSet((prev) =>
          prev.map((f) =>
            f.taskId === backendTaskId
              ? { ...f, progress: Math.max(f.progress ?? 0, pct), queued: isQueued }
              : f
          )
        )
      }

      // Timed out without a terminal status. The task may still be running
      // server-side; the localStorage entry stays so a later reload can re-attach.
      safeSet((prev) =>
        prev.map((f) =>
          f.taskId === backendTaskId
            ? { ...f, status: "error", error: i18n.t("knowledge:documents.uploadError.timedOut") }
            : f
        )
      )
    },
    []
  )

  // Upload one file: POST with wait=false (202 + task_id), then poll the task
  // endpoint until terminal. The controllers map is re-keyed from the temporary
  // entry id to the backend task_id as soon as it is known, so cancel-by-task-id
  // works for both fresh and resumed uploads.
  const uploadOne = React.useCallback(
    async (file: File, entryId: string) => {
      const controller = new AbortController()
      controllersRef.current.set(entryId, controller)
      const signal = controller.signal

      const safeSet = (updater: Updater): void => {
        if (signal.aborted) return
        setUploadingFiles(updater)
      }

      let backendTaskId: string | undefined
      try {
        const res = await api.uploadKnowledgeDocument(file, true, false, signal)
        if (!res.ok) {
          const err = asRecord(await readJson(res))
          const detail = asString(err ? err.detail : res.statusText)
          safeSet((prev) =>
            prev.map((f) =>
              f.taskId === entryId ? { ...f, status: "error", error: detail || i18n.t("knowledge:documents.uploadError.failed") } : f
            )
          )
          return
        }
        const queued = asRecord(await readJson(res))
        const queuedTask = Array.isArray(queued?.tasks) ? asRecord(queued.tasks[0]) : queued
        backendTaskId = asString(queuedTask?.task_id) || undefined
        const backendName = asString(queuedTask?.filename)
        if (!backendTaskId) {
          // Server returned a synchronous result (wait was ignored or legacy
          // build). Treat as final to stay compatible.
          const ok = queuedTask?.status === "completed"
          safeSet((prev) =>
            prev.map((f) =>
              f.taskId === entryId
                ? ok
                  ? { ...f, backendName, status: "success", progress: 1 }
                  : { ...f, backendName, status: "error", error: i18n.t("knowledge:documents.uploadError.ingestionFailed") }
                : f
            )
          )
          if (ok) {
            loadDocumentsRef.current()
            setTimeout(() => {
              safeSet((prev) => prev.filter((f) => f.taskId !== entryId))
            }, 3000)
          }
          return
        }

        // Re-key the controllers map from entryId to the canonical backend
        // task_id so the cancel button (which only knows the task_id) finds it.
        controllersRef.current.delete(entryId)
        controllersRef.current.set(backendTaskId, controller)

        // Persist for resume-across-reload, only once there is a real task_id.
        addActiveUpload({ taskId: backendTaskId, name: file.name, createdAt: Date.now() })

        // Seed the entry with the backend task_id + a tiny visible progress so
        // the strip starts moving immediately on slow networks.
        const taskId = backendTaskId
        safeSet((prev) =>
          prev.map((f) =>
            f.taskId === entryId
              ? { ...f, taskId, backendName, progress: Math.max(f.progress ?? 0, 0.02) }
              : f
          )
        )

        await pollUntilTerminal(backendTaskId, signal)
      } catch (e: unknown) {
        if (isAbortError(e) || signal.aborted) {
          // Either the modal unmounted (safeSet is a no-op now) or the user
          // clicked cancel (the cancel handler already wrote the state).
          return
        }
        const message = e instanceof Error ? e.message : i18n.t("knowledge:documents.uploadError.uploadFailed")
        safeSet((prev) =>
          prev.map((f) =>
            f.taskId === entryId || f.taskId === backendTaskId
              ? { ...f, status: "error", error: message }
              : f
          )
        )
      } finally {
        // Clean both possible keys: entryId before re-keying, task_id after.
        const key = backendTaskId ?? entryId
        if (controllersRef.current.get(key) === controller) {
          controllersRef.current.delete(key)
        }
      }
    },
    [pollUntilTerminal]
  )

  const handleUpload = React.useCallback(
    async (files: FileList | File[]) => {
      if (!agentLevelEnabled) {
        onToast?.(
          "warning",
          i18n.t("knowledge:panel.agentDisabled.title"),
          i18n.t("knowledge:panel.agentDisabled.upload")
        )
        return
      }
      const fileArray = Array.from(files)
      if (fileArray.length === 0) return

      // A unique id per file entry.
      const entries: UploadingFile[] = fileArray.map((f) => ({
        name: f.name,
        status: "uploading",
        taskId: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        backendName: undefined,
      }))
      setUploadingFiles((prev) => [...prev.filter((f) => f.status !== "success"), ...entries])

      // Fire all uploads in parallel: each resolves independently.
      await Promise.allSettled(
        entries.map((entry, i) => uploadOne(fileArray[i], entry.taskId as string))
      )
    },
    [agentLevelEnabled, onToast, uploadOne]
  )

  // Cancel an in-flight upload. We await the server and only tear down the
  // local poll + resume entry once it confirms a terminal status.
  //
  // A cancel can legitimately NOT take effect: once the ingest is inside the
  // vector insert it is past the point of no return and the server returns the
  // still-running row. Then the poll stays attached so the row resolves to its
  // real terminal state instead of claiming a cancel that did not happen.
  const handleCancelUpload = React.useCallback(async (taskId: string | undefined): Promise<void> => {
    if (!taskId) return
    let serverTask: Record<string, unknown> | null = null
    try {
      const res = await api.cancelKnowledgeTask(taskId)
      if (res.ok) serverTask = asRecord(await readJson(res))
    } catch {
      // Network failure: fall through and leave the poll attached rather than
      // assume a cancel that may never have reached the server.
    }

    const serverStatus = asString(serverTask?.status)
    if (serverStatus === "cancelled" || serverStatus === "failed") {
      const controller = controllersRef.current.get(taskId)
      if (controller) {
        controller.abort()
        controllersRef.current.delete(taskId)
      }
      removeActiveUpload(taskId)
      // A task that was ALREADY failed when we asked to cancel it must keep
      // reading as failed: painting it "Cancelled" would hide a real ingest
      // failure behind a user action that did not cause it.
      const failed = serverStatus === "failed"
      const failureError = failed ? firstFileTaskError(serverTask) || i18n.t("knowledge:documents.uploadError.ingestionFailed") : undefined
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.taskId === taskId
            ? failed
              ? { ...f, status: "error", error: failureError, finishing: false }
              : { ...f, status: "cancelled", error: undefined, finishing: false }
            : f
        )
      )
      return
    }

    // Refused (too late) or the request failed: keep polling. The loop already
    // paints success/error from the server's own terminal write.
    setUploadingFiles((prev) => prev.map((f) => (f.taskId === taskId ? { ...f, finishing: true } : f)))
  }, [])

  const dismissUpload = React.useCallback((taskId: string | undefined) => {
    setUploadingFiles((prev) => prev.filter((x) => x.taskId !== taskId))
  }, [])

  // Resume on mount + teardown on unmount.
  // Resume: read localStorage, validate each entry against the server and
  // re-attach a poll for any task still in flight. Done once on mount.
  // Teardown: abort every controller so closing the modal stops timers, sleeps
  // and in-flight fetches in one synchronous turn.
  React.useEffect(() => {
    const controllers = controllersRef.current
    const teardown = () => {
      controllers.forEach((c) => c.abort())
      controllers.clear()
    }

    const persisted = loadActiveUploads()
    // Still register the cleanup even with no persisted entries: fresh uploads
    // created during the modal session must abort on close.
    if (persisted.length === 0) return teardown

    let cancelled = false
    void (async () => {
      for (const entry of persisted) {
        if (cancelled) return
        let task: Record<string, unknown> | null
        try {
          const resp = await api.getKnowledgeTaskStatus(entry.taskId)
          if (resp.status === 404) {
            removeActiveUpload(entry.taskId)
            continue
          }
          if (!resp.ok) continue
          task = asRecord(await readJson(resp))
        } catch {
          // Network issue on the initial check: leave the entry alone so a
          // later mount can try again.
          continue
        }
        if (!task || cancelled) continue
        const status = asString(task.status)
        if (status === "completed" || status === "failed" || status === "cancelled") {
          // Terminal: clean up the registry; the indexed-documents list already
          // shows successful ones.
          removeActiveUpload(entry.taskId)
          continue
        }
        // Still in flight: surface the row and start polling. Merge by taskId so
        // a concurrent fresh upload of the same task is not duplicated.
        const controller = new AbortController()
        controllers.set(entry.taskId, controller)
        const resumed: UploadingFile = {
          name: entry.name,
          backendName: asString(task.filename),
          taskId: entry.taskId,
          status: "uploading",
          progress: asNumber(task.weighted_pct) ?? 0,
          queued: task.ui_phase === "queued",
        }
        setUploadingFiles((prev) =>
          prev.some((f) => f.taskId === entry.taskId) ? prev : [...prev, resumed]
        )
        // Don't await: let all resumed polls run in parallel.
        void pollUntilTerminal(entry.taskId, controller.signal)
      }
    })()

    return () => {
      cancelled = true
      teardown()
    }
    // Intentionally mount-only: resuming on every render would re-fire server
    // validations for every state change. pollUntilTerminal is stable.
  }, [pollUntilTerminal])

  return { uploadingFiles, handleUpload, handleCancelUpload, dismissUpload }
}
