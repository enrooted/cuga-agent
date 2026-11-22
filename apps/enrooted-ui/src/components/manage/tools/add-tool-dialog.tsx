/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/AddToolModal.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * Add / edit one tool of an agent: MCP server (SSE URL, HTTP URL or stdio
 * command) or OpenAPI service, with authentication and saved-secret references.
 */
import * as React from "react"
import { FolderIcon, LayoutTemplateIcon, type LucideIcon } from "lucide-react"

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
import { AUTH_TYPE_OPTIONS, type AuthType, type ToolAuth, type ToolEntry } from "@/lib/manage/tools-types"

import { loadSecretOptions, Notice, type SecretOption } from "./shared"

export interface AddToolDialogProps {
  onClose: () => void
  onSave: (tool: ToolEntry) => void
  initial?: ToolEntry | null
  agentId?: string
}

const emptyAuth: ToolAuth = { type: "none" }

type McpConnectionMode = "url" | "url-http" | "command"

// Pre-configured tool templates
interface ToolTemplate {
  id: string
  name: string
  description: string
  icon: LucideIcon
  config: Partial<ToolEntry> & { mcpMode?: McpConnectionMode; argsText?: string }
}

const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files in a specified directory",
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
    name: "Drawio",
    description: "Create and manipulate diagrams using Draw.io",
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
    name: "Browser_MCP",
    description: "Browser automation and web interaction capabilities",
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
  const mcpMode: McpConnectionMode = hasCmd ? "command" : transport === "http" ? "url-http" : "url"
  const authType: AuthType = !auth.type || auth.type === "none" ? "none" : auth.type
  return {
    name: initial?.name ?? "",
    type: initial?.type ?? "mcp",
    mcpMode,
    url: initial?.url ?? "",
    command: initial?.command ?? "",
    argsText: (initial?.args ?? []).join("\n"),
    description: initial?.description ?? "",
    authType,
    authKey: auth.key ?? "",
    authValue: val,
    useSavedSecret:
      typeof val === "string" && (val.startsWith("db://") || val.startsWith("vault://") || val.startsWith("aws://")),
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

export function AddToolDialog({ onClose, onSave, initial, agentId }: AddToolDialogProps) {
  const [init] = React.useState(() => initFromTool(initial))
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
  const [authType, setAuthType] = React.useState<AuthType>(init.authType)
  const [authKey, setAuthKey] = React.useState(init.authKey)
  const [authValue, setAuthValue] = React.useState(init.authValue)
  const [useSavedSecret, setUseSavedSecret] = React.useState(init.useSavedSecret)
  const [saveAsNewSecret, setSaveAsNewSecret] = React.useState(false)
  const [saveAsNewSecretKey, setSaveAsNewSecretKey] = React.useState("")
  const [secretsList, setSecretsList] = React.useState<SecretOption[]>([])
  const [inlineCreateOpen, setInlineCreateOpen] = React.useState(false)
  const [inlineCreateValue, setInlineCreateValue] = React.useState("")
  const [inlineCreateKey, setInlineCreateKey] = React.useState("")
  const [showTemplates, setShowTemplates] = React.useState(!initial)

  const busy = submitting || creatingSecret

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
    const config = template.config
    setName(config.name || "")
    setType(config.type || "mcp")
    setMcpMode(config.mcpMode || "url")
    setUrl(config.url || "")
    setCommand(config.command || "")
    setArgsText(config.argsText || (config.args || []).join("\n"))
    setDescription(config.description || "")
    const auth = config.auth ?? emptyAuth
    setAuthType(auth.type === "none" || !auth.type ? "none" : auth.type)
    setAuthKey(auth.key ?? "")
    setAuthValue(auth.value ?? "")
    setEnvText(envToText(config.env))
    setShowTemplates(false)
  }

  const authOption = AUTH_TYPE_OPTIONS.find((o) => o.value === authType)
  const needsKey = authOption?.needsKey ?? false

  const autoSlug = () => slugify(`${name.trim() || "tool"}-${authType}-${Date.now()}`)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // The form sits in a portal but still bubbles through React to any form around ToolsConfig.
    e.stopPropagation()
    if (submitting || !valid || creatingSecret) return
    setSubmitting(true)
    setSecretError("")
    try {
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
      if (authType !== "none") {
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
          if (!res.ok) throw new Error(`Failed to save secret (${res.status})`)
          const data = (await res.json()) as { ref?: string }
          authValueFinal = data.ref || `db://${slug}`
        }

        if (authValueFinal) {
          tool.auth = {
            type: authType,
            ...(needsKey && authKey.trim() && { key: authKey.trim() }),
            value: authValueFinal,
          }
        } else if (initial?.auth && initial.auth.type !== "none") {
          tool.auth = {
            ...initial.auth,
            type: authType,
            ...(needsKey && authKey.trim() && { key: authKey.trim() }),
          }
        }
      }
      onSave(tool)
      onClose()
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : "Failed to save secret")
    } finally {
      setSubmitting(false)
    }
  }

  const handleInlineCreate = async () => {
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
      if (!res.ok) throw new Error(`Failed to save secret (${res.status})`)
      setAuthValue(`db://${slug}`)
      setInlineCreateOpen(false)
      setInlineCreateKey("")
      loadSecretOptions(agentId)
        .then((list) => {
          if (list) setSecretsList(list)
        })
        .catch(() => {})
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : "Failed to save secret")
    } finally {
      setCreatingSecret(false)
    }
  }

  const nameError =
    name.trim() === ""
      ? "Name is required"
      : !NAME_RE.test(name.trim())
        ? "Use lowercase letters, digits, and underscores only (e.g. my_tool)"
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
      ? `Invalid env line${badEnvLines.length > 1 ? "s" : ""}: ${badEnvLines.map((l) => `"${l}"`).join(", ")}. Use KEY=VALUE format.`
      : ""

  const valid =
    !nameError &&
    !envError &&
    description.trim().length > 0 &&
    (type === "openapi"
      ? url.trim().length > 0
      : isCommandMcp
        ? command.trim().length > 0
        : url.trim().length > 0)

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
          <DialogTitle>{initial ? "Edit tool" : "Add tool"}</DialogTitle>
          <DialogDescription className="sr-only">
            Connect an MCP server or an OpenAPI service and set how the agent authenticates to it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          {/* The scroller is a div: a <fieldset> does not shrink or scroll as a flex item. */}
          <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <fieldset disabled={busy} className="min-w-0">
            <FieldGroup>
              {secretError && <Notice title={secretError} />}

              {!initial && showTemplates && (
                <section className="flex flex-col gap-3 border-b pb-4">
                  <h4 className="flex items-center gap-2 text-sm font-medium">
                    <LayoutTemplateIcon className="size-4" aria-hidden="true" />
                    Start from a template
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
                            <span className="text-sm font-semibold text-foreground">{template.name}</span>
                            <span className="text-xs text-muted-foreground">{template.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowTemplates(false)}>
                      Or configure manually
                    </Button>
                  </div>
                </section>
              )}
              {!initial && !showTemplates && (
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowTemplates(true)}>
                    <LayoutTemplateIcon data-icon="inline-start" />
                    Browse templates
                  </Button>
                </div>
              )}

              <Field data-invalid={showNameError || undefined}>
                <FieldLabel htmlFor="tool-name">Name</FieldLabel>
                <Input
                  id="tool-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === "mcp" ? "e.g. my_tool" : "e.g. crm_api"}
                  aria-invalid={showNameError || undefined}
                  aria-describedby="tool-name-help"
                />
                {showNameError ? (
                  <FieldError id="tool-name-help">{nameError}</FieldError>
                ) : (
                  <FieldDescription id="tool-name-help">
                    Lowercase letters, digits, underscores (e.g. my_tool)
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="tool-type">Type</FieldLabel>
                <NativeSelect
                  id="tool-type"
                  className="w-full"
                  value={type}
                  onChange={(e) => setType(e.target.value as "mcp" | "openapi")}
                >
                  <NativeSelectOption value="mcp">MCP server</NativeSelectOption>
                  <NativeSelectOption value="openapi">OpenAPI service</NativeSelectOption>
                </NativeSelect>
              </Field>

              {type === "mcp" && (
                <Field>
                  <FieldLabel htmlFor="tool-mcp-mode">Connection</FieldLabel>
                  <NativeSelect
                    id="tool-mcp-mode"
                    className="w-full"
                    value={mcpMode}
                    onChange={(e) => setMcpMode(e.target.value as McpConnectionMode)}
                  >
                    <NativeSelectOption value="url">URL (SSE)</NativeSelectOption>
                    <NativeSelectOption value="url-http">URL (HTTP)</NativeSelectOption>
                    <NativeSelectOption value="command">Command (stdio)</NativeSelectOption>
                  </NativeSelect>
                </Field>
              )}

              {isCommandMcp ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="tool-command">Command</FieldLabel>
                    <Input
                      id="tool-command"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="e.g. npx"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tool-args">Args (one per line)</FieldLabel>
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
                      One argument per line (e.g. -y, package name, working directory)
                    </FieldDescription>
                  </Field>
                  <Field data-invalid={!!envError || undefined}>
                    <FieldLabel htmlFor="tool-env">Environment variables (one per line)</FieldLabel>
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
                        KEY=VALUE per line. Use ENV_VAR_NAME as value to reference process env (e.g. MY_KEY=MY_KEY)
                      </FieldDescription>
                    )}
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="tool-url">URL</FieldLabel>
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
                        ? "MCP server Streamable HTTP endpoint"
                        : "MCP server SSE endpoint (e.g. /sse)"
                      : "OpenAPI spec URL"}
                  </FieldDescription>
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="tool-description">Description</FieldLabel>
                <Textarea
                  id="tool-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description of what this tool provides"
                  rows={2}
                  required
                />
              </Field>

              <FieldSet>
                <FieldLegend variant="label">Authentication</FieldLegend>
                <Field>
                  <FieldLabel htmlFor="tool-auth-type">Auth type</FieldLabel>
                  <NativeSelect
                    id="tool-auth-type"
                    className="w-full"
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as AuthType)}
                  >
                    {AUTH_TYPE_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>
                        {opt.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                {needsKey && (
                  <Field>
                    <FieldLabel htmlFor="tool-auth-key">Header / query key</FieldLabel>
                    <Input
                      id="tool-auth-key"
                      value={authKey}
                      onChange={(e) => setAuthKey(e.target.value)}
                      placeholder={authType === "header" ? "X-API-Key" : "api_key"}
                    />
                  </Field>
                )}

                {authType !== "none" && (
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
                        Use saved secret
                      </FieldLabel>
                    </Field>
                    {secretsLoading && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                        <Spinner />
                        Loading saved secrets…
                      </p>
                    )}

                    {useSavedSecret ? (
                      <>
                        <Field>
                          <FieldLabel htmlFor="tool-auth-secret">Secret</FieldLabel>
                          <NativeSelect
                            id="tool-auth-secret"
                            className="w-full"
                            value={authValue}
                            onChange={(e) => setAuthValue(e.target.value)}
                          >
                            <NativeSelectOption value="">Select a secret</NativeSelectOption>
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
                            {inlineCreateOpen ? "Cancel" : "Create new secret"}
                          </Button>
                        </div>
                        {inlineCreateOpen && (
                          <div className="flex flex-col gap-3 rounded-lg border p-3">
                            <Field>
                              <FieldLabel htmlFor="tool-inline-secret-key">Key name</FieldLabel>
                              <Input
                                id="tool-inline-secret-key"
                                type="text"
                                value={inlineCreateKey}
                                onChange={(e) => setInlineCreateKey(e.target.value)}
                                placeholder="e.g. my-tool-api-key"
                                aria-describedby="tool-inline-secret-key-help"
                              />
                              <FieldDescription id="tool-inline-secret-key-help">
                                Optional; leave empty to auto-generate
                              </FieldDescription>
                            </Field>
                            <div className="flex flex-wrap items-end gap-2">
                              <Field className="min-w-48 flex-1">
                                <FieldLabel htmlFor="tool-inline-secret-value">New secret value</FieldLabel>
                                <Input
                                  id="tool-inline-secret-value"
                                  type="password"
                                  value={inlineCreateValue}
                                  onChange={(e) => setInlineCreateValue(e.target.value)}
                                  placeholder="Secret value"
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
                                {creatingSecret ? "Saving secret…" : "Save"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <Field>
                          <FieldLabel htmlFor="tool-auth-value">Secret / token / value</FieldLabel>
                          <Input
                            id="tool-auth-value"
                            type="password"
                            value={authValue}
                            onChange={(e) => setAuthValue(e.target.value)}
                            placeholder="Leave empty to keep existing"
                            autoComplete="off"
                          />
                        </Field>
                        <Field orientation="horizontal" data-disabled={busy || undefined}>
                          <Checkbox
                            id="tool-save-as-secret"
                            disabled={busy}
                            checked={saveAsNewSecret}
                            onCheckedChange={(checked) => setSaveAsNewSecret(!!checked)}
                          />
                          <FieldLabel htmlFor="tool-save-as-secret" className="font-normal">
                            Save as new secret
                          </FieldLabel>
                        </Field>
                        {saveAsNewSecret && (
                          <Field>
                            <FieldLabel htmlFor="tool-save-as-secret-key">Key name</FieldLabel>
                            <Input
                              id="tool-save-as-secret-key"
                              type="text"
                              value={saveAsNewSecretKey}
                              onChange={(e) => setSaveAsNewSecretKey(e.target.value)}
                              placeholder="e.g. my-tool-api-key"
                              aria-describedby="tool-save-as-secret-key-help"
                            />
                            <FieldDescription id="tool-save-as-secret-key-help">
                              Optional; leave empty to auto-generate
                            </FieldDescription>
                          </Field>
                        )}
                      </>
                    )}
                  </>
                )}
              </FieldSet>
            </FieldGroup>
          </fieldset>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !valid || creatingSecret}>
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting ? "Saving tool…" : initial ? "Save" : "Add tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
