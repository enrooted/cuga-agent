/*
 * Studio → Sub-agents: the roster of the one agent, and the add / edit form.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/events/StudioPage.tsx
 * (AgentEditor, AgentsTab) (Copyright IBM Corp., Apache-2.0).
 */
import * as React from "react"
import { Trans, useTranslation } from "react-i18next"
import { BotIcon, ExternalLinkIcon, PlugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { CheckField, Notice, TextAreaField, TextField } from "@/components/manage/form"
import { SelectField } from "@/components/manage/knowledge/parts"
import { CardFoot, CardHead, CardTitle, Loader, Muted, STUDIO_GRID, StudioCard, Tag, useEndpoint, type Rec } from "@/components/events/studio-parts"
import * as api from "@/lib/events/api"

const KNOWN_CHANNELS = ["web", "telegram", "slack", "discord"]
// Fallback only: the editor derives the live list (and each app's triggers)
// from /api/events/triggers, the backend registry.
const KNOWN_INTEGRATIONS = ["box", "discord", "github", "gmail", "slack", "telegram", "webhook"]
// Fallback tool catalog so the picker is never empty (used if
// /api/events/mcp-servers is unreachable). UNDERSCORES: these names are stored
// on the agent as `mcp_servers` and used verbatim to scope its tools against
// the CUGA registry, whose keys are underscore names. A hyphen provisions an
// agent that resolves no tools. Keep in step with events/mcp_catalog.py.
const FALLBACK_MCP = [
  { name: "cuga_web", hint: "web search / browse / weather / wiki" },
  { name: "cuga_finance", hint: "stock quote / crypto price" },
  { name: "cuga_knowledge", hint: "search arXiv (recent papers)" },
  { name: "cuga_geo", hint: "country capital / population / region" },
  { name: "cuga_text", hint: "summarize / translate / text utilities" },
  { name: "cuga_code", hint: "explain / analyze code" },
  { name: "cuga_local", hint: "local / system operations" },
]

type TriggerInfo = { event: string; title: string }

/**
 * The add / edit agent form. An agent = skill (prompt) + tools (mcp_servers) +
 * the connectors it may use (channels to converse on, integrations to watch or
 * act on). Saving upserts by name (POST for new, PUT for existing).
 */
export function AgentEditor({ open, editing, onClose }: { open: boolean; editing: Rec | null; onClose: (saved: boolean) => void }) {
  const { t } = useTranslation("studio")
  const isEdit = !!editing
  const [name, setName] = React.useState("")
  const [backend, setBackend] = React.useState("cuga")
  const [prompt, setPrompt] = React.useState("")
  const [mcp, setMcp] = React.useState<string[]>([])
  const [channels, setChannels] = React.useState<string[]>(["web"])
  const [integrations, setIntegrations] = React.useState<Record<string, string>>({})
  // Trigger grain: app → the trigger events this agent handles ([] = all of the app's triggers).
  const [trigs, setTrigs] = React.useState<Record<string, string[]>>({})
  // The registry (app → its triggers) from /api/events/triggers; drives the picker below.
  const [registry, setRegistry] = React.useState<Record<string, TriggerInfo[]>>({})
  const [access, setAccess] = React.useState("")
  const [servers, setServers] = React.useState<{ name: string; hint: string }[]>([])
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setErr(null)
    setSaving(false)
    setName(editing?.name ?? "")
    setBackend(editing?.backend || "cuga")
    setPrompt(editing?.prompt ?? "")
    setMcp(editing?.mcp_servers ?? [])
    setChannels(editing?.channels?.length ? editing.channels : ["web"])
    const im: Record<string, string> = {}
    const tm: Record<string, string[]> = {}
    ;(editing?.integrations ?? []).forEach((i: Rec) => {
      im[i.app] = i.ownership || "per-user"
      tm[i.app] = Array.isArray(i.triggers) ? i.triggers : []
    })
    setIntegrations(im)
    setTrigs(tm)
    setAccess((editing?.access ?? []).join(", "))
    setServers(FALLBACK_MCP) // always have a catalog; enrich from the server if reachable
    api
      .getEventsMcpServers()
      .then((r) => r.json())
      .then((d) => {
        if (d.servers?.length) setServers(d.servers)
      })
      .catch(() => {})
    api
      .getEventsTriggers()
      .then((r) => r.json())
      .then((d) => {
        const reg: Record<string, TriggerInfo[]> = {}
        ;(d.apps ?? []).forEach((a: Rec) => {
          reg[a.app] = a.triggers ?? []
        })
        setRegistry(reg)
      })
      .catch(() => {})
  }, [open, editing])

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const save = () => {
    setSaving(true)
    setErr(null)
    const spec: api.AgentSpecBody = {
      name: name.trim(),
      backend,
      prompt,
      mcp_servers: mcp,
      channels,
      integrations: Object.entries(integrations).map(([app, ownership]) => ({
        app,
        ownership,
        ...(trigs[app]?.length ? { triggers: trigs[app] } : {}),
      })),
      access: access
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }
    const req = isEdit ? api.putEventsAgent(editing.name, spec) : api.postEventsAgent(spec)
    req
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          onClose(true)
        } else {
          setErr(res.error || t("agents.saveFailed"))
          setSaving(false)
        }
      })
      .catch((e) => {
        setErr(String(e))
        setSaving(false)
      })
  }

  const apps = Object.keys(registry).length ? Object.keys(registry).sort() : KNOWN_INTEGRATIONS

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose(false)}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("agents.editTitle", { name: editing?.name }) : t("agents.addTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("agents.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!saving && name.trim()) save()
          }}
        >
          {err && (
            <Notice kind="error" title={t("error")}>
              {err}
            </Notice>
          )}
          <TextField id="agent-name" label={t("agents.name")} value={name} disabled={isEdit} placeholder={t("agents.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          <SelectField id="agent-backend" label={t("agents.backend")} value={backend} onChange={(e) => setBackend(e.target.value)}>
            <NativeSelectOption value="cuga">{t("agents.backendCuga")}</NativeSelectOption>
            <NativeSelectOption value="react">{t("agents.backendReact")}</NativeSelectOption>
          </SelectField>
          <TextAreaField
            id="agent-prompt"
            label={t("agents.skill")}
            rows={4}
            value={prompt}
            placeholder={t("agents.skillPlaceholder")}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("agents.tools")}</legend>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {servers.map((s) => (
                <CheckField
                  key={s.name}
                  id={`mcp-${s.name}`}
                  label={`${s.name}${s.hint ? " — " + s.hint : ""}`}
                  checked={mcp.includes(s.name)}
                  onChange={() => toggle(mcp, setMcp, s.name)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("agents.channels")}</legend>
            <div className="flex flex-wrap gap-4">
              {KNOWN_CHANNELS.map((ch) => (
                <div key={ch}>
                  <CheckField id={`ch-${ch}`} label={ch} checked={channels.includes(ch)} onChange={() => toggle(channels, setChannels, ch)} />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("agents.integrations")}</legend>
            <div className="flex flex-col gap-2">
              {apps.map((app) => (
                <div key={app}>
                  <div className="flex items-center gap-3">
                    <div>
                      <CheckField
                        id={`int-${app}`}
                        label={app}
                        checked={app in integrations}
                        onChange={(checked) =>
                          setIntegrations((prev) => {
                            const next = { ...prev }
                            if (checked) next[app] = next[app] || "per-user"
                            else delete next[app]
                            return next
                          })
                        }
                      />
                    </div>
                    {app in integrations && (
                      <NativeSelect
                        id={`own-${app}`}
                        size="sm"
                        aria-label={t("agents.ownershipOf", { app })}
                        value={integrations[app]}
                        onChange={(e) => setIntegrations((prev) => ({ ...prev, [app]: e.target.value }))}
                      >
                        <NativeSelectOption value="per-user">{t("agents.ownershipPerUser")}</NativeSelectOption>
                        <NativeSelectOption value="shared">{t("agents.ownershipShared")}</NativeSelectOption>
                      </NativeSelect>
                    )}
                  </div>
                  {/* Trigger grain: pick WHICH of the app's triggers this agent handles.
                      Nothing selected = all of them (the registry default). */}
                  {app in integrations && (registry[app]?.length ?? 0) > 0 && (
                    <div className="mt-1 mb-2 ml-7">
                      <Muted className="mb-1 text-xs">
                        {trigs[app]?.length
                          ? t("agents.triggersSelected", { selected: trigs[app].length, total: registry[app].length })
                          : t("agents.triggersAll", { total: registry[app].length })}
                      </Muted>
                      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                        {registry[app].map((trig) => (
                          <CheckField
                            key={trig.event}
                            id={`trg-${app}-${trig.event}`}
                            label={`${trig.event} — ${trig.title}`}
                            checked={(trigs[app] ?? []).includes(trig.event)}
                            onChange={() =>
                              setTrigs((prev) => {
                                const cur = prev[app] ?? []
                                const next = cur.includes(trig.event) ? cur.filter((e) => e !== trig.event) : [...cur, trig.event]
                                return { ...prev, [app]: next }
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
          <TextField
            id="agent-access"
            label={t("agents.access")}
            value={access}
            placeholder={t("agents.accessPlaceholder")}
            onChange={(e) => setAccess(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onClose(false)}>
              {t("common:action.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {saving ? t("common:state.saving") : t("common:action.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AgentsSection({ refresh, onTry }: { refresh: number; onTry: (utterance: string) => void }) {
  const { t } = useTranslation("studio")
  const [localBump, setLocalBump] = React.useState(0)
  const { data, loading, refreshing, error } = useEndpoint<Rec[]>(api.getEventsAgents, (d) => d.agents ?? [], refresh + localBump)
  const mcp = useEndpoint<Rec>(api.getEventsMcpServers, (d) => d, refresh)
  const explorerUrl: string = mcp.data?.explorer_url || "http://localhost:8001/docs"
  const mcpServers: { name: string }[] = mcp.data?.servers || []
  // As in the original, nothing opens the editor: the roster is a file in the
  // single-agent world. It stays mounted so the form is one state change away.
  const [editor, setEditor] = React.useState<{ open: boolean; editing: Rec | null }>({ open: false, editing: null })
  const onClose = (saved: boolean) => {
    setEditor((e) => ({ ...e, open: false }))
    if (saved) setLocalBump((n) => n + 1)
  }
  return (
    <div className="flex flex-col gap-4">
      <Muted>
        <Trans t={t} i18nKey="agents.intro" components={{ b: <b />, code: <code /> }} />
      </Muted>
      {/* Pointer to the MCP tool explorer: where the tools these agents use come from. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[0.8125rem] text-muted-foreground">
        <PlugIcon className="size-4 shrink-0" aria-hidden="true" />
        <span>
          <Trans t={t} i18nKey="agents.mcpHint" components={{ b: <b /> }} />
        </span>
        <Button variant="ghost" size="sm" render={<a href={explorerUrl} target="_blank" rel="noreferrer" />}>
          {t("agents.mcpExplorer")}
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
        {mcpServers.length > 0 && <span>· {mcpServers.map((s) => s.name).join(", ")}</span>}
      </div>
      <Loader loading={loading} refreshing={refreshing} error={error} />
      {!loading && !error && (data?.length ?? 0) === 0 && (
        <Notice kind="info" title={t("agents.emptyTitle")}>
          {t("agents.emptyBody")}
        </Notice>
      )}
      <div className={STUDIO_GRID}>
        {data?.map((a) => (
          <StudioCard key={a.name}>
            <CardHead>
              <CardTitle>
                <BotIcon aria-hidden="true" /> <span className="truncate">{a.name}</span>
              </CardTitle>
              <Tag tone={a.backend === "cuga" ? "outline" : "neutral"}>{a.backend}</Tag>
            </CardHead>
            <Muted>{a.prompt || "—"}</Muted>
            <CardFoot>
              {a.mcp_servers?.map((m: string) => (
                <Tag key={m}>{m}</Tag>
              ))}
              {a.channels?.map((c: string) => (
                <Tag key={c} tone="outline">
                  {c}
                </Tag>
              ))}
              {a.integrations?.map((i: Rec) => (
                <Tag key={i.app} title={i.triggers?.length ? i.triggers.join(", ") : t("agents.allTriggers")}>
                  {i.triggers?.length
                    ? t("agents.integrationTagTriggers", { app: i.app, ownership: i.ownership, count: i.triggers.length })
                    : t("agents.integrationTag", { app: i.app, ownership: i.ownership })}
                </Tag>
              ))}
              {a.restricted && <Tag tone={a.can_use ? "ok" : "warn"}>{a.can_use ? t("agents.restrictedCanUse") : t("agents.restricted")}</Tag>}
            </CardFoot>
            {(a.examples?.length ?? 0) > 0 && (
              <div className="mt-2">
                <Muted className="mb-1 text-xs">{t("agents.try")}</Muted>
                <div className="flex flex-wrap gap-1.5">
                  {a.examples.map((u: string) => (
                    <Button key={u} variant="outline" size="xs" title={t("agents.loadIntoConcierge")} className="h-auto min-h-6 py-0.5 text-left whitespace-normal" onClick={() => onTry(u)}>
                      {t("quoted", { text: u })}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </StudioCard>
        ))}
      </div>
      <AgentEditor open={editor.open} editing={editor.editing} onClose={onClose} />
    </div>
  )
}
