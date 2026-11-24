/*
 * Knowledge panel > Documents tab: upload zone, per-file upload rows and the
 * indexed-documents list (with per-row status while a re-index runs).
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, CircleAlertIcon, FileTextIcon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import type {
  KnowledgeDocument,
  ReindexProgress,
  ReindexTask,
  UploadingFile,
} from "@/lib/manage/knowledge-types"
import { cn } from "@/lib/utils"
import { IconButton, MessageTile, Notice, StatusBadge, Tile, type StatusTone } from "./parts"

const ACCEPT = ".pdf,.docx,.txt,.md,.html,.csv,.json,.xml"

// Per-row status of an existing document while a re-index runs (tone + label key).
const TAG_BY_STATUS: Record<string, [StatusTone, string]> = {
  completed: ["ok", "documents.reindexStatus.completed"],
  failed: ["warn", "documents.reindexStatus.failed"],
  running: ["active", "documents.reindexStatus.running"],
  pending: ["neutral", "documents.reindexStatus.pending"],
}

function UploadRow({
  file,
  onCancel,
  onDismiss,
}: {
  file: UploadingFile
  onCancel: (taskId: string | undefined) => void
  onDismiss: (taskId: string | undefined) => void
}) {
  const { t } = useTranslation("knowledge")
  const isUploading = file.status === "uploading"
  const isSuccess = file.status === "success"
  const isError = file.status === "error"
  const isCancelled = file.status === "cancelled"
  const isQueued = isUploading && file.queued === true
  const isInFlight = isUploading && !isQueued
  const isDismissable = isError || isCancelled

  const stateLabel = isSuccess
    ? t("documents.upload.indexed")
    : isError
      ? t("documents.upload.failed")
      : isCancelled
        ? t("documents.upload.cancelled")
        : file.finishing
          ? // The cancel arrived too late to stop the insert. Say so rather
            // than let the click look like a no-op.
            t("documents.upload.finishing")
          : isQueued
            ? t("documents.upload.queued")
            : t("documents.upload.processing")

  // Visual fill driven by the backend's weighted_pct. Clamped 0..1 and
  // monotonic via the poll loop. No numeric label on purpose.
  const stripPct = isSuccess
    ? 1
    : isError || isCancelled || isQueued
      ? 0
      : Math.max(0, Math.min(1, file.progress ?? 0))

  return (
    <Tile
      // The left line is the at-a-glance signal: it encodes state, not progress.
      accent={isError ? "warn" : isSuccess ? "ok" : isQueued || isCancelled ? "neutral" : "active"}
      className="group/upload relative overflow-hidden"
    >
      <div className="flex items-center gap-3">
        {/* The status indicator replaces the file icon during processing. */}
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {isInFlight ? (
            <Spinner aria-label={stateLabel} />
          ) : isSuccess ? (
            <CheckIcon className="size-4 text-status-ok" aria-hidden="true" />
          ) : isError ? (
            <CircleAlertIcon className="size-4 text-status-warn" aria-hidden="true" />
          ) : isQueued ? (
            <span className="size-2 rounded-full bg-muted-foreground/60" aria-label={t("documents.upload.queued")} role="img" />
          ) : (
            <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
          {file.name}
        </span>
        <span role="status" aria-live="polite" className="min-w-16 text-right text-xs text-muted-foreground">
          {stateLabel}
        </span>
        {isUploading && file.taskId && (
          <IconButton
            label={isQueued ? t("documents.upload.removeFromQueue") : t("documents.upload.cancel")}
            onClick={() => onCancel(file.taskId)}
          >
            <XIcon />
          </IconButton>
        )}
        {isDismissable && (
          <IconButton label={t("shared.dismiss")} onClick={() => onDismiss(file.taskId)}>
            <Trash2Icon />
          </IconButton>
        )}
      </div>
      {file.error && <p className="mt-1 ml-7 text-xs break-words text-warn-text">{file.error}</p>}
      {/* Thin progress strip anchored to the bottom of the row. */}
      {(isInFlight || isSuccess) && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-muted">
          <div
            className={cn(
              "h-full w-full origin-left transition-transform duration-300 ease-out",
              isSuccess ? "bg-status-ok" : "bg-accent-line"
            )}
            style={{ transform: `scaleX(${stripPct})` }}
          />
        </div>
      )}
    </Tile>
  )
}

export function DocumentsTab({
  agentLevelEnabled,
  documents,
  documentsLoading,
  documentsError,
  documentsBeforeReindex,
  reindexProgress,
  uploadingFiles,
  onRefresh,
  onUpload,
  onCancelUpload,
  onDismissUpload,
  onDeleteRequest,
}: {
  agentLevelEnabled: boolean
  documents: KnowledgeDocument[]
  documentsLoading: boolean
  documentsError: string
  documentsBeforeReindex: KnowledgeDocument[] | null
  reindexProgress: ReindexProgress | null
  uploadingFiles: UploadingFile[]
  onRefresh: () => void
  onUpload: (files: FileList | File[]) => void
  onCancelUpload: (taskId: string | undefined) => void
  onDismissUpload: (taskId: string | undefined) => void
  onDeleteRequest: (filename: string) => void
}) {
  const { t, i18n } = useTranslation("knowledge")
  const [isDragOver, setIsDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  if (!agentLevelEnabled) {
    return (
      <MessageTile title={t("documents.disabledTitle")}>{t("documents.disabledBody")}</MessageTile>
    )
  }

  // Keep showing the user's documents straight through a profile-switch
  // upgrade. `documents` from the server is briefly empty during the migration
  // (the new-hash collection has no rows yet); `documentsBeforeReindex` is the
  // list from before the re-index started.
  const reindexActive = !!(reindexProgress && !reindexProgress.done)
  const effectiveDocs = reindexActive && documentsBeforeReindex ? documentsBeforeReindex : documents
  const taskByName = new Map<string, ReindexTask>()
  if (reindexActive && reindexProgress) {
    for (const reindexTask of reindexProgress.tasks) {
      const n = reindexTask.filename || Object.values(reindexTask.file_tasks ?? {})[0]?.filename
      if (n) taskByName.set(n, reindexTask)
    }
  }

  let list: React.ReactNode
  if (documentsLoading && effectiveDocs.length === 0) {
    list = (
      <div className="flex flex-col gap-2" role="status" aria-label={t("documents.loading")}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  } else if (documentsError) {
    list = <Notice kind="error" title={documentsError} />
  } else if (effectiveDocs.length === 0 && uploadingFiles.length === 0) {
    list = <MessageTile>{t("documents.empty")}</MessageTile>
  } else {
    list = (
      <ul className="flex flex-col gap-2">
        {effectiveDocs
          .filter(
            (doc) =>
              !uploadingFiles.some(
                (f) => (f.backendName || f.name) === doc.filename && f.status !== "error"
              )
          )
          .map((doc) => {
            const task = taskByName.get(doc.filename)
            const [tone, tagLabelKey] = task ? (TAG_BY_STATUS[task.status] ?? TAG_BY_STATUS.pending) : ["neutral" as const, ""]
            return (
              <li key={doc.filename}>
                <Tile accent={task ? "active" : "ok"} className="flex items-center gap-3 py-1.5">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={doc.filename}>
                    {doc.filename}
                  </span>
                  {task ? (
                    <StatusBadge tone={tone} icon={task.status === "running" ? <Spinner aria-hidden="true" /> : undefined}>
                      {t(tagLabelKey)}
                    </StatusBadge>
                  ) : (
                    <>
                      {doc.ingested_at && (
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {new Date(doc.ingested_at).toLocaleDateString(i18n.language)}
                        </span>
                      )}
                      <IconButton label={t("documents.deleteDocument")} onClick={() => onDeleteRequest(doc.filename)}>
                        <Trash2Icon />
                      </IconButton>
                    </>
                  )}
                </Tile>
              </li>
            )
          })}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Upload zone */}
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragOver ? "border-accent-line bg-foreground/8" : "border-border bg-card hover:bg-foreground/5"
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files)
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold">
          {isDragOver ? t("documents.dropHere") : t("documents.dropOrClick")}
        </span>
        <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD, HTML, CSV, JSON</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-label={t("documents.uploadLabel")}
        accept={ACCEPT}
        onChange={(e) => {
          if (e.target.files) onUpload(e.target.files)
          e.target.value = ""
        }}
      />

      {/* Document list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{t("documents.heading", { total: documents.length })}</h4>
          <IconButton label={t("common:action.refresh")} onClick={onRefresh} disabled={documentsLoading}>
            <RefreshCwIcon />
          </IconButton>
        </div>

        {/* Upload progress: one row per file, driven by the backend's weighted_pct. */}
        {uploadingFiles.length > 0 && (
          <ul className="flex flex-col gap-1">
            {uploadingFiles.map((f) => (
              <li key={f.taskId || f.name}>
                <UploadRow file={f} onCancel={onCancelUpload} onDismiss={onDismissUpload} />
              </li>
            ))}
          </ul>
        )}

        {list}
      </div>
    </div>
  )
}
