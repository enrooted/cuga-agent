/*
 * Studio → Dashboard, Flows and Runs: the armed watchers, their lifecycle
 * (view / pause / resume / delete) and the execution log.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (FlowDetail, FlowsTab, RunDetail, DashboardTab, RunsTab)
 * (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, PauseIcon, PlayIcon, RefreshCwIcon, Trash2Icon, WorkflowIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Notice } from "@/components/manage/form"
import { IconButton, InlineLoading, Notice as ClosableNotice, SelectField } from "@/components/manage/knowledge/parts"
import {
  CardFoot,
  CardHead,
  CardTitle,
  ContentSkeleton,
  Loader,
  Muted,
  RunStatusTag,
  STUDIO_GRID,
  StudioCard,
  Tag,
  fmtEpoch,
  fmtTime,
  useEndpoint,
  useStudioAction,
  useStudioFeedback,
  type Rec,
} from "@/components/events/studio-parts"
import i18n from "@/i18n"
import * as api from "@/lib/events/api"

const PRE = "rounded-lg border bg-background/60 p-3 font-sans text-[0.8125rem] leading-normal break-words whitespace-pre-wrap text-body"

/**
 * Walk the AP flow's trigger → nextAction chain into a flat step list, then
 * show the CUGA Source → Agent → Sink model and those AP steps.
 */
function FlowDetail({ detail }: { detail: Rec }) {
  const { t } = useTranslation("studio")
  const s: Rec = detail?.subscription || {}
  const ap: Rec | null = detail?.ap_flow || null
  const steps: { name: string; piece?: string; action?: string }[] = []
  let node: Rec | undefined = ap?.version?.trigger
  while (node) {
    const set: Rec = node.settings || {}
    steps.push({ name: node.displayName || node.name, piece: set.pieceName, action: set.actionName || set.triggerName })
    node = node.nextAction
  }
  // The post-agent ACTION. For a DIRECT trigger (slack / discord / telegram) it
  // lives in config.action_plan (the executor); there is no AP flow to walk, so
  // this is the only place it shows. For an AP-push flow it also appears below.
  const plan: Rec | undefined = s.config?.action_plan
  const actionLabel: string = plan?.steps?.length
    ? plan.steps.map((x: Rec) => t("flows.detail.executorStep", { app: x.app, action: x.ap_action })).join(" + ")
    : plan?.branches?.length
      ? t("flows.detail.branched", { branches: plan.branches.map((b: Rec) => b.tag || `${b.step?.app}/${b.step?.ap_action}`).join(" / ") })
      : ""
  return (
    <div className="flex flex-col gap-3">
      <Muted>
        <strong>{t("flows.detail.source")}</strong> {s.source_connector || s.source_type} → <strong>{t("flows.detail.agent")}</strong> {s.target_agent}
        {actionLabel && (
          <>
            {" "}
            → <strong>{t("flows.detail.action")}</strong> {actionLabel}
          </>
        )}{" "}
        → <strong>{t("flows.detail.sink")}</strong> {(s.deliver_to || []).join(", ") || "web"}
      </Muted>
      <p className="flex flex-wrap gap-1">
        <Tag>{s.mode}</Tag>
        <Tag tone={s.status === "paused" ? "neutral" : "ok"}>{s.status}</Tag>
        {s.flow_name && <Tag tone="outline">{s.flow_name}</Tag>}
      </p>
      <Muted className="text-[0.8125rem]">{s.prompt}</Muted>
      <h4 className="text-sm font-semibold">{t("flows.detail.stepsHeading")}</h4>
      {ap ? (
        <ol className="list-decimal pl-5 text-[0.8125rem] text-body">
          {steps.map((st, i) => (
            <li key={i} className="mb-1">
              <strong>{st.name}</strong> {st.piece && <code className="rounded-sm bg-muted px-1">{String(st.piece).replace("@activepieces/piece-", "")}</code>}
              {st.action && <span className="text-muted-foreground"> · {st.action}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <Muted>
          {actionLabel ? (
            <Trans t={t} i18nKey="flows.detail.directTrigger" components={{ action: <code>{actionLabel}</code> }} />
          ) : (
            t("flows.detail.noApFlow")
          )}
        </Muted>
      )}
    </div>
  )
}

export function FlowsSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { confirm } = useStudioFeedback()
  const [tick, setTick] = React.useState(0)
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsSubscriptions, (d) => d.subscriptions ?? [], refresh + tick)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<Rec | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)

  const act = async (id: string, fn: (id: string) => Promise<Response>) => {
    setBusy(id)
    setActionError(null)
    try {
      const res = await fn(id)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || res.statusText)
      setTick((n) => n + 1)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("flows.actionFailed"))
    } finally {
      setBusy(null)
    }
  }
  const del = async (id: string, name: string) => {
    if (!(await confirm(t("flows.deleteConfirm", { name }), t("flows.deleteFlow")))) return
    await act(id, api.deleteFlow)
  }
  const view = async (id: string) => {
    setDetailLoading(true)
    setDetail({ id })
    setActionError(null)
    try {
      const res = await api.getEventsFlowDetail(id)
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || res.statusText)
      setDetail(d)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("flows.loadFailed"))
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Loader loading={loading} refreshing={refreshing} error={error} />
      {busy && <InlineLoading>{t("flows.updating")}</InlineLoading>}
      {actionError && (
        <ClosableNotice kind="error" title={t("error")} onClose={() => setActionError(null)}>
          {actionError}
        </ClosableNotice>
      )}
      {!loading && !error && (data?.length ?? 0) === 0 && (
        <Notice kind="info" title={t("flows.emptyTitle")}>
          {t("flows.emptyBody")}
        </Notice>
      )}
      <div className={STUDIO_GRID}>
        {data?.map((s) => {
          const paused = s.status === "paused"
          const flowLabel: string = s.flow_name || s.id
          return (
            <StudioCard key={s.id}>
              <CardHead>
                <CardTitle>
                  <WorkflowIcon aria-hidden="true" /> <span className="truncate">{s.target_agent}</span>
                </CardTitle>
                <Tag>{s.mode}</Tag>
              </CardHead>
              {s.flow_name && (
                <Muted className="text-xs">
                  <Trans t={t} i18nKey="flows.flowName" components={{ name: <code>{s.flow_name}</code> }} />
                </Muted>
              )}
              <Muted>{s.prompt || `${s.source_type}/${s.source_connector}`}</Muted>
              <Muted className="text-[0.6875rem]">
                {paused ? t("flows.pausedSince", { time: fmtEpoch(s.created_at) }) : t("flows.enabledSince", { time: fmtEpoch(s.created_at) })}
              </Muted>
              <CardFoot>
                <Tag tone="outline">{s.backend}</Tag>
                <Tag tone={paused ? "neutral" : "ok"}>{s.status}</Tag>
                {s.deliver_to?.length > 0 && <Tag>→ {s.deliver_to.join(", ")}</Tag>}
              </CardFoot>
              <div className="flex flex-wrap gap-1 border-t pt-3">
                <Button size="sm" variant="ghost" disabled={busy === s.id} aria-label={t("flows.viewFlow", { name: flowLabel })} onClick={() => void view(s.id)}>
                  <EyeIcon data-icon="inline-start" />
                  {t("view")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === s.id}
                  aria-label={paused ? t("flows.resumeFlow", { name: flowLabel }) : t("flows.pauseFlow", { name: flowLabel })}
                  onClick={() => void act(s.id, paused ? api.resumeFlow : api.pauseFlow)}
                >
                  {paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
                  {paused ? t("flows.resume") : t("flows.pause")}
                </Button>
                <Button size="sm" variant="destructive" disabled={busy === s.id} aria-label={t("flows.deleteFlowNamed", { name: flowLabel })} onClick={() => void del(s.id, flowLabel)}>
                  <Trash2Icon data-icon="inline-start" />
                  {t("common:action.delete")}
                </Button>
              </div>
            </StudioCard>
          )
        })}
      </div>
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("flows.detailTitle", { name: detail?.subscription?.flow_name || detail?.id || "" })}</DialogTitle>
            <DialogDescription className="sr-only">{t("flows.detailDescription")}</DialogDescription>
          </DialogHeader>
          {detailLoading ? <ContentSkeleton label={t("flows.loading")} /> : detail?.subscription ? <FlowDetail detail={detail} /> : <Muted>{t("flows.noDetail")}</Muted>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One run: status, the flow's utterance, the agent's output and the trigger payload. */
function RunDetail({ detail }: { detail: Rec }) {
  const { t } = useTranslation("studio")
  if (detail?.error) {
    return (
      <Notice kind="error" title={t("error")}>
        {String(detail.error)}
      </Notice>
    )
  }
  const run: Rec = detail?.run || {}
  const trig = detail?.trigger_payload
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2">
        <RunStatusTag status={run.status} />
        <span className="text-xs text-muted-foreground">{fmtTime(run.started_at)}</span>
      </p>
      {detail?.utterance && (
        <Muted className="text-xs">
          <Trans t={t} i18nKey="runDetail.flow" components={{ utterance: <i>{detail.utterance}</i> }} />
        </Muted>
      )}
      {detail?.error_msg && (
        <Notice kind="error" title={t("runDetail.flowError")}>
          {String(detail.error_msg)}
        </Notice>
      )}
      <h4 className="mt-1 text-sm font-semibold">{t("runDetail.agentOutput")}</h4>
      {detail?.answer ? <pre className={PRE}>{detail.answer}</pre> : <Muted>{t("runDetail.noAnswer")}</Muted>}
      {trig != null && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("runDetail.triggerPayload")}</summary>
          <pre className={`${PRE} mt-1.5 max-h-56 overflow-auto font-mono text-xs`}>{JSON.stringify(trig, null, 2).slice(0, 4000)}</pre>
        </details>
      )}
    </div>
  )
}

const backendLabel = (b?: string) => (b === "native" ? "native" : b === "ap" ? "AP" : b || "—")

/**
 * The events control plane at a glance: summary tiles, every watcher (with
 * pause / resume / delete), and recent runs (agent · type · tools · answer).
 * Refreshes every 10 s.
 */
export function DashboardSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { confirm } = useStudioFeedback()
  const { pending, run } = useStudioAction()
  const [tick, setTick] = React.useState(0)
  const subsE = useEndpoint<Rec>(api.getEventsSubscriptions, (d) => d, refresh + tick)
  const runsE = useEndpoint<Rec[]>(api.getEventsRuns, (d) => d.runs ?? [], refresh + tick)
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10000)
    return () => clearInterval(id)
  }, [])

  const data: Rec = subsE.data || {}
  const summary: Rec = data.summary || { by_mode: {} }
  const watchers: Rec[] = data.subscriptions || []
  const runs: Rec[] = runsE.data || []

  const act = async (id: string, what: "pause" | "resume" | "delete") => {
    if (what === "delete" && !(await confirm(t("dashboard.deleteConfirm", { id }), t("dashboard.deleteWatcher")))) return
    await run(id, async () => {
      const response = what === "pause" ? await api.pauseFlow(id) : what === "resume" ? await api.resumeFlow(id) : await api.deleteFlow(id)
      if (!response.ok) throw new Error(t("dashboard.requestFailed", { status: response.status }))
      setTick((n) => n + 1)
    })
  }
  const cadence = (s: Rec): string =>
    s.interval_seconds
      ? s.interval_seconds % 60 === 0
        ? t("dashboard.cadenceMinutes", { value: s.interval_seconds / 60 })
        : t("dashboard.cadenceSeconds", { value: s.interval_seconds })
      : s.cron_expr
        ? t("dashboard.cadenceCron", { expr: s.cron_expr })
        : s.mode === "PUSH"
          ? t("dashboard.onEvent")
          : "—"
  const watches = (s: Rec): string =>
    s.mode === "PUSH" ? `${s.source_connector || ""} · ${s.event || ""}` : ["cron", "interval"].includes(s.source_connector) ? t("dashboard.theClock") : s.source_connector || "—"
  // The actual task / utterance, with the scheduler framing stripped so you see WHAT it watches for.
  const taskOf = (s: Rec): string => {
    let p: string = s.prompt || ""
    const i = p.indexOf("report:\n")
    if (i >= 0) p = p.slice(i + 8)
    return (
      p
        .split("\nThis is a POLL:")[0]
        .replace(/^["“]|["”]$/g, "")
        .trim() || watches(s)
    )
  }

  const tiles: [string, number | undefined][] = [
    [t("dashboard.tile.watchers"), summary.total],
    [t("dashboard.tile.crons"), summary.by_mode?.CRON],
    [t("dashboard.tile.polls"), summary.by_mode?.POLL],
    [t("dashboard.tile.pushes"), summary.by_mode?.PUSH],
    [t("dashboard.tile.nativeNoAp"), summary.native_no_ap],
    [t("dashboard.tile.apFlows"), summary.ap_flows],
    [t("dashboard.tile.paused"), summary.paused],
  ]

  return (
    <div className="flex flex-col gap-4">
      {pending && <InlineLoading>{t("dashboard.updating")}</InlineLoading>}
      <Loader loading={subsE.loading} refreshing={subsE.refreshing} error={subsE.error} kind="table" />
      {!subsE.loading && !subsE.error && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Muted className="text-[0.8125rem]">{t("dashboard.intro")}</Muted>
            <Button variant="ghost" size="sm" onClick={() => setTick((n) => n + 1)}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("common:action.refresh")}
            </Button>
          </div>
          <dl className="flex flex-wrap gap-3">
            {tiles.map(([label, value]) => (
              <div key={label} className="glass-card flex min-w-28 flex-col-reverse rounded-xl border px-4 py-3">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
                <dd className="text-2xl leading-tight font-semibold tabular-nums">{value ?? 0}</dd>
              </div>
            ))}
          </dl>

          <h4 className="text-base font-medium">{t("dashboard.watchers")}</h4>
          {watchers.length === 0 ? (
            <Notice kind="info" title={t("dashboard.noWatchersTitle")}>
              {t("dashboard.noWatchersBody")}
            </Notice>
          ) : (
            <div className="glass-card rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.col.watchingFor")}</TableHead>
                    <TableHead>{t("dashboard.col.agent")}</TableHead>
                    <TableHead>{t("dashboard.col.source")}</TableHead>
                    <TableHead>{t("dashboard.col.type")}</TableHead>
                    <TableHead>{t("dashboard.col.cadence")}</TableHead>
                    <TableHead>{t("dashboard.col.nextFire")}</TableHead>
                    <TableHead>{t("dashboard.col.status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("dashboard.col.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchers.map((s) => {
                    const paused = s.status === "paused"
                    return (
                      <TableRow key={s.id}>
                        <TableCell title={s.prompt || ""} className="max-w-xs whitespace-normal">
                          <div>{taskOf(s).slice(0, 90)}</div>
                          <div className="font-mono text-[0.6875rem] text-muted-foreground">{s.id}</div>
                        </TableCell>
                        <TableCell className="font-semibold">{s.target_agent}</TableCell>
                        <TableCell>{watches(s)}</TableCell>
                        <TableCell>
                          <span className="flex gap-1">
                            <Tag>{s.mode}</Tag>
                            <Tag tone="outline">{s.backend === "native" ? "native" : "AP"}</Tag>
                          </span>
                        </TableCell>
                        <TableCell>
                          {cadence(s)}
                          {s.fire_count ? ` · ×${s.fire_count}` : ""}
                        </TableCell>
                        <TableCell>{s.next_fire ? new Date(s.next_fire * 1000).toLocaleString(i18n.language) : "—"}</TableCell>
                        <TableCell>
                          <Tag tone={paused ? "neutral" : "ok"}>{s.status}</Tag>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            <IconButton
                              label={paused ? t("dashboard.resumeWatcher", { id: s.id }) : t("dashboard.pauseWatcher", { id: s.id })}
                              disabled={pending !== null}
                              onClick={() => void act(s.id, paused ? "resume" : "pause")}
                            >
                              {paused ? <PlayIcon /> : <PauseIcon />}
                            </IconButton>
                            <IconButton label={t("dashboard.deleteWatcherNamed", { id: s.id })} disabled={pending !== null} onClick={() => void act(s.id, "delete")}>
                              <Trash2Icon />
                            </IconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <h4 className="mt-2 text-base font-medium">{t("dashboard.recentRuns")}</h4>
          {runs.length === 0 ? (
            <Notice kind="info" title={t("dashboard.noRunsTitle")}>
              {t("dashboard.noRunsBody")}
            </Notice>
          ) : (
            <div className="glass-card rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.col.when")}</TableHead>
                    <TableHead>{t("dashboard.col.source")}</TableHead>
                    <TableHead>{t("dashboard.col.agent")}</TableHead>
                    <TableHead>{t("dashboard.col.type")}</TableHead>
                    <TableHead>{t("dashboard.col.tools")}</TableHead>
                    <TableHead>{t("dashboard.col.answer")}</TableHead>
                    <TableHead>{t("dashboard.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.slice(0, 30).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmtTime(r.started_at)}</TableCell>
                      {/* SOURCE: which flow produced this run, or "chat" if a human asked
                          directly. The id is the one to match against the Flows section
                          and against `watch id …` in an ARMED reply. */}
                      <TableCell className="font-mono text-xs">
                        {r.subscription_id || r.flow_id ? (
                          <span title={r.flow_name || undefined} className="flex items-center gap-1">
                            <Tag>{t("dashboard.tagFlow")}</Tag> {r.subscription_id || r.flow_id}
                          </span>
                        ) : (
                          <span title={t("dashboard.directMessage", { channel: r.channel || "web" })} className="flex items-center gap-1 text-muted-foreground">
                            <Tag tone="outline">{t("dashboard.tagChat")}</Tag> {r.channel || "web"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold">{r.agent}</TableCell>
                      <TableCell>
                        <span className="flex gap-1">
                          <Tag>{r.mode}</Tag>
                          <Tag tone="outline">{r.backend}</Tag>
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{(r.tools || []).join(", ") || "—"}</TableCell>
                      <TableCell title={r.answer || r.utterance || ""} className="max-w-xs whitespace-normal">
                        {String(r.answer || r.utterance || "").slice(0, 130)}
                      </TableCell>
                      <TableCell>
                        <Tag tone={r.status === "FAILED" ? "warn" : "ok"}>{r.status}</Tag>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const RUN_FILTERS = ["agent", "backend", "integration", "channel", "mode", "status"]

/**
 * The execution log: every run (NOW answers and standing-flow fires),
 * filterable by agent / integration / channel / trigger / backend / status,
 * sortable by column, with the agent's output on demand.
 */
export function RunsSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { notify } = useStudioFeedback()
  const [tick, setTick] = React.useState(0)
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsRuns, (d) => d.runs ?? [], refresh + tick)
  const [f, setF] = React.useState<Record<string, string>>({ agent: "all", backend: "all", integration: "all", channel: "all", mode: "all", status: "all" })
  const [sort, setSort] = React.useState<{ col: string; dir: 1 | -1 }>({ col: "started_at", dir: -1 })
  const [detail, setDetail] = React.useState<Rec | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)

  const runs = data ?? []
  const uniq = (k: string) => Array.from(new Set(runs.map((r) => r[k]).filter(Boolean))).sort()
  const filtered = runs.filter((r) => RUN_FILTERS.every((k) => f[k] === "all" || String(r[k]) === f[k]))
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.col] ?? ""
    const bv = b[sort.col] ?? ""
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir
  })

  const view = async (row: Rec) => {
    setDetailLoading(true)
    setDetail({ id: row.id, utterance: row.utterance })
    try {
      const res = await api.getEventsRunDetail(row.id)
      const d = await res.json()
      setDetail(res.ok ? { ...d, utterance: row.utterance, error_msg: d.error } : { error: d?.error || res.statusText })
    } catch (e) {
      setDetail({ error: e instanceof Error ? e.message : t("runDetail.failed") })
    } finally {
      setDetailLoading(false)
    }
  }

  const th = (col: string, label: string) => {
    const active = sort.col === col
    return (
      <TableHead aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-link focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setSort((s) => ({ col, dir: s.col === col ? ((s.dir * -1) as 1 | -1) : 1 }))}
        >
          {label}
          {active && (sort.dir === 1 ? <ArrowUpIcon className="size-3.5" aria-hidden="true" /> : <ArrowDownIcon className="size-3.5" aria-hidden="true" />)}
        </button>
      </TableHead>
    )
  }
  const filterSel = (key: string, label: string) => (
    <SelectField id={`run-f-${key}`} label={label} size="sm" className="w-36" value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))}>
      <NativeSelectOption value="all">{t("runs.all")}</NativeSelectOption>
      {uniq(key).map((v) => (
        <NativeSelectOption key={String(v)} value={String(v)}>
          {String(v)}
        </NativeSelectOption>
      ))}
    </SelectField>
  )
  const copyFlowId = (id: string) => {
    void navigator.clipboard?.writeText(id).then(
      () => notify(t("runs.flowIdCopied"), "success"),
      () => {}
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Loader loading={loading} refreshing={refreshing} error={error} kind="table" />
      {!loading && !error && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Muted className="text-[0.8125rem]">
              <Trans t={t} i18nKey="runs.intro" components={{ b: <b /> }} />
            </Muted>
            <Button variant="ghost" size="sm" onClick={() => setTick((n) => n + 1)}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("common:action.refresh")}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {filterSel("agent", t("runs.col.agent"))}
            {filterSel("integration", t("runs.col.integration"))}
            {filterSel("channel", t("runs.col.channel"))}
            {filterSel("mode", t("runs.col.trigger"))}
            {filterSel("backend", t("runs.col.backend"))}
            {filterSel("status", t("runs.col.status"))}
          </div>
          {runs.length === 0 ? (
            <Notice kind="info" title={t("runs.noRunsTitle")}>
              {t("runs.noRunsBody")}
            </Notice>
          ) : (
            <div className="glass-card rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {th("started_at", t("runs.col.time"))}
                    {th("agent", t("runs.col.agent"))}
                    {th("utterance", t("runs.col.utterance"))}
                    {th("mode", t("runs.col.trigger"))}
                    {th("backend", t("runs.col.backend"))}
                    {th("integration", t("runs.col.integration"))}
                    {th("channel", t("runs.col.channel"))}
                    <TableHead>{t("runs.col.tools")}</TableHead>
                    {th("flow_id", t("runs.col.flowId"))}
                    {th("status", t("runs.col.status"))}
                    <TableHead>{t("runs.col.output")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmtTime(r.started_at)}</TableCell>
                      <TableCell>{r.agent}</TableCell>
                      <TableCell title={r.utterance || ""} className="max-w-64 truncate">
                        {r.utterance ? (r.utterance.length > 52 ? r.utterance.slice(0, 52) + "…" : r.utterance) : "—"}
                      </TableCell>
                      <TableCell>
                        <Tag>{r.mode}</Tag>
                      </TableCell>
                      <TableCell>
                        <Tag tone="outline">{backendLabel(r.backend)}</Tag>
                      </TableCell>
                      <TableCell>{r.integration}</TableCell>
                      <TableCell>{r.channel}</TableCell>
                      <TableCell title={(r.tools || []).join(", ")} className="max-w-40 truncate font-mono text-xs">
                        {r.tools && r.tools.length ? r.tools.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.flow_id ? (
                          <button
                            type="button"
                            className="cursor-copy rounded-sm outline-none hover:text-link focus-visible:ring-3 focus-visible:ring-ring/50"
                            title={r.flow_name ? t("runs.flowTitleNamed", { id: r.flow_id, name: r.flow_name }) : t("runs.flowTitle", { id: r.flow_id })}
                            aria-label={t("runs.copyFlowId", { id: r.flow_id })}
                            onClick={() => copyFlowId(String(r.flow_id))}
                          >
                            {String(r.flow_id).length > 12 ? String(r.flow_id).slice(0, 10) + "…" : r.flow_id}
                          </button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <RunStatusTag status={r.status} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" aria-label={t("runs.viewOutput", { id: r.id })} onClick={() => void view(r)}>
                          <EyeIcon data-icon="inline-start" />
                  {t("view")}
                </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Muted className="text-xs" aria-live="polite">
            {t("runs.showing", { shown: sorted.length, total: runs.length })}
          </Muted>
        </>
      )}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("runDetail.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("runDetail.description")}</DialogDescription>
          </DialogHeader>
          {detailLoading ? <ContentSkeleton label={t("runDetail.loading")} /> : detail && <RunDetail detail={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
