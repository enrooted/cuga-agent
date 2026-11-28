/*
 * Policies editor (modal): intent guards, playbooks, tool guides (with tool
 * guard generation), tool approvals and output formatters, plus the global
 * policy switch and JSON import/export.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */

import * as React from "react"
import {
  DownloadIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import i18n from "@/i18n"
import * as policiesApi from "@/lib/manage/policies-api"
import type {
  AppInfo,
  IntentGuardPolicy,
  OutputFormatterPolicy,
  PlaybookPolicy,
  PoliciesConfigData,
  Policy,
  PolicyType,
  ToolApprovalPolicy,
  ToolGuardData,
  ToolGuardGenerateResult,
  ToolGuidePolicy,
  ToolInfo,
} from "@/lib/manage/policies-api"

import { PolicyCard } from "./policy-card"
import {
  IntentGuardEditor,
  IntentGuardSummary,
  OutputFormatterEditor,
  OutputFormatterSummary,
  PlaybookEditor,
  PlaybookSummary,
  ToolApprovalEditor,
  ToolApprovalSummary,
  ToolGuideEditor,
  ToolGuideSummary,
} from "./policy-editors"
import { ToolGuardDialog } from "./tool-guard-dialog"

export type {
  AppInfo,
  IntentGuardPolicy,
  OutputFormatterPolicy,
  PlaybookPolicy,
  PlaybookStep,
  PoliciesConfigData,
  Policy,
  PolicyTrigger,
  PolicyType,
  ToolApprovalPolicy,
  ToolGuardData,
  ToolGuidePolicy,
  ToolInfo,
} from "@/lib/manage/policies-api"

export interface PoliciesConfigProps {
  /** Called when the dialog is dismissed (close button, Escape, Cancel) and 1.5 s after a successful save. */
  onClose: () => void
  /** Read and write the agent's draft (PATCH …/draft/policies) instead of the published config. */
  draftMode?: boolean
  /** Called with the saved policies section after a successful save or import. */
  onSave?: (policies: { enablePolicies: boolean; policies: unknown[] }) => void
  /**
   * Not in the Carbon component. When set, config and tool requests carry this
   * `agent_id`; when left out the requests are the original ones (the server
   * resolves the default agent; the tool list uses `getKnowledgeAgentId()`).
   */
  agentId?: string
}

type SaveStatus = "idle" | "saving" | "success" | "error"
type Notice = { kind: "success" | "error" | "warning"; title: string; subtitle: string }

const notify = ({ kind, title, subtitle }: Notice) => toast[kind](title, { description: subtitle, duration: 5000 })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

// ── tool guide ↔ guard state ───────────────────────────────────────────────
const toolGuideSnapshot = (policy: ToolGuidePolicy) =>
  JSON.stringify({
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    priority: policy.priority,
    target_tools: policy.target_tools ?? [],
    target_apps: policy.target_apps ?? null,
    guide_content: policy.guide_content ?? "",
    prepend: policy.prepend ?? false,
    tool_guards: policy.tool_guards ?? {},
  })

const toolGuideSnapshots = (policies: Policy[]) => {
  const snapshots: Record<string, string> = {}
  for (const policy of policies) {
    if (policy.policy_type === "tool_guide") snapshots[policy.id] = toolGuideSnapshot(policy)
  }
  return snapshots
}

const hasConcreteTargetTools = (policy: ToolGuidePolicy) => {
  const targetTools = policy.target_tools ?? []
  return targetTools.length > 0 && !targetTools.includes("*")
}

const allTargetToolsHaveGuard = (policy: ToolGuidePolicy) =>
  hasConcreteTargetTools(policy) &&
  (policy.target_tools ?? []).every((tool) => Boolean(policy.tool_guards?.[tool]?.policy_code))

// ── new policy templates ───────────────────────────────────────────────────
function newPolicy(type: PolicyType): Policy {
  const stamp = Date.now()
  switch (type) {
    case "intent_guard":
      return {
        id: `guard_${stamp}`,
        name: i18n.t("policies:defaults.intentGuard.name"),
        description: i18n.t("policies:defaults.intentGuard.description"),
        policy_type: "intent_guard",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "intent", case_sensitive: false, operator: "and" }],
        response: { response_type: "natural_language", content: i18n.t("policies:defaults.intentGuard.response") },
        allow_override: false,
        priority: 50,
      }
    case "playbook":
      return {
        id: `playbook_${stamp}`,
        name: i18n.t("policies:defaults.playbook.name"),
        description: i18n.t("policies:defaults.playbook.description"),
        policy_type: "playbook",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "intent", case_sensitive: false, operator: "and" }],
        markdown_content: i18n.t("policies:defaults.playbook.markdown"),
        steps: [
          {
            step_number: 1,
            instruction: i18n.t("policies:defaults.playbook.stepInstruction"),
            expected_outcome: i18n.t("policies:defaults.playbook.stepOutcome"),
            tools_allowed: [],
          },
        ],
        priority: 50,
      }
    case "tool_guide":
      return {
        id: `tool_guide_${stamp}`,
        name: i18n.t("policies:defaults.toolGuide.name"),
        description: i18n.t("policies:defaults.toolGuide.description"),
        policy_type: "tool_guide",
        enabled: true,
        triggers: [{ type: "always" }],
        target_tools: ["*"],
        target_apps: undefined,
        guide_content: i18n.t("policies:defaults.toolGuide.content"),
        prepend: false,
        priority: 50,
      }
    case "tool_approval":
      return {
        id: `tool_approval_${stamp}`,
        name: i18n.t("policies:defaults.toolApproval.name"),
        description: i18n.t("policies:defaults.toolApproval.description"),
        policy_type: "tool_approval",
        enabled: true,
        triggers: [],
        required_tools: [],
        required_apps: undefined,
        approval_message: i18n.t("policies:defaults.toolApproval.message"),
        show_code_preview: true,
        auto_approve_after: undefined,
        priority: 50,
      }
    case "output_formatter":
      return {
        id: `output_formatter_${stamp}`,
        name: i18n.t("policies:defaults.outputFormatter.name"),
        description: i18n.t("policies:defaults.outputFormatter.description"),
        policy_type: "output_formatter",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "agent_response", case_sensitive: false, operator: "and" }],
        format_type: "markdown",
        format_config: i18n.t("policies:defaults.outputFormatter.config"),
        priority: 50,
      }
  }
}

const SECTIONS: readonly {
  type: PolicyType
  /** Translation group under `sections` (tab, heading, add, empty, namePlaceholder). */
  key: "intentGuard" | "playbook" | "toolGuide" | "toolApproval" | "outputFormatter"
  /** Kept from the original so input ids stay distinct per policy type. */
  idPrefix: string
}[] = [
  {
    type: "intent_guard",
    key: "intentGuard",
    idPrefix: "",
  },
  {
    type: "playbook",
    key: "playbook",
    idPrefix: "playbook-",
  },
  {
    type: "tool_guide",
    key: "toolGuide",
    idPrefix: "toolguide-",
  },
  {
    type: "tool_approval",
    key: "toolApproval",
    idPrefix: "toolapproval-",
  },
  {
    type: "output_formatter",
    key: "outputFormatter",
    idPrefix: "outputformatter-",
  },
]

// ── tool guard button ──────────────────────────────────────────────────────
function ToolGuardAction({
  policy,
  policiesEnabled,
  generating,
  anyGenerating,
  onView,
  onGenerate,
}: {
  policy: ToolGuidePolicy
  policiesEnabled: boolean
  generating: boolean
  anyGenerating: boolean
  onView: () => void
  onGenerate: () => void
}) {
  const { t } = useTranslation("policies")
  if (generating) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Spinner />
        {t("guardAction.generating")}
      </span>
    )
  }
  const guarded = allTargetToolsHaveGuard(policy)
  const guardsOff = guarded && policy.guards_enabled === false
  const concrete = hasConcreteTargetTools(policy)
  const label = guardsOff
    ? t("guardAction.guardsOff")
    : guarded
      ? t("guardAction.view")
      : !policy.enabled
        ? t("guardAction.policyDisabled")
        : !policiesEnabled
          ? t("guardAction.policiesDisabled")
          : !concrete
            ? t("guardAction.selectTools")
            : t("guardAction.generate")
  const disabled = guarded ? false : anyGenerating || !policiesEnabled || !policy.enabled || !concrete
  const showGenerateLabel = !guarded && policiesEnabled && policy.enabled && concrete
  return (
    <Tooltip>
      {/* The span keeps the explanation reachable while the button is disabled. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="ghost"
          size={showGenerateLabel ? "sm" : "icon-sm"}
          aria-label={label}
          disabled={disabled}
          onClick={guarded ? onView : onGenerate}
        >
          {guardsOff ? (
            <ShieldOffIcon className="text-status-warn" />
          ) : guarded ? (
            <ShieldCheckIcon className="text-status-ok" />
          ) : (
            <ShieldIcon />
          )}
          {showGenerateLabel && label}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// ── the editor ─────────────────────────────────────────────────────────────
export function PoliciesConfig({ onClose, draftMode = false, onSave, agentId }: PoliciesConfigProps) {
  const { t } = useTranslation("policies")
  const importInputRef = React.useRef<HTMLInputElement>(null)
  const [config, setConfig] = React.useState<PoliciesConfigData>({ enablePolicies: true, policies: [] })
  // Latest config for async handlers (save runs after a blur that may still add a tag).
  const configRef = React.useRef(config)
  configRef.current = config

  const [expandedPolicy, setExpandedPolicy] = React.useState<string | null>(null)
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle")
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [availableTools, setAvailableTools] = React.useState<ToolInfo[]>([])
  const [availableApps, setAvailableApps] = React.useState<AppInfo[]>([])
  const [toolsLoading, setToolsLoading] = React.useState(false)
  const [savedToolGuideSnapshots, setSavedToolGuideSnapshots] = React.useState<Record<string, string>>({})
  const [generatingToolGuardPolicyId, setGeneratingToolGuardPolicyId] = React.useState<string | null>(null)
  const [viewingGuardPolicyId, setViewingGuardPolicyId] = React.useState<string | null>(null)

  const timers = React.useRef<number[]>([])
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const loadConfig = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await policiesApi.getManageConfig(draftMode, agentId)
      if (!response.ok) {
        setLoadError(await policiesApi.readErrorMessage(response, `HTTP ${response.status}`))
        return
      }
      const data: unknown = await response.json()
      const configData = isRecord(data) && isRecord(data.config) ? data.config : {}
      const policiesData = isRecord(configData.policies) ? configData.policies : {}
      const policies = policiesApi.normalizePolicies(Array.isArray(policiesData.policies) ? policiesData.policies : [])
      setConfig({
        enablePolicies: typeof policiesData.enablePolicies === "boolean" ? policiesData.enablePolicies : true,
        policies,
      })
      setSavedToolGuideSnapshots(toolGuideSnapshots(policies))
    } catch (error) {
      console.error("[PoliciesConfig] Error loading config:", error)
      // i18n.t, not the hook: a language switch must not reload the config and drop unsaved edits.
      setLoadError(error instanceof Error ? error.message : i18n.t("policies:toast.networkError"))
    } finally {
      setIsLoading(false)
    }
  }, [draftMode, agentId])

  const loadTools = React.useCallback(async () => {
    setToolsLoading(true)
    try {
      const response = await policiesApi.getToolsList(draftMode, agentId)
      if (response.ok) {
        const data: unknown = await response.json()
        if (isRecord(data)) {
          setAvailableTools(Array.isArray(data.tools) ? (data.tools as ToolInfo[]) : [])
          setAvailableApps(Array.isArray(data.apps) ? (data.apps as AppInfo[]) : [])
        }
      }
    } catch (error) {
      console.error("[PoliciesConfig] Error loading tools:", error)
    } finally {
      setToolsLoading(false)
    }
  }, [draftMode, agentId])

  React.useEffect(() => {
    void loadConfig()
    void loadTools()
  }, [loadConfig, loadTools])

  // ── close ────────────────────────────────────────────────────────────────
  const saving = saveStatus === "saving"
  const closeModal = () => {
    if (!saving) onClose()
  }

  // ── export / import ──────────────────────────────────────────────────────
  const exportPolicies = () => {
    try {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `policies-export-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[PoliciesConfig] Export error:", error)
      notify({ kind: "error", title: t("toast.errorTitle"), subtitle: t("toast.exportFailed") })
    }
  }

  const importPolicies = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    try {
      const text = await file.text().catch(() => {
        throw new Error(t("toast.readFailed"))
      })
      input.value = ""

      const importedData: unknown = JSON.parse(text)
      if (!isRecord(importedData) || !Array.isArray(importedData.policies)) {
        notify({ kind: "error", title: t("toast.invalidImportTitle"), subtitle: t("toast.invalidImportBody") })
        return
      }

      const policies = policiesApi.normalizePolicies(importedData.policies)
      const normalizedConfig: PoliciesConfigData = {
        enablePolicies:
          typeof importedData.enablePolicies === "boolean"
            ? importedData.enablePolicies
            : configRef.current.enablePolicies,
        policies,
      }
      setConfig(normalizedConfig)

      // An import is saved right away, like in the original.
      const { response, loadFailed } = await policiesApi.savePolicies(normalizedConfig, draftMode, agentId)
      if (loadFailed) {
        notify({ kind: "error", title: t("toast.importAbortedTitle"), subtitle: t("toast.loadExistingFailed") })
        return
      }
      if (response.ok) {
        setSavedToolGuideSnapshots(toolGuideSnapshots(policies))
        notify({
          kind: "success",
          title: t("toast.importedTitle"),
          subtitle: t("toast.importedBody", { count: policies.length }),
        })
        onSave?.(normalizedConfig)
      } else {
        const data: unknown = await response.json().catch(() => ({}))
        const pick = (key: string) => (isRecord(data) && typeof data[key] === "string" && data[key] ? data[key] : "")
        notify({
          kind: "error",
          title: t("toast.importFailedTitle"),
          subtitle: pick("error") || pick("message") || t("toast.saveImportedFailed"),
        })
      }
    } catch (error) {
      console.error("[PoliciesConfig] Import error:", error)
      input.value = ""
      notify({
        kind: "error",
        title: t("toast.importFailedTitle"),
        subtitle: error instanceof Error ? error.message : t("toast.invalidFile"),
      })
    }
  }

  // ── save ─────────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    // Leaving a tag box adds what is still typed in it; let that land first.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise((resolve) => setTimeout(resolve, 50))
    setSaveStatus("saving")

    const failed = (title: string, subtitle: string) => {
      setSaveStatus("error")
      notify({ kind: "error", title, subtitle })
      later(() => setSaveStatus("idle"), 2000)
    }

    try {
      const current = configRef.current
      const normalizedConfig: PoliciesConfigData = {
        enablePolicies: current.enablePolicies,
        policies: policiesApi.normalizePolicies(current.policies),
      }

      const { response, loadFailed } = await policiesApi.savePolicies(normalizedConfig, draftMode, agentId)
      if (loadFailed) {
        // Nothing was written: without the existing config a save would wipe the other sections.
        const message = await policiesApi.readErrorMessage(response, t("toast.loadExistingFailed"))
        console.error("Failed to load existing config before save:", message)
        failed(t("toast.saveAbortedTitle"), message)
        return
      }
      if (!response.ok) {
        failed(t("toast.saveFailedTitle"), await policiesApi.readErrorMessage(response, t("toast.saveFailed")))
        return
      }

      const count = normalizedConfig.policies.length
      setSaveStatus("success")
      notify({
        kind: "success",
        title: t("toast.savedTitle"),
        subtitle: t("toast.savedBody", { count }),
      })
      setSavedToolGuideSnapshots(toolGuideSnapshots(current.policies))
      onSave?.(normalizedConfig)
      later(() => {
        setSaveStatus("idle")
        onClose()
      }, 1500)
    } catch (error) {
      failed(t("toast.saveFailedTitle"), error instanceof Error ? error.message : t("toast.networkError"))
    }
  }

  // ── tool guard generation ────────────────────────────────────────────────
  const generateToolGuard = async (policyId: string) => {
    if (generatingToolGuardPolicyId !== null) return

    const policy = configRef.current.policies.find((p) => p.id === policyId)
    if (!policy || policy.policy_type !== "tool_guide") {
      notify({ kind: "error", title: t("toast.cannotGenerateTitle"), subtitle: t("toast.notToolGuide") })
      return
    }
    // The server generates from the saved policy, so unsaved edits must be saved first.
    if (savedToolGuideSnapshots[policy.id] !== toolGuideSnapshot(policy)) {
      notify({ kind: "warning", title: t("toast.saveRequiredTitle"), subtitle: t("toast.saveRequiredBody") })
      return
    }
    if (!hasConcreteTargetTools(policy)) {
      notify({
        kind: "error",
        title: t("toast.cannotGenerateTitle"),
        subtitle: t("toast.selectTools"),
      })
      return
    }

    setGeneratingToolGuardPolicyId(policyId)
    try {
      const response = await policiesApi.generateToolGuards(policyId, draftMode)
      if (!response.ok) {
        notify({
          kind: "error",
          title: t("toast.generationFailedTitle"),
          subtitle: await policiesApi.readErrorMessage(response, t("toast.generationFailed"), ["message"]),
        })
        return
      }

      const result = (await response.json()) as ToolGuardGenerateResult
      const synced = result.config_synced !== false
      if (!synced) {
        const toolGuards: Record<string, ToolGuardData> | undefined = result.tool_guards
        if (toolGuards) {
          setConfig((prev) => ({
            ...prev,
            policies: prev.policies.map((p) =>
              p.id === policyId && p.policy_type === "tool_guide" ? { ...p, tool_guards: toolGuards } : p
            ),
          }))
        }
      } else {
        await loadConfig()
      }

      const results = Array.isArray(result.results) ? result.results : []
      const successTools = results.filter((r) => r.status === "ok").map((r) => r.tool)
      const failedTools = results.filter((r) => r.status === "error").map((r) => r.tool)

      if (successTools.length > 0 && failedTools.length === 0) {
        notify({
          kind: synced ? "success" : "warning",
          title: synced ? t("toast.generatedTitle") : t("toast.generatedUnsyncedTitle"),
          subtitle: synced
            ? t("toast.generatedBody", { tools: successTools.join(", ") })
            : t("toast.generatedUnsyncedBody", {
                tools: successTools.join(", "),
                detail: result.sync_error ?? t("toast.refreshAndSave"),
              }),
        })
      } else if (successTools.length > 0 && failedTools.length > 0) {
        notify({
          kind: "warning",
          title: t("toast.partialTitle"),
          subtitle: synced
            ? t("toast.partialBody", { succeeded: successTools.join(", "), failed: failedTools.join(", ") })
            : t("toast.partialUnsyncedBody", {
                succeeded: successTools.join(", "),
                failed: failedTools.join(", "),
                detail: result.sync_error ?? t("toast.refreshBeforePublishing"),
              }),
        })
      } else {
        notify({
          kind: "error",
          title: t("toast.generationFailedTitle"),
          subtitle: t("toast.generationFailedFor", { tools: failedTools.join(", ") }),
        })
      }
    } catch (error) {
      notify({
        kind: "error",
        title: t("toast.generationFailedTitle"),
        subtitle: error instanceof Error ? error.message : t("toast.networkError"),
      })
    } finally {
      setGeneratingToolGuardPolicyId(null)
    }
  }

  // ── list edits ───────────────────────────────────────────────────────────
  const addPolicy = (type: PolicyType) =>
    setConfig((prev) => ({ ...prev, policies: [...prev.policies, newPolicy(type)] }))

  const updatePolicy = (id: string, updates: Partial<Policy>) =>
    setConfig((prev) => ({
      ...prev,
      policies: prev.policies.map((policy) => (policy.id === id ? ({ ...policy, ...updates } as Policy) : policy)),
    }))

  const removePolicy = (id: string) =>
    setConfig((prev) => ({ ...prev, policies: prev.policies.filter((p) => p.id !== id) }))

  const locked = !config.enablePolicies
  const viewingGuardPolicy = viewingGuardPolicyId
    ? config.policies.find((p): p is ToolGuidePolicy => p.id === viewingGuardPolicyId && p.policy_type === "tool_guide")
    : undefined

  const renderPolicy = (policy: Policy, section: (typeof SECTIONS)[number]) => {
    const expanded = expandedPolicy === policy.id
    const common = {
      domId: `${section.idPrefix}${policy.id}`,
      name: policy.name,
      namePlaceholder: t(`sections.${section.key}.namePlaceholder`),
      enabled: policy.enabled,
      expanded,
      disabled: locked,
      onEnabledChange: (enabled: boolean) => updatePolicy(policy.id, { enabled }),
      onNameChange: (name: string) => updatePolicy(policy.id, { name }),
      onToggleExpanded: () => setExpandedPolicy(expanded ? null : policy.id),
      onRemove: () => removePolicy(policy.id),
    }
    const tools = { availableTools, availableApps, toolsLoading }

    switch (policy.policy_type) {
      case "intent_guard":
        return (
          <PolicyCard key={policy.id} {...common} summary={<IntentGuardSummary policy={policy} />}>
            <IntentGuardEditor
              policy={policy}
              disabled={locked}
              onUpdate={(updates: Partial<IntentGuardPolicy>) => updatePolicy(policy.id, updates)}
            />
          </PolicyCard>
        )
      case "playbook":
        return (
          <PolicyCard key={policy.id} {...common} summary={<PlaybookSummary policy={policy} />}>
            <PlaybookEditor
              policy={policy}
              disabled={locked}
              onUpdate={(updates: Partial<PlaybookPolicy>) => updatePolicy(policy.id, updates)}
            />
          </PolicyCard>
        )
      case "tool_guide":
        return (
          <PolicyCard
            key={policy.id}
            {...common}
            summary={<ToolGuideSummary policy={policy} guarded={allTargetToolsHaveGuard(policy)} />}
            actions={
              <ToolGuardAction
                policy={policy}
                policiesEnabled={config.enablePolicies}
                generating={generatingToolGuardPolicyId === policy.id}
                anyGenerating={generatingToolGuardPolicyId !== null}
                onView={() => setViewingGuardPolicyId(policy.id)}
                onGenerate={() => void generateToolGuard(policy.id)}
              />
            }
          >
            <ToolGuideEditor
              policy={policy}
              disabled={locked}
              onUpdate={(updates: Partial<ToolGuidePolicy>) => updatePolicy(policy.id, updates)}
              {...tools}
            />
          </PolicyCard>
        )
      case "tool_approval":
        return (
          <PolicyCard key={policy.id} {...common} summary={<ToolApprovalSummary policy={policy} />}>
            <ToolApprovalEditor
              policy={policy}
              disabled={locked}
              onUpdate={(updates: Partial<ToolApprovalPolicy>) => updatePolicy(policy.id, updates)}
              {...tools}
            />
          </PolicyCard>
        )
      case "output_formatter":
        return (
          <PolicyCard key={policy.id} {...common} summary={<OutputFormatterSummary policy={policy} />}>
            <OutputFormatterEditor
              policy={policy}
              disabled={locked}
              onUpdate={(updates: Partial<OutputFormatterPolicy>) => updatePolicy(policy.id, updates)}
            />
          </PolicyCard>
        )
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()} disablePointerDismissal>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("config.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("config.description")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-2">
          {isLoading ? (
            <div className="flex flex-col gap-4" role="status" aria-label={t("config.loading")}>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-8 w-2/3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : loadError !== null ? (
            <Alert className="*:[svg]:text-status-warn">
              <TriangleAlertIcon />
              <AlertTitle>{t("config.loadFailedTitle")}</AlertTitle>
              <AlertDescription>
                <p>{loadError}</p>
                <p>{t("config.loadFailedBody")}</p>
                <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void loadConfig()}>
                  {t("common:action.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-semibold">{t("config.globalTitle")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("config.globalBody", { count: config.policies.length })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={exportPolicies} disabled={config.policies.length === 0}>
                    <DownloadIcon data-icon="inline-start" />
                    {t("config.export")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
                    <UploadIcon data-icon="inline-start" />
                    {t("config.import")}
                  </Button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => void importPolicies(e)}
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      id="enable-policies-toggle"
                      aria-label={t("config.enableSystem")}
                      checked={config.enablePolicies}
                      onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enablePolicies: checked }))}
                    />
                    <span className="w-16 text-sm text-muted-foreground" aria-hidden="true">
                      {config.enablePolicies ? t("config.enabled") : t("config.disabled")}
                    </span>
                  </div>
                </div>
              </section>

              <Tabs defaultValue={SECTIONS[0].type}>
                <div className="overflow-x-auto">
                  <TabsList aria-label={t("config.policyTypes")}>
                    {SECTIONS.map((section) => (
                      <TabsTrigger key={section.type} value={section.type} className="px-2.5">
                        {t(`sections.${section.key}.tab`, {
                          total: config.policies.filter((p) => p.policy_type === section.type).length,
                        })}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {SECTIONS.map((section) => {
                  const policies = config.policies.filter((p) => p.policy_type === section.type)
                  return (
                    <TabsContent key={section.type} value={section.type} className="flex flex-col gap-4 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-medium">{t(`sections.${section.key}.heading`)}</h4>
                        <Button variant="outline" size="sm" onClick={() => addPolicy(section.type)} disabled={locked}>
                          <PlusIcon data-icon="inline-start" />
                          {t(`sections.${section.key}.add`)}
                        </Button>
                      </div>
                      {policies.length === 0 ? (
                        <Empty className="rounded-xl border border-dashed">
                          <EmptyHeader>
                            <EmptyTitle>{t("config.emptyTitle")}</EmptyTitle>
                            <EmptyDescription>{t(`sections.${section.key}.empty`)}</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <ul className="flex flex-col gap-3">{policies.map((policy) => renderPolicy(policy, section))}</ul>
                      )}
                    </TabsContent>
                  )
                })}
              </Tabs>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t("common:action.cancel")}
          </Button>
          <Button onClick={() => void saveConfig()} disabled={isLoading || saving || loadError !== null}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving && t("config.saving")}
            {saveStatus === "idle" && t("config.saveChanges")}
            {saveStatus === "success" && t("config.saved")}
            {saveStatus === "error" && t("config.saveError")}
          </Button>
        </DialogFooter>

        {viewingGuardPolicy && (
          <ToolGuardDialog
            policy={viewingGuardPolicy}
            policiesEnabled={config.enablePolicies}
            onGuardsEnabledChange={(guards_enabled) => updatePolicy(viewingGuardPolicy.id, { guards_enabled })}
            onClose={() => setViewingGuardPolicyId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
