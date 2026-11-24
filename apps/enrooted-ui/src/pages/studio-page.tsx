/*
 * /studio: the events control plane. Turns natural language into worker
 * agents and triggers; configuration and visibility only, every decision runs
 * server-side.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (Copyright IBM Corp., Apache-2.0). Loaded lazily from App.tsx, behind
 * RequireManage and EventsGate.
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Notice } from "@/components/manage/form"
import { SelectField } from "@/components/manage/knowledge/parts"
import { ManageShell } from "@/components/manage/manage-shell"
import { AgentsSection } from "@/components/events/agents-section"
import { DashboardSection, FlowsSection, RunsSection } from "@/components/events/automation-sections"
import { ConciergeChat } from "@/components/events/concierge-chat"
import { ChannelsSection, IntegrationsSection, SetupSection } from "@/components/events/connections-sections"
import { AdminSection, ApiSection, ExamplesSection, ProfileSection } from "@/components/events/service-sections"
import { StudioFeedbackProvider } from "@/components/events/studio-parts"
import * as api from "@/lib/events/api"
import { cn } from "@/lib/utils"

const STUDIO_NAVIGATION = [
  {
    titleKey: "nav.group.automation",
    items: [
      { id: "dashboard", labelKey: "nav.section.dashboard" },
      { id: "concierge", labelKey: "nav.section.concierge" },
      { id: "agents", labelKey: "nav.section.agents" },
      { id: "flows", labelKey: "nav.section.flows" },
      { id: "runs", labelKey: "nav.section.runs" },
      { id: "examples", labelKey: "nav.section.examples" },
    ],
  },
  {
    titleKey: "nav.group.connections",
    items: [
      { id: "channels", labelKey: "nav.section.channels" },
      { id: "integrations", labelKey: "nav.section.integrations" },
      { id: "setup", labelKey: "nav.section.setup" },
    ],
  },
  {
    titleKey: "nav.group.service",
    items: [
      { id: "profile", labelKey: "nav.section.profile" },
      { id: "admin", labelKey: "nav.section.admin" },
      { id: "api", labelKey: "nav.section.api" },
    ],
  },
]
const STUDIO_SECTIONS = STUDIO_NAVIGATION.flatMap((group) => group.items)

const sectionPath = (id: string) => (id === "dashboard" ? "/studio" : `/studio?section=${id}`)

export function StudioPage() {
  const { t } = useTranslation("studio")
  const navigate = useNavigate()
  const [status, setStatus] = React.useState<api.EventsStatus | null>(null)
  const [checked, setChecked] = React.useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const selected = STUDIO_SECTIONS.find((item) => item.id === searchParams.get("section")) ?? STUDIO_SECTIONS[0]
  // A section mounts on first visit and then stays mounted (hidden), so its
  // state — the concierge transcript, filters — survives switching sections.
  const [visited, setVisited] = React.useState(() => new Set([selected.id]))
  React.useEffect(() => {
    setVisited((previous) => (previous.has(selected.id) ? previous : new Set([...previous, selected.id])))
  }, [selected.id])
  const selectSection = (id: string) => {
    const params = new URLSearchParams(searchParams)
    if (id === "dashboard") params.delete("section")
    else params.set("section", id)
    setSearchParams(params)
  }
  const [draft, setDraft] = React.useState("")
  const [refresh, setRefresh] = React.useState(0)

  React.useEffect(() => {
    void api.getEventsStatus().then((s) => {
      setStatus(s)
      setChecked(true)
    })
  }, [])

  // Refresh every section after a concierge action or a manual refresh.
  const bump = () => setRefresh((n) => n + 1)

  if (checked && !status) {
    // Events layer not mounted: this route should not be reachable; guide back.
    return (
      <ManageShell title={<h1 className="truncate text-sm font-medium">{t("common:nav.studio")}</h1>}>
        <div className="min-h-0 flex-1 overflow-y-auto pt-12">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-6 py-8">
            <Notice kind="info" title={t("page.offTitle")}>
              {t("page.offBody")}
            </Notice>
            <Button variant="outline" onClick={() => navigate("/manage")}>
              {t("page.backToDashboard")}
            </Button>
          </div>
        </div>
      </ManageShell>
    )
  }

  const onTry = (utterance: string) => {
    setDraft(utterance)
    selectSection("concierge")
  }
  const sectionContent = (id: string) => {
    switch (id) {
      case "dashboard":
        return <DashboardSection refresh={refresh} />
      case "concierge":
        return <ConciergeChat draft={draft} setDraft={setDraft} />
      case "agents":
        return <AgentsSection refresh={refresh} onTry={onTry} />
      case "channels":
        return <ChannelsSection refresh={refresh} />
      case "integrations":
        return <IntegrationsSection refresh={refresh} />
      case "setup":
        return <SetupSection refresh={refresh} />
      case "flows":
        return <FlowsSection refresh={refresh} />
      case "runs":
        return <RunsSection refresh={refresh} />
      case "examples":
        return <ExamplesSection refresh={refresh} onTry={onTry} />
      case "api":
        return <ApiSection />
      case "profile":
        return <ProfileSection refresh={refresh} />
      case "admin":
        return <AdminSection refresh={refresh} />
      default:
        return null
    }
  }

  return (
    <StudioFeedbackProvider>
      <ManageShell
        title={<h1 className="truncate text-sm font-medium">{t("common:nav.studio")}</h1>}
        titleEnd={
          <Button variant="ghost" size="sm" onClick={bump}>
            <RefreshCwIcon data-icon="inline-start" />
            {t("common:action.refresh")}
          </Button>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-12">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
            <header className="flex flex-col gap-2">
              <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">{t("page.eyebrow")}</p>
              <h2 className="text-2xl font-semibold">{t("page.heading")}</h2>
              <p className="text-sm text-body">
                {t("page.intro")}
                {status ? (
                  <span className="text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[0.8125rem]">
                    {" "}
                    <Trans
                      t={t}
                      i18nKey={status.ap_configured ? "page.statusConnected" : "page.statusOff"}
                      components={{
                        scope: <code>{status.scope}</code>,
                        workers: <code>{status.worker_backend ?? "cuga"}</code>,
                        concierge: <code>{status.concierge_backend ?? "react"}</code>,
                      }}
                    />
                  </span>
                ) : (
                  <Skeleton className="ml-2 inline-block h-4 w-64 align-middle" aria-label={t("page.statusLoading")} />
                )}
              </p>
            </header>

            {/* Narrow screens: a labelled select instead of the section list. */}
            <SelectField id="studio-section" label={t("page.sectionSelect")} className="lg:hidden" value={selected.id} onChange={(event) => selectSection(event.target.value)}>
              {STUDIO_NAVIGATION.map((group) => (
                <NativeSelectOptGroup key={group.titleKey} label={t(group.titleKey)}>
                  {group.items.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {t(item.labelKey)}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </SelectField>

            <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <nav aria-label={t("page.sectionsNav")} className="glass-card sticky top-16 hidden max-h-[calc(100dvh-6rem)] flex-col gap-4 overflow-y-auto rounded-xl border p-3 lg:flex">
                {STUDIO_NAVIGATION.map((group) => (
                  <div key={group.titleKey} className="flex flex-col gap-1">
                    <p className="px-2 text-[0.6875rem] font-medium tracking-[0.1em] text-muted-foreground uppercase">{t(group.titleKey)}</p>
                    <ul className="flex flex-col gap-0.5">
                      {group.items.map((item) => {
                        const active = selected.id === item.id
                        return (
                          <li key={item.id}>
                            <Link
                              to={sectionPath(item.id)}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "block rounded-md border-l-2 border-transparent px-2 py-1.5 text-sm text-body outline-none hover:bg-foreground/8 focus-visible:ring-3 focus-visible:ring-ring/50",
                                active && "border-l-accent-line bg-foreground/8 font-medium text-foreground"
                              )}
                            >
                              {t(item.labelKey)}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
              <div className="min-w-0">
                {STUDIO_SECTIONS.map((item) => (
                  <section key={item.id} hidden={selected.id !== item.id} aria-labelledby={`studio-section-${item.id}`}>
                    {(visited.has(item.id) || selected.id === item.id) && (
                      <>
                        <h3 id={`studio-section-${item.id}`} className="mb-4 text-lg font-medium">
                          {t(item.labelKey)}
                        </h3>
                        {sectionContent(item.id)}
                      </>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ManageShell>
    </StudioFeedbackProvider>
  )
}
