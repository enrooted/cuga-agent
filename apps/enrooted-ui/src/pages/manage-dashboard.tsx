/*
 * /manage: the agent dashboard. Ported from
 * cuga-agent/src/frontend_workspaces/frontend/src/ManageDashboard.tsx
 * (Copyright IBM Corp., Apache-2.0): list, search, create and delete agents.
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { BotIcon, FilesIcon, MessageSquareIcon, PlusIcon, SearchIcon, Settings2Icon, Trash2Icon, WorkflowIcon, WrenchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Notice, TextAreaField, TextField } from "@/components/manage/form"
import { ManageShell } from "@/components/manage/manage-shell"
import * as api from "@/lib/manage/api"

export interface AgentItem {
  id: string
  name?: string
  description: string
  kind: "single" | "supervisor"
  tools_count: number
  latest_version: number | null
  latest_version_created_at: string | null
}

function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [kind, setKind] = React.useState<"single" | "supervisor">("single")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await api.createAgent(name.trim(), description.trim(), kind)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || res.statusText)
      }
      const data = await res.json()
      onCreated(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create agent</DialogTitle>
          <DialogDescription className="sr-only">Name, description and kind of the new agent</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          {error && (
            <Notice kind="error" title="Error">
              {error}
            </Notice>
          )}
          <TextField id="create-agent-name" label="Name" placeholder="e.g. Flight Booker" disabled={saving} value={name} onChange={(e) => setName(e.target.value)} />
          <TextAreaField
            id="create-agent-description"
            label="Description"
            placeholder="Optional"
            disabled={saving}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Field>
            <FieldLabel id="create-agent-kind-label">Kind</FieldLabel>
            <RadioGroup
              aria-labelledby="create-agent-kind-label"
              value={kind}
              disabled={saving}
              onValueChange={(v) => setKind(v as "single" | "supervisor")}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="single" id="create-agent-kind-single" />
                Single agent
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="supervisor" id="create-agent-kind-supervisor" />
                Supervisor (orchestrates other agents)
              </label>
            </RadioGroup>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Spinner data-icon="inline-start" />}
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ManageDashboard() {
  const navigate = useNavigate()
  const [agents, setAgents] = React.useState<AgentItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [agentContext, setAgentContext] = React.useState<{ agent_id: string; config_version: number | null } | null>(null)
  const [showCreate, setShowCreate] = React.useState(false)
  const [agentRegistry, setAgentRegistry] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [pendingDelete, setPendingDelete] = React.useState<AgentItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const filtered = agents.filter((a) => `${a.name ?? ""} ${a.id} ${a.description}`.toLowerCase().includes(query.toLowerCase()))
  const groups = [
    { id: "supervisors", title: "Supervisors", description: "Coordinate other agents to complete tasks.", agents: filtered.filter((a) => a.kind === "supervisor") },
    { id: "agents", title: "Individual agents", description: "Agents with their own tools and instructions.", agents: filtered.filter((a) => a.kind !== "supervisor") },
  ].filter((g) => g.agents.length > 0)

  const reloadAgents = React.useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getAgents()
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data) => setAgents(data.agents ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load agents"))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await api.deleteAgent(pendingDelete.id)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || "Failed to delete agent")
      }
      setPendingDelete(null)
      reloadAgents()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete agent")
    } finally {
      setDeleting(false)
    }
  }

  React.useEffect(() => {
    api
      .getUiConfig()
      .then((c) => setAgentRegistry(!!c.agent_registry))
      .catch(() => setAgentRegistry(false))
  }, [])
  React.useEffect(reloadAgents, [reloadAgents])
  React.useEffect(() => {
    api
      .getAgentContext()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setAgentContext({ agent_id: data.agent_id ?? "cuga-default", config_version: data.config_version ?? null }))
      .catch(() => {})
  }, [])

  const createButton = agentRegistry && (
    <Button onClick={() => setShowCreate(true)}>
      <PlusIcon data-icon="inline-start" />
      Create agent
    </Button>
  )

  return (
    <ManageShell
      agentContext={agentContext ?? undefined}
      onNew={agentRegistry ? () => setShowCreate(true) : undefined}
      newLabel="Create agent"
      title={<h1 className="truncate text-sm font-medium">Agents</h1>}
    >
      <div className="min-h-0 flex-1 overflow-y-auto pt-12">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
          <header className="flex flex-col gap-2">
            <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">Workspace</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">Agent dashboard</h2>
              {createButton}
            </div>
            <p className="text-sm text-body">Select an agent to configure it and try it out.</p>
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="glass-card max-w-md flex-1">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="agent-search"
                type="search"
                aria-label="Search agents"
                placeholder="Search agents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {loading ? "" : `${filtered.length} of ${agents.length} agents`}
            </span>
          </div>

          {loading && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading agents">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          )}

          {error && (
            <Notice kind="error" title="Error">
              {error}
            </Notice>
          )}

          {!loading &&
            !error &&
            groups.map((group) => (
              <section key={group.id} aria-labelledby={`manage-${group.id}-heading`} className="flex flex-col gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 id={`manage-${group.id}-heading`} className="text-base font-medium">
                      {group.title}
                    </h3>
                    <Badge variant="secondary">{group.agents.length}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.agents.map((agent) => (
                    <article key={agent.id} className="glass-card flex flex-col gap-2 rounded-xl border p-4">
                      <div className="flex items-center justify-between">
                        {agent.kind === "supervisor" ? <WorkflowIcon className="size-5 text-link" aria-hidden /> : <BotIcon className="size-5 text-link" aria-hidden />}
                        <Badge variant="outline">{agent.kind === "supervisor" ? "Supervisor" : "Single agent"}</Badge>
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-base font-medium">{agent.name?.trim() || "Agent"}</h4>
                        <p className="truncate font-mono text-xs text-muted-foreground">{agent.id}</p>
                      </div>
                      <p className="line-clamp-3 min-h-10 text-sm text-body">{agent.description}</p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <WrenchIcon className="size-3.5" /> {agent.tools_count} tool{agent.tools_count !== 1 ? "s" : ""}
                        </span>
                        {agent.latest_version != null && (
                          <span
                            className="flex items-center gap-1"
                            title={agent.latest_version_created_at ? new Date(agent.latest_version_created_at).toLocaleString() : undefined}
                          >
                            <FilesIcon className="size-3.5" /> v{agent.latest_version}
                          </span>
                        )}
                      </div>
                      <div className="mt-auto flex items-center gap-1 border-t pt-3">
                        <Button variant="outline" size="sm" render={<Link to={`/manage/${encodeURIComponent(agent.id)}`} />}>
                          <Settings2Icon data-icon="inline-start" />
                          Configure &amp; try it out
                        </Button>
                        <Button variant="ghost" size="sm" render={<Link to={`/chat/${encodeURIComponent(agent.id)}`} />}>
                          <MessageSquareIcon data-icon="inline-start" />
                          Chat
                        </Button>
                        {agentRegistry && agent.id !== "cuga-default" && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="ml-auto text-muted-foreground"
                                  aria-label={`Delete agent ${agent.name?.trim() || agent.id}`}
                                  onClick={() => {
                                    setDeleteError(null)
                                    setPendingDelete(agent)
                                  }}
                                />
                              }
                            >
                              <Trash2Icon />
                            </TooltipTrigger>
                            <TooltipContent>Delete agent</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}

          {!loading && !error && agents.length > 0 && filtered.length === 0 && (
            <div className="glass-card flex flex-col items-start gap-2 rounded-xl border p-6">
              <h3 className="text-base font-medium">No matching agents</h3>
              <p className="text-sm text-body">Try a different name or description.</p>
              <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          )}

          {!loading && !error && agents.length === 0 && (
            <div className="flex flex-col items-start gap-4">
              <Notice kind="info" title="No agents configured">
                {agentRegistry ? "Create an agent to get started" : "No agents configured"}
              </Notice>
              {createButton}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete agent “{pendingDelete?.name?.trim() || pendingDelete?.id || ""}”?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          {deleteError && (
            <Notice kind="error" title="Error">
              {deleteError}
            </Notice>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting && <Spinner data-icon="inline-start" />}
              {deleting ? "Deleting…" : "Delete agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {agentRegistry && showCreate && (
        <CreateAgentDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            navigate(`/manage/${encodeURIComponent(id)}`)
          }}
        />
      )}
    </ManageShell>
  )
}
