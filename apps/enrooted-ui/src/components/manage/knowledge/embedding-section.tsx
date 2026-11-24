/*
 * Knowledge panel > Settings > Advanced > "Embedding model": detected env
 * presets, the guided verify → re-index flow, provider / model / key / base URL,
 * test connection, and throughput & hardware.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { CheckIcon, CircleAlertIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import type {
  AcceleratorStatus,
  DraftSaveStatus,
  EmbeddingsTestResult,
  EnvPreset,
  KnowledgeConfigValues,
  KnowledgeExtraParams,
  KnowledgeToast,
  ReindexProgress,
} from "@/lib/manage/knowledge-types"
import { EnvPresetsPanel } from "./env-presets-panel"
import { KNOWLEDGE_PROVIDER_ITEMS, asRecord, providerSpec } from "./knowledge-helpers"
import { InlineLoading, Notice, NumberField, SelectField, StatusBadge, TextField } from "./parts"

export type SaveState = "idle" | "saving" | "saving-slow" | "saved" | "failed"

export interface PresetGuide {
  provider: string
  label: string
  openedAt: number
}

/** A resettable settings section; its name is `settings.section.<id>` in the locale files. */
export type ResetSection = "embeddings" | "chunking" | "documentParsing" | "limits"

export const EMBEDDER_RESET_FIELDS = [
  "embedding_provider",
  "embedding_model",
  "embedding_api_key",
  "embedding_base_url",
  "embedding_extra_params",
  "use_gpu",
  "embedding_batch_size",
  "embedding_concurrency",
  "vector_insert_batch_size",
]

// Keys with dedicated fields: rejected in the extra-params JSON to prevent the
// "I put my model in the JSON" foot-gun.
const RESERVED_EXTRA_KEYS = [
  "embedding_model",
  "model",
  "embedding_api_key",
  "api_key",
  "embedding_base_url",
  "base_url",
]

function serializeExtraParams(params: KnowledgeExtraParams | undefined): string {
  return params && Object.keys(params).length > 0 ? JSON.stringify(params) : ""
}

/** What the typed text would serialize to; null while it is not a JSON dict. */
function serializeDraft(draft: string): string | null {
  if (draft.trim() === "") return ""
  try {
    const parsed = asRecord(JSON.parse(draft) as unknown)
    return parsed ? serializeExtraParams(parsed as KnowledgeExtraParams) : null
  } catch {
    return null
  }
}

/** Save-state pill; every variant maps to a real draft-PATCH lifecycle event. */
export function SaveStatePill({
  saveState,
  recentlySaved,
  slowText,
  showFailed,
}: {
  saveState: SaveState
  recentlySaved: boolean
  slowText?: string
  showFailed?: boolean
}) {
  const { t } = useTranslation("knowledge")
  if (saveState === "saving") return <InlineLoading>{t("common:state.saving")}</InlineLoading>
  // saving-slow: 25 s+ into the save with no response yet. Softer copy than a
  // failure: a perfectly healthy save over a slow network should not read as broken.
  if (saveState === "saving-slow") return <InlineLoading>{slowText ?? t("embedding.stillSaving")}</InlineLoading>
  if (saveState === "saved" && recentlySaved) return <StatusBadge tone="ok">{t("shared.saved")}</StatusBadge>
  if (saveState === "failed" && showFailed) return <StatusBadge tone="warn">{t("shared.couldntSave")}</StatusBadge>
  return null
}

/**
 * Extra provider kwargs as a JSON dict. The typed text is kept locally so
 * invalid JSON can exist while typing; only a valid dict is propagated.
 */
function ExtraParamsField({
  params,
  model,
  hint,
  onHint,
  onChange,
}: {
  params: KnowledgeExtraParams | undefined
  model: string | undefined
  hint: string | null
  onHint: (hint: string | null) => void
  onChange: (params: KnowledgeExtraParams) => void
}) {
  const { t } = useTranslation("knowledge")
  const serialized = serializeExtraParams(params)
  const [draft, setDraft] = React.useState(serialized)
  const [lastSerialized, setLastSerialized] = React.useState(serialized)
  if (serialized !== lastSerialized) {
    // The config changed (our own edit, a provider switch or a reset).
    setLastSerialized(serialized)
    if (serializeDraft(draft) !== serialized) setDraft(serialized)
  }

  return (
    <TextField
      id="knowledge-embedding-extra-params"
      label={t("embedding.extraParams.label")}
      className="font-mono"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const raw = e.target.value.trim()
        if (!raw) {
          onChange({})
          return
        }
        try {
          const parsed = asRecord(JSON.parse(raw) as unknown)
          if (parsed) {
            const violations = RESERVED_EXTRA_KEYS.filter((k) => k in parsed)
            if (violations.length > 0) {
              onHint(t("embedding.extraParams.reserved", { keys: violations.join(", ") }))
              return
            }
            onHint(null)
            onChange(parsed as KnowledgeExtraParams)
          }
        } catch {
          // Don't propagate while the user is typing invalid JSON.
        }
      }}
      placeholder={
        model?.startsWith("azure/")
          ? '{"api_version":"2024-02-15","azure_deployment":"my-deployment"}'
          : t("embedding.extraParams.placeholder")
      }
      helperText={t("embedding.extraParams.helper")}
      invalid={!!hint}
      invalidText={hint ?? undefined}
    />
  )
}

export function EmbeddingSection({
  knowledgeConfig,
  onKnowledgeConfigChange,
  envPresets,
  presetGuide,
  onPresetGuideChange,
  testing,
  testResult,
  onClearTestResult,
  onTestConnection,
  extraParamsHint,
  onExtraParamsHint,
  accel,
  baseUrlError,
  saveState,
  recentlySaved,
  draftSaveStatus,
  onRetryDraftSave,
  onDismissDraftSave,
  knowledgeReindexNeeded,
  knowledgeReindexing,
  reindexProgress,
  onReindexNow,
  onPresetApplied,
  onToast,
  onResetRequest,
}: {
  knowledgeConfig: KnowledgeConfigValues
  onKnowledgeConfigChange: (config: KnowledgeConfigValues) => void
  envPresets: EnvPreset[] | null
  presetGuide: PresetGuide | null
  onPresetGuideChange: (guide: PresetGuide | null) => void
  testing: boolean
  testResult: EmbeddingsTestResult | null
  onClearTestResult: () => void
  onTestConnection: () => void
  extraParamsHint: string | null
  onExtraParamsHint: (hint: string | null) => void
  accel: AcceleratorStatus | null
  baseUrlError: string | null
  saveState: SaveState
  recentlySaved: boolean
  draftSaveStatus?: DraftSaveStatus
  onRetryDraftSave?: () => void
  onDismissDraftSave?: () => void
  knowledgeReindexNeeded?: boolean
  knowledgeReindexing?: boolean
  reindexProgress: ReindexProgress | null
  onReindexNow: () => void
  onPresetApplied?: () => void
  onToast?: KnowledgeToast
  onResetRequest: (target: { section: ResetSection; fields: string[] }) => void
}) {
  const { t } = useTranslation("knowledge")
  const p = knowledgeConfig.embedding_provider ?? "auto"
  const spec = providerSpec(p)
  const modelRequired = !!spec.modelRequired
  const modelMissing = modelRequired && !(knowledgeConfig.embedding_model || "").trim()
  // Legacy/unknown saved provider: surface it as a real option so the select
  // shows the true value instead of coercing to Auto-detect.
  const isKnown = p === "auto" || KNOWLEDGE_PROVIDER_ITEMS.some((it) => it.id === p)

  const renderPresetGuide = () => {
    if (!presetGuide) return null
    // One guarded action ("verify, then re-index"), not a multi-step journey: a
    // single notification whose lone action button IS the current step. The
    // "Re-index now" button only exists once the connection test passes.
    const label = presetGuide.label
    const reindexActive = knowledgeReindexing || !!(reindexProgress && !reindexProgress.done)
    const reach =
      testResult?.latency_ms != null
        ? t("embedding.guide.reachableLatency", { dim: testResult?.dim ?? "?", ms: testResult.latency_ms })
        : t("embedding.guide.reachable", { dim: testResult?.dim ?? "?" })
    const dismiss = () => onPresetGuideChange(null)

    // In flight: the per-file progress lives in the re-index block above; here
    // only an in-place acknowledgement, never a second progress UI.
    if (reindexActive) return <InlineLoading>{t("embedding.guide.reindexing")}</InlineLoading>
    if (testing) return <InlineLoading>{t("embedding.guide.testing", { label })}</InlineLoading>
    if (testResult?.ok) {
      return knowledgeReindexNeeded ? (
        <Notice
          kind="success"
          title={reach}
          onClose={dismiss}
          actionLabel={t("shared.reindexNow")}
          onAction={onReindexNow}
        >
          {t("embedding.guide.stillOld")}
        </Notice>
      ) : (
        <Notice kind="success" title={reach} onClose={dismiss}>
          {t("embedding.guide.nothingToReindex")}
        </Notice>
      )
    }
    if (testResult) {
      return (
        <Notice
          kind="error"
          title={t("embedding.guide.unreachableTitle", { label })}
          onClose={dismiss}
          actionLabel={t("embedding.guide.testAgain")}
          onAction={onTestConnection}
        >
          {t("embedding.guide.unreachableBody", { error: testResult.error || t("embedding.guide.noResponse") })}
        </Notice>
      )
    }
    return (
      <Notice
        kind="info"
        title={t("embedding.guide.verifyTitle", { label })}
        onClose={dismiss}
        actionLabel={t("embedding.testConnection")}
        onAction={onTestConnection}
      >
        {t("embedding.guide.verifyBody", {
          embedder: `${knowledgeConfig.embedding_provider}${knowledgeConfig.embedding_model ? ` · ${knowledgeConfig.embedding_model}` : ""}`,
        })}
      </Notice>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <p className="text-[0.8125rem]">
        {knowledgeConfig.embedding_provider && knowledgeConfig.embedding_provider !== "auto" ? (
          <Trans
            t={t}
            i18nKey={knowledgeConfig.embedding_model ? "embedding.usingModel" : "embedding.using"}
            values={{ provider: knowledgeConfig.embedding_provider, model: knowledgeConfig.embedding_model }}
            components={{ strong: <strong /> }}
          />
        ) : (
          t("embedding.notSetUp")
        )}
      </p>

      {envPresets && envPresets.length > 0 && (
        <EnvPresetsPanel
          presets={envPresets}
          currentProvider={knowledgeConfig.embedding_provider ?? "auto"}
          currentModel={knowledgeConfig.embedding_model ?? ""}
          onApply={(preset) => {
            onPresetApplied?.()
            onKnowledgeConfigChange({
              ...knowledgeConfig,
              embedding_provider: preset.default_provider,
              embedding_model: preset.default_model,
              embedding_api_key: "",
              embedding_base_url: "",
              embedding_extra_params: {},
            })
            onToast?.(
              "success",
              t("embedding.presetApplied.title", { label: preset.label }),
              t("embedding.presetApplied.body", {
                provider: preset.default_provider,
                model: preset.default_model,
              })
            )
            // Start the guided verify → re-index flow (one notification right
            // below the presets list).
            onPresetGuideChange({
              provider: preset.default_provider,
              label: preset.label.replace(" (via LiteLLM)", ""),
              openedAt: Date.now(),
            })
          }}
          onFocusProviderSelect={() => {
            const el = document.getElementById("knowledge-embedding-provider")
            el?.focus()
            el?.scrollIntoView({ behavior: "smooth", block: "center" })
          }}
        />
      )}

      {renderPresetGuide()}

      {/* Save-failure recovery: a failed autosave is never silent or unrecoverable. */}
      {saveState === "failed" && draftSaveStatus?.kind === "failed" && (
        <Notice
          kind="error"
          title={t("embedding.saveFailedTitle")}
          onClose={() => onDismissDraftSave?.()}
          actionLabel={t("shared.retry")}
          onAction={() => onRetryDraftSave?.()}
        >
          {draftSaveStatus.error || t("shared.noDetail")}
        </Notice>
      )}

      <SelectField
        id="knowledge-embedding-provider"
        label={t("embedding.provider.label")}
        value={p}
        onChange={(e) => {
          const newProvider = e.target.value
          if (newProvider === p) return // no-op re-select
          // CRITICAL: switching providers ALWAYS resets the provider-specific
          // fields. Otherwise a previously typed base_url (e.g. a LiteLLM proxy
          // URL) silently bleeds into the next provider's request and sends
          // your key to the wrong server; a stale model likewise carries across.
          onKnowledgeConfigChange({
            ...knowledgeConfig,
            embedding_provider: newProvider,
            embedding_base_url: "",
            embedding_api_key: "",
            embedding_extra_params: {},
            embedding_model: "",
          })
        }}
      >
        {!isKnown && <NativeSelectOption value={p}>{t("embedding.provider.custom", { provider: p })}</NativeSelectOption>}
        <NativeSelectOption value="auto">{t("embedding.provider.auto")}</NativeSelectOption>
        <NativeSelectOptGroup label={t("embedding.provider.groupLocal")}>
          <NativeSelectOption value="fastembed">{t("embedding.provider.fastembed")}</NativeSelectOption>
          <NativeSelectOption value="ollama">{t("embedding.provider.ollama")}</NativeSelectOption>
          <NativeSelectOption value="huggingface">{t("embedding.provider.huggingface")}</NativeSelectOption>
        </NativeSelectOptGroup>
        <NativeSelectOptGroup label={t("embedding.provider.groupHosted")}>
          <NativeSelectOption value="openai">{t("embedding.provider.openai")}</NativeSelectOption>
          <NativeSelectOption value="openrouter">{t("embedding.provider.openrouter")}</NativeSelectOption>
          <NativeSelectOption value="litellm">{t("embedding.provider.litellm")}</NativeSelectOption>
        </NativeSelectOptGroup>
      </SelectField>

      <TextField
        id="knowledge-embedding-model"
        label={t("embedding.model.label")}
        value={knowledgeConfig.embedding_model ?? ""}
        onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_model: e.target.value })}
        placeholder={t("embedding.model.placeholder")}
        helperText={
          modelRequired
            ? t("embedding.model.helperRequired")
            : p === "ollama"
              ? t("embedding.model.helperOllama")
              : t("embedding.model.helperOptional")
        }
        required={modelRequired}
        invalid={modelMissing}
        invalidText={t("embedding.model.invalid")}
      />

      {spec.needsKey && (
        <TextField
          id="knowledge-embedding-api-key"
          type="password"
          autoComplete="off"
          label={spec.keyRequired ? t("embedding.apiKey.label") : t("embedding.apiKey.labelOptional")}
          value={knowledgeConfig.embedding_api_key ?? ""}
          onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_api_key: e.target.value })}
          placeholder={
            spec.keyRequired ? t("embedding.apiKey.placeholderRequired") : t("embedding.apiKey.placeholderOptional")
          }
          helperText={
            spec.keyRequired
              ? t("embedding.apiKey.helperRequired")
              : t("embedding.apiKey.helperOptional")
          }
          required={!!spec.keyRequired}
          invalid={!!spec.keyRequired && !(knowledgeConfig.embedding_api_key || "").trim()}
          invalidText={t("embedding.apiKey.invalid")}
        />
      )}

      {spec.needsBaseUrl && (
        <TextField
          id="knowledge-embedding-base-url"
          label={t("embedding.baseUrl.label")}
          value={knowledgeConfig.embedding_base_url ?? ""}
          onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_base_url: e.target.value })}
          placeholder={
            p === "openai"
              ? t("embedding.baseUrl.placeholderOpenai")
              : p === "ollama"
                ? t("embedding.baseUrl.placeholderOllama")
                : t("embedding.baseUrl.placeholderLitellm")
          }
          helperText={
            p === "openai"
              ? t("embedding.baseUrl.helperOpenai")
              : p === "ollama"
                ? t("embedding.baseUrl.helperOllama")
                : t("embedding.baseUrl.helperLitellm")
          }
          invalid={!!baseUrlError}
          invalidText={baseUrlError ?? undefined}
        />
      )}

      {(p === "openrouter" || p === "litellm") && (
        <a
          href={
            p === "openrouter"
              ? "https://openrouter.ai/models?output_modalities=embeddings"
              : "https://docs.litellm.ai/docs/embedding/supported_embedding"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-link underline"
        >
          {p === "openrouter" ? t("embedding.links.openrouter") : t("embedding.links.litellm")}
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      )}

      {/* Action row: Test connection + status chips */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={testing || !knowledgeConfig.embedding_provider}
          onClick={onTestConnection}
        >
          {testing && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {testing ? t("embedding.testing") : t("embedding.testConnection")}
        </Button>

        {/* The failed state is not repeated here: Retry lives once, in the
            notification above. */}
        <SaveStatePill saveState={saveState} recentlySaved={recentlySaved} slowText={t("embedding.stillSavingSlow")} />

        {/* Key-source chip: only while no test result is up (the test result
            is more informative when available). */}
        {!testResult && accel?.key_source?.required && (
          <StatusBadge
            tone={
              accel.key_source.source === "missing" ? "warn" : accel.key_source.source === "ui" ? "ok" : "active"
            }
            title={t("embedding.keySource.title")}
          >
            {accel.key_source.source === "ui"
              ? t("embedding.keySource.ui")
              : accel.key_source.source === "missing"
                ? t("embedding.keySource.missing")
                : t("embedding.keySource.other", { source: accel.key_source.source })}
          </StatusBadge>
        )}
      </div>

      {/* Test connection result: the FULL error is visible (critical for
          debugging 401s etc.). */}
      {testResult && !presetGuide && (
        <Notice
          kind={testResult.ok ? "success" : "error"}
          onClose={onClearTestResult}
          title={
            testResult.ok
              ? t("embedding.testResult.connected", {
                  dim: String(testResult.dim),
                  ms: String(testResult.latency_ms),
                })
              : t("embedding.testResult.failed")
          }
        >
          {testResult.ok
            ? t("embedding.testResult.okBody")
            : testResult.error || t("shared.noDetail")}
        </Notice>
      )}

      <h5 className="mt-1 text-[0.8125rem] font-semibold text-muted-foreground">{t("embedding.hardware.heading")}</h5>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="knowledge-use-gpu"
            checked={knowledgeConfig.use_gpu ?? true}
            onCheckedChange={(checked) => onKnowledgeConfigChange({ ...knowledgeConfig, use_gpu: checked })}
          />
          <Label htmlFor="knowledge-use-gpu">{t("embedding.hardware.gpu")}</Label>
          <span className="text-xs text-muted-foreground">{(knowledgeConfig.use_gpu ?? true) ? t("shared.on") : t("shared.off")}</span>
          {/* Honest device label: OK when the GPU is engaged, warning when the
              GPU was requested but only the CPU loaded, neutral when not
              relevant (cloud provider). */}
          {accel && (
            <StatusBadge
              tone={accel.fallback_to_cpu ? "warn" : accel.embedding_relevant ? "ok" : "neutral"}
              icon={
                accel.fallback_to_cpu ? (
                  <CircleAlertIcon className="text-status-warn" />
                ) : accel.embedding_relevant ? (
                  <CheckIcon className="text-status-ok" />
                ) : (
                  false
                )
              }
              title={t("embedding.hardware.deviceTitle")}
            >
              {accel.fallback_to_cpu
                ? t("embedding.hardware.fallback")
                : t("embedding.hardware.detected", { device: accel.device_label })}
            </StatusBadge>
          )}
        </div>

        {(knowledgeConfig.embedding_provider === "litellm" || knowledgeConfig.embedding_provider === "openai") && (
          <ExtraParamsField
            params={knowledgeConfig.embedding_extra_params}
            model={knowledgeConfig.embedding_model}
            hint={extraParamsHint}
            onHint={onExtraParamsHint}
            onChange={(params) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_extra_params: params })}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="knowledge-embedding-batch-size"
            label={t("embedding.batchSize.label")}
            value={knowledgeConfig.embedding_batch_size ?? 64}
            min={1}
            max={2048}
            step={16}
            helperText={t("embedding.batchSize.helper")}
            onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_batch_size: value })}
          />
          <NumberField
            id="knowledge-embedding-concurrency"
            label={t("embedding.concurrency.label")}
            value={knowledgeConfig.embedding_concurrency ?? 4}
            min={1}
            max={32}
            step={1}
            helperText={t("embedding.concurrency.helper")}
            onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_concurrency: value })}
          />
        </div>
        <NumberField
          id="knowledge-vector-insert-batch-size"
          label={t("embedding.vectorInsert.label")}
          value={knowledgeConfig.vector_insert_batch_size ?? 200}
          min={1}
          max={5000}
          step={50}
          helperText={t("embedding.vectorInsert.helper")}
          onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, vector_insert_batch_size: value })}
        />

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => onResetRequest({ section: "embeddings", fields: EMBEDDER_RESET_FIELDS })}
          >
            <RotateCcwIcon data-icon="inline-start" />
            {t("embedding.reset")}
          </Button>
        </div>
      </div>
    </div>
  )
}
