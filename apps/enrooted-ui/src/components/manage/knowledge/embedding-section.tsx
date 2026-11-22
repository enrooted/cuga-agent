/*
 * Knowledge panel > Settings > Advanced > "Embedding model": detected env
 * presets, the guided verify → re-index flow, provider / model / key / base URL,
 * test connection, and throughput & hardware.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
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
  slowText = "Still saving",
  showFailed,
}: {
  saveState: SaveState
  recentlySaved: boolean
  slowText?: string
  showFailed?: boolean
}) {
  if (saveState === "saving") return <InlineLoading>Saving…</InlineLoading>
  // saving-slow: 25 s+ into the save with no response yet. Softer copy than a
  // failure: a perfectly healthy save over a slow network should not read as broken.
  if (saveState === "saving-slow") return <InlineLoading>{slowText}</InlineLoading>
  if (saveState === "saved" && recentlySaved) return <StatusBadge tone="ok">Saved</StatusBadge>
  if (saveState === "failed" && showFailed) return <StatusBadge tone="warn">Couldn&apos;t save</StatusBadge>
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
      label="Advanced: Extra provider kwargs (optional, JSON dict)"
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
              onHint(
                `Don't put ${violations.join(", ")} here — those go in the named fields above. This box is for provider-specific extras (e.g. api_version for Azure).`
              )
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
          : "leave empty for most providers"
      }
      helperText="NOT for the model name — model has its own field above. Use this only for provider-specific extras (Azure: api_version. Bedrock: aws_region_name)."
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
  onResetRequest: (target: { section: string; fields: string[] }) => void
}) {
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
    const reach = `Reachable — ${testResult?.dim ?? "?"}-dim${
      testResult?.latency_ms != null ? `, ${testResult.latency_ms} ms` : ""
    }`
    const dismiss = () => onPresetGuideChange(null)

    // In flight: the per-file progress lives in the re-index block above; here
    // only an in-place acknowledgement, never a second progress UI.
    if (reindexActive) return <InlineLoading>Re-indexing your documents…</InlineLoading>
    if (testing) return <InlineLoading>{`Testing ${label} connection…`}</InlineLoading>
    if (testResult?.ok) {
      return knowledgeReindexNeeded ? (
        <Notice kind="success" title={reach} onClose={dismiss} actionLabel="Re-index now" onAction={onReindexNow}>
          Existing documents still use the old provider — re-index to switch them over.
        </Notice>
      ) : (
        <Notice kind="success" title={reach} onClose={dismiss}>
          Nothing to re-index yet — new uploads will use this provider.
        </Notice>
      )
    }
    if (testResult) {
      return (
        <Notice
          kind="error"
          title={`Couldn't reach ${label}`}
          onClose={dismiss}
          actionLabel="Test again"
          onAction={onTestConnection}
        >
          {`${testResult.error || "The embedder didn't respond."} Check credentials in your environment, then test again.`}
        </Notice>
      )
    }
    return (
      <Notice
        kind="info"
        title={`Verify ${label} before re-indexing`}
        onClose={dismiss}
        actionLabel="Test connection"
        onAction={onTestConnection}
      >
        {`${knowledgeConfig.embedding_provider}${knowledgeConfig.embedding_model ? ` · ${knowledgeConfig.embedding_model}` : ""} — test the embedder responds so you don't re-index against a broken connection.`}
      </Notice>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <p className="text-[0.8125rem]">
        {knowledgeConfig.embedding_provider && knowledgeConfig.embedding_provider !== "auto" ? (
          <>
            Using <strong>{knowledgeConfig.embedding_provider}</strong>
            {knowledgeConfig.embedding_model ? ` · ${knowledgeConfig.embedding_model}` : ""}
          </>
        ) : (
          "Not set up yet — pick an embedder below."
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
              `${preset.label} applied`,
              `Provider set to ${preset.default_provider}; model set to ${preset.default_model}. The engine will read credentials from the environment.`
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
          title="Couldn't save your changes"
          onClose={() => onDismissDraftSave?.()}
          actionLabel="Retry"
          onAction={() => onRetryDraftSave?.()}
        >
          {draftSaveStatus.error || "No detail returned."}
        </Notice>
      )}

      <SelectField
        id="knowledge-embedding-provider"
        label="Provider"
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
        {!isKnown && <NativeSelectOption value={p}>{`${p} — custom provider`}</NativeSelectOption>}
        <NativeSelectOption value="auto">Auto-detect — best available, chosen for you</NativeSelectOption>
        <NativeSelectOptGroup label="On your machine">
          <NativeSelectOption value="fastembed">FastEmbed — runs locally, no key</NativeSelectOption>
          <NativeSelectOption value="ollama">Ollama — local Ollama server</NativeSelectOption>
          <NativeSelectOption value="huggingface">HuggingFace — local, uses your GPU</NativeSelectOption>
        </NativeSelectOptGroup>
        <NativeSelectOptGroup label="Hosted API">
          <NativeSelectOption value="openai">
            OpenAI / compatible — OpenAI, Together, Fireworks, proxies
          </NativeSelectOption>
          <NativeSelectOption value="openrouter">OpenRouter — one key, many models</NativeSelectOption>
          <NativeSelectOption value="litellm">LiteLLM — routes to many providers</NativeSelectOption>
        </NativeSelectOptGroup>
      </SelectField>

      <TextField
        id="knowledge-embedding-model"
        label="Model"
        value={knowledgeConfig.embedding_model ?? ""}
        onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_model: e.target.value })}
        placeholder="e.g. openai/text-embedding-3-small"
        helperText={
          modelRequired
            ? "Required — include the provider prefix (e.g. openai/text-embedding-3-small)."
            : p === "ollama"
              ? "Optional — defaults to nomic-embed-text."
              : "Optional — auto-detected for this provider."
        }
        required={modelRequired}
        invalid={modelMissing}
        invalidText="Required for this provider — include the provider prefix."
      />

      {spec.needsKey && (
        <TextField
          id="knowledge-embedding-api-key"
          type="password"
          autoComplete="off"
          label={spec.keyRequired ? "API key" : "API key (optional)"}
          value={knowledgeConfig.embedding_api_key ?? ""}
          onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_api_key: e.target.value })}
          placeholder={spec.keyRequired ? "Paste OPENROUTER_API_KEY" : "Leave empty to use the provider's env var"}
          helperText={
            spec.keyRequired
              ? "Required for OpenRouter."
              : "Optional — falls back to the provider's environment variable."
          }
          required={!!spec.keyRequired}
          invalid={!!spec.keyRequired && !(knowledgeConfig.embedding_api_key || "").trim()}
          invalidText="API key is required for OpenRouter."
        />
      )}

      {spec.needsBaseUrl && (
        <TextField
          id="knowledge-embedding-base-url"
          label="Base URL (optional)"
          value={knowledgeConfig.embedding_base_url ?? ""}
          onChange={(e) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_base_url: e.target.value })}
          placeholder={
            p === "openai"
              ? "e.g. https://api.together.xyz/v1"
              : p === "ollama"
                ? "e.g. http://localhost:11434"
                : "e.g. http://localhost:4000"
          }
          helperText={
            p === "openai"
              ? "Optional — leave empty for OpenAI direct; append /v1 for most proxies."
              : p === "ollama"
                ? "Optional — defaults to http://localhost:11434."
                : "Optional — for a self-hosted LiteLLM proxy."
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
          {p === "openrouter" ? "Browse OpenRouter embedding models" : "Supported LiteLLM models"}
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
          {testing ? "Testing…" : "Test connection"}
        </Button>

        {/* The failed state is not repeated here: Retry lives once, in the
            notification above. */}
        <SaveStatePill saveState={saveState} recentlySaved={recentlySaved} slowText="Still saving — network is slow" />

        {/* Key-source chip: only while no test result is up (the test result
            is more informative when available). */}
        {!testResult && accel?.key_source?.required && (
          <StatusBadge
            tone={
              accel.key_source.source === "missing" ? "warn" : accel.key_source.source === "ui" ? "ok" : "active"
            }
            title="Where the embedding API key is being read from."
          >
            {accel.key_source.source === "ui"
              ? "Key: from UI"
              : accel.key_source.source === "missing"
                ? "Key: missing"
                : `Key: ${accel.key_source.source}`}
          </StatusBadge>
        )}
      </div>

      {/* Test connection result: the FULL error is visible (critical for
          debugging 401s etc.). */}
      {testResult && !presetGuide && (
        <Notice
          kind={testResult.ok ? "success" : "error"}
          onClose={onClearTestResult}
          title={testResult.ok ? `Connected — dim=${testResult.dim}, ${testResult.latency_ms} ms` : "Test failed"}
        >
          {testResult.ok
            ? "You can now upload documents on the Documents tab."
            : testResult.error || "No detail returned."}
        </Notice>
      )}

      <h5 className="mt-1 text-[0.8125rem] font-semibold text-muted-foreground">Throughput &amp; hardware</h5>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="knowledge-use-gpu"
            checked={knowledgeConfig.use_gpu ?? true}
            onCheckedChange={(checked) => onKnowledgeConfigChange({ ...knowledgeConfig, use_gpu: checked })}
          />
          <Label htmlFor="knowledge-use-gpu">GPU Acceleration</Label>
          <span className="text-xs text-muted-foreground">{(knowledgeConfig.use_gpu ?? true) ? "On" : "Off"}</span>
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
              title="What the running engine actually loaded for embedding inference."
            >
              {accel.fallback_to_cpu ? "GPU fallback to CPU" : `Detected: ${accel.device_label}`}
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
            label="Batch Size"
            value={knowledgeConfig.embedding_batch_size ?? 64}
            min={1}
            max={2048}
            step={16}
            helperText="Chunks per embed call. Smaller = finer progress; larger = lower per-call overhead."
            onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_batch_size: value })}
          />
          <NumberField
            id="knowledge-embedding-concurrency"
            label="Concurrency"
            value={knowledgeConfig.embedding_concurrency ?? 4}
            min={1}
            max={32}
            step={1}
            helperText="Parallel embed sub-batches for network providers (OpenAI / Ollama). No effect on local providers."
            onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, embedding_concurrency: value })}
          />
        </div>
        <NumberField
          id="knowledge-vector-insert-batch-size"
          label="Vector Insert Batch Size"
          value={knowledgeConfig.vector_insert_batch_size ?? 200}
          min={1}
          max={5000}
          step={50}
          helperText="Chunks per add_many transaction. Caps each transaction so a large document does not blow past pgvector's command_timeout or hold the HNSW write lock for long. Default 200 works for typical docs."
          onChange={(value) => onKnowledgeConfigChange({ ...knowledgeConfig, vector_insert_batch_size: value })}
        />

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => onResetRequest({ section: "Embeddings", fields: EMBEDDER_RESET_FIELDS })}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset Embedder to defaults
          </Button>
        </div>
      </div>
    </div>
  )
}
