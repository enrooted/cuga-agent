/*
 * Studio → Examples, Profile, Admin and API.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (ExamplesTab, ProfileTab, AdminTab, ApiTab) (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon, MessageSquareIcon, SearchIcon, StarIcon, UserPlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { CheckField } from "@/components/manage/form"
import { IconButton } from "@/components/manage/knowledge/parts"
import {
  AsyncButton,
  CardFoot,
  CardHead,
  CardTitle,
  ContentSkeleton,
  Loader,
  Muted,
  STUDIO_GRID,
  StatusTag,
  StudioCard,
  Tag,
  useEndpoint,
  useStudioAction,
  useStudioFeedback,
  type Rec,
} from "@/components/events/studio-parts"
import { getEventsBaseUrl } from "@/lib/api"
import * as api from "@/lib/events/api"

function CopyPromptButton({ text }: { text: string }) {
  const { t } = useTranslation("studio")
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])
  return (
    <>
      <IconButton
        label={t("examples.copyPrompt")}
        onClick={() => {
          try {
            void navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => {}
            )
          } catch {
            /* no clipboard in this context */
          }
        }}
      >
        {copied ? <CheckIcon className="text-status-ok" /> : <CopyIcon />}
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {copied ? t("examples.copied") : ""}
      </span>
    </>
  )
}

export function ExamplesSection({ refresh, onTry }: { refresh: number; onTry: (utterance: string) => void }) {
  const { t } = useTranslation("studio")
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsExamples, (d) => d.examples ?? [], refresh)
  const [starOnly, setStarOnly] = React.useState(false)
  const [q, setQ] = React.useState("")

  const query = q.trim().toLowerCase()
  const items = (data ?? []).filter(
    (e) => (!starOnly || e.star) && (!query || `${e.title} ${e.utterance} ${e.agent} ${e.note} ${e.action || ""}`.toLowerCase().includes(query))
  )

  // Group by agent: a long, copy-pasteable list per agent.
  const groups = new Map<string, Rec[]>()
  for (const e of items) {
    const k: string = e.agent || "—"
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(e)
  }
  // Agents with a recommended example first, then alphabetical.
  const agents = [...groups.keys()].sort((a, b) => {
    const sa = groups.get(a)!.some((e) => e.star) ? 0 : 1
    const sb = groups.get(b)!.some((e) => e.star) ? 0 : 1
    return sa - sb || a.localeCompare(b)
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Muted className="flex-[1_1_20rem] text-[0.8125rem]">
          <Trans
            t={t}
            i18nKey="examples.intro"
            components={{ b: <b />, star: <StarIcon className="inline size-3.5 fill-current align-[-2px]" aria-hidden="true" /> }}
          />
        </Muted>
        <InputGroup className="glass-card max-w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput id="ex-search" type="search" aria-label={t("examples.filter")} placeholder={t("examples.filterPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <div>
          <CheckField id="ex-star-only" label={t("examples.recommendedOnly")} checked={starOnly} onChange={setStarOnly} />
        </div>
      </div>
      <Loader loading={loading} refreshing={refreshing} error={error} />
      {!loading && !error && agents.length === 0 && <Muted>{t("examples.noMatch")}</Muted>}
      {agents.map((agent) => (
        <section key={agent} aria-label={t("examples.groupLabel", { agent })}>
          <h4 className="mb-1.5 flex items-center gap-2 text-base font-medium">
            <BotIcon className="size-4.5 text-link" aria-hidden="true" /> {agent}
            <Badge variant="secondary">{groups.get(agent)!.length}</Badge>
          </h4>
          <ul>
            {[...groups.get(agent)!]
              .sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0))
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2.5 border-b py-1.5">
                  <div className="min-w-0 flex-1 basis-64">
                    <span className="text-[0.8125rem] text-body italic">
                      {e.star && (
                        <StarIcon className="mr-1 inline size-3.5 fill-current align-[-2px] text-link not-italic" role="img" aria-label={t("examples.recommended")} />
                      )}
                      {t("quoted", { text: e.utterance })}
                    </span>
                    {e.note && <Muted className="mt-0.5 text-[0.6875rem]">{e.note}</Muted>}
                  </div>
                  {e.action && <Tag title={t("examples.actionTitle", { action: e.action })}>{t("examples.actions")}</Tag>}
                  <Tag tone="outline">{e.trigger || e.outcome}</Tag>
                  <CopyPromptButton text={e.utterance} />
                  <Button variant="outline" size="sm" onClick={() => onTry(e.utterance)}>
                    {t("examples.tryIt")}
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function ProfileSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { notify } = useStudioFeedback()
  const { pending, run } = useStudioAction()
  const { data, loading, refreshing, error } = useEndpoint<Rec>(api.getEventsMe, (d) => d, refresh)
  const link = (channel: string) => {
    void run(channel, () =>
      api
        .postEventsLinkChannel(channel)
        .then((r) => r.json())
        .then((res) => {
          notify(res.ok ? t("profile.linkHow", { channel, how: String(res.how) }) : t("failed", { error: res.error || t("errorFallback") }), res.ok ? "success" : "error")
        })
    )
  }
  if (loading || error) return <Loader loading={loading} refreshing={refreshing} error={error} kind="list" />
  const connections: Rec[] = data?.connections ?? []
  return (
    <div className="flex flex-col gap-4">
      <StudioCard className="min-h-0">
        <CardHead>
          <CardTitle>{data?.user_id}</CardTitle>
          <span className="flex flex-wrap gap-1">
            {(data?.roles ?? []).map((r: string) => (
              <Tag key={r} tone="outline">
                {r}
              </Tag>
            ))}
          </span>
        </CardHead>
        <Muted>
          <Trans t={t} i18nKey="profile.identity" components={{ email: <>{data?.email}</>, scope: <code>{data?.scope}</code> }} />
        </Muted>
      </StudioCard>
      <h4 className="text-base font-medium">{t("profile.myChannels")}</h4>
      <div className={STUDIO_GRID}>
        {["telegram", "discord", "slack"].map((ch) => {
          const linked = (data?.linked_channels ?? []).some((l: Rec) => l.channel === ch)
          return (
            <StudioCard key={ch} className="min-h-0">
              <CardHead>
                <CardTitle>
                  <MessageSquareIcon aria-hidden="true" /> {ch}
                </CardTitle>
                <StatusTag status={linked ? "connected" : "not_connected"} />
              </CardHead>
              <CardFoot>
                <AsyncButton busy={pending === ch} busyLabel={t("profile.linking")} disabled={pending !== null} variant="outline" size="sm" onClick={() => link(ch)}>
                  {linked ? t("profile.relink") : t("profile.link")}
                  <span className="sr-only"> ({ch})</span>
                </AsyncButton>
              </CardFoot>
            </StudioCard>
          )
        })}
      </div>
      <div>
        <h4 className="text-base font-medium">{t("profile.myIntegrations")}</h4>
        <Muted className="text-[0.8125rem]">
          <Trans t={t} i18nKey="profile.readOnly" components={{ b: <b /> }} />
        </Muted>
      </div>
      {connections.length === 0 ? (
        <Muted>{t("profile.none")}</Muted>
      ) : (
        <div className="flex flex-wrap gap-1">
          {connections.map((c) => (
            <Tag key={c.externalId} tone="ok">
              {c.externalId}
            </Tag>
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { prompt, notify } = useStudioFeedback()
  const { pending, run } = useStudioAction()
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsAdminUsers, (d) => d.users ?? [], refresh)
  const add = async () => {
    const id = await prompt(t("admin.newUserId"))
    if (!id) return
    const email = await prompt(t("admin.email"))
    if (email === null) return
    void run("add-user", () =>
      api
        .postEventsAdminUser({ user_id: id, email, roles: ["user"] })
        .then((r) => r.json())
        .then((res) => notify(res.ok ? t("admin.added", { id }) : t("failed", { error: String(res.error) }), res.ok ? "success" : "error"))
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Loader loading={loading} refreshing={refreshing} error={error} kind="table" />
      <Muted>
        <Trans t={t} i18nKey="admin.intro" components={{ b: <b /> }} />
      </Muted>
      <div>
        <AsyncButton busy={pending === "add-user"} busyLabel={t("admin.addingUser")} variant="outline" size="sm" onClick={() => void add()}>
          <UserPlusIcon data-icon="inline-start" />
          {t("admin.addUser")}
        </AsyncButton>
      </div>
      <div className={STUDIO_GRID}>
        {data?.map((u) => (
          <StudioCard key={u.user_id} className="min-h-0">
            <CardHead>
              <CardTitle>{u.user_id}</CardTitle>
              <span className="flex flex-wrap gap-1">
                {(u.roles ?? []).map((r: string) => (
                  <Tag key={r}>{r}</Tag>
                ))}
              </span>
            </CardHead>
            <Muted>{u.email}</Muted>
          </StudioCard>
        ))}
      </div>
    </div>
  )
}

/**
 * The API reference: FastAPI's own Swagger UI, embedded live from the events
 * service (generated from the running routes, so it cannot drift).
 */
export function ApiSection() {
  // Served by the EVENTS service, not by whoever served this SPA. Resolved
  // asynchronously and held in state: on first mount the synchronous cache is
  // cold and would fall back to the wrong origin in a split deployment.
  const { t } = useTranslation("studio")
  const [base, setBase] = React.useState<string | null>(null)
  const [referenceLoading, setReferenceLoading] = React.useState(true)
  React.useEffect(() => {
    let live = true
    void getEventsBaseUrl().then((b) => {
      if (live) setBase(b)
    })
    return () => {
      live = false
    }
  }, [])
  const url = base ? `${base}/docs` : ""
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Muted className="flex-[1_1_15rem] text-[0.8125rem]">
          <Trans t={t} i18nKey="api.intro" components={{ code: <code /> }} />
        </Muted>
        <Button size="sm" variant="ghost" disabled={!base} render={base ? <a href={`${base}/openapi.json`} target="_blank" rel="noreferrer" /> : undefined}>
          openapi.json
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
        <Button size="sm" variant="ghost" disabled={!base} render={base ? <a href={url} target="_blank" rel="noreferrer" /> : undefined}>
          {t("api.openFullPage")}
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
      </div>
      {base ? (
        <div className="relative h-[72vh]">
          {referenceLoading && <ContentSkeleton label={t("api.loading")} rows={8} />}
          <iframe
            title={t("api.title")}
            src={url}
            onLoad={() => setReferenceLoading(false)}
            onError={() => setReferenceLoading(false)}
            className={`absolute inset-0 size-full rounded-xl border bg-white ${referenceLoading ? "invisible" : "visible"}`}
          />
        </div>
      ) : (
        <ContentSkeleton label={t("api.loading")} rows={5} />
      )}
    </div>
  )
}
