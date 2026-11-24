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
import { useTranslation } from "react-i18next"

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
import i18n from "@/i18n"
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
  const { t } = useTranslation("tools")
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
      if (!secretsRes.ok) throw new Error(i18n.t("tools:secrets.errors.loadSecrets", { status: secretsRes.status }))
      if (!configRes.ok) throw new Error(i18n.t("tools:secrets.errors.loadConfig", { status: configRes.status }))
      const data = (await secretsRes.json()) as { secrets?: SecretMeta[]; overrides?: SecretMeta[] }
      setAllSecrets(data.secrets || data.overrides || [])
      setSecretsConfig((await configRes.json()) as SecretsConfig)
    } catch (e) {
      setLoadFailed(true)
      setError(e instanceof Error ? e.message : i18n.t("tools:secrets.errors.load"))
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
        setError(await errorDetail(res, t("secrets.errors.create")))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("secrets.errors.create"))
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
      else setError(await errorDetail(res, t("secrets.errors.delete")))
    } catch (e) {
      setError(e instanceof Error ? e.message : t("secrets.errors.delete"))
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
        setError(await errorDetail(res, t("secrets.errors.update")))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("secrets.errors.update"))
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
              label={t("common:action.edit")}
              disabled={busy}
              onClick={() => {
                setEditingId(s.id)
                setEditValue("")
              }}
            >
              <PencilIcon />
            </IconButton>
          )}
          <IconButton label={t("secrets.copyRef")} onClick={() => copyRef(s)}>
            <CopyIcon />
          </IconButton>
          {s.source !== "env" &&
            (deleting === s.id ? (
              <span className="flex items-center gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                <Spinner />
                {t("secrets.deleting")}
              </span>
            ) : (
              <IconButton label={t("common:action.delete")} disabled={busy} onClick={() => setConfirmDeleteId(s.id)}>
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
            aria-label={t("secrets.newValueFor", { id: s.id })}
            className="min-w-48 flex-1"
            type="password"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={t("secrets.newValue")}
            autoComplete="off"
          />
          <Button type="submit" variant="secondary" disabled={saving || !editValue.trim()}>
            {saving && <Spinner data-icon="inline-start" />}
            {saving ? t("common:state.saving") : t("common:action.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditingId(null)
              setEditValue("")
            }}
          >
            {t("common:action.cancel")}
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
            <DialogTitle>{t("secrets.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("secrets.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-1">
            {error && (
              <Notice
                title={t("secrets.error")}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("secrets.dismissError")}
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
              <Notice title={t("secrets.forceEnvTitle")}>{t("secrets.forceEnvBody")}</Notice>
            )}
            {loading ? (
              <div className="flex flex-col gap-2" role="status" aria-label={t("secrets.loading")}>
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : loadFailed && allSecrets.length === 0 ? (
              <div>
                <Button type="button" variant="outline" onClick={() => void load()}>
                  {t("secrets.retry")}
                </Button>
              </div>
            ) : (
              <Tabs defaultValue={initialTab}>
                <TabsList aria-label={t("secrets.tabsLabel")}>
                  <TabsTrigger value="env">{t("secrets.tab.env")} {envSecrets.length > 0 && `(${envSecrets.length})`}</TabsTrigger>
                  <TabsTrigger value="stored">
                    {mode === "vault" ? t("secrets.tab.vault") : t("secrets.tab.overrides")} {storedSecrets.length > 0 && `(${storedSecrets.length})`}
                  </TabsTrigger>
                </TabsList>

                {/* Environment tab */}
                <TabsContent value="env" className="flex flex-col gap-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    {t("secrets.envIntro")}
                  </p>
                  {envSecrets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {mode === "vault"
                        ? t("secrets.envHiddenVault")
                        : t("secrets.envNone")}
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
                      <FieldLegend variant="label">{t("secrets.add.legend")}</FieldLegend>
                      <FieldGroup className="gap-3">
                        <Field>
                          <FieldLabel htmlFor="secret-id">{t("secrets.add.id")}</FieldLabel>
                          <Input
                            id="secret-id"
                            value={addId}
                            onChange={(e) => setAddId(e.target.value)}
                            placeholder={t("secrets.add.idPlaceholder")}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="secret-value">{t("secrets.add.value")}</FieldLabel>
                          <Input
                            id="secret-value"
                            type="password"
                            value={addValue}
                            onChange={(e) => setAddValue(e.target.value)}
                            placeholder={t("secrets.add.valuePlaceholder")}
                            autoComplete="off"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="secret-description">{t("secrets.add.description")}</FieldLabel>
                          <Input
                            id="secret-description"
                            value={addDescription}
                            onChange={(e) => setAddDescription(e.target.value)}
                            placeholder={t("secrets.add.descriptionPlaceholder")}
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
                            {saving ? t("common:state.saving") : t("common:action.add")}
                          </Button>
                        </div>
                      </FieldGroup>
                    </FieldSet>
                  </form>
                  <section className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-medium">{mode === "vault" ? t("secrets.vaultSecrets") : t("secrets.storedOverrides")}</h3>
                    {storedSecrets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("secrets.empty")}</p>
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
              {t("common:action.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmDeleteId !== null}
        title={t("secrets.deleteTitle")}
        description={t("secrets.deleteConfirm", { id: confirmDeleteId ?? "" })}
        confirmLabel={t("common:action.delete")}
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
