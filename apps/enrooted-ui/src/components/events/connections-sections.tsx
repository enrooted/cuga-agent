/*
 * Studio → Channels, Integrations and Setup: what the events layer can talk
 * on and watch, and how each one is connected.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (ChannelsTab, IntegrationsTab, SetupTab) (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { AppWindowIcon, ExternalLinkIcon, MessageSquareIcon, PencilIcon, PlugIcon, Settings2Icon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  AsyncButton,
  CardFoot,
  CardHead,
  CardTitle,
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
import * as api from "@/lib/events/api"

export function ChannelsSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsChannels, (d) => d.channels ?? [], refresh)
  return (
    <div className="flex flex-col gap-4">
      <Loader loading={loading} refreshing={refreshing} error={error} />
      <div className={STUDIO_GRID}>
        {data?.map((c) => (
          <StudioCard key={c.name}>
            <CardHead>
              <CardTitle>
                <MessageSquareIcon aria-hidden="true" /> {c.label}
              </CardTitle>
              <StatusTag status={c.status} />
            </CardHead>
            <Muted>{c.note}</Muted>
            <CardFoot>
              <Tag tone="outline">{t("channels.converse")}</Tag>
              {c.backend && <Tag>{c.backend === "direct" ? t("channels.direct") : "Activepieces"}</Tag>}
              <Tag>{t("channels.sharedBot")}</Tag>
            </CardFoot>
          </StudioCard>
        ))}
      </div>
    </div>
  )
}

export function IntegrationsSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { prompt, notify } = useStudioFeedback()
  const { pending, run } = useStudioAction()
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsIntegrations, (d) => d.integrations ?? [], refresh)
  // The trigger registry, so each card can say WHAT the integration can watch.
  const reg = useEndpoint<Rec[]>(api.getEventsTriggers, (d) => d.apps ?? [], refresh)
  const trigsFor = (app: string): Rec[] => (reg.data ?? []).find((a) => a.app === app)?.triggers ?? []

  // "Log in with your own account": OAuth apps open the consent flow; token apps paste a secret.
  const connect = async (i: Rec) => {
    // pragma: allowlist secret -- authentication method comparison
    if (i.auth === "oauth") {
      window.open(api.eventsConnectUrl(i.name), "_blank", "noreferrer")
    } else {
      const token = await prompt(t("integrations.pasteToken", { label: i.label }), true) // pragma: allowlist secret -- collected at runtime
      if (token) {
        void run(i.name, () =>
          api
            .postEventsConnectToken(i.name, token)
            .then((r) => r.json())
            .then((res) => {
              notify(res.ok ? t("integrations.connected", { label: i.label }) : t("failed", { error: res.error || t("errorFallback") }), res.ok ? "success" : "error")
            })
        )
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Loader loading={loading} refreshing={refreshing} error={error} />
      <div className={STUDIO_GRID}>
        {data?.map((i) => {
          const trigs = trigsFor(i.name)
          const isOAuth = i.auth === "oauth" // pragma: allowlist secret -- authentication method comparison
          const noAuth = i.auth === "none" // pragma: allowlist secret -- authentication method comparison
          return (
            <StudioCard key={i.name}>
              <CardHead>
                <CardTitle>
                  <AppWindowIcon aria-hidden="true" /> {i.label}
                </CardTitle>
                <StatusTag status={i.status} />
              </CardHead>
              <Muted>{i.note}</Muted>
              {trigs.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {t("integrations.triggerCount", { count: trigs.length })}
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {trigs.map((trig) => (
                      <Tag key={trig.event} tone={trig.backend === "direct" ? "outline" : "neutral"} title={trig.title}>
                        {trig.event}
                        {trig.default ? " ★" : ""}
                      </Tag>
                    ))}
                  </div>
                </details>
              )}
              <CardFoot>
                <Tag>{i.backend === "direct" ? t("integrations.directBackend") : t("integrations.viaActivepieces")}</Tag>
                <Tag tone="outline">{noAuth ? t("integrations.noAuth") : i.backend === "direct" ? "token" : isOAuth ? "OAuth" : "token"}</Tag>
                {/* Public-feed pieces (youtube / rss) need NO connection: show "ready", not a Connect button. */}
                {i.needs_connection === false || noAuth ? (
                  <Tag tone="ok">{t("integrations.ready")}</Tag>
                ) : i.status !== "ap_not_configured" ? (
                  <AsyncButton
                    busy={pending === i.name}
                    busyLabel={t("integrations.connecting")}
                    disabled={pending !== null}
                    variant={i.status === "connected" ? "ghost" : "outline"}
                    size="sm"
                    onClick={() => void connect(i)}
                  >
                    {isOAuth ? <ExternalLinkIcon data-icon="inline-start" /> : <PlugIcon data-icon="inline-start" />}
                    {i.status === "connected" ? t("integrations.reconnect") : t("integrations.connect")}
                  </AsyncButton>
                ) : null}
              </CardFoot>
            </StudioCard>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The connect SETUP GUIDE, per connector: required credentials (and whether
 * they are present), ownership (per-user vs tenant), and the concrete steps.
 * It renders the server's guides and drives the connect action.
 */
export function SetupSection({ refresh }: { refresh: number }) {
  const { t } = useTranslation("studio")
  const { prompt, notify } = useStudioFeedback()
  const { pending, run } = useStudioAction()
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsSetupGuides, (d) => d.guides ?? [], refresh)
  const [own, setOwn] = React.useState<Record<string, string>>({})

  const connect = async (g: Rec) => {
    const ownership: string = own[g.app] || g.ownership_default || (g.ownership || [])[0] || "per_user"
    if (g.connect === "oauth") {
      window.open(api.eventsConnectUrl(g.app, ownership), "_blank", "noreferrer")
    } else if (g.connect === "token") {
      const token = await prompt(t("setup.pasteSecret", { label: g.label }), true) // pragma: allowlist secret -- collected at runtime
      if (token) {
        void run(g.app, () =>
          api
            .postEventsConnectToken(g.app, token, ownership)
            .then((r) => r.json())
            .then((res) => notify(res.ok ? t("setup.connected", { label: g.label, ownership }) : t("failed", { error: res.error || t("errorFallback") }), res.ok ? "success" : "error"))
        )
      }
    }
  }
  // TENANT-level OAuth app registration (client id / secret): the org-wide
  // credential that must exist before per-user OAuth connect works.
  const setOAuthApp = async (g: Rec) => {
    const cid = await prompt(t("setup.clientId", { label: g.label }))
    if (!cid) return
    const sec = await prompt(t("setup.clientSecret", { label: g.label }), true) // pragma: allowlist secret -- masked input label
    if (!sec) return
    void run(`oauth:${g.app}`, () =>
      api
        .postEventsAdminOAuthApp({ app: g.app, client_id: cid, client_secret: sec })
        .then((r) => r.json())
        .then((res) => notify(res.ok ? t("setup.oauthSaved", { label: g.label }) : t("failed", { error: res.error || t("errorFallback") }), res.ok ? "success" : "error"))
    )
  }
  // Edit ANY connector credential (its .env variable) in place: persists to
  // .env and applies live where the value is read at use time; the server's
  // note flags the ones that need a reload.
  // pragma: allowlist secret -- runtime credential handler
  const setCred = async (c: Rec) => {
    const v = await prompt(t("setup.setCredential", { key: c.key, label: c.label }), true) // pragma: allowlist secret -- collected at runtime
    if (v == null || v === "") return
    void run(c.key, () =>
      api
        .postEventsSetCredential(c.key, v)
        .then((r) => r.json())
        .then((res) => notify(res.ok ? t("setup.credentialSaved", { key: c.key, note: String(res.note) }) : t("failed", { error: res.error || t("errorFallback") }), res.ok ? "success" : "error"))
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Loader loading={loading} refreshing={refreshing} error={error} kind="list" />
      <Muted>
        <Trans t={t} i18nKey="setup.intro" components={{ b: <b /> }} />
      </Muted>
      {data?.map((g) => {
        const ownership: string[] = g.ownership || []
        const creds: Rec[] = g.creds || []
        return (
          <StudioCard key={g.app} className="min-h-0">
            <CardHead>
              <CardTitle>{g.label}</CardTitle>
              <span className="flex items-center gap-1">
                <Tag>{g.kind}</Tag>
                <Tag tone="outline">{g.wiring}</Tag>
              </span>
            </CardHead>
            {g.needs_connection && (
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={g.connected ? "ok" : "warn"}>{g.connected ? t("setup.statusConnected") : t("setup.statusNotConnected")}</Tag>
                <Tag>{g.connection_scope === "tenant" ? t("setup.scopeTenant") : t("setup.scopeUser")}</Tag>
                {(g.connect === "oauth" || g.connect === "token") && (
                  <AsyncButton
                    busy={pending === g.app}
                    busyLabel={t("integrations.connecting")}
                    disabled={pending !== null}
                    variant={g.connected ? "ghost" : "outline"}
                    size="sm"
                    onClick={() => void connect(g)}
                  >
                    {g.connect === "oauth" ? <ExternalLinkIcon data-icon="inline-start" /> : <PlugIcon data-icon="inline-start" />}
                    {g.connected ? t("setup.reconnectApp", { label: g.label }) : t("setup.connectApp", { label: g.label })}
                  </AsyncButton>
                )}
                {g.connect === "oauth" && g.connection_scope === "user" && (
                  <AsyncButton busy={pending === `oauth:${g.app}`} busyLabel={t("common:state.saving")} disabled={pending !== null} variant="ghost" size="sm" onClick={() => void setOAuthApp(g)}>
                    <Settings2Icon data-icon="inline-start" />
                    {t("setup.oauthCreds")}
                  </AsyncButton>
                )}
              </div>
            )}
            {creds.length === 0 ? (
              <Muted className="text-[0.8125rem]">{t("setup.noCredentials")}</Muted>
            ) : (
              <ul className="flex flex-col gap-1">
                {creds.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-body">
                    <Tag tone={c.present ? "ok" : c.required ? "warn" : "neutral"}>{c.present ? t("setup.credConfigured") : c.required ? t("setup.credSetUp") : t("setup.credOptional")}</Tag>
                    <Tag>{c.scope === "tenant" ? t("setup.tenant") : t("setup.user")}</Tag>
                    <code className="rounded-sm bg-muted px-1">{c.key}</code> — {c.label} <span className="text-muted-foreground">({c.where})</span>
                    <AsyncButton busy={pending === c.key} busyLabel={t("common:state.saving")} disabled={pending !== null} variant="ghost" size="sm" onClick={() => void setCred(c)}>
                      <PencilIcon data-icon="inline-start" />
                      {c.present ? t("common:action.edit") : t("setup.set")}
                      <span className="sr-only"> {c.key}</span>
                    </AsyncButton>
                  </li>
                ))}
              </ul>
            )}
            {ownership.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                <b>{t("setup.storeCredential")}</b>
                {ownership.map((o) => {
                  const label = o === "per_user" ? t("setup.perUser") : t("setup.perTenant")
                  const on = (own[g.app] || g.ownership_default) === o
                  return ownership.length > 1 ? (
                    <Button key={o} variant={on ? "default" : "outline"} size="sm" aria-pressed={on} onClick={() => setOwn({ ...own, [g.app]: o })}>
                      {label}
                    </Button>
                  ) : (
                    <Tag key={o} tone={on ? "outline" : "neutral"}>
                      {label}
                    </Tag>
                  )
                })}
              </div>
            )}
            <ol className="list-decimal pl-5 text-[0.8125rem] text-body">
              {(g.steps || []).map((s: string, i: number) => (
                <li key={i} className="my-1">
                  {s}
                </li>
              ))}
            </ol>
            {g.note && (
              <Muted className="flex items-start gap-1.5 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-warn" aria-label={t("setup.note")} />
                <span>{g.note}</span>
              </Muted>
            )}
          </StudioCard>
        )
      })}
    </div>
  )
}
