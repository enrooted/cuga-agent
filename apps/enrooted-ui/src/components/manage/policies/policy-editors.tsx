/*
 * The five policy editors (expanded card body) and their collapsed summaries.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0). Field labels, placeholders, helper texts,
 * defaults and the way each control rewrites `triggers` are kept as they were.
 */

import { PlusIcon, ShieldCheckIcon, ShieldOffIcon, Trash2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  AppInfo,
  IntentGuardPolicy,
  OutputFormatterPolicy,
  PlaybookPolicy,
  PolicyTrigger,
  ToolApprovalPolicy,
  ToolGuidePolicy,
  ToolInfo,
} from "@/lib/manage/policies-api"

import {
  CheckboxField,
  KEYWORD_OPERATOR_OPTIONS,
  MultiSelectField,
  NumberField,
  SelectField,
  TagInput,
  TextAreaField,
  ThresholdSlider,
} from "./policy-fields"

interface EditorProps<T> {
  policy: T
  /** The global policy switch is off. */
  disabled: boolean
  onUpdate: (updates: Partial<T>) => void
}

interface ToolEditorProps<T> extends EditorProps<T> {
  availableTools: ToolInfo[]
  availableApps: AppInfo[]
  toolsLoading: boolean
}

// ── shared trigger helpers ─────────────────────────────────────────────────
export const keywordTriggerOf = (triggers: PolicyTrigger[]) => triggers.find((t) => t.type === "keyword")

export const keywordsOf = (triggers: PolicyTrigger[]): string[] => {
  const trigger = keywordTriggerOf(triggers)
  return trigger && Array.isArray(trigger.value) ? trigger.value : []
}

const valuesOf = (trigger: PolicyTrigger | undefined): string[] =>
  trigger ? (Array.isArray(trigger.value) ? trigger.value : trigger.value ? [trigger.value] : []) : []

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`

const toolItems = (tools: ToolInfo[]) => tools.map((tool) => ({ id: tool.name, text: `${tool.name} (${tool.app})` }))
const appItems = (apps: AppInfo[]) => apps.map((app) => ({ id: app.name, text: `${app.name} (${app.type})` }))

/**
 * "Trigger Keywords (Optional)" of intent guards and output formatters: the
 * keyword trigger exists only while there is at least one keyword.
 */
function OptionalKeywords({
  idSuffix,
  triggers,
  target,
  helperText,
  operatorHelperText,
  disabled,
  onTriggersChange,
}: {
  idSuffix: string
  triggers: PolicyTrigger[]
  target: string
  helperText: string
  operatorHelperText: string
  disabled: boolean
  onTriggersChange: (triggers: PolicyTrigger[]) => void
}) {
  const keywordTrigger = keywordTriggerOf(triggers)
  const keywords = keywordsOf(triggers)
  return (
    <>
      <TagInput
        labelText="Trigger Keywords (Optional)"
        values={keywords}
        onChange={(newKeywords) => {
          const updated = triggers.filter((t) => t.type !== "keyword")
          if (newKeywords.length > 0) {
            updated.push({
              type: "keyword",
              value: newKeywords,
              target,
              case_sensitive: false,
              operator: keywordTrigger?.operator || "and",
            })
          }
          onTriggersChange(updated)
        }}
        placeholder="Type keyword and press Enter or comma"
        disabled={disabled}
        helperText={helperText}
      />
      {keywords.length > 1 && (
        <SelectField
          id={`keyword-operator-${idSuffix}`}
          label="Keyword Matching"
          value={keywordTrigger?.operator || "and"}
          options={KEYWORD_OPERATOR_OPTIONS}
          onChange={(operator) => onTriggersChange(triggers.map((t) => (t.type === "keyword" ? { ...t, operator } : t)))}
          disabled={disabled}
          helperText={operatorHelperText}
        />
      )}
    </>
  )
}

/** Optional natural-language trigger of intent guards and output formatters. */
function OptionalNaturalLanguageTrigger({
  idSuffix,
  triggers,
  target,
  helperText,
  disabled,
  onTriggersChange,
}: {
  idSuffix: string
  triggers: PolicyTrigger[]
  target: string
  helperText: string
  disabled: boolean
  onTriggersChange: (triggers: PolicyTrigger[]) => void
}) {
  const nlTrigger = triggers.find((t) => t.type === "natural_language")
  if (!nlTrigger) {
    return (
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onTriggersChange([...triggers, { type: "natural_language", value: [], target, threshold: 0.7 }])
          }
          disabled={disabled}
        >
          <PlusIcon data-icon="inline-start" />
          Add Natural Language Trigger
        </Button>
      </div>
    )
  }
  return (
    <>
      <TagInput
        labelText="Natural Language Triggers"
        values={valuesOf(nlTrigger)}
        onChange={(value) =>
          onTriggersChange(triggers.map((t) => (t.type === "natural_language" ? { ...t, value } : t)))
        }
        placeholder="Type natural language trigger and press Enter"
        disabled={disabled}
        helperText={helperText}
      />
      <ThresholdSlider
        id={`threshold-${idSuffix}`}
        threshold={nlTrigger.threshold}
        onChange={(threshold) =>
          onTriggersChange(triggers.map((t) => (t.type === "natural_language" ? { ...t, threshold } : t)))
        }
        disabled={disabled}
      />
      <div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onTriggersChange(triggers.filter((t) => t.type !== "natural_language"))}
          disabled={disabled}
        >
          <Trash2Icon data-icon="inline-start" />
          Remove Natural Language Trigger
        </Button>
      </div>
    </>
  )
}

// ── intent guard ───────────────────────────────────────────────────────────
export function IntentGuardSummary({ policy }: { policy: IntentGuardPolicy }) {
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      {keywords.length > 0 && <span>{plural(keywords.length, "keyword")}</span>}
      {policy.triggers.some((t) => t.type === "natural_language") && <span>AI trigger</span>}
      <span>Priority: {policy.priority}</span>
    </>
  )
}

export function IntentGuardEditor({ policy, disabled, onUpdate }: EditorProps<IntentGuardPolicy>) {
  return (
    <>
      <TextAreaField
        id={`description-${policy.id}`}
        label="Description"
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        placeholder="What this policy does..."
        rows={2}
        disabled={disabled}
      />
      <OptionalKeywords
        idSuffix={policy.id}
        triggers={policy.triggers}
        target="intent"
        helperText="Type keywords and press Enter or comma to add. Click × to remove."
        operatorHelperText="Choose whether all keywords or any keyword should trigger this policy"
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <OptionalNaturalLanguageTrigger
        idSuffix={policy.id}
        triggers={policy.triggers}
        target="intent"
        helperText="Type natural language triggers and press Enter to add. AI will match similar intents."
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <TextAreaField
        id={`response-${policy.id}`}
        label="Response Message"
        value={policy.response?.content ?? ""}
        onChange={(content) => onUpdate({ response: { ...policy.response, content } })}
        placeholder="This action is not allowed."
        rows={3}
        disabled={disabled}
      />
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <NumberField
          id={`priority-${policy.id}`}
          label="Priority"
          value={policy.priority}
          emptyValue={0}
          onChange={(value) => onUpdate({ priority: value ?? 0 })}
          min={0}
          max={100}
          disabled={disabled}
          helperText="Higher priority policies are checked first"
        />
        <div className="sm:pt-7">
          <CheckboxField
            label="Allow Override"
            checked={policy.allow_override}
            onChange={(allow_override) => onUpdate({ allow_override })}
            disabled={disabled}
            helperText="User can bypass this policy"
          />
        </div>
      </div>
    </>
  )
}

// ── playbook ───────────────────────────────────────────────────────────────
export function PlaybookSummary({ policy }: { policy: PlaybookPolicy }) {
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <span>{plural((policy.steps ?? []).length, "step")}</span>
      {policy.triggers.length > 0 && (
        <span>{policy.triggers[0].type === "natural_language" ? "AI trigger" : plural(keywords.length, "keyword")}</span>
      )}
    </>
  )
}

const PLAYBOOK_TRIGGER_OPTIONS = [
  { value: "keyword", text: "Keywords (Exact Match)" },
  { value: "natural_language", text: "Natural Language (AI Match)" },
] as const

export function PlaybookEditor({ policy, disabled, onUpdate }: EditorProps<PlaybookPolicy>) {
  const first: PolicyTrigger | undefined = policy.triggers[0]
  const keywordTrigger = keywordTriggerOf(policy.triggers)
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <TextAreaField
        id={`description-playbook-${policy.id}`}
        label="Description"
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        placeholder="What this playbook guides the user through..."
        rows={2}
        disabled={disabled}
      />
      <SelectField
        id={`trigger-type-playbook-${policy.id}`}
        label="Trigger Type"
        value={first?.type === "natural_language" ? "natural_language" : "keyword"}
        options={PLAYBOOK_TRIGGER_OPTIONS}
        onChange={(triggerType) =>
          onUpdate({
            triggers:
              triggerType === "natural_language"
                ? [{ type: "natural_language", value: [], target: "intent", threshold: 0.7 }]
                : [{ type: "keyword", value: [], target: "intent", case_sensitive: false, operator: "and" }],
          })
        }
        disabled={disabled}
      />

      {first?.type === "keyword" && (
        <>
          <TagInput
            labelText="Trigger Keywords"
            values={keywords}
            onChange={(value) =>
              onUpdate({ triggers: policy.triggers.map((t) => (t.type === "keyword" ? { ...t, value } : t)) })
            }
            placeholder="Type keyword and press Enter or comma"
            disabled={disabled}
            helperText="Type keywords and press Enter or comma to add."
          />
          {keywords.length > 1 && (
            <SelectField
              id={`keyword-operator-playbook-${policy.id}`}
              label="Keyword Matching"
              value={keywordTrigger?.operator || "and"}
              options={KEYWORD_OPERATOR_OPTIONS}
              onChange={(operator) =>
                onUpdate({ triggers: policy.triggers.map((t) => (t.type === "keyword" ? { ...t, operator } : t)) })
              }
              disabled={disabled}
              helperText="Choose whether all keywords or any keyword should trigger this playbook"
            />
          )}
        </>
      )}

      {first?.type === "natural_language" && (
        <>
          <TagInput
            labelText="Natural Language Triggers"
            values={valuesOf(first)}
            onChange={(value) =>
              onUpdate({ triggers: policy.triggers.map((t, idx) => (idx === 0 ? { ...t, value } : t)) })
            }
            placeholder="Type trigger and press Enter"
            disabled={disabled}
            helperText="Type natural language triggers and press Enter to add. AI will match similar user requests."
          />
          <ThresholdSlider
            id={`threshold-playbook-${policy.id}`}
            threshold={first.threshold}
            onChange={(threshold) =>
              onUpdate({ triggers: policy.triggers.map((t, idx) => (idx === 0 ? { ...t, threshold } : t)) })
            }
            disabled={disabled}
          />
        </>
      )}

      <TextAreaField
        id={`markdown-playbook-${policy.id}`}
        label="Markdown Content"
        value={policy.markdown_content}
        onChange={(markdown_content) => onUpdate({ markdown_content })}
        placeholder={"# Task Guide\n\n## Steps:\n\n1. First step\n2. Second step"}
        rows={8}
        mono
        disabled={disabled}
        helperText="Markdown-formatted guidance that will be shown to the agent"
      />
      <NumberField
        id={`priority-playbook-${policy.id}`}
        label="Priority"
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText="Higher priority playbooks are checked first"
      />
    </>
  )
}

// ── tool guide ─────────────────────────────────────────────────────────────
export function ToolGuideSummary({ policy, guarded }: { policy: ToolGuidePolicy; guarded: boolean }) {
  const targetTools = policy.target_tools ?? []
  return (
    <>
      <span>{targetTools.includes("*") ? "All tools" : `${targetTools.length} tool(s)`}</span>
      {policy.target_apps && policy.target_apps.length > 0 && <span>{policy.target_apps.length} app(s)</span>}
      <span>Priority: {policy.priority}</span>
      {guarded &&
        (policy.guards_enabled === false ? (
          <Badge variant="outline">
            <ShieldOffIcon className="text-status-warn" aria-hidden="true" />
            Guards disabled
          </Badge>
        ) : (
          <Badge variant="outline">
            <ShieldCheckIcon className="text-status-ok" aria-hidden="true" />
            Guarded
          </Badge>
        ))}
    </>
  )
}

export function ToolGuideEditor({
  policy,
  disabled,
  onUpdate,
  availableTools,
  availableApps,
  toolsLoading,
}: ToolEditorProps<ToolGuidePolicy>) {
  return (
    <>
      <TextAreaField
        id={`description-toolguide-${policy.id}`}
        label="Description"
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <MultiSelectField
        id={`target-tools-${policy.id}`}
        label="Target Tools"
        placeholder={toolsLoading ? "Loading tools..." : "Select tools to enrich"}
        items={toolItems(availableTools)}
        value={policy.target_tools ?? []}
        onChange={(target_tools) => onUpdate({ target_tools })}
        disabled={disabled || toolsLoading}
        helperText="Select specific tools to enrich, or use * to enrich all tools"
        wildcardLabel={toolsLoading ? undefined : "All tools (*)"}
      />
      <MultiSelectField
        id={`target-apps-${policy.id}`}
        label="Target Apps (Optional)"
        placeholder={toolsLoading ? "Loading apps..." : "Select apps (optional)"}
        items={appItems(availableApps)}
        value={policy.target_apps ?? []}
        onChange={(ids) => onUpdate({ target_apps: ids.length > 0 ? ids : undefined })}
        disabled={disabled || toolsLoading}
        helperText="Optionally filter by app name"
      />
      <TextAreaField
        id={`guide-content-${policy.id}`}
        label="Guide Content (Markdown)"
        value={policy.guide_content}
        onChange={(guide_content) => onUpdate({ guide_content })}
        placeholder={"## Additional Guidelines\n\n- Follow best practices\n- Consider security"}
        rows={6}
        mono
        disabled={disabled}
        helperText="Markdown content to add to tool descriptions"
      />
      <CheckboxField
        label="Prepend content (add before existing description)"
        checked={policy.prepend}
        onChange={(prepend) => onUpdate({ prepend })}
        disabled={disabled}
      />
      <NumberField
        id={`priority-toolguide-${policy.id}`}
        label="Priority"
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText="Higher priority guides are applied first"
      />
    </>
  )
}

// ── tool approval ──────────────────────────────────────────────────────────
export function ToolApprovalSummary({ policy }: { policy: ToolApprovalPolicy }) {
  const requiredTools = policy.required_tools ?? []
  return (
    <>
      <span>
        {requiredTools.length === 0
          ? "No tools selected"
          : requiredTools.includes("*")
            ? "All tools"
            : `${requiredTools.length} tool(s)`}
      </span>
      {policy.required_apps && policy.required_apps.length > 0 && <span>{policy.required_apps.length} app(s)</span>}
      <span>Priority: {policy.priority}</span>
    </>
  )
}

export function ToolApprovalEditor({
  policy,
  disabled,
  onUpdate,
  availableTools,
  availableApps,
  toolsLoading,
}: ToolEditorProps<ToolApprovalPolicy>) {
  return (
    <>
      <TextAreaField
        id={`description-toolapproval-${policy.id}`}
        label="Description"
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <MultiSelectField
        id={`required-tools-${policy.id}`}
        label="Required Tools"
        placeholder={toolsLoading ? "Loading tools..." : "Select tools requiring approval"}
        items={toolItems(availableTools)}
        value={policy.required_tools ?? []}
        onChange={(required_tools) => onUpdate({ required_tools })}
        disabled={disabled || toolsLoading}
        helperText="Tools that require approval before execution"
        wildcardLabel={toolsLoading ? undefined : "All tools (*)"}
      />
      <MultiSelectField
        id={`required-apps-${policy.id}`}
        label="Required Apps (Optional)"
        placeholder={toolsLoading ? "Loading apps..." : "Select apps (optional)"}
        items={appItems(availableApps)}
        value={policy.required_apps ?? []}
        onChange={(ids) => onUpdate({ required_apps: ids.length > 0 ? ids : undefined })}
        disabled={disabled || toolsLoading}
        helperText="Optionally require approval for all tools from specific apps"
      />
      <TextAreaField
        id={`approval-message-${policy.id}`}
        label="Approval Message (optional)"
        value={policy.approval_message || ""}
        onChange={(message) => onUpdate({ approval_message: message || undefined })}
        placeholder="This tool requires your approval before execution."
        rows={3}
        disabled={disabled}
        helperText="Custom message shown when requesting approval"
      />
      <CheckboxField
        label="Show code preview in approval request"
        checked={policy.show_code_preview}
        onChange={(show_code_preview) => onUpdate({ show_code_preview })}
        disabled={disabled}
      />
      <NumberField
        id={`auto-approve-${policy.id}`}
        label="Auto-approve after (seconds, optional)"
        value={policy.auto_approve_after || undefined}
        emptyValue={undefined}
        onChange={(value) => onUpdate({ auto_approve_after: value !== undefined && value > 0 ? value : undefined })}
        min={1}
        placeholder="Leave empty for no auto-approve"
        disabled={disabled}
        helperText="Automatically approve after N seconds (leave empty to disable)"
      />
      <NumberField
        id={`priority-toolapproval-${policy.id}`}
        label="Priority"
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText="Higher priority approval policies are checked first"
      />
    </>
  )
}

// ── output formatter ───────────────────────────────────────────────────────
const FORMAT_TYPE_OPTIONS = [
  { value: "direct", text: "Direct Answer (No LLM)" },
  { value: "markdown", text: "Markdown Instructions (LLM)" },
  { value: "json_schema", text: "JSON Schema (LLM)" },
] as const

const FORMAT_TEXT = {
  direct: {
    summary: "Direct",
    typeHelp: "Directly replace the response with the provided string (no LLM processing)",
    configLabel: "Direct Answer String",
    configPlaceholder: "You are not allowed to view this sensitive data",
    configHelp: "This exact string will replace the AI response when triggers match (no LLM processing)",
    rows: 4,
  },
  markdown: {
    summary: "Markdown (LLM)",
    typeHelp: "Use LLM to reformat the response according to markdown instructions",
    configLabel: "Formatting Instructions (Markdown)",
    configPlaceholder: "Format the response in a clear, structured way with proper headings and bullet points.",
    configHelp: "Markdown instructions for how to format the AI response (processed by LLM)",
    rows: 8,
  },
  json_schema: {
    summary: "JSON (LLM)",
    typeHelp: "Use LLM to extract and format the response as JSON matching the schema",
    configLabel: "JSON Schema",
    configPlaceholder:
      '{\n  "type": "object",\n  "properties": {\n    "summary": {"type": "string"},\n    "details": {"type": "array"}\n  }\n}',
    configHelp: "JSON schema that the formatted response must match (processed by LLM)",
    rows: 12,
  },
} as const

/** Any format type other than direct/markdown is treated as JSON schema, as in the original. */
const formatText = (formatType: string) =>
  formatType === "direct" ? FORMAT_TEXT.direct : formatType === "markdown" ? FORMAT_TEXT.markdown : FORMAT_TEXT.json_schema

export function OutputFormatterSummary({ policy }: { policy: OutputFormatterPolicy }) {
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <span>{formatText(policy.format_type).summary}</span>
      {keywords.length > 0 && <span>{plural(keywords.length, "keyword")}</span>}
      {policy.triggers.some((t) => t.type === "natural_language") && <span>AI trigger</span>}
      <span>Priority: {policy.priority}</span>
    </>
  )
}

export function OutputFormatterEditor({ policy, disabled, onUpdate }: EditorProps<OutputFormatterPolicy>) {
  const text = formatText(policy.format_type)
  return (
    <>
      <TextAreaField
        id={`description-outputformatter-${policy.id}`}
        label="Description"
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <OptionalKeywords
        idSuffix={`outputformatter-${policy.id}`}
        triggers={policy.triggers}
        target="agent_response"
        helperText="Keywords to match against the last AI message content. Leave empty to always format."
        operatorHelperText="Choose whether all keywords or any keyword should trigger this formatter"
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <OptionalNaturalLanguageTrigger
        idSuffix={`output-${policy.id}`}
        triggers={policy.triggers}
        target="agent_response"
        helperText="Type natural language triggers and press Enter to add. AI will match similar responses."
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <SelectField
        id={`format-type-${policy.id}`}
        label="Format Type"
        value={policy.format_type}
        options={FORMAT_TYPE_OPTIONS}
        onChange={(format_type) => onUpdate({ format_type })}
        disabled={disabled}
        helperText={text.typeHelp}
      />
      <TextAreaField
        id={`format-config-${policy.id}`}
        label={text.configLabel}
        value={policy.format_config}
        onChange={(format_config) => onUpdate({ format_config })}
        placeholder={text.configPlaceholder}
        rows={text.rows}
        mono={policy.format_type === "json_schema"}
        disabled={disabled}
        helperText={text.configHelp}
      />
      <NumberField
        id={`priority-outputformatter-${policy.id}`}
        label="Priority"
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText="Higher priority formatters are checked first"
      />
    </>
  )
}
