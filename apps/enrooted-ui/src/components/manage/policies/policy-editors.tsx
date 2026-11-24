/*
 * The five policy editors (expanded card body) and their collapsed summaries.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0). Field labels, placeholders, helper texts,
 * defaults and the way each control rewrites `triggers` are kept as they were.
 */

import { PlusIcon, ShieldCheckIcon, ShieldOffIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

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
  keywordOperatorOptions,
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
export const keywordTriggerOf = (triggers: PolicyTrigger[]) => triggers.find((trigger) => trigger.type === "keyword")

export const keywordsOf = (triggers: PolicyTrigger[]): string[] => {
  const trigger = keywordTriggerOf(triggers)
  return trigger && Array.isArray(trigger.value) ? trigger.value : []
}

const valuesOf = (trigger: PolicyTrigger | undefined): string[] =>
  trigger ? (Array.isArray(trigger.value) ? trigger.value : trigger.value ? [trigger.value] : []) : []

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
  const { t } = useTranslation("policies")
  const keywordTrigger = keywordTriggerOf(triggers)
  const keywords = keywordsOf(triggers)
  return (
    <>
      <TagInput
        labelText={t("editor.common.triggerKeywordsOptional")}
        values={keywords}
        onChange={(newKeywords) => {
          const updated = triggers.filter((trigger) => trigger.type !== "keyword")
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
        placeholder={t("editor.common.keywordPlaceholder")}
        disabled={disabled}
        helperText={helperText}
      />
      {keywords.length > 1 && (
        <SelectField
          id={`keyword-operator-${idSuffix}`}
          label={t("editor.common.keywordMatching")}
          value={keywordTrigger?.operator || "and"}
          options={keywordOperatorOptions(t)}
          onChange={(operator) => onTriggersChange(triggers.map((trigger) => (trigger.type === "keyword" ? { ...trigger, operator } : trigger)))}
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
  const { t } = useTranslation("policies")
  const nlTrigger = triggers.find((trigger) => trigger.type === "natural_language")
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
          {t("editor.common.addNlTrigger")}
        </Button>
      </div>
    )
  }
  return (
    <>
      <TagInput
        labelText={t("editor.common.nlTriggers")}
        values={valuesOf(nlTrigger)}
        onChange={(value) =>
          onTriggersChange(triggers.map((trigger) => (trigger.type === "natural_language" ? { ...trigger, value } : trigger)))
        }
        placeholder={t("editor.common.nlTriggerPlaceholder")}
        disabled={disabled}
        helperText={helperText}
      />
      <ThresholdSlider
        id={`threshold-${idSuffix}`}
        threshold={nlTrigger.threshold}
        onChange={(threshold) =>
          onTriggersChange(triggers.map((trigger) => (trigger.type === "natural_language" ? { ...trigger, threshold } : trigger)))
        }
        disabled={disabled}
      />
      <div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onTriggersChange(triggers.filter((trigger) => trigger.type !== "natural_language"))}
          disabled={disabled}
        >
          <Trash2Icon data-icon="inline-start" />
          {t("editor.common.removeNlTrigger")}
        </Button>
      </div>
    </>
  )
}

// ── intent guard ───────────────────────────────────────────────────────────
export function IntentGuardSummary({ policy }: { policy: IntentGuardPolicy }) {
  const { t } = useTranslation("policies")
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      {keywords.length > 0 && <span>{t("editor.summary.keywords", { count: keywords.length })}</span>}
      {policy.triggers.some((trigger) => trigger.type === "natural_language") && <span>{t("editor.summary.aiTrigger")}</span>}
      <span>{t("editor.summary.priority", { priority: policy.priority })}</span>
    </>
  )
}

export function IntentGuardEditor({ policy, disabled, onUpdate }: EditorProps<IntentGuardPolicy>) {
  const { t } = useTranslation("policies")
  return (
    <>
      <TextAreaField
        id={`description-${policy.id}`}
        label={t("editor.common.description")}
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        placeholder={t("editor.intentGuard.descriptionPlaceholder")}
        rows={2}
        disabled={disabled}
      />
      <OptionalKeywords
        idSuffix={policy.id}
        triggers={policy.triggers}
        target="intent"
        helperText={t("editor.intentGuard.keywordsHelp")}
        operatorHelperText={t("editor.intentGuard.operatorHelp")}
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <OptionalNaturalLanguageTrigger
        idSuffix={policy.id}
        triggers={policy.triggers}
        target="intent"
        helperText={t("editor.intentGuard.nlHelp")}
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <TextAreaField
        id={`response-${policy.id}`}
        label={t("editor.intentGuard.responseMessage")}
        value={policy.response?.content ?? ""}
        onChange={(content) => onUpdate({ response: { ...policy.response, content } })}
        placeholder={t("defaults.intentGuard.response")}
        rows={3}
        disabled={disabled}
      />
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <NumberField
          id={`priority-${policy.id}`}
          label={t("editor.common.priority")}
          value={policy.priority}
          emptyValue={0}
          onChange={(value) => onUpdate({ priority: value ?? 0 })}
          min={0}
          max={100}
          disabled={disabled}
          helperText={t("editor.intentGuard.priorityHelp")}
        />
        <div className="sm:pt-7">
          <CheckboxField
            label={t("editor.intentGuard.allowOverride")}
            checked={policy.allow_override}
            onChange={(allow_override) => onUpdate({ allow_override })}
            disabled={disabled}
            helperText={t("editor.intentGuard.allowOverrideHelp")}
          />
        </div>
      </div>
    </>
  )
}

// ── playbook ───────────────────────────────────────────────────────────────
export function PlaybookSummary({ policy }: { policy: PlaybookPolicy }) {
  const { t } = useTranslation("policies")
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <span>{t("editor.summary.steps", { count: (policy.steps ?? []).length })}</span>
      {policy.triggers.length > 0 && (
        <span>
          {policy.triggers[0].type === "natural_language"
            ? t("editor.summary.aiTrigger")
            : t("editor.summary.keywords", { count: keywords.length })}
        </span>
      )}
    </>
  )
}

export function PlaybookEditor({ policy, disabled, onUpdate }: EditorProps<PlaybookPolicy>) {
  const { t } = useTranslation("policies")
  const triggerOptions = [
    { value: "keyword", text: t("editor.playbook.triggerKeyword") },
    { value: "natural_language", text: t("editor.playbook.triggerNaturalLanguage") },
  ] as const
  const first: PolicyTrigger | undefined = policy.triggers[0]
  const keywordTrigger = keywordTriggerOf(policy.triggers)
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <TextAreaField
        id={`description-playbook-${policy.id}`}
        label={t("editor.common.description")}
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        placeholder={t("editor.playbook.descriptionPlaceholder")}
        rows={2}
        disabled={disabled}
      />
      <SelectField
        id={`trigger-type-playbook-${policy.id}`}
        label={t("editor.playbook.triggerType")}
        value={first?.type === "natural_language" ? "natural_language" : "keyword"}
        options={triggerOptions}
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
            labelText={t("editor.common.triggerKeywords")}
            values={keywords}
            onChange={(value) =>
              onUpdate({ triggers: policy.triggers.map((trigger) => (trigger.type === "keyword" ? { ...trigger, value } : trigger)) })
            }
            placeholder={t("editor.common.keywordPlaceholder")}
            disabled={disabled}
            helperText={t("editor.playbook.keywordsHelp")}
          />
          {keywords.length > 1 && (
            <SelectField
              id={`keyword-operator-playbook-${policy.id}`}
              label={t("editor.common.keywordMatching")}
              value={keywordTrigger?.operator || "and"}
              options={keywordOperatorOptions(t)}
              onChange={(operator) =>
                onUpdate({ triggers: policy.triggers.map((trigger) => (trigger.type === "keyword" ? { ...trigger, operator } : trigger)) })
              }
              disabled={disabled}
              helperText={t("editor.playbook.operatorHelp")}
            />
          )}
        </>
      )}

      {first?.type === "natural_language" && (
        <>
          <TagInput
            labelText={t("editor.common.nlTriggers")}
            values={valuesOf(first)}
            onChange={(value) =>
              onUpdate({ triggers: policy.triggers.map((trigger, idx) => (idx === 0 ? { ...trigger, value } : trigger)) })
            }
            placeholder={t("editor.playbook.nlPlaceholder")}
            disabled={disabled}
            helperText={t("editor.playbook.nlHelp")}
          />
          <ThresholdSlider
            id={`threshold-playbook-${policy.id}`}
            threshold={first.threshold}
            onChange={(threshold) =>
              onUpdate({ triggers: policy.triggers.map((trigger, idx) => (idx === 0 ? { ...trigger, threshold } : trigger)) })
            }
            disabled={disabled}
          />
        </>
      )}

      <TextAreaField
        id={`markdown-playbook-${policy.id}`}
        label={t("editor.playbook.markdownContent")}
        value={policy.markdown_content}
        onChange={(markdown_content) => onUpdate({ markdown_content })}
        placeholder={t("editor.playbook.markdownPlaceholder")}
        rows={8}
        mono
        disabled={disabled}
        helperText={t("editor.playbook.markdownHelp")}
      />
      <NumberField
        id={`priority-playbook-${policy.id}`}
        label={t("editor.common.priority")}
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText={t("editor.playbook.priorityHelp")}
      />
    </>
  )
}

// ── tool guide ─────────────────────────────────────────────────────────────
export function ToolGuideSummary({ policy, guarded }: { policy: ToolGuidePolicy; guarded: boolean }) {
  const { t } = useTranslation("policies")
  const targetTools = policy.target_tools ?? []
  return (
    <>
      <span>
        {targetTools.includes("*")
          ? t("editor.summary.allTools")
          : t("editor.summary.tools", { count: targetTools.length })}
      </span>
      {policy.target_apps && policy.target_apps.length > 0 && <span>{t("editor.summary.apps", { count: policy.target_apps.length })}</span>}
      <span>{t("editor.summary.priority", { priority: policy.priority })}</span>
      {guarded &&
        (policy.guards_enabled === false ? (
          <Badge variant="outline">
            <ShieldOffIcon className="text-status-warn" aria-hidden="true" />
            {t("editor.summary.guardsDisabled")}
          </Badge>
        ) : (
          <Badge variant="outline">
            <ShieldCheckIcon className="text-status-ok" aria-hidden="true" />
            {t("editor.summary.guarded")}
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
  const { t } = useTranslation("policies")
  return (
    <>
      <TextAreaField
        id={`description-toolguide-${policy.id}`}
        label={t("editor.common.description")}
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <MultiSelectField
        id={`target-tools-${policy.id}`}
        label={t("editor.toolGuide.targetTools")}
        placeholder={toolsLoading ? t("editor.common.loadingTools") : t("editor.toolGuide.targetToolsPlaceholder")}
        items={toolItems(availableTools)}
        value={policy.target_tools ?? []}
        onChange={(target_tools) => onUpdate({ target_tools })}
        disabled={disabled || toolsLoading}
        helperText={t("editor.toolGuide.targetToolsHelp")}
        wildcardLabel={toolsLoading ? undefined : t("editor.common.allToolsWildcard")}
      />
      <MultiSelectField
        id={`target-apps-${policy.id}`}
        label={t("editor.toolGuide.targetApps")}
        placeholder={toolsLoading ? t("editor.common.loadingApps") : t("editor.common.selectAppsOptional")}
        items={appItems(availableApps)}
        value={policy.target_apps ?? []}
        onChange={(ids) => onUpdate({ target_apps: ids.length > 0 ? ids : undefined })}
        disabled={disabled || toolsLoading}
        helperText={t("editor.toolGuide.targetAppsHelp")}
      />
      <TextAreaField
        id={`guide-content-${policy.id}`}
        label={t("editor.toolGuide.guideContent")}
        value={policy.guide_content}
        onChange={(guide_content) => onUpdate({ guide_content })}
        placeholder={t("editor.toolGuide.guidePlaceholder")}
        rows={6}
        mono
        disabled={disabled}
        helperText={t("editor.toolGuide.guideHelp")}
      />
      <CheckboxField
        label={t("editor.toolGuide.prepend")}
        checked={policy.prepend}
        onChange={(prepend) => onUpdate({ prepend })}
        disabled={disabled}
      />
      <NumberField
        id={`priority-toolguide-${policy.id}`}
        label={t("editor.common.priority")}
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText={t("editor.toolGuide.priorityHelp")}
      />
    </>
  )
}

// ── tool approval ──────────────────────────────────────────────────────────
export function ToolApprovalSummary({ policy }: { policy: ToolApprovalPolicy }) {
  const { t } = useTranslation("policies")
  const requiredTools = policy.required_tools ?? []
  return (
    <>
      <span>
        {requiredTools.length === 0
          ? t("editor.summary.noTools")
          : requiredTools.includes("*")
            ? t("editor.summary.allTools")
            : t("editor.summary.tools", { count: requiredTools.length })}
      </span>
      {policy.required_apps && policy.required_apps.length > 0 && <span>{t("editor.summary.apps", { count: policy.required_apps.length })}</span>}
      <span>{t("editor.summary.priority", { priority: policy.priority })}</span>
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
  const { t } = useTranslation("policies")
  return (
    <>
      <TextAreaField
        id={`description-toolapproval-${policy.id}`}
        label={t("editor.common.description")}
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <MultiSelectField
        id={`required-tools-${policy.id}`}
        label={t("editor.toolApproval.requiredTools")}
        placeholder={toolsLoading ? t("editor.common.loadingTools") : t("editor.toolApproval.requiredToolsPlaceholder")}
        items={toolItems(availableTools)}
        value={policy.required_tools ?? []}
        onChange={(required_tools) => onUpdate({ required_tools })}
        disabled={disabled || toolsLoading}
        helperText={t("editor.toolApproval.requiredToolsHelp")}
        wildcardLabel={toolsLoading ? undefined : t("editor.common.allToolsWildcard")}
      />
      <MultiSelectField
        id={`required-apps-${policy.id}`}
        label={t("editor.toolApproval.requiredApps")}
        placeholder={toolsLoading ? t("editor.common.loadingApps") : t("editor.common.selectAppsOptional")}
        items={appItems(availableApps)}
        value={policy.required_apps ?? []}
        onChange={(ids) => onUpdate({ required_apps: ids.length > 0 ? ids : undefined })}
        disabled={disabled || toolsLoading}
        helperText={t("editor.toolApproval.requiredAppsHelp")}
      />
      <TextAreaField
        id={`approval-message-${policy.id}`}
        label={t("editor.toolApproval.approvalMessage")}
        value={policy.approval_message || ""}
        onChange={(message) => onUpdate({ approval_message: message || undefined })}
        placeholder={t("defaults.toolApproval.message")}
        rows={3}
        disabled={disabled}
        helperText={t("editor.toolApproval.approvalMessageHelp")}
      />
      <CheckboxField
        label={t("editor.toolApproval.showCodePreview")}
        checked={policy.show_code_preview}
        onChange={(show_code_preview) => onUpdate({ show_code_preview })}
        disabled={disabled}
      />
      <NumberField
        id={`auto-approve-${policy.id}`}
        label={t("editor.toolApproval.autoApprove")}
        value={policy.auto_approve_after || undefined}
        emptyValue={undefined}
        onChange={(value) => onUpdate({ auto_approve_after: value !== undefined && value > 0 ? value : undefined })}
        min={1}
        placeholder={t("editor.toolApproval.autoApprovePlaceholder")}
        disabled={disabled}
        helperText={t("editor.toolApproval.autoApproveHelp")}
      />
      <NumberField
        id={`priority-toolapproval-${policy.id}`}
        label={t("editor.common.priority")}
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText={t("editor.toolApproval.priorityHelp")}
      />
    </>
  )
}

// ── output formatter ───────────────────────────────────────────────────────
const JSON_SCHEMA_PLACEHOLDER =
  '{\n  "type": "object",\n  "properties": {\n    "summary": {"type": "string"},\n    "details": {"type": "array"}\n  }\n}'

const FORMAT_ROWS = { direct: 4, markdown: 8, jsonSchema: 12 } as const

/** Any format type other than direct/markdown is treated as JSON schema, as in the original. */
const formatKind = (formatType: string) =>
  formatType === "direct" ? "direct" : formatType === "markdown" ? "markdown" : "jsonSchema"

export function OutputFormatterSummary({ policy }: { policy: OutputFormatterPolicy }) {
  const { t } = useTranslation("policies")
  const keywords = keywordsOf(policy.triggers)
  return (
    <>
      <span>{t(`editor.outputFormatter.format.${formatKind(policy.format_type)}.summary`)}</span>
      {keywords.length > 0 && <span>{t("editor.summary.keywords", { count: keywords.length })}</span>}
      {policy.triggers.some((trigger) => trigger.type === "natural_language") && (
        <span>{t("editor.summary.aiTrigger")}</span>
      )}
      <span>{t("editor.summary.priority", { priority: policy.priority })}</span>
    </>
  )
}

export function OutputFormatterEditor({ policy, disabled, onUpdate }: EditorProps<OutputFormatterPolicy>) {
  const { t } = useTranslation("policies")
  const kind = formatKind(policy.format_type)
  const formatTypeOptions = [
    { value: "direct", text: t("editor.outputFormatter.type.direct") },
    { value: "markdown", text: t("editor.outputFormatter.type.markdown") },
    { value: "json_schema", text: t("editor.outputFormatter.type.jsonSchema") },
  ] as const
  const configPlaceholder =
    kind === "direct"
      ? t("editor.outputFormatter.format.direct.configPlaceholder")
      : kind === "markdown"
        ? t("defaults.outputFormatter.config")
        : JSON_SCHEMA_PLACEHOLDER
  return (
    <>
      <TextAreaField
        id={`description-outputformatter-${policy.id}`}
        label={t("editor.common.description")}
        value={policy.description}
        onChange={(description) => onUpdate({ description })}
        rows={2}
        disabled={disabled}
      />
      <OptionalKeywords
        idSuffix={`outputformatter-${policy.id}`}
        triggers={policy.triggers}
        target="agent_response"
        helperText={t("editor.outputFormatter.keywordsHelp")}
        operatorHelperText={t("editor.outputFormatter.operatorHelp")}
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <OptionalNaturalLanguageTrigger
        idSuffix={`output-${policy.id}`}
        triggers={policy.triggers}
        target="agent_response"
        helperText={t("editor.outputFormatter.nlHelp")}
        disabled={disabled}
        onTriggersChange={(triggers) => onUpdate({ triggers })}
      />
      <SelectField
        id={`format-type-${policy.id}`}
        label={t("editor.outputFormatter.formatType")}
        value={policy.format_type}
        options={formatTypeOptions}
        onChange={(format_type) => onUpdate({ format_type })}
        disabled={disabled}
        helperText={t(`editor.outputFormatter.format.${kind}.typeHelp`)}
      />
      <TextAreaField
        id={`format-config-${policy.id}`}
        label={t(`editor.outputFormatter.format.${kind}.configLabel`)}
        value={policy.format_config}
        onChange={(format_config) => onUpdate({ format_config })}
        placeholder={configPlaceholder}
        rows={FORMAT_ROWS[kind]}
        mono={policy.format_type === "json_schema"}
        disabled={disabled}
        helperText={t(`editor.outputFormatter.format.${kind}.configHelp`)}
      />
      <NumberField
        id={`priority-outputformatter-${policy.id}`}
        label={t("editor.common.priority")}
        value={policy.priority}
        emptyValue={0}
        onChange={(value) => onUpdate({ priority: value ?? 0 })}
        min={0}
        max={100}
        disabled={disabled}
        helperText={t("editor.outputFormatter.priorityHelp")}
      />
    </>
  )
}
