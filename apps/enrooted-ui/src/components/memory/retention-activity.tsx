/*
 * Memory administration > Activity: memories awaiting a retention action,
 * recent outcomes, the retention runs and the audit details.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/memory/MemoryWorkspace.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  ClockIcon,
  EyeIcon,
  LockIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"

import { Notice, StatusBadge } from "@/components/manage/knowledge/parts"
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import i18n from "@/i18n"
import {
  loadAdminMemoryEntity,
  loadRetentionCollection,
  type RetentionAuditEvent,
  type RetentionCandidate,
} from "@/lib/memory/api"
import type {
  MemoryRecord,
  RetentionCapabilities,
  RetentionPolicy,
  RetentionReportItem,
  RetentionRun,
} from "@/lib/memory/types"
import {
  ContentSkeleton,
  DefinitionList,
  DetailHeader,
  DetailNote,
  Pagination,
  ReferenceLink,
  displayStatus,
  displayType,
  memoryStatusDetail,
} from "./parts"

export function runStatus(run: RetentionRun): string {
  if (run.status === "running") return "Running"
  if (run.status === "interrupted") return "Interrupted"
  if (run.status === "cancelled") return "Cancelled"
  if (run.status === "failed") return "Failed"
  if (run.status !== "completed" || run.errors.length > 0) return "Incomplete"
  return "Completed"
}

/** Plain audit table with a visible caption above it. */
function AuditTable({
  caption,
  head,
  children,
}: {
  caption: string
  head: string[]
  children: React.ReactNode
}) {
  return (
    <Table>
      <TableCaption className="mt-0 mb-1 caption-top text-left font-medium text-foreground">
        {caption}
      </TableCaption>
      <TableHeader>
        <TableRow>
          {head.map((label) => (
            <TableHead key={label} scope="col">
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function ReportItems({
  title,
  items,
  memories,
  capabilities,
  onOpenMemory,
}: {
  title: string
  items: RetentionReportItem[]
  memories: MemoryRecord[]
  capabilities: RetentionCapabilities | null
  onOpenMemory: (memoryId: string) => void
}) {
  const { t } = useTranslation("memory")
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-1.5 text-sm">
      <h3 className="font-heading font-semibold text-foreground">{title}</h3>
      <p className="text-muted-foreground">{t("run.viewAvailable")}</p>
      {!items.some((item) =>
        memories.some((memory) => memory.entityId === item.entityId)
      ) && <p className="text-muted-foreground">{t("run.notViewable")}</p>}
      <ul className="flex flex-col gap-1.5">
        {items.map((item, index) => {
          const memory = memories.find(
            (candidate) => candidate.entityId === item.entityId
          )
          if (!memory) return null
          const outcome = item.outcome ? displayType(item.outcome) : undefined
          const itemType = item.entityType
            ? displayType(item.entityType)
            : undefined
          const reason = item.reason?.trim()
          return (
            <li
              key={`${item.entityId ?? "unknown"}-${index}`}
              className="flex flex-col"
            >
              <ReferenceLink
                href={`/chat?memory_id=${encodeURIComponent(memory.entityId)}`}
                onClick={() => onOpenMemory(memory.id)}
              >
                <strong className="font-medium">{memory.title}</strong>
              </ReferenceLink>
              <span className="text-xs text-muted-foreground">
                {reason ||
                  (memory.state === "Needs attention"
                    ? memoryStatusDetail(memory, capabilities)
                    : [itemType, outcome].filter(Boolean).join(" / ") ||
                      (item.entityId
                        ? t("run.memoryId", { id: item.entityId })
                        : t("run.unknownMemory")))}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function RetentionRunDetail({
  run,
  memories,
  capabilities,
  onOpenMemory,
}: {
  run: RetentionRun
  memories: MemoryRecord[]
  capabilities: RetentionCapabilities | null
  onOpenMemory: (memoryId: string) => void
}) {
  const { t } = useTranslation("memory")
  const status = runStatus(run)
  return (
    <div className="flex flex-col gap-4 pt-1">
      <DetailHeader
        eyebrow={new Date(run.createdAt).toLocaleString(i18n.language)}
        title={t("run.title")}
        status={status}
      />
      <DetailNote
        title={
          run.deleted.length
            ? t("run.deletionRecorded")
            : t("run.activityRecorded")
        }
        aria-label={t("run.outcomeLabel")}
      >
        <p>{run.summary}</p>
        {run.deleted.length > 0 && <p>{t("run.deletedHidden")}</p>}
        {run.status !== "completed" && <p>{t("run.partial")}</p>}
      </DetailNote>
      {run.warnings.map((warning) => (
        <DetailNote title={t("run.warning")} key={warning}>
          <p>{warning}</p>
        </DetailNote>
      ))}
      {run.errors.map((error) => (
        <DetailNote title={t("run.error")} tone="error" key={error}>
          <p>{error}</p>
        </DetailNote>
      ))}
      <DefinitionList
        items={[
          {
            label: t("run.policy"),
            value: run.policyName ?? run.policyId ?? t("run.unavailable"),
          },
          {
            label: t("run.requestedBy"),
            value: run.initiatedBy || t("run.notRecorded"),
          },
          {
            label: t("run.started"),
            value: new Date(run.startedAt ?? run.createdAt).toLocaleString(
              i18n.language
            ),
          },
          {
            label: t("run.finished"),
            value: run.completedAt
              ? new Date(run.completedAt).toLocaleString(i18n.language)
              : t("run.notRecorded"),
          },
          { label: t("run.result"), value: displayStatus(status) },
        ]}
      />
      <ReportItems
        title={t("run.flaggedForReview")}
        items={run.flagged}
        memories={memories}
        capabilities={capabilities}
        onOpenMemory={onOpenMemory}
      />
      <ReportItems
        title={t("run.skipped")}
        items={run.skipped}
        memories={memories}
        capabilities={capabilities}
        onOpenMemory={onOpenMemory}
      />
      <Accordion>
        <AccordionItem value="audit">
          <AccordionTrigger>{t("run.auditDetails")}</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("run.auditNote")}</p>
            <DefinitionList
              items={[
                { label: t("run.runId"), value: run.runId },
                {
                  label: t("run.policyId"),
                  value: run.policyId ?? t("run.notRecorded"),
                },
              ]}
            />
            <AuditTable
              caption={t("run.actionsCaption")}
              head={[
                t("run.col.outcome"),
                t("run.col.entityReference"),
                t("run.col.reason"),
              ]}
            >
              {(
                [
                  ["flagged", run.flagged],
                  ["deleted", run.deleted],
                  ["skipped", run.skipped],
                ] as const
              ).flatMap(([outcome, items]) =>
                items.map((item, index) => (
                  <TableRow key={`${outcome}-${item.entityId ?? index}`}>
                    <TableCell>{t(`run.outcome.${outcome}`)}</TableCell>
                    <TableCell>
                      <code className="text-xs">
                        {item.entityId ?? t("run.notRecorded")}
                      </code>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {item.reason || t("run.notRecorded")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </AuditTable>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

const PENDING_STATUSES = ["pending", "held", "review"]

function statusLabel(status: string) {
  return status === "held"
    ? i18n.t("memory:activity.candidateStatus.held")
    : status === "review"
      ? i18n.t("memory:activity.candidateStatus.review")
      : i18n.t("memory:activity.candidateStatus.pending")
}

function outcomeLabel(outcome: string) {
  return ["deleted", "held", "flagged", "marked"].includes(outcome)
    ? i18n.t(`memory:activity.outcome.${outcome}`)
    : displayType(outcome)
}

export function CollectionActivity({
  agentId,
  policies,
  refreshKey,
  onOpen,
  history,
  onRefresh,
  refreshing,
}: {
  agentId: string
  policies: RetentionPolicy[]
  refreshKey: RetentionRun[]
  onOpen: (memory: MemoryRecord) => void
  history: React.ReactNode
  onRefresh: () => void
  refreshing: boolean
}) {
  const { t } = useTranslation("memory")
  const [candidates, setCandidates] = React.useState<RetentionCandidate[]>([])
  const [candidateMemories, setCandidateMemories] = React.useState<
    Record<string, MemoryRecord>
  >({})
  const [query, setQuery] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(5)
  const [events, setEvents] = React.useState<RetentionAuditEvent[]>([])
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setCandidates([])
    setCandidateMemories({})
    setEvents([])
    setPage(1)
    loadRetentionCollection()
      .then(async (data) => {
        const pendingIds = [
          ...new Set(
            data.candidates
              .filter((item) => PENDING_STATUSES.includes(item.status))
              .map((item) => item.entity_id)
          ),
        ]
        const records: Record<string, MemoryRecord> = {}
        // Bound requests independently of the Memory tab's inventory pagination.
        for (
          let offset = 0;
          offset < pendingIds.length && active;
          offset += 6
        ) {
          const batch = await Promise.allSettled(
            pendingIds
              .slice(offset, offset + 6)
              .map((id) => loadAdminMemoryEntity(agentId, id))
          )
          for (const result of batch)
            if (result.status === "fulfilled")
              records[result.value.entityId] = result.value
        }
        if (active) {
          setCandidates(data.candidates)
          setCandidateMemories(records)
          setEvents(data.audit)
          setError(false)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshKey, agentId])

  const pending = candidates.filter((item) =>
    PENDING_STATUSES.includes(item.status)
  )
  const policyName = (id: string) =>
    policies.find((policy) => policy.policyId === id)?.name ??
    t("activity.unavailablePolicy")
  const filtered = pending.filter((item) =>
    [
      candidateMemories[item.entity_id]?.title,
      item.entity_id,
      item.policy_id,
      statusLabel(item.status),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / pageSize))
  )
  const groups = Array.from(
    events
      .reduce((groups, event) => {
        const key = `${event.occurred_at.slice(0, 10)}:${event.policy_id}:${event.outcome}`
        const existing = groups.get(key)
        if (existing) existing.count++
        else groups.set(key, { event, count: 1 })
        return groups
      }, new Map<string, { event: RetentionAuditEvent; count: number }>())
      .values()
  )

  return (
    <section aria-label={t("activity.label")} className="flex flex-col gap-3">
      {error && <Notice kind="error" title={t("activity.loadFailed")} />}
      {loading && (
        <ContentSkeleton label={t("activity.loading")} kind="table" rows={5} />
      )}
      <div hidden={loading}>
        <Tabs defaultValue="awaiting">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList aria-label={t("activity.viewsLabel")}>
              <TabsTrigger value="awaiting" className="px-2.5">
                {t("activity.awaiting")}
              </TabsTrigger>
              <TabsTrigger value="history" className="px-2.5">
                {t("activity.history")}
              </TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={refreshing || loading}
              onClick={onRefresh}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {t("common:action.refresh")}
            </Button>
          </div>

          <TabsContent value="awaiting" className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body">{t("activity.awaitingIntro")}</p>
              {!loading && !error && (
                <span
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {t("activity.memoryCount", { count: pending.length })}
                </span>
              )}
            </div>
            <div role="toolbar" aria-label={t("activity.controlsLabel")}>
              <InputGroup className="glass-card max-w-md">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label={t("activity.search")}
                  placeholder={t("activity.search")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                />
              </InputGroup>
            </div>
            <div
              role="region"
              aria-label={t("activity.tableRegionLabel")}
              tabIndex={0}
              className="rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Table aria-label={t("activity.tableLabel")}>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">
                      {t("activity.col.memory")}
                    </TableHead>
                    <TableHead scope="col">
                      {t("activity.col.status")}
                    </TableHead>
                    <TableHead scope="col">
                      {t("activity.col.policy")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered
                    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                    .map((item) => {
                      const memory = candidateMemories[item.entity_id]
                      return (
                        <TableRow
                          key={JSON.stringify([item.policy_id, item.entity_id])}
                        >
                          <TableCell className="max-w-80 whitespace-normal">
                            {memory ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto justify-start px-0 text-left whitespace-normal text-link"
                                onClick={() => onOpen(memory)}
                              >
                                {memory.title}
                              </Button>
                            ) : (
                              <span className="flex flex-col">
                                <span className="break-all">
                                  {t("activity.memoryId", {
                                    id: item.entity_id,
                                  })}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {t("activity.detailsUnavailable")}
                                </span>
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={
                                item.status === "held"
                                  ? "warn"
                                  : item.status === "review"
                                    ? "active"
                                    : "neutral"
                              }
                              icon={
                                item.status === "held" ? (
                                  <LockIcon className="text-status-warn" />
                                ) : item.status === "review" ? (
                                  <EyeIcon className="text-link" />
                                ) : (
                                  <ClockIcon />
                                )
                              }
                            >
                              {statusLabel(item.status)}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {policyName(item.policy_id)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  {!filtered.length && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center whitespace-normal text-muted-foreground"
                      >
                        {loading
                          ? t("activity.empty.loading")
                          : error
                            ? t("activity.empty.failed")
                            : query
                              ? t("activity.empty.noMatch")
                              : t("activity.empty.none")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <Pagination
              id="memory-activity-page-size"
              className="border-t-0 pt-0"
              page={currentPage}
              pageSize={pageSize}
              pageSizes={[5, 10, 20]}
              totalItems={filtered.length}
              itemsPerPageText={t("activity.rowsPerPage")}
              onChange={({ page, pageSize }) => {
                setPage(page)
                setPageSize(pageSize)
              }}
            />
          </TabsContent>

          <TabsContent value="history" className="flex flex-col gap-6 pt-2">
            <section
              aria-labelledby="memory-recent-outcomes"
              className="flex flex-col gap-2"
            >
              <h2
                id="memory-recent-outcomes"
                className="font-heading text-sm font-semibold text-foreground"
              >
                {t("activity.recentOutcomes")}
              </h2>
              <p className="text-muted-foreground">
                {t("activity.recentIntro")}
              </p>
              {!loading && !error && !groups.length && (
                <p className="text-muted-foreground">
                  {t("activity.noActions")}
                </p>
              )}
              <ul className="flex flex-col divide-y rounded-lg border empty:hidden">
                {groups.map(({ event, count }) => (
                  <li
                    key={event.event_id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium text-foreground">
                        {outcomeLabel(event.outcome)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("activity.outcomeSummary", {
                          count,
                          policy: policyName(event.policy_id),
                        })}
                      </span>
                    </div>
                    <time
                      dateTime={event.occurred_at}
                      className="text-xs text-muted-foreground"
                    >
                      {new Date(event.occurred_at).toLocaleDateString(
                        i18n.language,
                        { month: "short", day: "numeric", year: "numeric" }
                      )}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
            <section
              aria-label={t("activity.runsLabel")}
              className="flex flex-col gap-2"
            >
              <h2 className="font-heading text-sm font-semibold text-foreground">
                {t("activity.runs")}
              </h2>
              <p className="text-muted-foreground">{t("activity.runsIntro")}</p>
              {history}
            </section>
            <Accordion>
              <AccordionItem value="audit">
                <AccordionTrigger>
                  {t("activity.auditDetails")}
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-4">
                  <p className="text-muted-foreground">
                    {t("activity.auditLimit")}
                  </p>
                  <AuditTable
                    caption={t("activity.currentMarks")}
                    head={[
                      t("activity.col.reference"),
                      t("activity.col.status"),
                      t("activity.col.policy"),
                    ]}
                  >
                    {pending.map((item) => (
                      <TableRow key={`${item.policy_id}:${item.entity_id}`}>
                        <TableCell>
                          <code className="text-xs">{item.entity_id}</code>
                        </TableCell>
                        <TableCell>
                          {item.status === "held"
                            ? t("activity.blockedByLegalHold")
                            : displayType(item.status)}
                        </TableCell>
                        <TableCell>{item.policy_id}</TableCell>
                      </TableRow>
                    ))}
                  </AuditTable>
                  <AuditTable
                    caption={t("activity.committedActions")}
                    head={[
                      t("activity.col.reference"),
                      t("activity.col.outcome"),
                      t("activity.col.requestedBy"),
                      t("activity.col.time"),
                    ]}
                  >
                    {events.map((event) => (
                      <TableRow key={event.event_id}>
                        <TableCell>
                          <code className="text-xs">{event.entity_id}</code>
                        </TableCell>
                        <TableCell>{displayType(event.outcome)}</TableCell>
                        <TableCell>
                          {event.initiated_by ?? t("activity.notRecorded")}
                        </TableCell>
                        <TableCell>
                          {new Date(event.occurred_at).toLocaleString(
                            i18n.language
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </AuditTable>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}
