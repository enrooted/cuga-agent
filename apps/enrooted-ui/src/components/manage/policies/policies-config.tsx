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
        name: "New Intent Guard",
        description: "Blocks or modifies specific user intents",
        policy_type: "intent_guard",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "intent", case_sensitive: false, operator: "and" }],
        response: { response_type: "natural_language", content: "This action is not allowed." },
        allow_override: false,
        priority: 50,
      }
    case "playbook":
      return {
        id: `playbook_${stamp}`,
        name: "New Playbook",
        description: "Step-by-step guidance for a task",
        policy_type: "playbook",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "intent", case_sensitive: false, operator: "and" }],
        markdown_content: "# Task Guide\n\n## Steps:\n\n1. First step\n2. Second step\n3. Third step",
        steps: [
          { step_number: 1, instruction: "First step", expected_outcome: "Step 1 complete", tools_allowed: [] },
        ],
        priority: 50,
      }
    case "tool_guide":
      return {
        id: `tool_guide_${stamp}`,
        name: "New Tool Guide",
        description: "Add additional context to tool descriptions",
        policy_type: "tool_guide",
        enabled: true,
        triggers: [{ type: "always" }],
        target_tools: ["*"],
        target_apps: undefined,
        guide_content: "## Additional Guidelines\n\n- Follow best practices\n- Consider security implications",
        prepend: false,
        priority: 50,
      }
    case "tool_approval":
      return {
        id: `tool_approval_${stamp}`,
        name: "New Tool Approval",
        description: "Require approval before executing specific tools",
        policy_type: "tool_approval",
        enabled: true,
        triggers: [],
        required_tools: [],
        required_apps: undefined,
        approval_message: "This tool requires your approval before execution.",
        show_code_preview: true,
        auto_approve_after: undefined,
        priority: 50,
      }
    case "output_formatter":
      return {
        id: `output_formatter_${stamp}`,
        name: "New Output Formatter",
        description: "Format the final AI message output",
        policy_type: "output_formatter",
        enabled: true,
        triggers: [{ type: "keyword", value: [], target: "agent_response", case_sensitive: false, operator: "and" }],
        format_type: "markdown",
        format_config: "Format the response in a clear, structured way with proper headings and bullet points.",
        priority: 50,
      }
  }
}

const SECTIONS: readonly {
  type: PolicyType
  tab: string
  heading: string
  addLabel: string
  empty: string
  namePlaceholder: string
  /** Kept from the original so input ids stay distinct per policy type. */
  idPrefix: string
}[] = [
  {
    type: "intent_guard",
    tab: "Intent Guards",
    heading: "Intent Guards",
    addLabel: "Add Intent Guard",
    empty: 'No intent guards configured. Click "Add Intent Guard" to create one.',
    namePlaceholder: "Policy Name",
    idPrefix: "",
  },
  {
    type: "playbook",
    tab: "Playbooks",
    heading: "Playbooks",
    addLabel: "Add Playbook",
    empty: 'No playbooks configured. Click "Add Playbook" to create one.',
    namePlaceholder: "Playbook Name",
    idPrefix: "playbook-",
  },
  {
    type: "tool_guide",
    tab: "Tool Guide",
    heading: "Tool Guide Policies",
    addLabel: "Add Tool Guide",
    empty: 'No tool guide policies configured. Click "Add Tool Guide" to create one.',
    namePlaceholder: "Policy Name",
    idPrefix: "toolguide-",
  },
  {
    type: "tool_approval",
    tab: "Tool Approval",
    heading: "Tool Approval Policies",
    addLabel: "Add Tool Approval",
    empty: 'No tool approval policies configured. Click "Add Tool Approval" to create one.',
    namePlaceholder: "Policy Name",
    idPrefix: "toolapproval-",
  },
  {
    type: "output_formatter",
    tab: "Output Formatter",
    heading: "Output Formatter Policies",
    addLabel: "Add Output Formatter",
    empty: 'No output formatter policies configured. Click "Add Output Formatter" to create one.',
    namePlaceholder: "Policy Name",
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
  if (generating) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Spinner />
        Generating...
      </span>
    )
  }
  const guarded = allTargetToolsHaveGuard(policy)
  const guardsOff = guarded && policy.guards_enabled === false
  const concrete = hasConcreteTargetTools(policy)
  const label = guardsOff
    ? "Guards generated but are disabled"
    : guarded
      ? "View tool guards"
      : !policy.enabled
        ? "Policy is disabled"
        : !policiesEnabled
          ? "Policies disabled"
          : !concrete
            ? "Select specific target tools to generate a guard"
            : "Generate tool guard"
  const disabled = guarded ? false : anyGenerating || !policiesEnabled || !policy.enabled || !concrete
  return (
    <Tooltip>
      {/* The span keeps the explanation reachable while the button is disabled. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="ghost"
          size="icon-sm"
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
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// ── the editor ─────────────────────────────────────────────────────────────
export function PoliciesConfig({ onClose, draftMode = false, onSave, agentId }: PoliciesConfigProps) {
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
    return () => pending.forEach((t) => window.clearTimeout(t))
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
      setLoadError(error instanceof Error ? error.message : "Network error occurred")
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
      notify({ kind: "error", title: "Error", subtitle: "Failed to export policies. Check console for details." })
    }
  }

  const importPolicies = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    try {
      const text = await file.text().catch(() => {
        throw new Error("Failed to read file")
      })
      input.value = ""

      const importedData: unknown = JSON.parse(text)
      if (!isRecord(importedData) || !Array.isArray(importedData.policies)) {
        notify({ kind: "error", title: "Invalid import", subtitle: 'Expected a JSON file with a "policies" array.' })
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
        notify({ kind: "error", title: "Import aborted", subtitle: "Failed to load existing configuration" })
        return
      }
      if (response.ok) {
        setSavedToolGuideSnapshots(toolGuideSnapshots(policies))
        notify({
          kind: "success",
          title: "Policies imported",
          subtitle: `${policies.length} ${policies.length === 1 ? "policy" : "policies"} imported and saved`,
        })
        onSave?.(normalizedConfig)
      } else {
        const data: unknown = await response.json().catch(() => ({}))
        const pick = (key: string) => (isRecord(data) && typeof data[key] === "string" && data[key] ? data[key] : "")
        notify({
          kind: "error",
          title: "Import failed",
          subtitle: pick("error") || pick("message") || "Failed to save imported policies",
        })
      }
    } catch (error) {
      console.error("[PoliciesConfig] Import error:", error)
      input.value = ""
      notify({
        kind: "error",
        title: "Import failed",
        subtitle: error instanceof Error ? error.message : "Invalid JSON or file format",
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
        const message = await policiesApi.readErrorMessage(response, "Failed to load existing configuration")
        console.error("Failed to load existing config before save:", message)
        failed("Save aborted", message)
        return
      }
      if (!response.ok) {
        failed("Save failed", await policiesApi.readErrorMessage(response, "Failed to save policies"))
        return
      }

      const count = normalizedConfig.policies.length
      setSaveStatus("success")
      notify({
        kind: "success",
        title: "Policies saved successfully",
        subtitle: `${count} ${count === 1 ? "policy" : "policies"} saved`,
      })
      setSavedToolGuideSnapshots(toolGuideSnapshots(current.policies))
      onSave?.(normalizedConfig)
      later(() => {
        setSaveStatus("idle")
        onClose()
      }, 1500)
    } catch (error) {
      failed("Save failed", error instanceof Error ? error.message : "Network error occurred")
    }
  }

  // ── tool guard generation ────────────────────────────────────────────────
  const generateToolGuard = async (policyId: string) => {
    if (generatingToolGuardPolicyId !== null) return

    const policy = configRef.current.policies.find((p) => p.id === policyId)
    if (!policy || policy.policy_type !== "tool_guide") {
      notify({ kind: "error", title: "Cannot generate guard", subtitle: "Policy not found or not a tool guide" })
      return
    }
    // The server generates from the saved policy, so unsaved edits must be saved first.
    if (savedToolGuideSnapshots[policy.id] !== toolGuideSnapshot(policy)) {
      notify({ kind: "warning", title: "Save required", subtitle: "Save the tool guide before generating a guard." })
      return
    }
    if (!hasConcreteTargetTools(policy)) {
      notify({
        kind: "error",
        title: "Cannot generate guard",
        subtitle: "Select specific target tools to generate a guard.",
      })
      return
    }

    setGeneratingToolGuardPolicyId(policyId)
    try {
      const response = await policiesApi.generateToolGuards(policyId, draftMode)
      if (!response.ok) {
        notify({
          kind: "error",
          title: "Generation failed",
          subtitle: await policiesApi.readErrorMessage(response, "Failed to generate tool guard", ["message"]),
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
          title: synced ? "Guard generated" : "Guard generated (sync pending)",
          subtitle: synced
            ? `Tool guard created for: ${successTools.join(", ")}`
            : `${successTools.join(", ")} generated in policy storage but config sync failed. ${result.sync_error ?? "Refresh and save before publishing."}`,
        })
      } else if (successTools.length > 0 && failedTools.length > 0) {
        notify({
          kind: "warning",
          title: "Partial success",
          subtitle: `Generated for ${successTools.join(", ")}. Failed: ${failedTools.join(", ")}${
            synced ? "" : `. Config sync failed: ${result.sync_error ?? "refresh before publishing"}`
          }`,
        })
      } else {
        notify({
          kind: "error",
          title: "Generation failed",
          subtitle: `Failed to generate guards for: ${failedTools.join(", ")}`,
        })
      }
    } catch (error) {
      notify({
        kind: "error",
        title: "Generation failed",
        subtitle: error instanceof Error ? error.message : "Network error occurred",
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
      namePlaceholder: section.namePlaceholder,
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
          <DialogTitle>Policies Configuration</DialogTitle>
          <DialogDescription className="sr-only">
            Intent guards, playbooks, tool guides, tool approvals and output formatters of this agent.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-2">
          {isLoading ? (
            <div className="flex flex-col gap-4" role="status" aria-label="Loading policies…">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-8 w-2/3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : loadError !== null ? (
            <Alert className="*:[svg]:text-status-warn">
              <TriangleAlertIcon />
              <AlertTitle>Policies could not be loaded</AlertTitle>
              <AlertDescription>
                <p>{loadError}</p>
                <p>Saving is disabled so the stored policies are not overwritten with an empty list.</p>
                <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void loadConfig()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-semibold">Global Policy System</h3>
                  <p className="text-sm text-muted-foreground">
                    Master switch for all policy enforcement ({config.policies.length} policies configured)
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={exportPolicies} disabled={config.policies.length === 0}>
                    <DownloadIcon data-icon="inline-start" />
                    Export
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
                    <UploadIcon data-icon="inline-start" />
                    Import
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
                      aria-label="Enable Policy System"
                      checked={config.enablePolicies}
                      onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enablePolicies: checked }))}
                    />
                    <span className="w-16 text-sm text-muted-foreground" aria-hidden="true">
                      {config.enablePolicies ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
              </section>

              <Tabs defaultValue={SECTIONS[0].type}>
                <div className="overflow-x-auto">
                  <TabsList aria-label="Policy Types">
                    {SECTIONS.map((section) => (
                      <TabsTrigger key={section.type} value={section.type} className="px-2.5">
                        {section.tab} ({config.policies.filter((p) => p.policy_type === section.type).length})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {SECTIONS.map((section) => {
                  const policies = config.policies.filter((p) => p.policy_type === section.type)
                  return (
                    <TabsContent key={section.type} value={section.type} className="flex flex-col gap-4 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-medium">{section.heading}</h4>
                        <Button variant="outline" size="sm" onClick={() => addPolicy(section.type)} disabled={locked}>
                          <PlusIcon data-icon="inline-start" />
                          {section.addLabel}
                        </Button>
                      </div>
                      {policies.length === 0 ? (
                        <Empty className="rounded-xl border border-dashed">
                          <EmptyHeader>
                            <EmptyTitle>Nothing here yet</EmptyTitle>
                            <EmptyDescription>{section.empty}</EmptyDescription>
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
            Cancel
          </Button>
          <Button onClick={() => void saveConfig()} disabled={isLoading || saving || loadError !== null}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving && "Saving..."}
            {saveStatus === "idle" && "Save Changes"}
            {saveStatus === "success" && "Saved!"}
            {saveStatus === "error" && "Error!"}
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
