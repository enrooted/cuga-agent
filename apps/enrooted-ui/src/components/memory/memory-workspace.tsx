/*
 * The Memory workspace (/chat?view=memory): the signed-in user's memories with
 * search, filters, paging, details and "Forget", and for administrators the
 * Settings / Memory / Activity tabs (service switches, retention policies and
 * schedules, protection filters, the content-free inventory and retention
 * activity).
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/memory/MemoryWorkspace.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleDashedIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { AlertDialog } from "@/components/confirm-dialog"
import {
  InlineLoading,
  Notice,
  SelectField,
  StatusBadge,
} from "@/components/manage/knowledge/parts"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import i18n from "@/i18n"
import {
  deleteMemory,
  loadAdminMemoryPage,
  loadMemoryEntity,
  loadMemoryPage,
  loadMemoryPreferences,
  loadProtectionStatus,
  loadRetentionCapabilities,
  loadRetentionPolicies,
  loadRetentionRuns,
  runRetention,
} from "@/lib/memory/api"
import type {
  MemoryRecord,
  ProtectionStatus,
  RetentionCapabilities,
  RetentionPolicy,
  RetentionRun,
} from "@/lib/memory/types"
import { MemoryPreferences } from "./memory-preferences"
import {
  AsyncButton,
  ContentSkeleton,
  DefinitionList,
  DetailHeader,
  DetailNote,
  MasterDetail,
  Pagination,
  RecordRow,
  ReferenceLink,
  StatusPill,
  displayType,
  formatRule,
  memoryStatusDetail,
  recordDomId,
} from "./parts"
import {
  CollectionActivity,
  RetentionRunDetail,
  runStatus,
} from "./retention-activity"
import { RetentionSchedules } from "./retention-schedules"

type MemorySort =
  | "recently-saved"
  | "recently-used"
  | "most-used"
  | "least-used"
  | "oldest"
  | "name"

type AdminTab = "settings" | "memory" | "activity"
type SettingsId = string

type SettingsItem = {
  id: SettingsId
  title: string
  description: string
  status: string
  detail: string
  kind: "protection" | "retention"
  enabled: boolean
  healthy?: boolean
  pluginCount?: number
  plugins?: ProtectionStatus["plugins"]
  policy?: RetentionPolicy
}

type MemoryWorkspaceProps = {
  agentId: string
  agentName: string
  onClose: () => void
  canManage?: boolean
  focusEntityIds?: string[]
  focusRelationship?: "used" | "saved"
  onClearFocus?: () => void
  onOpenConversation?: (threadId: string) => void
}

const NO_FOCUS: string[] = []

function MemoryDetail({
  memory,
  capabilities,
  deleting,
  onDelete,
  onOpenConversation,
  admin = false,
}: {
  memory: MemoryRecord
  capabilities: RetentionCapabilities | null
  deleting?: boolean
  onDelete?: () => void
  onOpenConversation?: (threadId: string) => void
  admin?: boolean
}) {
  const { t } = useTranslation("memory")
  const source = memory.sources?.length ? (
    <ul className="flex flex-col gap-1">
      {memory.sources.map((item, index) => (
        <li key={`${item.threadId ?? "unavailable"}-${index}`}>
          {item.threadId && onOpenConversation ? (
            <ReferenceLink
              href={`/chat?thread_id=${encodeURIComponent(item.threadId)}`}
              onClick={() => onOpenConversation(item.threadId!)}
            >
              {t("detail.sourceConversation", { number: index + 1 })}
            </ReferenceLink>
          ) : (
            t("detail.sourceUnavailable")
          )}
          {" · "}
          {item.status === "superseded"
            ? t("detail.sourceSuperseded")
            : t("detail.sourceSupporting")}
        </li>
      ))}
    </ul>
  ) : memory.sourceConversationId && onOpenConversation ? (
    <ReferenceLink
      href={`/chat?thread_id=${encodeURIComponent(memory.sourceConversationId)}`}
      onClick={() => onOpenConversation(memory.sourceConversationId!)}
    >
      {memory.sourceLabel}
    </ReferenceLink>
  ) : (
    memory.sourceLabel
  )

  return (
    <>
      <DetailHeader
        eyebrow={admin ? undefined : t("detail.eyebrow")}
        title={memory.title}
        status={memory.state === "Retained" ? "Current" : memory.state}
      />
      <div className="flex flex-col gap-4">
        {!admin && memory.content && (
          <DetailNote title={t("detail.remembered")}>
            <p>{memory.content}</p>
          </DetailNote>
        )}
        <DefinitionList
          items={[
            ...(admin && memory.ownerLabel
              ? [{ label: t("detail.owner"), value: memory.ownerLabel }]
              : []),
            { label: t("detail.type"), value: displayType(memory.entityType) },
            ...(memory.category
              ? [
                  {
                    label: t("detail.category"),
                    value: displayType(memory.category),
                  },
                ]
              : []),
            { label: t("detail.source"), value: source },
            { label: t("detail.saved"), value: memory.createdLabel },
            {
              label: t("detail.useFrequency"),
              value: memory.usageCount
                ? t("usage.used", { count: memory.usageCount })
                : t("usage.notUsedYet"),
            },
            ...(memory.usageCount > 0
              ? [{ label: t("detail.lastUsed"), value: memory.lastUsedLabel }]
              : []),
            {
              label: t("detail.status"),
              value: memoryStatusDetail(memory, capabilities),
            },
            ...(memory.relatedIds.length
              ? [
                  {
                    label: t("detail.related"),
                    value: t("detail.relatedCount", {
                      count: memory.relatedIds.length,
                    }),
                  },
                ]
              : []),
          ]}
        />
        {memory.recentUsage.length > 0 && (
          <section className="flex flex-col gap-1.5 text-sm">
            <h3 className="font-heading font-semibold text-foreground">
              {t("detail.recentUse")}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {memory.recentUsage.map((usage, index) => (
                <li
                  key={`${usage.threadId}-${usage.usedAt}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3"
                >
                  {usage.threadId && onOpenConversation ? (
                    <ReferenceLink
                      href={`/chat?thread_id=${encodeURIComponent(usage.threadId)}`}
                      onClick={() => onOpenConversation(usage.threadId)}
                    >
                      {usage.conversationLabel}
                    </ReferenceLink>
                  ) : (
                    <span className="text-body">{usage.conversationLabel}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {usage.usedLabel}
                    {usage.revision
                      ? ` · ${t("detail.version", { revision: usage.revision })}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {memory.legalHold && (
          <DetailNote title={t("detail.deletionUnavailable")}>
            <p>{t("detail.legalHold")}</p>
          </DetailNote>
        )}
        {admin ? (
          <DetailNote title={t("detail.contentHidden")} tone="muted">
            <p>{t("detail.contentHiddenBody")}</p>
          </DetailNote>
        ) : (
          <div>
            <AsyncButton
              busy={!!deleting}
              busyLabel={t("detail.deleting")}
              variant="destructive"
              size="sm"
              disabled={memory.legalHold}
              onClick={onDelete}
            >
              {t("detail.forget")}
            </AsyncButton>
          </div>
        )}
      </div>
    </>
  )
}

function SettingsDetail({
  settings,
  capabilities,
  latestRun,
  runningRetention,
  onRunRetention,
  readOnly = false,
}: {
  settings: SettingsItem
  capabilities: RetentionCapabilities | null
  latestRun?: RetentionRun
  runningRetention: boolean
  onRunRetention: () => void
  readOnly?: boolean
}) {
  const { t } = useTranslation("memory")
  const policy = settings.policy
  if (settings.kind === "protection")
    return (
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <div>
          <h2 className="font-heading text-sm font-semibold text-foreground">
            {settings.id === "save-check"
              ? t("settings.beforeSaving")
              : t("settings.beforeSending")}
          </h2>
          <p className="text-sm text-body">{settings.description}</p>
        </div>
        {settings.plugins?.length ? (
          <ul className="flex flex-col divide-y">
            {settings.plugins.map((plugin) => (
              <li
                key={plugin.name}
                className="flex flex-wrap items-start justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <strong className="font-medium text-foreground">
                    {plugin.displayName || plugin.name}
                  </strong>
                  {plugin.description && (
                    <p className="text-muted-foreground">
                      {plugin.description}
                    </p>
                  )}
                </div>
                <StatusBadge
                  tone={
                    !plugin.enabled ? "neutral" : plugin.healthy ? "ok" : "warn"
                  }
                  icon={
                    !plugin.enabled ? (
                      <CircleDashedIcon />
                    ) : plugin.healthy ? (
                      <CheckIcon className="text-status-ok" />
                    ) : (
                      <TriangleAlertIcon className="text-status-warn" />
                    )
                  }
                >
                  {!plugin.enabled
                    ? t("settings.plugin.disabled")
                    : plugin.healthy
                      ? t("settings.plugin.enabled")
                      : t("settings.plugin.enabledStatusUnavailable")}
                </StatusBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settings.plugin.none")}
          </p>
        )}
      </section>
    )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold text-foreground">
              {settings.title}
            </h2>
            <StatusPill status={settings.status} />
            <span className="text-xs text-muted-foreground">
              {settings.detail}
            </span>
          </div>
          <p className="text-sm text-body">{t("settings.retention.intro")}</p>
        </div>
        <AsyncButton
          busy={runningRetention}
          busyLabel={t("settings.retention.running")}
          variant="outline"
          disabled={
            readOnly ||
            runningRetention ||
            !capabilities?.available ||
            !policy?.enabled
          }
          onClick={onRunRetention}
        >
          {t("settings.retention.runNow")}
        </AsyncButton>
      </div>
      {policy && (
        <>
          <section className="flex flex-col gap-2 text-sm">
            <h2 className="font-heading text-sm font-semibold text-foreground">
              {t("settings.retention.policyRules")}
            </h2>
            {policy.rules.length ? (
              <ul className="list-disc pl-5 text-body">
                {policy.rules.map((rule) => (
                  <li key={rule.name}>{formatRule(rule)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {t("settings.retention.noRules")}
              </p>
            )}
          </section>
          {capabilities?.available ? (
            <RetentionSchedules
              key={policy.policyId}
              readOnly={readOnly}
              policyId={policy.policyId}
              enabled={policy.enabled}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("settings.retention.unavailable")}
            </p>
          )}
          <section className="flex flex-col gap-1 border-t pt-4 text-sm">
            <h2 className="font-heading text-sm font-semibold text-foreground">
              {t("settings.retention.latestRun")}
            </h2>
            <p className="text-body">
              {latestRun
                ? new Date(latestRun.createdAt).toLocaleString(i18n.language)
                : t("settings.retention.noneRecorded")}
            </p>
            <p className="text-muted-foreground">
              {t("settings.retention.activityHint")}
            </p>
          </section>
        </>
      )}
    </div>
  )
}

type PendingConfirm = {
  title: string
  description: string
  confirmLabel: string
}

export function MemoryWorkspace({
  agentId,
  agentName,
  onClose,
  canManage = false,
  focusEntityIds = NO_FOCUS,
  focusRelationship = "used",
  onClearFocus,
  onOpenConversation,
}: MemoryWorkspaceProps) {
  const { t } = useTranslation("memory")
  // Promise-based confirmation, as the Carbon UI's `confirm()` (CarbonFeedback).
  const [pendingConfirm, setPendingConfirm] =
    React.useState<PendingConfirm | null>(null)
  const confirmResolver = React.useRef<((confirmed: boolean) => void) | null>(
    null
  )
  const confirm = (description: string, title: string, confirmLabel: string) =>
    new Promise<boolean>((resolve) => {
      confirmResolver.current?.(false)
      confirmResolver.current = resolve
      setPendingConfirm({ title, description, confirmLabel })
    })
  const settleConfirm = (confirmed: boolean) => {
    confirmResolver.current?.(confirmed)
    confirmResolver.current = null
    setPendingConfirm(null)
  }
  React.useEffect(() => () => confirmResolver.current?.(false), [])

  const rootRef = React.useRef<HTMLDivElement>(null)
  const requestGenerationRef = React.useRef(0)
  const activeAgentRef = React.useRef(agentId)
  const [view, setView] = React.useState<"user" | "admin">("user")
  const [adminTab, setAdminTab] = React.useState<AdminTab>("settings")
  const [memories, setMemories] = React.useState<MemoryRecord[]>([])
  const [memoryTotal, setMemoryTotal] = React.useState(0)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [memoryPage, setMemoryPage] = React.useState(1)
  const [memoryPageSize, setMemoryPageSize] = React.useState(20)
  const memoryCursors = React.useRef<Array<string | undefined>>([undefined])
  const memoryPageRequest = React.useRef(0)
  const [capabilities, setCapabilities] =
    React.useState<RetentionCapabilities | null>(null)
  const [retentionPolicies, setRetentionPolicies] = React.useState<
    RetentionPolicy[]
  >([])
  const [protections, setProtections] = React.useState<ProtectionStatus[]>([])
  const [adminMemories, setAdminMemories] = React.useState<MemoryRecord[]>([])
  const [adminMemoryTotal, setAdminMemoryTotal] = React.useState(0)
  const [adminNextCursor, setAdminNextCursor] = React.useState<string | null>(
    null
  )
  const [runs, setRuns] = React.useState<RetentionRun[]>([])
  const [selectedMemoryId, setSelectedMemoryId] = React.useState("")
  const [selectedAdminMemoryId, setSelectedAdminMemoryId] = React.useState("")
  const [selectedSettingsId, setSelectedSettingsId] =
    React.useState<SettingsId>("")
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [entityType, setEntityType] = React.useState("all")
  const [adminOwner, setAdminOwner] = React.useState("all")
  const [adminState, setAdminState] = React.useState("all")
  const [sort, setSort] = React.useState<MemorySort>("recently-saved")
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [runningRetention, setRunningRetention] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const [serviceEnabled, setServiceEnabled] = React.useState(true)

  React.useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const preferences = await loadMemoryPreferences()
        if (!active) return
        setServiceEnabled(preferences.instance_enabled)
      } catch {
        /* Settings controls display their own loading error. */
      }
    }
    void refresh()
    window.addEventListener("memory-preferences-changed", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      active = false
      window.removeEventListener("memory-preferences-changed", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [])
  const focusEntityKey = Array.from(
    new Set(focusEntityIds.filter(Boolean))
  ).join("\0")

  React.useLayoutEffect(() => {
    if (activeAgentRef.current === agentId) return
    activeAgentRef.current = agentId
    requestGenerationRef.current += 1
    setMemories([])
    setMemoryTotal(0)
    setNextCursor(null)
    setCapabilities(null)
    setRetentionPolicies([])
    setProtections([])
    setAdminMemories([])
    setAdminMemoryTotal(0)
    setAdminNextCursor(null)
    setRuns([])
    setSelectedMemoryId("")
    setSelectedAdminMemoryId("")
    setDetailOpen(false)
    setLoadingMore(false)
    setDeleting(false)
    setRunningRetention(false)
  }, [agentId])

  const refreshData = React.useCallback(async () => {
    const generation = ++requestGenerationRef.current
    memoryPageRequest.current += 1
    const scopeChanged = activeAgentRef.current !== agentId
    activeAgentRef.current = agentId
    setLoading(true)
    setLoadingMore(false)
    if (scopeChanged) {
      setMemories([])
      setMemoryTotal(0)
      setNextCursor(null)
      setCapabilities(null)
      setRetentionPolicies([])
      setProtections([])
      setAdminMemories([])
      setAdminMemoryTotal(0)
      setAdminNextCursor(null)
      setRuns([])
      setSelectedMemoryId("")
      setSelectedAdminMemoryId("")
      setDetailOpen(false)
      setLoadingMore(false)
      setDeleting(false)
      setRunningRetention(false)
    }
    const focusedEntityIds = focusEntityKey ? focusEntityKey.split("\0") : []
    const results = await Promise.allSettled([
      loadMemoryPage(agentId, undefined, memoryPageSize),
      loadRetentionCapabilities(),
      canManage ? loadRetentionPolicies() : Promise.resolve([]),
      canManage ? loadRetentionRuns() : Promise.resolve([]),
      canManage ? loadAdminMemoryPage(agentId) : Promise.resolve(null),
      canManage ? loadProtectionStatus() : Promise.resolve([]),
      Promise.allSettled(
        focusedEntityIds.map((entityId) => loadMemoryEntity(agentId, entityId))
      ),
    ] as const)
    if (generation !== requestGenerationRef.current) return

    const [
      page,
      retention,
      policies,
      history,
      adminPage,
      protectionStatus,
      focused,
    ] = results
    const errors: string[] = []
    const focusedMemories =
      focused.status === "fulfilled"
        ? focused.value
            .filter(
              (result): result is PromiseFulfilledResult<MemoryRecord> =>
                result.status === "fulfilled"
            )
            .map((result) => result.value)
        : []
    const unavailableFocusedCount =
      focused.status === "fulfilled"
        ? focused.value.filter((result) => result.status === "rejected").length
        : focusedEntityIds.length

    if (page.status === "fulfilled" || focusedMemories.length > 0) {
      const byId = new Map<string, MemoryRecord>()
      if (page.status === "fulfilled")
        page.value.items.forEach((memory) => byId.set(memory.id, memory))
      focusedMemories.forEach((memory) => byId.set(memory.id, memory))
      const items = Array.from(byId.values())
      setMemories(items)
      setMemoryTotal(
        page.status === "fulfilled"
          ? Math.max(page.value.total, items.length)
          : items.length
      )
      setNextCursor(page.status === "fulfilled" ? page.value.nextCursor : null)
      setMemoryPage(1)
      memoryCursors.current = [undefined]
      setSelectedMemoryId((current) =>
        items.some((memory) => memory.id === current)
          ? current
          : (items[0]?.id ?? "")
      )
    } else {
      errors.push(t("message.inventoryUnavailable"))
    }
    if (unavailableFocusedCount > 0) {
      errors.push(
        t("message.referencedUnavailable", { count: unavailableFocusedCount })
      )
    }

    if (retention.status === "fulfilled") {
      const policyRules =
        policies.status === "fulfilled"
          ? policies.value.flatMap((policy) => policy.rules)
          : []
      const rulesByName = new Map(
        retention.value.rules.map((rule) => [rule.name, rule])
      )
      policyRules.forEach((rule) => rulesByName.set(rule.name, rule))
      setCapabilities({
        ...retention.value,
        rules: Array.from(rulesByName.values()),
      })
    } else {
      errors.push(t("message.retentionStatusUnavailable"))
    }
    if (policies.status === "fulfilled") {
      setRetentionPolicies(policies.value)
    } else {
      errors.push(t("message.retentionPoliciesUnavailable"))
    }
    if (history.status === "fulfilled") {
      setRuns(history.value)
    } else {
      errors.push(t("message.retentionHistoryUnavailable"))
    }
    if (protectionStatus.status === "fulfilled") {
      setProtections(protectionStatus.value)
    } else {
      errors.push(t("message.protectionStatusUnavailable"))
    }
    if (adminPage.status === "fulfilled" && adminPage.value) {
      const loadedAdminPage = adminPage.value
      setAdminMemories(loadedAdminPage.items)
      setAdminMemoryTotal(loadedAdminPage.total)
      setAdminNextCursor(loadedAdminPage.nextCursor)
      setSelectedAdminMemoryId((current) =>
        loadedAdminPage.items.some((memory) => memory.id === current)
          ? current
          : (loadedAdminPage.items[0]?.id ?? "")
      )
    } else if (adminPage.status === "rejected") {
      errors.push(t("message.adminInventoryUnavailable"))
    }
    setMessage(errors.join(". "))
    setLoading(false)
  }, [agentId, canManage, focusEntityKey, memoryPageSize, t])

  React.useEffect(() => {
    void refreshData()
  }, [refreshData])

  React.useEffect(() => {
    rootRef.current?.scrollTo({ top: 0, behavior: "instant" })
    setDetailOpen(false)
  }, [view])

  const entityTypes = React.useMemo(
    () =>
      Array.from(new Set(memories.map((memory) => memory.entityType))).sort(),
    [memories]
  )

  const adminOwners = React.useMemo(
    () =>
      Array.from(
        new Set(
          adminMemories
            .map((memory) => memory.ownerLabel)
            .filter((owner): owner is string => Boolean(owner))
        )
      ).sort(),
    [adminMemories]
  )

  const visibleAdminMemories = React.useMemo(
    () =>
      adminMemories.filter(
        (memory) =>
          (adminOwner === "all" || memory.ownerLabel === adminOwner) &&
          (adminState === "all" || memory.state === adminState)
      ),
    [adminMemories, adminOwner, adminState]
  )

  React.useEffect(() => {
    if (
      !visibleAdminMemories.some(
        (memory) => memory.id === selectedAdminMemoryId
      )
    ) {
      setSelectedAdminMemoryId(visibleAdminMemories[0]?.id ?? "")
    }
  }, [selectedAdminMemoryId, visibleAdminMemories])

  const settingsItems = React.useMemo<SettingsItem[]>(() => {
    const protectionItems: SettingsItem[] = (
      ["save-check", "send-check"] as const
    ).map((id) => {
      const protection = protections.find((item) => item.id === id)
      const title =
        id === "save-check"
          ? t("settings.protection.saveTitle")
          : t("settings.protection.sendTitle")
      const description =
        id === "save-check"
          ? t("settings.protection.saveDescription")
          : t("settings.protection.sendDescription")
      return {
        id,
        title: protection?.title ?? title,
        description: protection?.description ?? description,
        status:
          protection?.enabled && protection.healthy
            ? "Enabled and healthy"
            : protection?.enabled
              ? "Needs attention"
              : "Status unavailable",
        detail: t("settings.protection.continuous"),
        kind: "protection",
        enabled: protection?.enabled ?? false,
        healthy: protection?.healthy ?? false,
        pluginCount: protection?.pluginCount ?? 0,
        plugins: protection?.plugins ?? [],
      }
    })
    const retentionItems: SettingsItem[] = retentionPolicies.map((policy) => ({
      id: `retention:${policy.policyId}`,
      title: policy.name,
      description:
        policy.description ?? t("settings.retention.defaultDescription"),
      status: !capabilities?.available
        ? "Unavailable"
        : policy.enabled
          ? "Enabled"
          : "Disabled",
      detail: t("settings.retention.publishedRules", {
        count: policy.rules.length,
      }),
      kind: "retention",
      enabled: Boolean(capabilities?.available && policy.enabled),
      policy,
    }))
    return [...protectionItems, ...retentionItems]
  }, [capabilities?.available, protections, retentionPolicies, t])

  const visibleMemories = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = memories.filter(
      (memory) =>
        (!focusEntityIds.length || focusEntityIds.includes(memory.entityId)) &&
        (entityType === "all" || memory.entityType === entityType) &&
        (!query ||
          `${memory.title} ${memory.entityType} ${memory.category ?? ""} ${memory.sourceLabel}`
            .toLowerCase()
            .includes(query))
    )
    const time = (value?: string) => (value ? Date.parse(value) || 0 : 0)
    return [...filtered].sort((left, right) => {
      if (sort === "recently-used")
        return time(right.lastUsedAt) - time(left.lastUsedAt)
      if (sort === "most-used") return right.usageCount - left.usageCount
      if (sort === "least-used") return left.usageCount - right.usageCount
      if (sort === "oldest") return time(left.createdAt) - time(right.createdAt)
      if (sort === "name") return left.title.localeCompare(right.title)
      return time(right.createdAt) - time(left.createdAt)
    })
  }, [entityType, focusEntityIds, memories, search, sort])

  React.useEffect(() => {
    if (!visibleMemories.some((memory) => memory.id === selectedMemoryId)) {
      setSelectedMemoryId(visibleMemories[0]?.id ?? "")
    }
  }, [selectedMemoryId, visibleMemories])

  const selectedMemory =
    visibleMemories.find((memory) => memory.id === selectedMemoryId) ??
    visibleMemories[0]
  const selectedAdminMemory =
    visibleAdminMemories.find(
      (memory) => memory.id === selectedAdminMemoryId
    ) ?? visibleAdminMemories[0]
  const settingsCategories = [
    { id: "general", title: t("settings.categories.general") },
    ...settingsItems.filter((item) => item.kind === "retention"),
    { id: "filters", title: t("settings.categories.filters") },
  ]
  const settingsIndex = Math.max(
    0,
    settingsCategories.findIndex((item) => item.id === selectedSettingsId)
  )
  const selectedSettings = settingsItems.find(
    (settings) => settings.id === settingsCategories[settingsIndex]?.id
  )

  React.useEffect(() => {
    if (!detailOpen) return
    const selectedId =
      view === "user"
        ? selectedMemory?.id
        : adminTab === "settings"
          ? selectedSettings?.id
          : adminTab === "memory"
            ? selectedAdminMemory?.id
            : undefined
    if (!selectedId) return
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          recordDomId(view === "user" ? "user" : adminTab, selectedId)
        )
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  }, [
    adminTab,
    detailOpen,
    selectedAdminMemory?.id,
    selectedSettings?.id,
    selectedMemory?.id,
    view,
  ])

  const changeMemoryPage = async (pageNumber: number, pageSize: number) => {
    if (loading || loadingMore) return
    if (pageSize !== memoryPageSize) {
      setMemoryPageSize(pageSize)
      return
    }
    if (pageNumber === memoryPage) return
    const cursor =
      pageNumber === memoryPage + 1
        ? nextCursor
        : memoryCursors.current[pageNumber - 1]
    if (pageNumber > 1 && !cursor) return
    const generation = requestGenerationRef.current
    const request = ++memoryPageRequest.current
    setLoadingMore(true)
    try {
      const result = await loadMemoryPage(
        agentId,
        cursor ?? undefined,
        pageSize
      )
      if (
        generation !== requestGenerationRef.current ||
        request !== memoryPageRequest.current
      )
        return
      memoryCursors.current[pageNumber - 1] = cursor ?? undefined
      memoryCursors.current.length = pageNumber
      setMemories(result.items)
      setMemoryTotal(result.total)
      setNextCursor(result.nextCursor)
      setMemoryPage(pageNumber)
      setDetailOpen(false)
      setMessage("")
      rootRef.current
        ?.querySelector("[data-memory-list]")
        ?.scrollIntoView({ block: "start" })
    } catch (error) {
      if (
        generation !== requestGenerationRef.current ||
        request !== memoryPageRequest.current
      )
        return
      setMessage(
        error instanceof Error ? error.message : t("message.loadFailed")
      )
    } finally {
      if (
        generation === requestGenerationRef.current &&
        request === memoryPageRequest.current
      )
        setLoadingMore(false)
    }
  }

  const loadMoreAdminMemories = async () => {
    if (!adminNextCursor || loadingMore) return
    const generation = requestGenerationRef.current
    setLoadingMore(true)
    try {
      const page = await loadAdminMemoryPage(agentId, adminNextCursor)
      if (generation !== requestGenerationRef.current) return
      setAdminMemories((current) => {
        const byId = new Map(current.map((memory) => [memory.id, memory]))
        page.items.forEach((memory) => byId.set(memory.id, memory))
        return Array.from(byId.values())
      })
      setAdminMemoryTotal(page.total)
      setAdminNextCursor(page.nextCursor)
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setMessage(
        error instanceof Error ? error.message : t("message.loadMoreFailed")
      )
    } finally {
      if (generation === requestGenerationRef.current) setLoadingMore(false)
    }
  }

  const forgetSelectedMemory = async () => {
    if (!selectedMemory || deleting) return
    if (selectedMemory.legalHold) {
      setMessage(t("message.legalHold"))
      return
    }
    if (
      !(await confirm(
        t("confirm.forget.body"),
        t("confirm.forget.title"),
        t("confirm.forget.action")
      ))
    )
      return
    const generation = requestGenerationRef.current
    setDeleting(true)
    try {
      await deleteMemory(selectedMemory.entityId, agentId)
      if (generation !== requestGenerationRef.current) return
      setMessage(t("message.deleted"))
      setDetailOpen(false)
      await refreshData()
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setMessage(
        error instanceof Error ? error.message : t("message.deleteFailed")
      )
    } finally {
      if (activeAgentRef.current === agentId) setDeleting(false)
    }
  }

  const executeRetention = async () => {
    const policy = selectedSettings?.policy
    if (runningRetention || !capabilities?.available || !policy?.enabled) return
    if (
      !(await confirm(
        t("confirm.retention.body"),
        t("confirm.retention.title"),
        t("confirm.retention.action")
      ))
    )
      return
    const generation = requestGenerationRef.current
    setRunningRetention(true)
    setMessage(t("message.runningRetention"))
    try {
      await runRetention(policy.policyId)
      if (generation !== requestGenerationRef.current) return
      await refreshData()
      if (activeAgentRef.current !== agentId) return
      setMessage(t("message.retentionFinished"))
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setMessage(
        error instanceof Error ? error.message : t("message.retentionFailed")
      )
    } finally {
      if (activeAgentRef.current === agentId) setRunningRetention(false)
    }
  }

  const emptyDetail = (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {t("detail.empty")}
    </p>
  )
  const emptyList = (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {t("list.empty")}
    </p>
  )

  const memoryList = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start gap-1">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {t("list.title")}
        </h2>
        <p className="text-sm text-body">{t("list.hint")}</p>
        {focusEntityIds.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5 h-auto py-1 whitespace-normal"
            onClick={onClearFocus}
          >
            {focusRelationship === "saved"
              ? t("list.focusSaved", { count: focusEntityIds.length })
              : t("list.focusUsed", { count: focusEntityIds.length })}
          </Button>
        )}
      </div>
      {(loading || loadingMore) && visibleMemories.length > 0 && (
        <InlineLoading>{t("list.loading")}</InlineLoading>
      )}
      {visibleMemories.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {visibleMemories.map((memory) => (
            <li key={memory.id}>
              <RecordRow
                id={memory.id}
                scope="user"
                selected={memory.id === selectedMemory?.id}
                title={memory.title}
                meta={`${memory.sourceLabel}${memory.usageCount ? ` / ${t("usage.used", { count: memory.usageCount })}` : ""}`}
                status={memory.state === "Retained" ? "Current" : memory.state}
                detail={
                  memory.state === "Needs attention"
                    ? memoryStatusDetail(memory, capabilities)
                    : displayType(memory.category ?? memory.entityType)
                }
                onSelect={() => {
                  setSelectedMemoryId(memory.id)
                  setDetailOpen(true)
                }}
              />
            </li>
          ))}
        </ul>
      ) : loading ? (
        <ContentSkeleton label={t("list.loading")} rows={5} />
      ) : (
        emptyList
      )}
      {!focusEntityIds.length && (
        <Pagination
          id="memory-page-size"
          page={memoryPage}
          pageSize={memoryPageSize}
          pageSizes={[10, 20, 50, 100]}
          totalItems={memoryTotal}
          isLastPage={!nextCursor}
          disabled={loading || loadingMore}
          itemsPerPageText={t("list.perPage")}
          onChange={({ page, pageSize }) =>
            void changeMemoryPage(page, pageSize)
          }
        />
      )}
    </div>
  )

  const refreshButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => void refreshData()}
    >
      <RefreshCwIcon data-icon="inline-start" />
      {t("common:action.refresh")}
    </Button>
  )

  return (
    <div ref={rootRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:px-6">
        {!serviceEnabled && (
          <Notice kind="warning" title={t("serviceOff.title")}>
            {t("serviceOff.body")}
          </Notice>
        )}
        <div aria-live="polite">
          {message && (
            <Notice
              kind="info"
              title={message}
              onClose={() => setMessage("")}
            />
          )}
        </div>

        {view === "user" ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">
                  {t("header.eyebrow")}
                </p>
                <h1 className="truncate text-2xl font-semibold">{agentName}</h1>
                <p className="text-sm text-body">{t("header.userSubtitle")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                >
                  <ArrowLeftIcon data-icon="inline-start" />
                  {t("common:app.backToChat")}
                </Button>
                {canManage && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setView("admin")}
                  >
                    {t("header.administration")}
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                )}
              </div>
            </header>

            <MemoryPreferences className="glass-card rounded-xl border p-4" />

            <div className="flex flex-wrap items-end gap-3">
              <InputGroup className="glass-card max-w-md min-w-56 flex-1">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  id="memory-search"
                  type="search"
                  aria-label={t("toolbar.search")}
                  placeholder={t("toolbar.search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </InputGroup>
              <SelectField
                id="memory-type"
                label={t("toolbar.type")}
                className="w-44"
                value={entityType}
                onChange={(event) => setEntityType(event.target.value)}
              >
                <NativeSelectOption value="all">
                  {t("toolbar.allTypes")}
                </NativeSelectOption>
                {entityTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {displayType(type)}
                  </NativeSelectOption>
                ))}
              </SelectField>
              <SelectField
                id="memory-sort"
                label={t("toolbar.sort")}
                className="w-44"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as MemorySort)
                  setDetailOpen(false)
                }}
              >
                <NativeSelectOption value="recently-saved">
                  {t("toolbar.sortOptions.recentlySaved")}
                </NativeSelectOption>
                <NativeSelectOption value="recently-used">
                  {t("toolbar.sortOptions.recentlyUsed")}
                </NativeSelectOption>
                <NativeSelectOption value="most-used">
                  {t("toolbar.sortOptions.mostUsed")}
                </NativeSelectOption>
                <NativeSelectOption value="least-used">
                  {t("toolbar.sortOptions.leastUsed")}
                </NativeSelectOption>
                <NativeSelectOption value="oldest">
                  {t("toolbar.sortOptions.oldest")}
                </NativeSelectOption>
                <NativeSelectOption value="name">
                  {t("toolbar.sortOptions.name")}
                </NativeSelectOption>
              </SelectField>
              <div className="ml-auto flex items-center gap-2">
                <span
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {focusEntityIds.length
                    ? t("list.referencedCount", {
                        count: visibleMemories.length,
                      })
                    : t("list.pageCount", {
                        shown: visibleMemories.length,
                        total: memoryTotal,
                      })}
                </span>
                {refreshButton}
              </div>
            </div>

            <MasterDetail
              listLabel={t("list.label")}
              list={memoryList}
              detail={
                selectedMemory ? (
                  <MemoryDetail
                    memory={selectedMemory}
                    capabilities={capabilities}
                    deleting={deleting}
                    onDelete={() => void forgetSelectedMemory()}
                    onOpenConversation={onOpenConversation}
                  />
                ) : (
                  emptyDetail
                )
              }
              detailLabel={t("list.detailLabel")}
              sheetOpen={detailOpen}
              closeSheet={() => setDetailOpen(false)}
            />
          </>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">
                  {t("header.eyebrow")}
                </p>
                <h1 className="truncate text-2xl font-semibold">
                  {t("header.adminTitle")}
                </h1>
                <p className="text-sm text-body">{t("header.adminSubtitle")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                >
                  <ArrowLeftIcon data-icon="inline-start" />
                  {t("common:app.backToChat")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setView("user")}
                >
                  {t("header.yourMemory")}
                </Button>
              </div>
            </header>

            <Tabs
              value={adminTab}
              onValueChange={(value) => {
                setAdminTab(value as AdminTab)
                setDetailOpen(false)
              }}
            >
              <TabsList aria-label={t("header.adminTitle")}>
                <TabsTrigger value="settings" className="px-2.5">
                  {t("admin.tabs.settings")}
                </TabsTrigger>
                <TabsTrigger value="memory" className="px-2.5">
                  {t("admin.tabs.memory")}
                </TabsTrigger>
                <TabsTrigger value="activity" className="px-2.5">
                  {t("admin.tabs.activity")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="settings" className="pt-2">
                <Tabs
                  orientation="vertical"
                  className="gap-6 max-md:flex-col"
                  value={settingsCategories[settingsIndex].id}
                  onValueChange={(value) =>
                    setSelectedSettingsId(String(value))
                  }
                >
                  <TabsList
                    aria-label={t("settings.categories.label")}
                    className="w-full shrink-0 items-stretch self-start md:w-52"
                  >
                    {settingsCategories.map((item) => (
                      <TabsTrigger
                        key={item.id}
                        value={item.id}
                        className="h-auto px-2.5 py-1.5 text-left whitespace-normal"
                      >
                        {item.title}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {settingsCategories.map((category) => {
                    const item = settingsItems.find(
                      (candidate) => candidate.id === category.id
                    )
                    return (
                      <TabsContent
                        key={category.id}
                        value={category.id}
                        className="glass-card min-w-0 rounded-xl border p-4"
                      >
                        {category.id === "general" ? (
                          <MemoryPreferences admin />
                        ) : category.id === "filters" ? (
                          <div className="flex flex-col gap-3">
                            <p className="text-sm text-body">
                              {t("settings.filters.intro")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("settings.filters.scope")}
                            </p>
                            {settingsItems
                              .filter(
                                (candidate) => candidate.kind === "protection"
                              )
                              .map((candidate) => (
                                <SettingsDetail
                                  readOnly={!serviceEnabled}
                                  key={candidate.id}
                                  settings={candidate}
                                  capabilities={capabilities}
                                  runningRetention={runningRetention}
                                  onRunRetention={() => {}}
                                />
                              ))}
                            <p className="text-xs text-muted-foreground">
                              {t("settings.filters.note")}
                            </p>
                          </div>
                        ) : item ? (
                          <SettingsDetail
                            readOnly={!serviceEnabled}
                            settings={item}
                            capabilities={capabilities}
                            latestRun={runs.find(
                              (run) => run.policyId === item.policy?.policyId
                            )}
                            runningRetention={runningRetention}
                            onRunRetention={() => void executeRetention()}
                          />
                        ) : null}
                      </TabsContent>
                    )
                  })}
                </Tabs>
              </TabsContent>

              <TabsContent value="memory" className="flex flex-col gap-4 pt-2">
                <div className="flex flex-wrap items-end gap-3">
                  <SelectField
                    id="admin-memory-owner"
                    label={t("admin.memoryAbout")}
                    className="w-56"
                    value={adminOwner}
                    onChange={(event) => setAdminOwner(event.target.value)}
                  >
                    <NativeSelectOption value="all">
                      {t("admin.allOwners")}
                    </NativeSelectOption>
                    {adminOwners.map((owner) => (
                      <NativeSelectOption key={owner} value={owner}>
                        {owner}
                      </NativeSelectOption>
                    ))}
                  </SelectField>
                  <SelectField
                    id="admin-memory-state"
                    label={t("admin.status")}
                    className="w-56"
                    value={adminState}
                    onChange={(event) => setAdminState(event.target.value)}
                  >
                    <NativeSelectOption value="all">
                      {t("admin.allStates")}
                    </NativeSelectOption>
                    <NativeSelectOption value="Needs attention">
                      {t("status.needsAttention")}
                    </NativeSelectOption>
                    <NativeSelectOption value="Retained">
                      {t("status.retained")}
                    </NativeSelectOption>
                    <NativeSelectOption value="Protected">
                      {t("status.protected")}
                    </NativeSelectOption>
                  </SelectField>
                  <div className="ml-auto flex items-center gap-2">
                    <span
                      aria-live="polite"
                      className="text-xs text-muted-foreground"
                    >
                      {t("admin.showing", {
                        shown: visibleAdminMemories.length,
                        total: adminMemoryTotal,
                      })}
                    </span>
                    {refreshButton}
                  </div>
                </div>
                <MasterDetail
                  listLabel={t("admin.listLabel")}
                  list={
                    <div className="flex flex-col gap-3">
                      {visibleAdminMemories.length ? (
                        <ul className="flex flex-col gap-1.5">
                          {visibleAdminMemories.map((memory) => (
                            <li key={memory.id}>
                              <RecordRow
                                id={memory.id}
                                scope="memory"
                                selected={memory.id === selectedAdminMemory?.id}
                                title={memory.title}
                                meta={`${memory.ownerLabel ?? t("record.ownerUnavailable")} / ${memory.sourceLabel}`}
                                status={memory.state}
                                detail={
                                  memory.state === "Needs attention"
                                    ? memoryStatusDetail(memory, capabilities)
                                    : displayType(
                                        memory.category ?? memory.entityType
                                      )
                                }
                                onSelect={() => {
                                  setSelectedAdminMemoryId(memory.id)
                                  setDetailOpen(true)
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : loading ? (
                        <ContentSkeleton label={t("list.loading")} rows={5} />
                      ) : (
                        emptyList
                      )}
                      {adminNextCursor &&
                        adminOwner === "all" &&
                        adminState === "all" && (
                          <div className="flex justify-center">
                            <AsyncButton
                              variant="ghost"
                              size="sm"
                              busy={loadingMore}
                              busyLabel={t("common:state.loading")}
                              onClick={() => void loadMoreAdminMemories()}
                            >
                              {t("admin.loadMore")}
                            </AsyncButton>
                          </div>
                        )}
                    </div>
                  }
                  detail={
                    selectedAdminMemory ? (
                      <MemoryDetail
                        memory={selectedAdminMemory}
                        capabilities={capabilities}
                        admin
                        onOpenConversation={onOpenConversation}
                      />
                    ) : (
                      emptyDetail
                    )
                  }
                  detailLabel={t("admin.detailLabel")}
                  sheetOpen={detailOpen}
                  closeSheet={() => setDetailOpen(false)}
                />
              </TabsContent>

              <TabsContent value="activity" className="pt-2">
                <CollectionActivity
                  policies={retentionPolicies}
                  agentId={agentId}
                  refreshKey={runs}
                  refreshing={loading}
                  onRefresh={() => void refreshData()}
                  onOpen={(memory) => {
                    setAdminMemories((items) =>
                      items.some((item) => item.id === memory.id)
                        ? items.map((item) =>
                            item.id === memory.id ? memory : item
                          )
                        : [...items, memory]
                    )
                    setAdminOwner("all")
                    setAdminState("all")
                    setSelectedAdminMemoryId(memory.id)
                    setAdminTab("memory")
                    setDetailOpen(true)
                  }}
                  history={
                    runs.length ? (
                      <Accordion className="rounded-lg border">
                        {runs.map((run) => (
                          <AccordionItem key={run.runId} value={run.runId}>
                            <AccordionTrigger className="items-center gap-3 px-3">
                              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <time dateTime={run.createdAt}>
                                  {new Date(run.createdAt).toLocaleString(
                                    i18n.language
                                  )}
                                </time>
                                <StatusPill status={runStatus(run)} />
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-3">
                              <RetentionRunDetail
                                run={run}
                                memories={adminMemories}
                                capabilities={capabilities}
                                onOpenMemory={(memoryId) => {
                                  setAdminOwner("all")
                                  setAdminState("all")
                                  setSelectedAdminMemoryId(memoryId)
                                  setAdminTab("memory")
                                  setDetailOpen(true)
                                }}
                              />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : loading ? (
                      <ContentSkeleton label={t("admin.loadingRuns")} />
                    ) : (
                      <p className="text-muted-foreground">
                        {t("admin.noRuns")}
                      </p>
                    )
                  }
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
      <AlertDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        confirmLabel={
          pendingConfirm?.confirmLabel ?? t("common:action.confirm")
        }
        onConfirm={() => settleConfirm(true)}
        onCancel={() => settleConfirm(false)}
      />
    </div>
  )
}
