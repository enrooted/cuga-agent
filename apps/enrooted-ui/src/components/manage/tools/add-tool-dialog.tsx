/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/AddToolModal.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * Add / edit one tool of an agent: MCP server (SSE URL, HTTP URL or stdio
 * command), MCP gateway instance (tools discovered from the instance and picked
 * one by one, run as the signed-in user or a service ID) or OpenAPI service,
 * with authentication and saved-secret references.
 */
import * as React from "react"
import { CableIcon, FolderIcon, LayoutTemplateIcon, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import * as api from "@/lib/manage/tools-api"
import {
  AUTH_TYPE_OPTIONS,
  KEYCLOAK_USER_EXCHANGE,
  parseGatewayInstanceUrl,
  type AuthType,
  type GatewayRunAs,
  type GatewayServer,
  type GatewayToolDef,
  type ToolAuth,
  type ToolEntry,
} from "@/lib/manage/tools-types"

import { GatewayToolPicker } from "./gateway-form"
import { loadSecretOptions, Notice, type SecretOption } from "./shared"

export interface AddToolDialogProps {
  onClose: () => void
  onSave: (tool: ToolEntry) => void
  initial?: ToolEntry | null
  agentId?: string
  /** Open as the dedicated MCP gateway form (no templates, type or connection choice). */
  gatewayOnly?: boolean
}

type AuthSelection = AuthType | typeof KEYCLOAK_USER_EXCHANGE

const emptyAuth: ToolAuth = { type: "none" }

type McpConnectionMode = "url" | "url-http" | "command" | "gateway"

const GATEWAY_AUTH_TYPE: AuthType = "account_iam_apikey"
const SECRET_REF_PREFIXES = ["db://", "vault://", "aws://", "env://"]

function isSecretRef(value: string): boolean {
  return SECRET_REF_PREFIXES.some((p) => value.startsWith(p))
}

/** A saved secret selected for a gateway: env secrets are listed by their bare name. */
function gatewaySecretRef(value: string): string {
  return isSecretRef(value) ? value : `env://${value}`
}

// Pre-configured tool templates. Name and description are translation keys (namespace "tools").
interface ToolTemplate {
  id: string
  nameKey: string
  descriptionKey: string
  icon: LucideIcon
  config: Partial<ToolEntry> & { mcpMode?: McpConnectionMode; argsText?: string }
}

const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: "mcp_gateway",
    nameKey: "templates.mcpGateway.name",
    descriptionKey: "templates.mcpGateway.description",
    icon: CableIcon,
    config: {
      name: "",
      type: "mcp",
      mcpMode: "gateway",
      description: "Tools from the MCP gateway",
      transport: "http",
    },
  },
  {
    id: "filesystem",
    nameKey: "templates.filesystem.name",
    descriptionKey: "templates.filesystem.description",
    icon: FolderIcon,
    config: {
      name: "filesystem",
      type: "mcp",
      mcpMode: "command",
      command: "npx",
      argsText: "-y\n@modelcontextprotocol/server-filesystem\n./cuga_workspace",
      description: "Filesystem access for reading and writing files",
      transport: "stdio",
    },
  },
  {
    id: "drawio",
    nameKey: "templates.drawio.name",
    descriptionKey: "templates.drawio.description",
    icon: LayoutTemplateIcon,
    config: {
      name: "drawio",
      type: "mcp",
      mcpMode: "command",
      command: "npx",
      argsText: "-y\n@next-ai-drawio/mcp-server@latest",
      description: "Drawio diagram creation and manipulation server",
      transport: "stdio",
    },
  },
  {
    id: "browser_mcp",
    nameKey: "templates.browserMcp.name",
    descriptionKey: "templates.browserMcp.description",
    icon: LayoutTemplateIcon,
    config: {
      name: "browser_mcp",
      type: "mcp",
      mcpMode: "command",
      command: "npx",
      argsText: "-y\n@agent-infra/mcp-server-browser@latest",
      description: "Browser automation and web interaction server",
      transport: "stdio",
    },
  },
]

function initFromTool(initial: ToolEntry | null | undefined) {
  const auth = initial?.auth ?? emptyAuth
  const val = auth.value ?? ""
  const hasCmd = !!initial?.command?.trim()
  const transport = initial?.transport ?? (initial?.url ? "sse" : "stdio")
  const mcpMode: McpConnectionMode = initial?.gateway
    ? "gateway"
    : hasCmd
      ? "command"
      : transport === "http"
        ? "url-http"
        : "url"
  const authType: AuthSelection = auth.mode ?? auth.type ?? "none"
  return {
    name: initial?.name ?? "",
    type: initial?.type ?? "mcp",
    mcpMode,
    url: initial?.url ?? "",
    command: initial?.command ?? "",
    argsText: (initial?.args ?? []).join("\n"),
    description: initial?.description ?? "",
    authType,
    profile: auth.profile ?? "",
    authKey: auth.key ?? "",
    authValue: val,
    useSavedSecret: typeof val === "string" && isSecretRef(val),
  }
}

function envToText(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "-")
}

const NAME_RE = /^[a-z][a-z0-9_]*$/

export function AddToolDialog({ onClose, onSave, initial, agentId, gatewayOnly }: AddToolDialogProps) {
  const { t } = useTranslation("tools")
  const gatewayForm = !!gatewayOnly || !!initial?.gateway
  const [init] = React.useState(() => {
    const base = initFromTool(initial)
    if (gatewayOnly && !initial) {
      base.mcpMode = "gateway"
      base.description = "Tools from the MCP gateway"
    }
    return base
  })
  const [submitting, setSubmitting] = React.useState(false)
  const [creatingSecret, setCreatingSecret] = React.useState(false)
  const [secretError, setSecretError] = React.useState("")
  const [secretsLoading, setSecretsLoading] = React.useState(true)
  const [name, setName] = React.useState(init.name)
  const [type, setType] = React.useState<"mcp" | "openapi">(init.type)
  const [mcpMode, setMcpMode] = React.useState<McpConnectionMode>(init.mcpMode)
  const [url, setUrl] = React.useState(init.url)
  const [command, setCommand] = React.useState(init.command)
  const [argsText, setArgsText] = React.useState(init.argsText)
  const [description, setDescription] = React.useState(init.description)
  const [envText, setEnvText] = React.useState(() => envToText(initial?.env))
  const [authType, setAuthType] = React.useState<AuthSelection>(init.authType)
  const [profile, setProfile] = React.useState(init.profile)
  const [authKey, setAuthKey] = React.useState(init.authKey)
  const [authValue, setAuthValue] = React.useState(init.authValue)
  const [useSavedSecret, setUseSavedSecret] = React.useState(init.useSavedSecret)
  const [saveAsNewSecret, setSaveAsNewSecret] = React.useState(false)
  const [saveAsNewSecretKey, setSaveAsNewSecretKey] = React.useState("")
  const [secretsList, setSecretsList] = React.useState<SecretOption[]>([])
  const [inlineCreateOpen, setInlineCreateOpen] = React.useState(false)
  const [inlineCreateValue, setInlineCreateValue] = React.useState("")
  const [inlineCreateKey, setInlineCreateKey] = React.useState("")
  const [showTemplates, setShowTemplates] = React.useState(!initial && !gatewayForm)
  // MCP gateway instance: the instance's servers and tools (after Connect) and the selection.
  const [gatewayServers, setGatewayServers] = React.useState<GatewayServer[] | null>(null)
  const [gatewaySelected, setGatewaySelected] = React.useState<Set<string>>(
    () => new Set(initial?.gateway ? (initial.include ?? []) : [])
  )
  const [gatewayRunAs, setGatewayRunAs] = React.useState<GatewayRunAs>(initial?.gateway?.run_as ?? "user")
  const [gatewayConnecting, setGatewayConnecting] = React.useState(false)
  const [gatewayError, setGatewayError] = React.useState("")
  const [submitError, setSubmitError] = React.useState("")

  const busy = submitting || creatingSecret || gatewayConnecting

  // Any route through the form can change a connection (including switching
  // templates or connection modes). Never reuse tools discovered for another identity.
  const discoveryContext = JSON.stringify([type, mcpMode, url, gatewayRunAs, authValue, useSavedSecret])
  const [previousDiscoveryContext, setPreviousDiscoveryContext] = React.useState(discoveryContext)
  if (previousDiscoveryContext !== discoveryContext) {
    setPreviousDiscoveryContext(discoveryContext)
    setGatewayServers(null)
    setGatewaySelected(new Set())
    setGatewayError("")
  }

  React.useEffect(() => {
    let cancelled = false
    setSecretsLoading(true)
    loadSecretOptions(agentId)
      .then((list) => {
        if (!cancelled && list) setSecretsList(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSecretsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  const applyTemplate = (template: ToolTemplate) => {
    if (busy) return
    const config = template.config
    setName(config.name || "")
    setType(config.type || "mcp")
    setMcpMode(config.mcpMode || "url")
    setUrl(config.url || "")
    setCommand(config.command || "")
    setArgsText(config.argsText || (config.args || []).join("\n"))
    setDescription(config.description || "")
    const auth = config.auth ?? emptyAuth
    setAuthType(auth.mode ?? auth.type ?? "none")
    setProfile(auth.profile ?? "")
    setAuthKey(auth.key ?? "")
    setAuthValue(auth.value ?? "")
    setEnvText(envToText(config.env))
    setShowTemplates(false)
  }

  const isGateway = type === "mcp" && mcpMode === "gateway"
  const isDelegated = authType === KEYCLOAK_USER_EXCHANGE
  const isHttpMcp = type === "mcp" && mcpMode === "url-http"
  const effectiveAuthType: AuthSelection = isGateway ? GATEWAY_AUTH_TYPE : authType
  const authOption = AUTH_TYPE_OPTIONS.find((o) => o.value === authType)
  const needsKey = !isGateway && (authOption?.needsKey ?? false)
  const gatewayInstanceId = isGateway ? parseGatewayInstanceUrl(url) : null
  const gatewayUserMode = isGateway && gatewayRunAs === "user"
  // Definitions of the selected tools: from the last Connect, else as saved on the edited entry.
  const selectedToolDefs: GatewayToolDef[] = (() => {
    const known = new Map<string, GatewayToolDef>()
    ;(initial?.gateway?.tools ?? []).forEach((def) => known.set(def.name, def))
    ;(gatewayServers ?? []).forEach((sv) => sv.tools.forEach((def) => known.set(def.name, def)))
    return [...gatewaySelected]
      .sort()
      .map((n) => known.get(n))
      .filter((def): def is GatewayToolDef => !!def)
  })()
  // The selected saved secret (by the "Use saved secret" choice, not by the value's form: an env
  // secret is a bare name), else the ref stored on the edited entry when nothing is entered.
  const gatewayKeyRef = (() => {
    const v = authValue.trim()
    if (v && useSavedSecret) return gatewaySecretRef(v)
    const prev = initial?.gateway ? (initial.auth?.value ?? "") : ""
    return !v && isSecretRef(prev) ? prev : ""
  })()
  // A key typed now; it is saved as a new secret before the entry is saved.
  const gatewayPlainKey = (() => {
    const v = authValue.trim()
    return v && !useSavedSecret ? v : ""
  })()

  const autoSlug = () => slugify(`${name.trim() || "tool"}-${effectiveAuthType}-${Date.now()}`)

  const connectGateway = async () => {
    if (busy) return
    setGatewayError("")
    setGatewayConnecting(true)
    try {
      const res = await api.discoverGateway(
        url.trim(),
        gatewayUserMode ? { runAs: "user" } : gatewayPlainKey ? { apiKey: gatewayPlainKey } : { apiKeyRef: gatewayKeyRef },
        agentId
      )
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown; servers?: GatewayServer[] }
      if (!res.ok) {
        setGatewayError(typeof data.detail === "string" ? data.detail : t("addTool.gateway.connectFailedStatus", { status: res.status }))
        return
      }
      const servers: GatewayServer[] = data.servers ?? []
      setGatewayServers(servers)
      // Keep only selected tools that still exist; new tools stay unselected.
      const known = new Set(servers.flatMap((sv) => sv.tools.map((def) => def.name)))
      setGatewaySelected((prev) => new Set([...prev].filter((n) => known.has(n))))
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : t("addTool.gateway.connectFailed"))
    } finally {
      setGatewayConnecting(false)
    }
  }

  const toggleGatewayTools = (names: string[], checked: boolean) => {
    setGatewaySelected((prev) => {
      const next = new Set(prev)
      names.forEach((n) => (checked ? next.add(n) : next.delete(n)))
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // The form sits in a portal but still bubbles through React to any form around ToolsConfig.
    e.stopPropagation()
    if (busy || !valid) return
    setSubmitting(true)
    setSecretError("")
    try {
      setSubmitError("")
      if (isGateway && gatewayUserMode) {
        // No API key: the selected tools' definitions are saved, and calls carry each user's token.
        onSave({
          name: name.trim(),
          type: "mcp",
          url: url.trim(),
          transport: "http",
          description: description.trim() || undefined,
          gateway: { instance_url: url.trim(), run_as: "user", tools: selectedToolDefs },
          include: [...gatewaySelected].sort(),
        })
        onClose()
        return
      }
      if (isGateway) {
        // The API key is stored only as a secret; a typed key becomes a new secret first.
        let ref = gatewayKeyRef
        if (gatewayPlainKey) {
          const baseSlug = saveAsNewSecretKey.trim()
            ? slugify(saveAsNewSecretKey.trim().toLowerCase().replace(/\s+/g, "-"))
            : slugify(`${name.trim() || "gateway"}-apikey-${Date.now()}`)
          try {
            const res = await api.createSecret(
              baseSlug,
              gatewayPlainKey,
              `MCP gateway API key for ${name.trim()}`,
              undefined,
              agentId
            )
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = (await res.json().catch(() => ({}))) as { ref?: string }
            ref = data.ref || `db://${baseSlug}`
          } catch (err) {
            setSubmitError(
              t("addTool.gateway.keyNotSaved", {
                reason: err instanceof Error ? err.message : t("addTool.gateway.unknownError"),
              })
            )
            return
          }
        }
        onSave({
          name: name.trim(),
          type: "mcp",
          url: url.trim(),
          transport: "http",
          description: description.trim() || undefined,
          gateway: { instance_url: url.trim(), run_as: "service" },
          auth: { type: GATEWAY_AUTH_TYPE, value: ref },
          include: [...gatewaySelected].sort(),
        })
        onClose()
        return
      }
      const isCommand = type === "mcp" && mcpMode === "command"
      const args = argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
      const tool: ToolEntry = {
        name: name.trim(),
        type,
        url: isCommand ? undefined : url.trim() || undefined,
        description: description.trim() || undefined,
      }
      if (isCommand) {
        tool.command = command.trim()
        tool.args = args.length ? args : undefined
        tool.transport = "stdio"
        const envEntries = envText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l): [string, string] | null => {
            const idx = l.indexOf("=")
            return idx > 0 ? [l.slice(0, idx).trim(), l.slice(idx + 1).trim()] : null
          })
          .filter((entry): entry is [string, string] => entry !== null && entry[0].length > 0)
        if (envEntries.length > 0) {
          tool.env = Object.fromEntries(envEntries)
        }
      } else if (type === "mcp" && url.trim()) {
        tool.transport = mcpMode === "url-http" ? "http" : "sse"
      }
      if (isDelegated) {
        tool.auth = { mode: KEYCLOAK_USER_EXCHANGE, profile: profile.trim() }
        if (initial?.include) tool.include = initial.include
      } else if (authType !== "none") {
        let authValueFinal = authValue.trim()

        if (saveAsNewSecret && authValueFinal) {
          const slug = saveAsNewSecretKey.trim()
            ? slugify(saveAsNewSecretKey.trim().toLowerCase().replace(/\s+/g, "-"))
            : autoSlug()
          const res = await api.createSecret(
            slug,
            authValueFinal,
            `Auth for ${name.trim() || "tool"}`,
            undefined,
            agentId
          )
          if (!res.ok) throw new Error(t("addTool.secret.saveFailedStatus", { status: res.status }))
          const data = (await res.json()) as { ref?: string }
          authValueFinal = data.ref || `db://${slug}`
        }

        if (authValueFinal) {
          tool.auth = {
            type: authType,
            ...(needsKey && authKey.trim() && { key: authKey.trim() }),
            value: authValueFinal,
          }
        } else if (initial?.auth?.type && initial.auth.type !== KEYCLOAK_USER_EXCHANGE && initial.auth.type !== "none") {
          tool.auth = {
            type: authType,
            value: initial.auth.value,
            key: initial.auth.key,
            ...(needsKey && authKey.trim() && { key: authKey.trim() }),
          }
        }
      }
      onSave(tool)
      onClose()
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : t("addTool.secret.saveFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleInlineCreate = async () => {
    if (busy) return
    setCreatingSecret(true)
    setSecretError("")
    try {
      const baseSlug = inlineCreateKey.trim()
        ? slugify(inlineCreateKey.trim().toLowerCase().replace(/\s+/g, "-"))
        : autoSlug()
      const slug = baseSlug || autoSlug()
      const res = await api.createSecret(
        slug,
        inlineCreateValue.trim(),
        `Auth for ${name.trim() || "tool"}`,
        undefined,
        agentId
      )
      if (!res.ok) throw new Error(t("addTool.secret.saveFailedStatus", { status: res.status }))
      const created = (await res.json().catch(() => ({}))) as { ref?: string }
      setAuthValue(created.ref || `db://${slug}`)
      setInlineCreateOpen(false)
      setInlineCreateKey("")
      setInlineCreateValue("")
      loadSecretOptions(agentId)
        .then((list) => {
          if (list) setSecretsList(list)
        })
        .catch(() => {})
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : t("addTool.secret.saveFailed"))
    } finally {
      setCreatingSecret(false)
    }
  }

  const nameError =
    name.trim() === ""
      ? t("addTool.name.required")
      : !NAME_RE.test(name.trim())
        ? t("addTool.name.invalid")
        : ""
  const showNameError = name.trim() !== "" && !!nameError

  const isCommandMcp = type === "mcp" && mcpMode === "command"

  // Validate env lines only in command/stdio mode (env UI is hidden otherwise)
  const envLines = isCommandMcp
    ? envText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : []
  const badEnvLines = envLines.filter((l) => {
    const idx = l.indexOf("=")
    return idx <= 0 || l.slice(0, idx).trim().length === 0
  })
  const envError =
    badEnvLines.length > 0
      ? t("addTool.env.invalid", {
          count: badEnvLines.length,
          lines: badEnvLines.map((l) => `"${l}"`).join(", "),
        })
      : ""

  const gatewayHasKey = !!(gatewayPlainKey || gatewayKeyRef)
  const gatewayValid =
    !!gatewayInstanceId &&
    gatewaySelected.size > 0 &&
    (gatewayUserMode ? selectedToolDefs.length === gatewaySelected.size : gatewayHasKey)
  const valid =
    !nameError &&
    !envError &&
    (isDelegated || description.trim().length > 0) &&
    (!isDelegated || (isHttpMcp && !!profile.trim() && /^https:\/\//i.test(url.trim()))) &&
    (type === "openapi"
      ? url.trim().length > 0
      : isGateway
        ? gatewayValid
        : isCommandMcp
          ? command.trim().length > 0
          : url.trim().length > 0)

  const showGatewayUrlError = url.trim() !== "" && !gatewayInstanceId
  const dialogTitle = gatewayForm
    ? initial
      ? t("addTool.title.editGateway")
      : t("addTool.title.addGateway")
    : initial
      ? t("addTool.title.edit")
      : t("addTool.title.add")

  const secretFields = (
    <>
      <Field orientation="horizontal" data-disabled={secretsLoading || busy || undefined}>
        <Checkbox
          id="tool-use-saved-secret"
          disabled={secretsLoading || busy}
          checked={useSavedSecret}
          onCheckedChange={(checked) => {
            setUseSavedSecret(!!checked)
            setInlineCreateOpen(false)
          }}
        />
        <FieldLabel htmlFor="tool-use-saved-secret" className="font-normal">
          {t("addTool.secret.useSaved")}
        </FieldLabel>
      </Field>
      {secretsLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Spinner />
          {t("addTool.secret.loading")}
        </p>
      )}

      {useSavedSecret ? (
        <>
          <Field>
            <FieldLabel htmlFor="tool-auth-secret">{t("addTool.secret.label")}</FieldLabel>
            <NativeSelect
              id="tool-auth-secret"
              className="w-full"
              value={authValue.startsWith("env://") ? authValue.slice("env://".length) : authValue}
              onChange={(e) => setAuthValue(e.target.value)}
            >
              <NativeSelectOption value="">{t("addTool.secret.select")}</NativeSelectOption>
              {secretsList.map((s) => (
                <NativeSelectOption key={s.id} value={s.ref}>
                  {s.description ? `${s.id} — ${s.description}` : s.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setInlineCreateOpen((v) => !v)}
            >
              {inlineCreateOpen ? t("common:action.cancel") : t("addTool.secret.createNew")}
            </Button>
          </div>
          {inlineCreateOpen && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <Field>
                <FieldLabel htmlFor="tool-inline-secret-key">{t("addTool.secret.keyName")}</FieldLabel>
                <Input
                  id="tool-inline-secret-key"
                  type="text"
                  value={inlineCreateKey}
                  onChange={(e) => setInlineCreateKey(e.target.value)}
                  placeholder={t("addTool.secret.keyNamePlaceholder")}
                  aria-describedby="tool-inline-secret-key-help"
                />
                <FieldDescription id="tool-inline-secret-key-help">
                  {t("addTool.secret.keyNameHelp")}
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field className="min-w-48 flex-1">
                  <FieldLabel htmlFor="tool-inline-secret-value">{t("addTool.secret.newValue")}</FieldLabel>
                  <Input
                    id="tool-inline-secret-value"
                    type="password"
                    value={inlineCreateValue}
                    onChange={(e) => setInlineCreateValue(e.target.value)}
                    placeholder={t("addTool.secret.valuePlaceholder")}
                    autoComplete="off"
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={creatingSecret || !inlineCreateValue.trim()}
                  onClick={() => void handleInlineCreate()}
                >
                  {creatingSecret && <Spinner data-icon="inline-start" />}
                  {creatingSecret ? t("addTool.secret.saving") : t("common:action.save")}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="tool-auth-value">{t("addTool.secret.value")}</FieldLabel>
            <Input
              id="tool-auth-value"
              type="password"
              value={authValue}
              onChange={(e) => setAuthValue(e.target.value)}
              placeholder={t("addTool.secret.keepExisting")}
              autoComplete="off"
            />
          </Field>
          {!isGateway && (
            <Field orientation="horizontal" data-disabled={busy || undefined}>
              <Checkbox
                id="tool-save-as-secret"
                disabled={busy}
                checked={saveAsNewSecret}
                onCheckedChange={(checked) => setSaveAsNewSecret(!!checked)}
              />
              <FieldLabel htmlFor="tool-save-as-secret" className="font-normal">
                {t("addTool.secret.saveAsNew")}
              </FieldLabel>
            </Field>
          )}
          {(saveAsNewSecret || (isGateway && !!gatewayPlainKey)) && (
            <Field>
              <FieldLabel htmlFor="tool-save-as-secret-key">{t("addTool.secret.keyName")}</FieldLabel>
              <Input
                id="tool-save-as-secret-key"
                type="text"
                value={saveAsNewSecretKey}
                onChange={(e) => setSaveAsNewSecretKey(e.target.value)}
                placeholder={t("addTool.secret.keyNamePlaceholder")}
                aria-describedby="tool-save-as-secret-key-help"
              />
              <FieldDescription id="tool-save-as-secret-key-help">
                {t("addTool.secret.keyNameHelp")}
              </FieldDescription>
            </Field>
          )}
        </>
      )}
    </>
  )

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            {gatewayForm ? t("addTool.description.gateway") : t("addTool.description.tool")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          {/* The scroller is a div: a <fieldset> does not shrink or scroll as a flex item. */}
          <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <fieldset disabled={busy} className="min-w-0">
            <FieldGroup>
              {submitError && <Notice title={t("addTool.notSaved")}>{submitError}</Notice>}
              {secretError && <Notice title={secretError} />}

              {!initial && showTemplates && (
                <section className="flex flex-col gap-3 border-b pb-4">
                  <h4 className="flex items-center gap-2 text-sm font-medium">
                    <LayoutTemplateIcon className="size-4" aria-hidden="true" />
                    {t("templates.title")}
                  </h4>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
                    {TOOL_TEMPLATES.map((template) => {
                      const TemplateIcon = template.icon
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:border-ring hover:bg-foreground/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none"
                        >
                          <TemplateIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-sm font-semibold text-foreground">{t(template.nameKey)}</span>
                            <span className="text-xs text-muted-foreground">{t(template.descriptionKey)}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowTemplates(false)}>
                      {t("templates.configureManually")}
                    </Button>
                  </div>
                </section>
              )}
              {!initial && !showTemplates && !gatewayForm && (
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowTemplates(true)}>
                    <LayoutTemplateIcon data-icon="inline-start" />
                    {t("templates.browse")}
                  </Button>
                </div>
              )}

              <Field data-invalid={showNameError || undefined}>
                <FieldLabel htmlFor="tool-name">{t("addTool.name.label")}</FieldLabel>
                <Input
                  id="tool-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === "mcp" ? t("addTool.name.placeholderMcp") : t("addTool.name.placeholderOpenapi")}
                  aria-invalid={showNameError || undefined}
                  aria-describedby="tool-name-help"
                />
                {showNameError ? (
                  <FieldError id="tool-name-help">{nameError}</FieldError>
                ) : (
                  <FieldDescription id="tool-name-help">
                    {t("addTool.name.help")}
                  </FieldDescription>
                )}
              </Field>

              {!gatewayForm && (
              <Field>
                <FieldLabel htmlFor="tool-type">{t("addTool.type.label")}</FieldLabel>
                <NativeSelect
                  id="tool-type"
                  className="w-full"
                  value={type}
                  onChange={(e) => setType(e.target.value as "mcp" | "openapi")}
                >
                  <NativeSelectOption value="mcp">{t("addTool.type.mcp")}</NativeSelectOption>
                  <NativeSelectOption value="openapi" disabled={isDelegated}>{t("addTool.type.openapi")}</NativeSelectOption>
                </NativeSelect>
              </Field>
              )}

              {type === "mcp" && !gatewayForm && (
                <Field>
                  <FieldLabel htmlFor="tool-mcp-mode">{t("addTool.connection.label")}</FieldLabel>
                  <NativeSelect
                    id="tool-mcp-mode"
                    className="w-full"
                    value={mcpMode}
                    onChange={(e) => setMcpMode(e.target.value as McpConnectionMode)}
                  >
                    <NativeSelectOption value="url" disabled={isDelegated}>{t("addTool.connection.url")}</NativeSelectOption>
                    <NativeSelectOption value="url-http">{t("addTool.connection.urlHttp")}</NativeSelectOption>
                    <NativeSelectOption value="command" disabled={isDelegated}>{t("addTool.connection.command")}</NativeSelectOption>
                    <NativeSelectOption value="gateway" disabled={isDelegated}>{t("addTool.connection.gateway")}</NativeSelectOption>
                  </NativeSelect>
                </Field>
              )}

              {isGateway ? (
                <Field data-invalid={showGatewayUrlError || undefined}>
                  <FieldLabel htmlFor="tool-gateway-url">{t("addTool.gatewayUrl.label")}</FieldLabel>
                  <Input
                    id="tool-gateway-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("addTool.gatewayUrl.placeholder")}
                    aria-invalid={showGatewayUrlError || undefined}
                    aria-describedby="tool-gateway-url-help"
                  />
                  {showGatewayUrlError ? (
                    <FieldError id="tool-gateway-url-help">
                      {t("addTool.gatewayUrl.invalid")}
                    </FieldError>
                  ) : (
                    <FieldDescription id="tool-gateway-url-help">
                      {t("addTool.gatewayUrl.help")}
                    </FieldDescription>
                  )}
                </Field>
              ) : isCommandMcp ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="tool-command">{t("addTool.command.label")}</FieldLabel>
                    <Input
                      id="tool-command"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder={t("addTool.command.placeholder")}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tool-args">{t("addTool.args.label")}</FieldLabel>
                    <Textarea
                      id="tool-args"
                      className="font-mono"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem\n./cuga_workspace"}
                      rows={4}
                      aria-describedby="tool-args-help"
                    />
                    <FieldDescription id="tool-args-help">
                      {t("addTool.args.help")}
                    </FieldDescription>
                  </Field>
                  <Field data-invalid={!!envError || undefined}>
                    <FieldLabel htmlFor="tool-env">{t("addTool.env.label")}</FieldLabel>
                    <Textarea
                      id="tool-env"
                      className="font-mono"
                      value={envText}
                      onChange={(e) => setEnvText(e.target.value)}
                      placeholder={"API_KEY=your_api_key\nBASE_URL=http://localhost:8000"}
                      rows={3}
                      aria-invalid={!!envError || undefined}
                      aria-describedby="tool-env-help"
                    />
                    {envError ? (
                      <FieldError id="tool-env-help">{envError}</FieldError>
                    ) : (
                      <FieldDescription id="tool-env-help">
                        {t("addTool.env.help")}
                      </FieldDescription>
                    )}
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="tool-url">{t("addTool.url.label")}</FieldLabel>
                  <Input
                    id="tool-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={
                      type === "mcp"
                        ? mcpMode === "url-http"
                          ? "https://example.com/mcp"
                          : "http://localhost:8112/sse"
                        : "http://localhost:8007/openapi.json"
                    }
                    required
                    aria-describedby="tool-url-help"
                  />
                  <FieldDescription id="tool-url-help">
                    {type === "mcp"
                      ? mcpMode === "url-http"
                        ? t("addTool.url.helpHttp")
                        : t("addTool.url.helpSse")
                      : t("addTool.url.helpOpenapi")}
                  </FieldDescription>
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="tool-description">{t("addTool.descriptionField.label")}</FieldLabel>
                <Textarea
                  id="tool-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("addTool.descriptionField.placeholder")}
                  rows={2}
                  required={!isDelegated}
                />
              </Field>

              {isGateway ? (
              <FieldSet>
                <FieldLegend variant="label">{t("addTool.gateway.legend")}</FieldLegend>
                <Field>
                  <FieldLabel htmlFor="tool-gateway-run-as">{t("addTool.gateway.runAs.label")}</FieldLabel>
                  <NativeSelect
                    id="tool-gateway-run-as"
                    className="w-full"
                    value={gatewayRunAs}
                    onChange={(e) => setGatewayRunAs(e.target.value as GatewayRunAs)}
                    aria-describedby="tool-gateway-run-as-help"
                  >
                    <NativeSelectOption value="user">{t("addTool.gateway.runAs.user")}</NativeSelectOption>
                    <NativeSelectOption value="service">{t("addTool.gateway.runAs.service")}</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription id="tool-gateway-run-as-help">
                    {gatewayRunAs === "user"
                      ? t("addTool.gateway.runAs.helpUser")
                      : t("addTool.gateway.runAs.helpService")}
                  </FieldDescription>
                </Field>
                {gatewayUserMode ? (
                  <p className="text-sm text-muted-foreground">
                    {t("addTool.gateway.hintUser")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("addTool.gateway.hintService")}
                    </p>
                    {secretFields}
                  </>
                )}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!gatewayInstanceId || (!gatewayUserMode && !gatewayHasKey) || gatewayConnecting}
                    onClick={() => void connectGateway()}
                  >
                    {gatewayConnecting && <Spinner data-icon="inline-start" />}
                    {gatewayConnecting
                      ? gatewayServers
                        ? t("addTool.gateway.refreshing")
                        : t("addTool.gateway.connecting")
                      : gatewayServers
                        ? t("addTool.gateway.refresh")
                        : t("addTool.gateway.connect")}
                  </Button>
                </div>
                {gatewayError && <Notice title={t("addTool.gateway.connectFailed")}>{gatewayError}</Notice>}
                {gatewayServers && (
                  <GatewayToolPicker
                    servers={gatewayServers}
                    selected={gatewaySelected}
                    disabled={busy}
                    onToggle={toggleGatewayTools}
                  />
                )}
                {!gatewayServers && gatewaySelected.size > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("addTool.gateway.selectedSummary", { count: gatewaySelected.size })}
                  </p>
                )}
              </FieldSet>
              ) : (
              <FieldSet>
                <FieldLegend variant="label">{t("addTool.auth.legend")}</FieldLegend>
                <Field>
                  <FieldLabel htmlFor="tool-auth-type">{t("addTool.auth.type")}</FieldLabel>
                  <NativeSelect
                    id="tool-auth-type"
                    className="w-full"
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as AuthSelection)}
                  >
                    {(isHttpMcp || isDelegated) && (
                      <NativeSelectOption value={KEYCLOAK_USER_EXCHANGE}>{t("authType.keycloak")}</NativeSelectOption>
                    )}
                    {AUTH_TYPE_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                {needsKey && (
                  <Field>
                    <FieldLabel htmlFor="tool-auth-key">{t("addTool.auth.key")}</FieldLabel>
                    <Input
                      id="tool-auth-key"
                      value={authKey}
                      onChange={(e) => setAuthKey(e.target.value)}
                      placeholder={authType === "header" ? "X-API-Key" : "api_key"}
                    />
                  </Field>
                )}

                {isDelegated ? (
                  <Field>
                    <FieldLabel htmlFor="tool-delegation-profile">{t("addTool.auth.profile")}</FieldLabel>
                    <Input
                      id="tool-delegation-profile"
                      value={profile}
                      onChange={(e) => setProfile(e.target.value)}
                      required
                      aria-describedby="tool-delegation-help"
                    />
                    <FieldDescription id="tool-delegation-help">{t("addTool.auth.profileHelp")}</FieldDescription>
                  </Field>
                ) : authType !== "none" && secretFields}
              </FieldSet>
              )}
            </FieldGroup>
          </fieldset>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common:action.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !valid || creatingSecret || gatewayConnecting}>
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting
                ? isGateway
                  ? t("addTool.submit.savingGateway")
                  : t("addTool.submit.savingTool")
                : initial
                  ? t("common:action.save")
                  : gatewayForm
                    ? t("addTool.submit.addGateway")
                    : t("addTool.submit.addTool")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
