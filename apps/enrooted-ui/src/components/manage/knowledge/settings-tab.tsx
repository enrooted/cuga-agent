/*
 * Knowledge panel > Settings tab: service health, on/off and scope switches,
 * retrieval profile, re-index block, and the advanced accordion (embedding
 * model, chunking, document parsing, retrieval behavior, score & metric, limits).
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import {
  FileTextIcon,
  QuoteIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"

import { AlertDialog } from "@/components/confirm-dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import * as api from "@/lib/manage/knowledge-api"
import type {
  AcceleratorStatus,
  DraftSaveStatus,
  EmbeddingsTestResult,
  EnvPreset,
  KnowledgeConfigValues,
  KnowledgeToast,
  RagProfileMeta,
  ReindexProgress,
} from "@/lib/manage/knowledge-types"
import { cn } from "@/lib/utils"
import { EmbeddingSection, SaveStatePill, type PresetGuide, type SaveState } from "./embedding-section"
import {
  asNumber,
  asRecord,
  asString,
  loadShowAdvanced,
  providerSpec,
  readJson,
  saveShowAdvanced,
  validateBaseUrl,
} from "./knowledge-helpers"
import { IconButton, MessageTile, Notice, NumberField, SelectField, StatusBadge, StatusDot, Tile } from "./parts"
import { ReindexStatus } from "./reindex-status"

// Per-section error/warning state, shown as a chip in the accordion header so
// the user sees which sections need attention WITHOUT opening them. Errors
// block save (the engine would reject); warnings are advisory.
type SectionStatus = { kind: "error" | "warning"; reason: string } | null

function SectionTitle({ label, status }: { label: string; status?: SectionStatus }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {status && (
        <StatusBadge tone="warn" title={status.reason}>
          {status.kind === "error" ? "Needs attention" : "Warning"}
          <span className="sr-only">: {status.reason}</span>
        </StatusBadge>
      )}
    </span>
  )
}

function ResetButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5" onClick={onClick}>
        <RotateCcwIcon data-icon="inline-start" />
        {children}
      </Button>
    </div>
  )
}

/** A scope card: icon, title, description and a switch; the left line shows on/off. */
function ScopeCard({
  id,
  icon: Icon,
  title,
  description,
  active,
  checked,
  onCheckedChange,
}: {
  id: string
  icon: LucideIcon
  title: string
  description: string
  /** Effective state (also off while the knowledge base itself is off). */
  active: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Tile accent={active ? "ok" : "neutral"} className="flex items-center justify-between gap-4 transition-colors">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className={cn("size-5 shrink-0", active ? "text-status-ok" : "text-muted-foreground")} aria-hidden="true" />
        <div className="min-w-0">
          <Label htmlFor={id} className="text-sm font-semibold">
            {title}
          </Label>
          <p id={`${id}-description`} className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <Switch id={id} aria-describedby={`${id}-description`} checked={checked} onCheckedChange={onCheckedChange} />
    </Tile>
  )
}

export function SettingsTab({
  knowledgeConfig,
  onKnowledgeConfigChange,
  healthy,
  onCheckHealth,
  onEnsureEngineStarted,
  ragProfiles,
  reindexProgress,
  onDismissReindexProgress,
  onReindexNow,
  canReindex,
  knowledgeReindexNeeded,
  knowledgeStale,
  knowledgeReindexDeferred,
  knowledgeReindexing,
  draftSaveStatus,
  onRetryDraftSave,
  onDismissDraftSave,
  onPresetApplied,
  onToast,
}: {
  knowledgeConfig: KnowledgeConfigValues
  onKnowledgeConfigChange: (config: KnowledgeConfigValues) => void
  healthy: boolean | null
  onCheckHealth: () => void
  onEnsureEngineStarted: () => void
  ragProfiles?: Record<string, RagProfileMeta>
  reindexProgress: ReindexProgress | null
  onDismissReindexProgress: () => void
  onReindexNow: () => void
  canReindex: boolean
  knowledgeReindexNeeded?: boolean
  knowledgeStale?: boolean
  knowledgeReindexDeferred?: boolean
  knowledgeReindexing?: boolean
  draftSaveStatus?: DraftSaveStatus
  onRetryDraftSave?: () => void
  onDismissDraftSave?: () => void
  onPresetApplied?: () => void
  onToast?: KnowledgeToast
}) {
  const knowledgeEnabled = knowledgeConfig.enabled ?? true
  const agentLevelEnabled = knowledgeEnabled && (knowledgeConfig.agent_level_enabled ?? true)
  const sessionLevelEnabled = knowledgeEnabled && (knowledgeConfig.session_level_enabled ?? true)
  const citationsEnabled = knowledgeEnabled && (knowledgeConfig.citations_enabled ?? true)

  // Hardware acceleration status (what the live engine actually loaded).
  const [accel, setAccel] = React.useState<AcceleratorStatus | null>(null)

  // Inline hint when the user tries to put a reserved key (like embedding_model)
  // into the extra-params JSON.
  const [extraParamsHint, setExtraParamsHint] = React.useState<string | null>(null)

  // Test-connection state. null = untested.
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<EmbeddingsTestResult | null>(null)

  // Guided "apply a detected provider" flow: after the user clicks Use on an env
  // preset, walk them through verify-connection → re-index (re-index gated on a
  // green test). Set on apply; cleared when they switch provider away or the
  // re-index finishes.
  const [presetGuide, setPresetGuide] = React.useState<PresetGuide | null>(null)

  // Show / hide expert fields. Persisted so the mode sticks across reloads.
  // Default: simple, to avoid drowning first-time users in tuning knobs.
  const [showAdvanced, setShowAdvanced] = React.useState<boolean>(loadShowAdvanced)
  const persistShowAdvanced = (v: boolean) => {
    setShowAdvanced(v)
    saveShowAdvanced(v)
  }

  const baseUrlError = validateBaseUrl(knowledgeConfig.embedding_base_url)

  const embeddingsStatus: SectionStatus = (() => {
    const spec = providerSpec(knowledgeConfig.embedding_provider)
    const model = (knowledgeConfig.embedding_model || "").trim()
    const apiKey = (knowledgeConfig.embedding_api_key || "").trim()
    if (baseUrlError) return { kind: "error", reason: `Base URL: ${baseUrlError}` }
    if (spec.modelRequired && !model) return { kind: "error", reason: "Model is required" }
    if (spec.keyRequired && !apiKey) return { kind: "error", reason: "API Key is required" }
    if (extraParamsHint) return { kind: "error", reason: extraParamsHint }
    if (testResult && !testResult.ok) return { kind: "warning", reason: "Test connection failed" }
    return null
  })()
  const chunkingStatus: SectionStatus = (() => {
    const cs = knowledgeConfig.chunk_size ?? 1000
    const co = knowledgeConfig.chunk_overlap ?? 200
    if (co >= cs) return { kind: "error", reason: "Overlap must be less than chunk size" }
    return null
  })()

  // Reset state: confirmation dialog target. null = no dialog open.
  const [resetTarget, setResetTarget] = React.useState<null | { section: string; fields: string[] }>(null)
  const [defaultsCache, setDefaultsCache] = React.useState<Record<string, unknown> | null>(null)
  const performReset = async () => {
    if (!resetTarget) return
    try {
      let defaults = defaultsCache
      if (!defaults) {
        const res = await api.getKnowledgeDefaults()
        if (!res.ok) {
          onToast?.("error", "Reset failed", `Server returned ${res.status} ${res.statusText}`)
          setResetTarget(null)
          return
        }
        defaults = asRecord(asRecord((await res.json()) as unknown)?.defaults) ?? {}
        setDefaultsCache(defaults)
      }
      // Only the fields listed in resetTarget.fields: never touches other sections.
      const updates: Record<string, unknown> = {}
      for (const f of resetTarget.fields) {
        if (f in defaults) updates[f] = defaults[f]
      }
      onKnowledgeConfigChange({ ...knowledgeConfig, ...updates })
      onToast?.("success", "Section reset", `Restored ${resetTarget.section} to factory defaults.`)
    } catch (e) {
      onToast?.("error", "Reset failed", e instanceof Error ? e.message : "unknown error")
    } finally {
      setResetTarget(null)
    }
  }

  // Save-state indicator, driven by the page's `draftSaveStatus` (sourced from
  // the actual PATCH lifecycle). The "saved" pill auto-hides after 3 s of
  // quiescence via `recentlySaved` so it is not a permanent sticker.
  const saveState: SaveState = !draftSaveStatus ? "idle" : draftSaveStatus.kind
  const [recentlySaved, setRecentlySaved] = React.useState(false)
  React.useEffect(() => {
    if (saveState === "saved") {
      setRecentlySaved(true)
      const t = setTimeout(() => setRecentlySaved(false), 3000)
      return () => clearTimeout(t)
    }
    setRecentlySaved(false)
  }, [saveState, draftSaveStatus])

  // Detected embedding-provider presets from the host's environment (.env /
  // shell). The endpoint returns booleans + suggested config only, never the
  // raw credential values. Fetched once on mount.
  const [envPresets, setEnvPresets] = React.useState<EnvPreset[] | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.getKnowledgeEnvPresets()
        if (!res.ok || cancelled) return
        const presets = asRecord(await readJson(res))?.presets
        if (cancelled) return
        setEnvPresets(Array.isArray(presets) ? (presets as EnvPreset[]) : [])
      } catch {
        // Fail quiet: the panel just hides; the user can still configure manually.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch the hardware acceleration status. Re-fetches when the user toggles
  // use_gpu or changes the embedding provider/model/key: all can change what
  // the live engine actually loaded.
  const { use_gpu, embedding_provider, embedding_model, embedding_api_key, embedding_base_url, embedding_extra_params } =
    knowledgeConfig
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.getKnowledgeAccelerator()
        if (!res.ok) return
        const j = asRecord((await res.json()) as unknown)
        if (cancelled || !j?.available) {
          if (!cancelled) setAccel(null)
          return
        }
        const keySource = asRecord(j.key_source)
        setAccel({
          device_label: asString(j.device_label) ?? "",
          fallback_to_cpu: !!j.fallback_to_cpu,
          embedding_relevant: !!j.embedding_relevant,
          key_source: keySource
            ? { required: !!keySource.required, source: asString(keySource.source) ?? "" }
            : undefined,
        })
      } catch {
        if (!cancelled) setAccel(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [use_gpu, embedding_provider, embedding_model, embedding_api_key])

  // Reset the test result when any embedding-related field changes (a green
  // check on yesterday's key is not trustworthy after an edit). Also clear the
  // extra-params reserved-key hint: switching provider resets
  // embedding_extra_params, and a lingering hint would keep the section in an
  // error state with no visible field to fix.
  React.useEffect(() => {
    setTestResult(null)
    setExtraParamsHint(null)
  }, [embedding_provider, embedding_model, embedding_api_key, embedding_base_url, embedding_extra_params])

  // Dismiss the guided apply flow once the user switches provider away from the
  // applied preset, or the re-index THIS guide started has finished. The
  // done-branch is gated on a run that began after the guide opened: otherwise
  // a stale `done` from an earlier re-index kills the guide the instant it appears.
  const reindexDone = reindexProgress?.done
  const reindexStartedAt = reindexProgress?.startedAt
  React.useEffect(() => {
    if (!presetGuide) return
    const switchedAway = (embedding_provider ?? "") !== presetGuide.provider
    const freshReindexDone = !!reindexDone && (reindexStartedAt ?? 0) >= presetGuide.openedAt
    if (switchedAway || freshReindexDone) setPresetGuide(null)
  }, [presetGuide, embedding_provider, reindexDone, reindexStartedAt])

  // Run a single embed call against the configured provider: surfaces auth /
  // network / model failures BEFORE the user uploads anything.
  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.testEmbeddingsConnection({
        provider: knowledgeConfig.embedding_provider || "",
        model: knowledgeConfig.embedding_model || "",
        api_key: knowledgeConfig.embedding_api_key || "",
        base_url: knowledgeConfig.embedding_base_url || "",
        extra_params: knowledgeConfig.embedding_extra_params || {},
      })
      const j = asRecord((await res.json()) as unknown)
      setTestResult({
        ok: !!j?.ok,
        dim: asNumber(j?.dim),
        latency_ms: asNumber(j?.latency_ms),
        error: asString(j?.error),
      })
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const set = (patch: Partial<KnowledgeConfigValues>) => onKnowledgeConfigChange({ ...knowledgeConfig, ...patch })

  const profileKey = knowledgeConfig.rag_profile ?? "standard"

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Health status */}
      <Tile className="flex items-center justify-between gap-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot state={healthy === null ? "off" : healthy ? "ok" : "warn"} />
          <span className="text-xs font-semibold whitespace-nowrap">Service</span>
          <StatusBadge tone={healthy === null ? "neutral" : healthy ? "ok" : "warn"}>
            {healthy === null ? "Checking" : healthy ? "Connected" : "Disconnected"}
          </StatusBadge>
        </div>
        <IconButton label="Refresh status" onClick={onCheckHealth}>
          <RefreshCwIcon />
        </IconButton>
      </Tile>

      {/* 2. Enable / disable */}
      <Tile className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id="knowledge-enabled"
            checked={knowledgeConfig.enabled ?? true}
            onCheckedChange={(checked) => {
              set({ enabled: checked })
              // Start the engine on demand when switched on while disconnected.
              if (checked && !healthy) onEnsureEngineStarted()
            }}
          />
          <Label htmlFor="knowledge-enabled" className="text-sm font-semibold">
            Knowledge Base
          </Label>
          <span className="text-xs text-muted-foreground">{(knowledgeConfig.enabled ?? true) ? "On" : "Off"}</span>
        </div>
        {!knowledgeEnabled && (
          <p className="text-xs text-muted-foreground">
            Knowledge base is disabled. Enable it to configure retrieval settings.
          </p>
        )}
      </Tile>

      {knowledgeEnabled && (
        <div className="flex flex-col gap-3">
          <ScopeCard
            id="knowledge-agent-level-enabled"
            icon={FileTextIcon}
            title="Agent-level knowledge"
            description="Permanent documents shared across all conversations"
            active={agentLevelEnabled}
            checked={knowledgeConfig.agent_level_enabled ?? true}
            onCheckedChange={(checked) => set({ agent_level_enabled: checked })}
          />
          <ScopeCard
            id="knowledge-session-level-enabled"
            icon={SearchIcon}
            title="Session-level knowledge"
            description="Per-conversation uploads and scoped search"
            active={sessionLevelEnabled}
            checked={knowledgeConfig.session_level_enabled ?? true}
            onCheckedChange={(checked) => set({ session_level_enabled: checked })}
          />
          <ScopeCard
            id="knowledge-citations-enabled"
            icon={QuoteIcon}
            title="Citations"
            description="Number knowledge sources in answers ([1]) with clickable snippets"
            active={citationsEnabled}
            checked={knowledgeConfig.citations_enabled ?? true}
            onCheckedChange={(checked) => set({ citations_enabled: checked })}
          />
        </div>
      )}

      {/* Everything below is gated on enabled */}
      {knowledgeEnabled && (
        <>
          {!agentLevelEnabled && (
            <Notice kind="info" title="Agent-level knowledge is off">
              Permanent documents, indexing, and Manage search are unavailable until you turn it back on.
            </Notice>
          )}
          {!sessionLevelEnabled && (
            <Notice kind="info" title="Session-level knowledge is off">
              Conversation uploads and session-scoped knowledge search are unavailable in chat.
            </Notice>
          )}

          {/* 3. Retrieval profile */}
          {ragProfiles && Object.keys(ragProfiles).length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h4 id="knowledge-profile-heading" className="text-sm font-semibold">
                    Retrieval Profile
                  </h4>
                  {/* Save-status pill at the surface the user is actually editing. */}
                  <SaveStatePill saveState={saveState} recentlySaved={recentlySaved} showFailed />
                </div>
                <p className="text-xs text-muted-foreground">
                  Balance retrieval accuracy against response speed and cost.
                </p>
              </div>
              <div role="radiogroup" aria-labelledby="knowledge-profile-heading" className="flex flex-col gap-2">
                {Object.entries(ragProfiles).map(([key, profile]) => {
                  // Selected by USER INTENT (the profile name in the config), not
                  // by field-for-field equality: edits to advanced settings are
                  // overrides on top of the named profile ("Modified").
                  const isSelected = profileKey === key
                  // A re-index is required when ANY field of the backend's
                  // vector_config_hash would change: the embedding model AND
                  // chunk size/overlap.
                  const vectorConfigMatches =
                    (profile.embeddings?.model ?? knowledgeConfig.embedding_model) ===
                      knowledgeConfig.embedding_model &&
                    profile.chunking?.chunk_size === knowledgeConfig.chunk_size &&
                    profile.chunking?.chunk_overlap === knowledgeConfig.chunk_overlap
                  // "Modified" = this profile runs settings that differ from its
                  // packaged defaults: a customization indicator, independent of
                  // publish state.
                  const isModified = isSelected && !vectorConfigMatches
                  const willReindex = !vectorConfigMatches
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-3 rounded-lg border border-l-[3px] px-4 py-3 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                        isSelected
                          ? "border-l-accent-line bg-foreground/8"
                          : "border-l-transparent bg-card hover:bg-foreground/5"
                      )}
                      onClick={() => {
                        // Populate EVERY field the profile owns from the profile
                        // metadata (not just chunking). Otherwise the autosave
                        // re-sends the prior embedding_model / docling_* /
                        // rerank_* values and the backend's "incoming wins"
                        // merge clobbers the profile loader. Fall back to the
                        // previous value when a profile section omits a key.
                        onKnowledgeConfigChange({
                          ...knowledgeConfig,
                          rag_profile: key,
                          chunk_size: profile.chunking?.chunk_size ?? knowledgeConfig.chunk_size,
                          chunk_overlap: profile.chunking?.chunk_overlap ?? knowledgeConfig.chunk_overlap,
                          embedding_model: profile.embeddings?.model ?? knowledgeConfig.embedding_model,
                          embedding_batch_size: profile.embeddings?.batch_size ?? knowledgeConfig.embedding_batch_size,
                          embedding_concurrency:
                            profile.embeddings?.concurrency ?? knowledgeConfig.embedding_concurrency,
                          docling_pdf_mode: profile.docling?.pdf_mode ?? knowledgeConfig.docling_pdf_mode,
                          docling_layout_engine:
                            profile.docling?.layout_engine ?? knowledgeConfig.docling_layout_engine,
                          docling_drop_page_chrome:
                            profile.docling?.drop_page_chrome ?? knowledgeConfig.docling_drop_page_chrome,
                          rerank_enabled: profile.rerank?.enabled ?? knowledgeConfig.rerank_enabled,
                          rerank_top_k_in: profile.rerank?.top_k_in ?? knowledgeConfig.rerank_top_k_in,
                          rerank_model: profile.rerank?.model ?? knowledgeConfig.rerank_model,
                          search_hybrid_mode: profile.search?.hybrid_mode ?? knowledgeConfig.search_hybrid_mode,
                          search_query_transform:
                            profile.search?.query_transform ?? knowledgeConfig.search_query_transform,
                          search_junk_filter: profile.search?.junk_filter ?? knowledgeConfig.search_junk_filter,
                          max_search_attempts:
                            profile.search?.max_search_attempts ?? knowledgeConfig.max_search_attempts,
                          default_limit: profile.search?.default_limit ?? knowledgeConfig.default_limit,
                          default_score_threshold:
                            profile.search?.default_score_threshold ?? knowledgeConfig.default_score_threshold,
                          max_ingest_workers: profile.engine?.max_ingest_workers ?? knowledgeConfig.max_ingest_workers,
                          vector_insert_batch_size:
                            profile.engine?.vector_insert_batch_size ?? knowledgeConfig.vector_insert_batch_size,
                        })
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                          isSelected ? "border-foreground" : "border-muted-foreground"
                        )}
                      >
                        {isSelected && <span className="size-2 rounded-full bg-foreground" />}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{profile.name}</span>
                          {isModified && <StatusBadge tone="neutral">Modified</StatusBadge>}
                        </span>
                        <span className="text-xs leading-normal text-muted-foreground">{profile.description}</span>
                        {!isSelected && willReindex && (
                          <ProfileWarning>Requires re-indexing existing documents.</ProfileWarning>
                        )}
                        {isModified && (
                          <ProfileWarning>Overrides the profile defaults — re-indexing runs on Publish.</ProfileWarning>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 4. Re-index: progress, completion, or the "re-index needed" banner */}
          <ReindexStatus
            agentLevelEnabled={agentLevelEnabled}
            reindexProgress={reindexProgress}
            onDismissProgress={onDismissReindexProgress}
            hidePrompt={!!presetGuide}
            needsReindex={!!(knowledgeReindexNeeded || knowledgeStale || knowledgeReindexDeferred)}
            canReindex={canReindex}
            knowledgeReindexing={knowledgeReindexing}
            onReindexNow={onReindexNow}
          />

          {/* Advanced settings toggle. The basic view is the on/off gate, the
              scopes and the retrieval profile: the 90 % decision surface.
              Embeddings / chunking / parsing / score / limits are operator-grade
              knobs. The choice persists in localStorage. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Switch id="knowledge-show-advanced" checked={showAdvanced} onCheckedChange={persistShowAdvanced} />
            <Label htmlFor="knowledge-show-advanced" className="text-sm font-semibold">
              Advanced settings
            </Label>
            <span className="text-xs text-muted-foreground">
              Embedding model, chunking, parsing, retrieval behavior, score &amp; metric, and limits.
            </span>
          </div>

          {/* 5. Advanced configuration (only when the toggle is on) */}
          {showAdvanced && (
            <Accordion multiple className="rounded-lg border px-3">
              <AccordionItem value="embeddings">
                <AccordionTrigger>
                  <SectionTitle label="Embedding model" status={embeddingsStatus} />
                </AccordionTrigger>
                <AccordionContent>
                  <EmbeddingSection
                    knowledgeConfig={knowledgeConfig}
                    onKnowledgeConfigChange={onKnowledgeConfigChange}
                    envPresets={envPresets}
                    presetGuide={presetGuide}
                    onPresetGuideChange={setPresetGuide}
                    testing={testing}
                    testResult={testResult}
                    onClearTestResult={() => setTestResult(null)}
                    onTestConnection={() => void handleTestConnection()}
                    extraParamsHint={extraParamsHint}
                    onExtraParamsHint={setExtraParamsHint}
                    accel={accel}
                    baseUrlError={baseUrlError}
                    saveState={saveState}
                    recentlySaved={recentlySaved}
                    draftSaveStatus={draftSaveStatus}
                    onRetryDraftSave={onRetryDraftSave}
                    onDismissDraftSave={onDismissDraftSave}
                    knowledgeReindexNeeded={knowledgeReindexNeeded}
                    knowledgeReindexing={knowledgeReindexing}
                    reindexProgress={reindexProgress}
                    onReindexNow={onReindexNow}
                    onPresetApplied={onPresetApplied}
                    onToast={onToast}
                    onResetRequest={setResetTarget}
                  />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="chunking">
                <AccordionTrigger>
                  <SectionTitle label="Chunking" status={chunkingStatus} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-4 pt-2">
                    {ragProfiles && profileKey !== "custom" && (
                      <p className="text-xs text-muted-foreground">
                        Values set by the <strong>{ragProfiles[profileKey]?.name ?? "Standard"}</strong> profile.
                        Edit to override.
                      </p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        id="knowledge-chunk-size"
                        label="Chunk Size"
                        value={knowledgeConfig.chunk_size ?? 1000}
                        min={100}
                        max={10000}
                        step={100}
                        onChange={(value) => set({ chunk_size: value })}
                      />
                      <NumberField
                        id="knowledge-chunk-overlap"
                        label="Chunk Overlap"
                        value={knowledgeConfig.chunk_overlap ?? 200}
                        min={0}
                        max={(knowledgeConfig.chunk_size ?? 1000) - 1}
                        invalid={(knowledgeConfig.chunk_overlap ?? 0) >= (knowledgeConfig.chunk_size ?? 1000)}
                        invalidText="Overlap must be less than chunk size"
                        onChange={(value) => set({ chunk_overlap: value })}
                      />
                    </div>
                    <ResetButton
                      onClick={() => setResetTarget({ section: "Chunking", fields: ["chunk_size", "chunk_overlap"] })}
                    >
                      Reset Chunking to defaults
                    </ResetButton>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="docling">
                <AccordionTrigger>
                  <SectionTitle label="Document Parsing (Docling)" />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-4 pt-2">
                    <SelectField
                      id="knowledge-docling-pdf-mode"
                      label="Parsing Level"
                      helperText="Applies to PDFs and every other Docling-supported format (DOCX, PPTX, HTML, images, …). Trades parse speed for extraction fidelity. Saved with the published config snapshot."
                      value={knowledgeConfig.docling_pdf_mode ?? "accurate"}
                      onChange={(e) => set({ docling_pdf_mode: e.target.value })}
                    >
                      <NativeSelectOption value="fast">
                        Fast — OCR off, tables off (digital docs only; ~3–10× faster)
                      </NativeSelectOption>
                      <NativeSelectOption value="balanced">
                        Balanced — OCR off, tables on (digital docs with tables)
                      </NativeSelectOption>
                      <NativeSelectOption value="accurate">
                        Accurate (default) — OCR on, tables on (scanned docs supported)
                      </NativeSelectOption>
                    </SelectField>
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-warn" aria-hidden="true" />
                      <span>
                        <strong>Fast</strong> mode will extract little or no text from scanned documents. Use{" "}
                        <strong>Accurate</strong> for OCR.
                      </span>
                    </p>
                    <SelectField
                      id="knowledge-docling-layout-engine"
                      label="Layout Engine"
                      helperText="Which backend runs the layout-detection model. Auto = ONNX (default; CPU on Mac, CUDA on NVIDIA). Transformers = PyTorch (only way to engage Apple GPU/MPS; ~500 MB more RAM)."
                      value={knowledgeConfig.docling_layout_engine ?? "auto"}
                      onChange={(e) => set({ docling_layout_engine: e.target.value })}
                    >
                      <NativeSelectOption value="auto">
                        Auto (default) — ONNX, fastest startup on CPU &amp; NVIDIA
                      </NativeSelectOption>
                      <NativeSelectOption value="onnx">ONNX — explicit (same as Auto today; pinned)</NativeSelectOption>
                      <NativeSelectOption value="transformers">
                        Transformers (PyTorch) — engages MPS on Mac / CUDA on NVIDIA
                      </NativeSelectOption>
                    </SelectField>
                    <ResetButton
                      onClick={() =>
                        setResetTarget({
                          section: "Document Parsing",
                          fields: ["docling_pdf_mode", "docling_layout_engine"],
                        })
                      }
                    >
                      Reset Document Parsing to defaults
                    </ResetButton>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <RetrievalBehaviorItem knowledgeConfig={knowledgeConfig} ragProfiles={ragProfiles} onPatch={set} />

              <AccordionItem value="metric">
                <AccordionTrigger>
                  <SectionTitle label="Score & Metric" />
                </AccordionTrigger>
                <AccordionContent>
                  {/* Read-only: only COSINE is supported end to end (config
                      validation rejects IP/L2), so a dropdown could only ever
                      fail the save. */}
                  <dl className="pt-2">
                    <dt className="text-xs text-muted-foreground">Distance Metric</dt>
                    <dd className="mt-1 text-sm">Cosine Similarity</dd>
                  </dl>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="limits">
                <AccordionTrigger>
                  <SectionTitle label="Limits" />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-4 pt-2">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        id="knowledge-max-upload"
                        label="Max Upload Size (MB)"
                        value={knowledgeConfig.max_upload_size_mb ?? 100}
                        min={1}
                        max={1000}
                        onChange={(value) => set({ max_upload_size_mb: value })}
                      />
                      <NumberField
                        id="knowledge-max-files"
                        label="Max Files per Request"
                        value={knowledgeConfig.max_files_per_request ?? 10}
                        min={1}
                        max={100}
                        onChange={(value) => set({ max_files_per_request: value })}
                      />
                      <NumberField
                        id="knowledge-max-url-download"
                        label="Max URL Download (MB)"
                        value={knowledgeConfig.max_url_download_size_mb ?? 50}
                        min={1}
                        max={500}
                        onChange={(value) => set({ max_url_download_size_mb: value })}
                      />
                      <NumberField
                        id="knowledge-max-chunks"
                        label="Max Chunks per Document"
                        value={knowledgeConfig.max_chunks_per_document ?? 10000}
                        min={100}
                        max={100000}
                        step={1000}
                        onChange={(value) => set({ max_chunks_per_document: value })}
                      />
                    </div>
                    <NumberField
                      id="knowledge-max-pending"
                      label="Max Pending Tasks"
                      value={knowledgeConfig.max_pending_tasks ?? 10}
                      min={1}
                      max={50}
                      onChange={(value) => set({ max_pending_tasks: value })}
                    />
                    <ResetButton
                      onClick={() =>
                        setResetTarget({
                          section: "Limits",
                          fields: [
                            "max_upload_size_mb",
                            "max_files_per_request",
                            "max_url_download_size_mb",
                            "max_chunks_per_document",
                            "max_pending_tasks",
                          ],
                        })
                      }
                    >
                      Reset Limits to defaults
                    </ResetButton>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Reset to defaults: confirmation so a stray click does not wipe the
              user's tuned values. */}
          <AlertDialog
            open={resetTarget !== null}
            title={`Reset ${resetTarget?.section ?? ""} to defaults?`}
            description={
              `This restores the ${resetTarget?.section ?? ""} section to factory defaults. ` +
              `Your other knowledge settings are untouched. ` +
              `Fields affected: ${(resetTarget?.fields ?? []).join(", ")}`
            }
            confirmLabel="Reset section"
            onConfirm={() => void performReset()}
            onCancel={() => setResetTarget(null)}
          />
        </>
      )}
    </div>
  )
}

function ProfileWarning({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex items-start gap-1 text-[0.6875rem] text-warn-text">
      <TriangleAlertIcon className="mt-px size-3 shrink-0 text-status-warn" aria-hidden="true" />
      {children}
    </span>
  )
}

// Operator-only query transformation. Off everywhere by default. The original
// query always runs; this only adds extra retrieval legs, and the engine fails
// open on an LLM error.
function RetrievalBehaviorItem({
  knowledgeConfig,
  ragProfiles,
  onPatch,
}: {
  knowledgeConfig: KnowledgeConfigValues
  ragProfiles?: Record<string, RagProfileMeta>
  onPatch: (patch: Partial<KnowledgeConfigValues>) => void
}) {
  const qtVal = knowledgeConfig.search_query_transform ?? "off"
  const qtProfile = knowledgeConfig.rag_profile ?? "standard"
  const qtDefault = ragProfiles?.[qtProfile]?.search?.query_transform ?? "off"
  const qtLabels: Record<string, string> = {
    off: "Off",
    multi_query: "Reword the query (multi-query)",
    hyde: "Draft an ideal answer first (HyDE)",
  }
  return (
    <AccordionItem value="retrieval">
      <AccordionTrigger>
        <SectionTitle label="Retrieval behavior" />
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-4 pt-2">
          <SelectField
            id="knowledge-query-transform"
            label="Query expansion"
            helperText="Rewrites the query before searching to catch documents that word things differently. Adds one LLM call (~0.3–1.5s) per search and may not improve every corpus — leave Off unless you've seen it help. The original query still runs, and if the rewrite errors or times out the plain query is used."
            value={qtVal}
            onChange={(e) => onPatch({ search_query_transform: e.target.value })}
          >
            <NativeSelectOption value="off">Off — search the query as typed (default)</NativeSelectOption>
            <NativeSelectOption value="multi_query">
              Reword the query (multi-query) — try a few alternate phrasings
            </NativeSelectOption>
            <NativeSelectOption value="hyde">
              Draft an ideal answer first (HyDE) — match against a hypothetical passage
            </NativeSelectOption>
          </SelectField>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              Default for the {ragProfiles?.[qtProfile]?.name ?? qtProfile} profile: {qtLabels[qtDefault] ?? qtDefault}
            </span>
            {qtVal !== qtDefault && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPatch({ search_query_transform: qtDefault })}
              >
                Reset to profile default
              </Button>
            )}
          </div>
          {qtVal !== "off" && (
            <Notice kind="info" title="Adds an extra AI step per search">
              Every search now makes one model call first — about 0.3–1.5s slower, with a small added cost.
              Watch latency after enabling and switch back to Off if recall doesn&apos;t improve.
            </Notice>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export function SettingsUnavailable({ page }: { page: string }) {
  return <MessageTile>Knowledge settings are managed from the {page} page.</MessageTile>
}
