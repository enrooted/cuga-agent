/*
 * Knowledge Base modal of the Manage page: Documents, Search Test, Knowledge
 * harness and Settings tabs.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"

import { AlertDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import i18n from "@/i18n"
import * as api from "@/lib/manage/knowledge-api"
import {
  TAB_INDEX,
  type AdaptationServerErrorShape,
  type AutoReindexTrigger,
  type DraftSaveStatus,
  type GlossaryEntry,
  type KnowledgeConfigValues,
  type KnowledgeDocument,
  type KnowledgeReindexResult,
  type KnowledgeTabName,
  type KnowledgeToast,
  type RagProfileMeta,
} from "@/lib/manage/knowledge-types"
import { ClientAdaptationPanel } from "./client-adaptation-panel"
import { DocumentsTab } from "./documents-tab"
import { asRecord, asString, readJson } from "./knowledge-helpers"
import { SearchTab } from "./search-tab"
import { SettingsTab, SettingsUnavailable } from "./settings-tab"
import { useKnowledgeUploads } from "./use-knowledge-uploads"
import { useReindexProgress } from "./use-reindex-progress"

export { TAB_INDEX }
export type { KnowledgeConfigValues, KnowledgeTabName, RagProfileMeta }

export interface KnowledgePanelProps {
  onClose: () => void
  onDocsChanged?: (count: number) => void
  onHealthChanged?: (healthy: boolean) => void
  onToast?: KnowledgeToast
  knowledgeConfig?: KnowledgeConfigValues
  onKnowledgeConfigChange?: (config: KnowledgeConfigValues) => void
  knowledgeReindexNeeded?: boolean
  knowledgeStale?: boolean
  knowledgeReindexDeferred?: boolean
  // Resolves to the reindex POST response ({count, task_ids, tasks?}) or null.
  // `tasks` carries [{task_id, filename}] pairs so the tile shows real
  // filenames from the first frame.
  onReindex?: () => Promise<KnowledgeReindexResult | null>
  knowledgeReindexing?: boolean
  ragProfiles?: Record<string, RagProfileMeta>
  // Auto-reindex pushed down by the page: when a draft PATCH server-triggers a
  // re-index, the response carries task ids the user never explicitly asked
  // for. They are mirrored into the re-index tile. `triggerKey` dedupes;
  // `onAutoReindexConsumed` tells the page it can clear the trigger.
  autoReindexTrigger?: AutoReindexTrigger | null
  onAutoReindexConsumed?: () => void
  // Fired when an in-flight re-index (auto or manual) finishes WITHOUT
  // failures. The page refreshes its saved-config snapshot so the "Re-index
  // needed" banner clears.
  onAutoReindexComplete?: () => void
  // Fired when polling reaches ANY terminal state (success or partial
  // failure). The page clears `knowledgeReindexing` so autosave can resume.
  onReindexFinished?: () => void
  // Which tab to open the modal on. Uncontrolled with an initial value: the
  // user owns tab navigation from the first frame. Defaults to "documents".
  initialTab?: KnowledgeTabName
  // Adaptation server error (422 body of the draft PATCH), lifted to the page
  // because the autosave lives there. With the prop the panel is controlled;
  // without it the panel keeps local state.
  adaptationServerError?: AdaptationServerErrorShape | null
  onAdaptationServerError?: (error: AdaptationServerErrorShape | null) => void
  // Draft autosave status driven by the actual PATCH lifecycle.
  draftSaveStatus?: DraftSaveStatus
  // Re-fires the PATCH from the "failed" state.
  onRetryDraftSave?: () => void
  // Dismisses the failure banner WITHOUT retrying.
  onDismissDraftSave?: () => void
  // Fired on an explicit env-preset "Use" click so the page can bypass the
  // autosave debounce. The config change itself goes through
  // onKnowledgeConfigChange.
  onPresetApplied?: () => void
}

const TAB_ORDER: KnowledgeTabName[] = ["documents", "search", "behavior", "settings"]

export function KnowledgePanel({
  onClose,
  onDocsChanged,
  onHealthChanged,
  onToast,
  knowledgeConfig,
  onKnowledgeConfigChange,
  knowledgeReindexNeeded,
  knowledgeStale,
  knowledgeReindexDeferred,
  onReindex,
  knowledgeReindexing,
  ragProfiles,
  autoReindexTrigger,
  onAutoReindexConsumed,
  onAutoReindexComplete,
  onReindexFinished,
  initialTab,
  adaptationServerError: adaptationServerErrorProp,
  // Part of the controlled-state contract; the panel itself never sets it (as
  // in the original, where the page's autosave pushes the 422 in).
  onAdaptationServerError: _onAdaptationServerError,
  draftSaveStatus,
  onRetryDraftSave,
  onDismissDraftSave,
  onPresetApplied,
}: KnowledgePanelProps) {
  void _onAdaptationServerError
  const { t } = useTranslation("knowledge")
  // Seeded from the prop on first render (the modal is unmounted on close, so
  // the prop is always fresh on the next mount), then the user owns navigation.
  const [tab, setTab] = React.useState<KnowledgeTabName>(TAB_ORDER[TAB_INDEX[initialTab ?? "documents"]])

  // Controlled when the page passes a value, otherwise local (never set today).
  const [adaptationServerErrorLocal] = React.useState<AdaptationServerErrorShape | null>(null)
  const adaptationServerError =
    adaptationServerErrorProp !== undefined ? adaptationServerErrorProp : adaptationServerErrorLocal

  const knowledgeEnabled = knowledgeConfig?.enabled ?? true
  const agentLevelEnabled = knowledgeEnabled && (knowledgeConfig?.agent_level_enabled ?? true)

  // Documents state
  const [documents, setDocuments] = React.useState<KnowledgeDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = React.useState(true)
  const [documentsError, setDocumentsError] = React.useState("")
  const documentsRequest = React.useRef(0)
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null)

  // Health state (null = checking)
  const [healthy, setHealthy] = React.useState<boolean | null>(null)

  // Callback props through refs, to avoid re-fetch loops when the page re-renders.
  const onDocsChangedRef = React.useRef(onDocsChanged)
  onDocsChangedRef.current = onDocsChanged
  const onHealthChangedRef = React.useRef(onHealthChanged)
  onHealthChangedRef.current = onHealthChanged

  // ── data fetching ────────────────────────────────────────────────────────
  const loadDocuments = React.useCallback(async () => {
    const request = ++documentsRequest.current
    if (!agentLevelEnabled) {
      setDocumentsLoading(false)
      setDocuments([])
      onDocsChangedRef.current?.(0)
      return
    }
    setDocumentsLoading(true)
    setDocumentsError("")
    try {
      const res = await api.listKnowledgeDocuments()
      if (request !== documentsRequest.current) return
      if (!res.ok) throw new Error(i18n.t("knowledge:panel.loadFailedStatus", { status: res.status }))
      const data = asRecord((await res.json()) as unknown)
      const docs = Array.isArray(data?.documents) ? (data.documents as KnowledgeDocument[]) : []
      if (request !== documentsRequest.current) return
      setDocuments(docs)
      onDocsChangedRef.current?.(docs.length)
    } catch (e) {
      console.error("Failed to load documents:", e)
      if (request === documentsRequest.current) {
        setDocumentsError(e instanceof Error ? e.message : i18n.t("knowledge:panel.loadFailed"))
      }
    } finally {
      if (request === documentsRequest.current) setDocumentsLoading(false)
    }
  }, [agentLevelEnabled])

  const checkHealth = React.useCallback(async () => {
    try {
      const res = await api.getKnowledgeHealth()
      if (res.ok) {
        const isHealthy = !!asRecord((await res.json()) as unknown)?.healthy
        setHealthy(isHealthy)
        onHealthChangedRef.current?.(isHealthy)
      }
    } catch {
      setHealthy(false)
      onHealthChangedRef.current?.(false)
    }
  }, [])

  // Timers of the engine-start poll, cleared on unmount.
  const enginePollRef = React.useRef<{
    interval: ReturnType<typeof setInterval>
    timeout: ReturnType<typeof setTimeout>
  } | null>(null)
  const stopEnginePoll = React.useCallback(() => {
    if (!enginePollRef.current) return
    clearInterval(enginePollRef.current.interval)
    clearTimeout(enginePollRef.current.timeout)
    enginePollRef.current = null
  }, [])
  React.useEffect(() => stopEnginePoll, [stopEnginePoll])

  // Start the knowledge engine on demand (the user switched it ON while
  // disconnected).
  const ensureEngineStarted = React.useCallback(async () => {
    try {
      setHealthy(null) // show the "Checking" state
      const res = await api.enableKnowledge()
      if (res.ok) {
        stopEnginePoll()
        // Poll health until ready (the engine needs time to warm up).
        const interval = setInterval(async () => {
          try {
            const hRes = await api.getKnowledgeHealth()
            if (hRes.ok) {
              const hData = asRecord((await hRes.json()) as unknown)
              if (hData?.healthy) {
                stopEnginePoll()
                setHealthy(true)
                onHealthChangedRef.current?.(true)
                void loadDocuments()
              }
            }
          } catch {
            /* keep polling */
          }
        }, 2000)
        // Stop polling after 60 s.
        const timeout = setTimeout(stopEnginePoll, 60000)
        enginePollRef.current = { interval, timeout }
      }
    } catch {
      setHealthy(false)
      onHealthChangedRef.current?.(false)
    }
  }, [loadDocuments, stopEnginePoll])

  // Initial load
  React.useEffect(() => {
    void loadDocuments()
    void checkHealth()
  }, [loadDocuments, checkHealth])

  // ── re-index + uploads ───────────────────────────────────────────────────
  const { reindexProgress, startReindexWithProgress, clearReindexProgress } = useReindexProgress({
    loadDocuments,
    checkHealth,
    onToast,
    onReindex,
    onReindexFinished,
    onAutoReindexComplete,
    autoReindexTrigger,
    onAutoReindexConsumed,
  })

  const { uploadingFiles, handleUpload, handleCancelUpload, dismissUpload } = useKnowledgeUploads({
    agentLevelEnabled,
    loadDocuments,
    onToast,
  })

  // Snapshot the documents at re-index start so the list keeps showing the
  // user's files (with their ingest dates) throughout the upgrade: `documents`
  // from the server is briefly empty while the new-hash collection has no rows.
  // Cleared on completion; the next refresh of `documents` then takes over.
  const [documentsBeforeReindex, setDocumentsBeforeReindex] = React.useState<KnowledgeDocument[] | null>(null)
  const reindexRunning = !!reindexProgress && !reindexProgress.done
  React.useEffect(() => {
    if (reindexRunning) {
      // First transition into a running re-index: capture once, then leave the
      // snapshot alone until completion.
      setDocumentsBeforeReindex((prev) => (prev === null && documents.length > 0 ? documents : prev))
    } else {
      setDocumentsBeforeReindex(null)
    }
  }, [reindexRunning, reindexProgress?.taskIds.length, documents])

  // ── delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (filename: string) => {
    if (!agentLevelEnabled) {
      onToast?.(
        "warning",
        t("panel.agentDisabled.title"),
        t("panel.agentDisabled.manage")
      )
      return
    }
    try {
      const res = await api.deleteKnowledgeDocument(filename)
      if (res.ok) {
        onToast?.("success", t("panel.delete.done"), filename)
        setDeleteConfirm(null)
        void loadDocuments()
      } else {
        const err = asRecord(await readJson(res)) ?? { detail: t("panel.delete.failed") }
        onToast?.(
          "error",
          t("panel.delete.failed"),
          asString(err.detail) || asString(err.error) || t("shared.unknownError")
        )
      }
    } catch (e) {
      onToast?.("error", t("panel.delete.failed"), (e instanceof Error && e.message) || t("shared.networkError"))
    }
  }

  const configurable = knowledgeConfig && onKnowledgeConfigChange

  return (
    // Clicking outside does not close it (as in the original): an accidental
    // click must not drop in-flight uploads.
    <Dialog open onOpenChange={(open) => !open && onClose()} disablePointerDismissal>
      <DialogContent className="flex max-h-[min(90vh,56rem)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t("panel.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("panel.description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as KnowledgeTabName)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b px-5 py-2">
            <TabsList aria-label={t("panel.tabsLabel")}>
              <TabsTrigger value="documents">{t("panel.tab.documents", { total: documents.length })}</TabsTrigger>
              <TabsTrigger value="search">{t("panel.tab.search")}</TabsTrigger>
              <TabsTrigger value="behavior">{t("panel.tab.behavior")}</TabsTrigger>
              <TabsTrigger value="settings">{t("panel.tab.settings")}</TabsTrigger>
            </TabsList>
          </div>

          {/* The panels stay mounted (like Carbon's) so search results, test
              results and the guided preset flow survive a tab switch. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <TabsContent value="documents" keepMounted>
              <DocumentsTab
                agentLevelEnabled={agentLevelEnabled}
                documents={documents}
                documentsLoading={documentsLoading}
                documentsError={documentsError}
                documentsBeforeReindex={documentsBeforeReindex}
                reindexProgress={reindexProgress}
                uploadingFiles={uploadingFiles}
                onRefresh={() => void loadDocuments()}
                onUpload={(files) => void handleUpload(files)}
                onCancelUpload={(taskId) => void handleCancelUpload(taskId)}
                onDismissUpload={dismissUpload}
                onDeleteRequest={setDeleteConfirm}
              />
            </TabsContent>

            <TabsContent value="search" keepMounted>
              <SearchTab agentLevelEnabled={agentLevelEnabled} onToast={onToast} />
            </TabsContent>

            <TabsContent value="behavior" keepMounted>
              {configurable ? (
                <ClientAdaptationPanel
                  value={knowledgeConfig.client_adaptation_text ?? ""}
                  onChange={(next) => onKnowledgeConfigChange({ ...knowledgeConfig, client_adaptation_text: next })}
                  glossary={knowledgeConfig.client_adaptation_glossary ?? []}
                  onGlossaryChange={(next: GlossaryEntry[]) =>
                    onKnowledgeConfigChange({ ...knowledgeConfig, client_adaptation_glossary: next })
                  }
                  // Atomic reset: clear text AND glossary in one change. Two
                  // separate callbacks would close over the same config
                  // snapshot, so the second would clobber the first.
                  onReset={() =>
                    onKnowledgeConfigChange({
                      ...knowledgeConfig,
                      client_adaptation_text: "",
                      client_adaptation_glossary: [],
                    })
                  }
                  serverError={adaptationServerError ?? null}
                />
              ) : (
                <SettingsUnavailable page="manage" />
              )}
            </TabsContent>

            <TabsContent value="settings" keepMounted>
              {configurable ? (
                <SettingsTab
                  knowledgeConfig={knowledgeConfig}
                  onKnowledgeConfigChange={onKnowledgeConfigChange}
                  healthy={healthy}
                  onCheckHealth={() => void checkHealth()}
                  onEnsureEngineStarted={() => void ensureEngineStarted()}
                  ragProfiles={ragProfiles}
                  reindexProgress={reindexProgress}
                  onDismissReindexProgress={clearReindexProgress}
                  onReindexNow={() => void startReindexWithProgress()}
                  canReindex={!!onReindex}
                  knowledgeReindexNeeded={knowledgeReindexNeeded}
                  knowledgeStale={knowledgeStale}
                  knowledgeReindexDeferred={knowledgeReindexDeferred}
                  knowledgeReindexing={knowledgeReindexing}
                  draftSaveStatus={draftSaveStatus}
                  onRetryDraftSave={onRetryDraftSave}
                  onDismissDraftSave={onDismissDraftSave}
                  onPresetApplied={onPresetApplied}
                  onToast={onToast}
                />
              ) : (
                <SettingsUnavailable page="settings" />
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="m-0 rounded-b-xl px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common:action.close")}
          </Button>
        </DialogFooter>

        {/* Delete confirmation */}
        <AlertDialog
          open={deleteConfirm !== null}
          title={t("panel.delete.title")}
          description={t("panel.delete.description", { name: deleteConfirm ?? "" })}
          confirmLabel={t("common:action.delete")}
          onConfirm={() => {
            if (deleteConfirm) void handleDelete(deleteConfirm)
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgePanel
