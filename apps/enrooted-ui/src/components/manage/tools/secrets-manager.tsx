/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/SecretsManager.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * Secrets dialog: environment variables found at startup (read-only) and the
 * stored overrides / vault secrets (add, replace value, copy reference, delete).
 * Values are write-only: they are typed into password fields and never shown.
 */
import * as React from "react"
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { AlertDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import * as api from "@/lib/manage/tools-api"
import type { SecretMeta, SecretsConfig } from "@/lib/manage/tools-types"

import { IconButton, Notice } from "./shared"

export interface SecretsManagerProps {
  open: boolean
  onClose: () => void
  agentId?: string
}

function SourceBadge({ source, mode }: { source?: string; mode?: string }) {
  const label =
    source === "vault" ? "vault" : source === "env" ? "env" : source === "db" ? "db" : mode === "vault" ? "vault" : "db"
  return <Badge variant={label === "env" ? "outline" : "secondary"}>{label}</Badge>
}

function refForSecret(item: SecretMeta, mode?: string): string {
  if (item.source === "vault" || mode === "vault") return `vault://secret/${item.id}#value`
  if (item.source === "env") return item.id.toUpperCase().replace(/-/g, "_")
  return `db://${item.id}`
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { detail?: unknown; error?: unknown }
  const detail = data.detail || data.error
  if (!detail) return fallback
  return typeof detail === "string" ? detail : JSON.stringify(detail)
}

export function SecretsManager({ open, onClose, agentId }: SecretsManagerProps) {
  const [allSecrets, setAllSecrets] = React.useState<SecretMeta[]>([])
  const [secretsConfig, setSecretsConfig] = React.useState<SecretsConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [addId, setAddId] = React.useState("")
  const [addValue, setAddValue] = React.useState("")
  const [addDescription, setAddDescription] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState("")

  const busy = saving || deleting !== null

  const load = React.useCallback(async () => {
    if (!open) return
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    try {
      const [secretsRes, configRes] = await Promise.all([api.getSecrets(agentId), api.getSecretsConfig()])
      if (!secretsRes.ok) throw new Error(`Failed to load secrets (${secretsRes.status})`)
      if (!configRes.ok) throw new Error(`Failed to load secrets configuration (${configRes.status})`)
      const data = (await secretsRes.json()) as { secrets?: SecretMeta[]; overrides?: SecretMeta[] }
      setAllSecrets(data.secrets || data.overrides || [])
      setSecretsConfig((await configRes.json()) as SecretsConfig)
    } catch (e) {
      setLoadFailed(true)
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [open, agentId])

  React.useEffect(() => {
    void load()
  }, [load])

  const mode = secretsConfig?.mode ?? "local"

  // Environment tab: env-sourced items (local/force_env mode only)
  const envSecrets = allSecrets.filter((s) => s.source === "env")
  // Overrides tab: db + vault items (user-managed)
  const storedSecrets = allSecrets.filter((s) => s.source !== "env")

  const handleAdd = async () => {
    const id = addId.trim().toLowerCase().replace(/\s+/g, "-")
    if (!id || !addValue.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.createSecret(id, addValue.trim(), addDescription.trim() || undefined, undefined, agentId)
      if (res.ok) {
        setAddId("")
        setAddValue("")
        setAddDescription("")
        void load()
      } else {
        setError(await errorDetail(res, "Failed to create"))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    setError(null)
    try {
      const res = await api.deleteSecret(id)
      if (res.ok) await load()
      else setError(await errorDetail(res, "Failed to delete"))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete")
    } finally {
      setDeleting(null)
    }
  }

  const handleSaveEdit = async (id: string) => {
    if (!editValue.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.updateSecret(id, editValue.trim())
      if (res.ok) {
        setEditingId(null)
        setEditValue("")
        void load()
      } else {
        setError(await errorDetail(res, "Failed to update"))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setSaving(false)
    }
  }

  const copyRef = (item: SecretMeta) => {
    navigator.clipboard.writeText(refForSecret(item, mode)).catch(() => {})
  }

  const renderRow = (s: SecretMeta) => (
    <li key={s.id} className="border-b py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-semibold break-all text-foreground">{s.id}</span>
        <SourceBadge source={s.source} mode={mode} />
        {s.agent_id && s.agent_id !== "*" && <Badge variant="outline">{s.agent_id}</Badge>}
        {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {s.source !== "env" && (
            <IconButton
              label="Edit"
              disabled={busy}
              onClick={() => {
                setEditingId(s.id)
                setEditValue("")
              }}
            >
              <PencilIcon />
            </IconButton>
          )}
          <IconButton label="Copy reference" onClick={() => copyRef(s)}>
            <CopyIcon />
          </IconButton>
          {s.source !== "env" &&
            (deleting === s.id ? (
              <span className="flex items-center gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                <Spinner />
                Deleting secret…
              </span>
            ) : (
              <IconButton label="Delete" disabled={busy} onClick={() => setConfirmDeleteId(s.id)}>
                <Trash2Icon />
              </IconButton>
            ))}
        </span>
      </div>
      {editingId === s.id && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!saving) void handleSaveEdit(s.id)
          }}
        >
          <Input
            id={`edit-${s.id}`}
            aria-label={`New value for ${s.id}`}
            className="min-w-48 flex-1"
            type="password"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="New value"
            autoComplete="off"
          />
          <Button type="submit" variant="secondary" disabled={saving || !editValue.trim()}>
            {saving && <Spinner data-icon="inline-start" />}
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditingId(null)
              setEditValue("")
            }}
          >
            Cancel
          </Button>
        </form>
      )}
    </li>
  )

  const initialTab = mode === "vault" || storedSecrets.length > 0 ? "stored" : "env"

  return (
    <>
      {/* Hidden while the delete confirmation is up, like the original. */}
      <Dialog
        open={open && confirmDeleteId === null}
        onOpenChange={(next) => {
          if (!next && !busy) onClose()
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Secrets Manager</DialogTitle>
            <DialogDescription className="sr-only">
              Environment variables and stored secrets that tools and models can reference. Values are never shown.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-1">
            {error && (
              <Notice
                title="Error"
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Dismiss error"
                    onClick={() => setError(null)}
                  >
                    <XIcon />
                  </Button>
                }
              >
                {error}
              </Notice>
            )}
            {secretsConfig?.force_env && (
              <Notice title="force_env is enabled">All secret resolution uses environment variables only.</Notice>
            )}
            {loading ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Loading secrets…">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : loadFailed && allSecrets.length === 0 ? (
              <div>
                <Button type="button" variant="outline" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            ) : (
              <Tabs defaultValue={initialTab}>
                <TabsList aria-label="Secrets tabs">
                  <TabsTrigger value="env">Environment {envSecrets.length > 0 && `(${envSecrets.length})`}</TabsTrigger>
                  <TabsTrigger value="stored">
                    {mode === "vault" ? "Vault" : "Overrides"} {storedSecrets.length > 0 && `(${storedSecrets.length})`}
                  </TabsTrigger>
                </TabsList>

                {/* Environment tab */}
                <TabsContent value="env" className="flex flex-col gap-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Environment variables detected at startup. Available as references in local mode.
                  </p>
                  {envSecrets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {mode === "vault"
                        ? "Environment variable list is not shown in vault mode."
                        : "No known LLM environment variables detected."}
                    </p>
                  ) : (
                    <ul className="flex flex-col border-t">{envSecrets.map(renderRow)}</ul>
                  )}
                </TabsContent>

                {/* Overrides / Vault tab */}
                <TabsContent value="stored" className="flex flex-col gap-6 pt-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!busy) void handleAdd()
                    }}
                  >
                    <FieldSet>
                      <FieldLegend variant="label">Add secret</FieldLegend>
                      <FieldGroup className="gap-3">
                        <Field>
                          <FieldLabel htmlFor="secret-id">Name (id)</FieldLabel>
                          <Input
                            id="secret-id"
                            value={addId}
                            onChange={(e) => setAddId(e.target.value)}
                            placeholder="e.g. my-openai-key"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="secret-value">Value</FieldLabel>
                          <Input
                            id="secret-value"
                            type="password"
                            value={addValue}
                            onChange={(e) => setAddValue(e.target.value)}
                            placeholder="Secret value"
                            autoComplete="off"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="secret-description">Description (optional)</FieldLabel>
                          <Input
                            id="secret-description"
                            value={addDescription}
                            onChange={(e) => setAddDescription(e.target.value)}
                            placeholder="Optional description"
                          />
                        </Field>
                        <div>
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={busy || !addId.trim() || !addValue.trim()}
                          >
                            {saving ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                            {saving ? "Saving…" : "Add"}
                          </Button>
                        </div>
                      </FieldGroup>
                    </FieldSet>
                  </form>
                  <section className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-medium">{mode === "vault" ? "Vault secrets" : "Stored overrides"}</h3>
                    {storedSecrets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No secrets stored yet.</p>
                    ) : (
                      <ul className="flex flex-col border-t">{storedSecrets.map(renderRow)}</ul>
                    )}
                  </section>
                </TabsContent>
              </Tabs>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmDeleteId !== null}
        title="Delete secret"
        description={`Delete secret "${confirmDeleteId ?? ""}"?`}
        confirmLabel="Delete"
        onConfirm={() => {
          const id = confirmDeleteId
          setConfirmDeleteId(null)
          if (id) void handleDelete(id)
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  )
}
