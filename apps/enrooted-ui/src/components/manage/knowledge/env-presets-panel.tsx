/*
 * "Detected in your environment": embedding providers found in the host's
 * .env / shell, each applicable with one click.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/EnvPresetsPanel.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { InfoIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { EnvPreset } from "@/lib/manage/knowledge-types"
import { StatusBadge } from "./parts"

function providerMonogram(id: string): string {
  switch (id) {
    case "openai":
      return "OA"
    case "openrouter":
      return "OR"
    case "watsonx":
      return "Wx"
    case "azure":
      return "Az"
    case "cohere":
      return "Co"
    case "gemini":
      return "Gm"
    case "voyage":
      return "Vy"
    case "mistral":
      return "Ms"
    case "togetherai":
      return "Tg"
    case "jina":
      return "Ja"
    default:
      return id.slice(0, 2).toUpperCase()
  }
}

function providerCategory(id: string): "Cloud" | "Enterprise" {
  return id === "watsonx" || id === "azure" ? "Enterprise" : "Cloud"
}

// Human-readable label for env var keys shown in the detection tooltip.
function envKeyLabel(name: string): string {
  const map: Record<string, string> = {
    WATSONX_URL: "URL",
    WATSONX_API_BASE: "URL",
    WATSONX_PROJECT_ID: "Project ID",
    AZURE_API_BASE: "Endpoint",
    AZURE_API_VERSION: "API version",
    OPENAI_BASE_URL: "Base URL",
  }
  return map[name] || name
}

// Truncate long values (UUIDs, URLs) for the compact tooltip.
function truncate(s: string, max = 48): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function isPresetActive(preset: EnvPreset, currentProvider: string, currentModel: string): boolean {
  if (preset.default_provider !== currentProvider) return false
  // For multi-preset providers (litellm hosts watsonx/azure/cohere/...)
  // distinguish by model prefix. A user who switches the specific watsonx model
  // is still on the Watsonx preset's creds, so prefix match keeps "Active" stable.
  if (preset.default_provider === "litellm") {
    return preset.default_model.split("/")[0] === (currentModel || "").split("/")[0]
  }
  // Single-preset providers (openai, openrouter): require an exact model match,
  // otherwise a custom model typed by hand would show a misleading "Active".
  return preset.default_model === currentModel
}

const infoButtonClass =
  "inline-flex cursor-help rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

function InfoTooltip({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" className={infoButtonClass} aria-label={label} />}>
        <InfoIcon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{children ?? label}</TooltipContent>
    </Tooltip>
  )
}

// Per-row info tooltip: the default model plus every non-secret detected env
// value (URL, project ID, region ...). Secrets are filtered server-side and
// never reach this component, so this is safe to render verbatim.
function RowInfoTooltip({ model, envValues }: { model: string; envValues?: Record<string, string> }) {
  const entries = Object.entries(envValues || {})
  const ariaLabel = [
    `Default model: ${model}`,
    ...entries.map(([k, v]) => `${envKeyLabel(k)}: ${truncate(v)}`),
  ].join(" — ")
  return (
    <InfoTooltip label={ariaLabel}>
      <div className="grid gap-0.5 text-left leading-snug">
        <div>
          <strong>Model:</strong> {model}
        </div>
        {entries.map(([k, v]) => (
          <div key={k}>
            <strong>{envKeyLabel(k)}:</strong> {truncate(v)}
          </div>
        ))}
      </div>
    </InfoTooltip>
  )
}

export function EnvPresetsPanel({
  presets,
  currentProvider,
  currentModel,
  onApply,
  onFocusProviderSelect,
}: {
  presets: EnvPreset[]
  currentProvider: string
  currentModel: string
  onApply: (preset: EnvPreset) => void
  onFocusProviderSelect?: () => void
}) {
  // Render nothing when NO preset has any env signal. Local providers never
  // appear here: they live in the Provider select; the link below points there.
  const rows = presets.filter((p) => Object.values(p.env_vars ?? {}).some(Boolean))
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h5 className="text-xs font-medium text-muted-foreground">Detected in your environment</h5>
        <InfoTooltip label="Providers found in your .env or shell. One click sets the provider; credentials stay on this machine." />
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((preset) => {
          const active = isPresetActive(preset, currentProvider, currentModel)
          const missingText = `Missing: ${(preset.missing ?? []).join(", ")}`
          return (
            <li key={preset.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <span
                aria-hidden="true"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-[0.625rem] font-semibold tracking-wide"
              >
                {providerMonogram(preset.id)}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {preset.label.replace(" (via LiteLLM)", "")}
                </span>
                <RowInfoTooltip model={preset.default_model} envValues={preset.env_values} />
              </span>
              <StatusBadge tone="active">{providerCategory(preset.id)}</StatusBadge>
              {active ? (
                <StatusBadge tone="ok">Active</StatusBadge>
              ) : preset.ready ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onApply(preset)}>
                  Use
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={<button type="button" className={infoButtonClass} aria-label={missingText} />}
                  >
                    <StatusBadge tone="neutral">Set up</StatusBadge>
                  </TooltipTrigger>
                  <TooltipContent side="left">{missingText}</TooltipContent>
                </Tooltip>
              )}
            </li>
          )
        })}
      </ul>
      {onFocusProviderSelect && (
        <button
          type="button"
          className="w-fit cursor-pointer rounded-sm text-left text-xs text-link underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onFocusProviderSelect}
        >
          Or run locally with Fastembed or Ollama — no keys needed.
        </button>
      )}
    </div>
  )
}
