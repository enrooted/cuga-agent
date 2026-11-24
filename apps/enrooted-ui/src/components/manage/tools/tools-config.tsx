/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/ToolsConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * The tools list of an agent: configured MCP / OpenAPI / MCP gateway entries
 * (edit, remove, pick a subset of a connected server's tools, open the gateway
 * console), the runtime built-in apps, and the entry points to the add-tool
 * dialog, the MCP gateway form and the secrets manager.
 */
import * as React from "react"
import {
  CableIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  ListFilterIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
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
import { Label } from "@/components/ui/label"
import type { ConnectedApp, ConnectedTool, ToolEntry } from "@/lib/manage/tools-types"

import { AddToolDialog } from "./add-tool-dialog"
import { SecretsManager } from "./secrets-manager"
import { IconButton, IconLink } from "./shared"

export type { ConnectedApp, ConnectedTool, ToolEntry }

export interface ToolsConfigProps {
  tools: ToolEntry[]
  onChange: (tools: ToolEntry[]) => void
  connectedApps?: ConnectedApp[]
  connectedTools?: ConnectedTool[]
  agentId?: string
  builtinTools?: string[]
  /** Kept for parity with the original, which accepts it but never reports through it. */
  onError?: (title: string, message: string) => void
  /** When given, the key button calls this instead of opening the built-in secrets dialog. */
  onOpenSecrets?: () => void
}

const TOOLS_PREVIEW_COUNT = 3
const DEFAULT_BUILTIN_TOOLS = ["knowledge"]
const NO_APPS: ConnectedApp[] = []
const NO_TOOLS: ConnectedTool[] = []

function withInclude(tool: ToolEntry, include: string[] | undefined): ToolEntry {
  if (include && include.length > 0) return { ...tool, include }
  const rest = { ...tool }
  delete rest.include
  return rest
}

function ToolsConfigInner({
  tools,
  onChange,
  connectedApps = NO_APPS,
  connectedTools = NO_TOOLS,
  agentId = "cuga-default",
  builtinTools = DEFAULT_BUILTIN_TOOLS,
  onOpenSecrets,
}: ToolsConfigProps) {
  const { t: tr } = useTranslation("tools")
  const builtinSet = React.useMemo(() => new Set(builtinTools.map((n) => n.toLowerCase())), [builtinTools])
  const [modalOpen, setModalOpen] = React.useState(false)
  const [gatewayModalOpen, setGatewayModalOpen] = React.useState(false)
  const [secretsOpen, setSecretsOpen] = React.useState(false)
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
  const [toolsModalIndex, setToolsModalIndex] = React.useState<number | null>(null)
  // Never set by the original either (its "add a connected app" entry point is not rendered);
  // kept so the by-app save path stays intact.
  const [toolsModalAppName, setToolsModalAppName] = React.useState<string | null>(null)
  const [showAllTools, setShowAllTools] = React.useState(false)

  const handleAdd = (tool: ToolEntry) => {
    onChange([...tools, tool])
    setModalOpen(false)
  }

  const handleEdit = (tool: ToolEntry) => {
    if (editingIndex === null) return
    const next = [...tools]
    next[editingIndex] = tool
    onChange(next)
    setEditingIndex(null)
  }

  const handleRemove = (index: number) => {
    onChange(tools.filter((_, i) => i !== index))
  }

  const updateServerInclude = (index: number, include: string[] | undefined) => {
    onChange(tools.map((t, i) => (i === index ? withInclude(t, include) : t)))
  }

  const saveToolsModalByAppName = (appName: string, include: string[] | undefined) => {
    const idx = tools.findIndex((t) => t.name === appName)
    let updatedTools: ToolEntry[]

    if (idx >= 0) {
      updatedTools = tools.map((t, i) => (i === idx ? withInclude(t, include) : t))
    } else {
      const entry: ToolEntry = {
        name: appName,
        type: "mcp",
        url: "",
        description: "",
      }
      if (include && include.length > 0) entry.include = include
      const connectedIndex = connectedApps.findIndex((a) => a.name === appName)
      if (connectedIndex >= 0) {
        updatedTools = [...tools]
        let insertAt = 0
        for (const app of connectedApps) {
          if (app.name === appName) break
          if (tools.some((t) => t.name === app.name)) insertAt++
        }
        updatedTools.splice(insertAt, 0, entry)
      } else {
        updatedTools = [...tools, entry]
      }
    }

    onChange(updatedTools)
  }

  const editingTool = editingIndex !== null ? (tools[editingIndex] ?? null) : null
  const toolsModalServer = toolsModalIndex !== null ? (tools[toolsModalIndex] ?? null) : null
  const toolsModalOpenByApp = toolsModalAppName !== null
  const toolsModalServerName = toolsModalOpenByApp ? toolsModalAppName : (toolsModalServer?.name ?? null)
  const toolsModalAppTools = React.useMemo(
    () => (toolsModalServerName ? connectedTools.filter((t) => t.app === toolsModalServerName) : []),
    [toolsModalServerName, connectedTools]
  )
  const toolsModalCurrentInclude = React.useMemo(
    () => (toolsModalServerName ? tools.find((t) => t.name === toolsModalServerName)?.include : undefined),
    [toolsModalServerName, tools]
  )
  const closeToolsModal = () => {
    setToolsModalIndex(null)
    setToolsModalAppName(null)
  }

  // Runtime built-in apps (injected by Cuga Lite, not user-configured)
  const runtimeApps = connectedApps.filter((app) => app.type === "CUGA_LITE")

  const displayTools = showAllTools ? tools : tools.slice(0, TOOLS_PREVIEW_COUNT)

  return (
    <div className="flex flex-col gap-4">
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("toolsList.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {displayTools.map((t, i) => {
            const isConnected = connectedTools.some((ct) => ct.app === t.name)
            const isBuiltIn = builtinSet.has(t.name?.toLowerCase())
            const source =
              t.url || (t.command ? `${t.command}${t.args?.length ? ` ${t.args.join(" ")}` : ""}` : null)
            const include = t.include ?? []
            const typeLabel = t.type === "mcp" ? "MCP" : "OpenAPI"
            const gateway = t.gateway
            return (
              <li key={i} className="rounded-lg border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-semibold text-foreground">{t.name || typeLabel}</span>
                    <Badge variant="secondary">{gateway ? tr("toolsList.gatewayBadge") : typeLabel}</Badge>
                    {gateway && (
                      <Badge
                        variant="outline"
                        title={
                          gateway.run_as === "user"
                            ? tr("toolsList.runAsUserTitle")
                            : tr("toolsList.runAsServiceTitle")
                        }
                      >
                        {gateway.run_as === "user" ? tr("toolsList.asUser") : tr("toolsList.asService")}
                      </Badge>
                    )}
                    {isBuiltIn && <Badge variant="outline">{tr("toolsList.builtIn")}</Badge>}
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CircleCheckIcon className="size-3.5 text-status-ok" aria-hidden="true" />
                        {tr("toolsList.connected")}
                      </span>
                    )}
                    {include.length > 0 && <Badge variant="outline">{tr("toolsList.selected", { count: include.length })}</Badge>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {(isConnected || gateway) && (
                      <IconButton
                        label={tr("toolsList.selectTools")}
                        // A gateway's picker lists the instance's tools, also the unselected ones.
                        onClick={() => (gateway ? setEditingIndex(i) : setToolsModalIndex(i))}
                      >
                        <ListFilterIcon />
                      </IconButton>
                    )}
                    {gateway && /^https?:\/\//i.test(gateway.instance_url) && (
                      <IconLink label={tr("toolsList.openConsole")} href={gateway.instance_url}>
                        <ExternalLinkIcon />
                      </IconLink>
                    )}
                    <IconButton label={tr("common:action.edit")} onClick={() => setEditingIndex(i)} disabled={isBuiltIn}>
                      <PencilIcon />
                    </IconButton>
                    <IconButton label={tr("common:action.remove")} onClick={() => handleRemove(i)} disabled={isBuiltIn}>
                      <Trash2Icon />
                    </IconButton>
                  </div>
                </div>
                {source && (
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={source}>
                    {source.length > 60 ? `${source.slice(0, 60)}…` : source}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {runtimeApps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {runtimeApps.map((app) => {
            const appToolNames = connectedTools
              .filter((t) => t.app === app.name)
              .map((t) => t.name)
              .join(", ")
            return (
              <li key={app.name} className="rounded-lg border bg-card px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-semibold text-foreground">{app.name}</span>
                  <Badge variant="outline">{tr("toolsList.builtIn")}</Badge>
                  <Badge variant="secondary">
                    {tr("toolsList.toolCount", { count: app.tool_count })}
                  </Badge>
                </div>
                {appToolNames && (
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={appToolNames}>
                    {appToolNames}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={tr("toolsList.manageSecrets")} onClick={() => (onOpenSecrets ? onOpenSecrets() : setSecretsOpen(true))}>
          <KeyRoundIcon />
        </IconButton>
        <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {tr("toolsList.addTool")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setGatewayModalOpen(true)}>
          <CableIcon data-icon="inline-start" />
          {tr("toolsList.gatewayButton")}
        </Button>
        {tools.length > TOOLS_PREVIEW_COUNT && !showAllTools && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllTools(true)}>
            {tr("toolsList.showMore", { count: tools.length - TOOLS_PREVIEW_COUNT })}
          </Button>
        )}
        {tools.length > TOOLS_PREVIEW_COUNT && showAllTools && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllTools(false)}>
            {tr("toolsList.showLess")}
          </Button>
        )}
      </div>

      {modalOpen && (
        <AddToolDialog onClose={() => setModalOpen(false)} onSave={handleAdd} initial={null} agentId={agentId} />
      )}
      {gatewayModalOpen && (
        <AddToolDialog
          onClose={() => setGatewayModalOpen(false)}
          onSave={handleAdd}
          initial={null}
          agentId={agentId}
          gatewayOnly
        />
      )}
      {editingIndex !== null && editingTool !== null && (
        <AddToolDialog
          key={`edit-${editingIndex}`}
          onClose={() => setEditingIndex(null)}
          onSave={handleEdit}
          initial={editingTool}
          agentId={agentId}
        />
      )}
      {toolsModalServerName && (
        <ServerToolsDialog
          serverName={toolsModalServerName}
          appTools={toolsModalAppTools}
          currentInclude={toolsModalCurrentInclude}
          isNewInConfig={toolsModalOpenByApp && !tools.some((t) => t.name === toolsModalServerName)}
          onClose={closeToolsModal}
          onSave={(include) => {
            if (toolsModalOpenByApp && toolsModalAppName) {
              saveToolsModalByAppName(toolsModalAppName, include)
            } else if (toolsModalIndex !== null) {
              updateServerInclude(toolsModalIndex, include)
            }
            closeToolsModal()
          }}
        />
      )}
      <SecretsManager open={secretsOpen} onClose={() => setSecretsOpen(false)} agentId={agentId} />
    </div>
  )
}

export const ToolsConfig = React.memo(ToolsConfigInner)

export interface ServerToolsDialogProps {
  serverName: string
  appTools: ConnectedTool[]
  currentInclude: string[] | undefined
  isNewInConfig?: boolean
  onClose: () => void
  onSave: (include: string[] | undefined) => void
}

/** Pick which tools of one connected server are enabled (all selected = no include list). */
export function ServerToolsDialog({
  serverName,
  appTools,
  currentInclude,
  isNewInConfig,
  onClose,
  onSave,
}: ServerToolsDialogProps) {
  const { t: tr } = useTranslation("tools")
  const allIds = React.useMemo(() => appTools.map((t) => t.id ?? t.name), [appTools])
  const defaultChecked =
    !currentInclude || currentInclude.length === 0 || currentInclude.length === allIds.length
  const [selected, setSelected] = React.useState<Set<string>>(() => {
    if (defaultChecked) return new Set(allIds)
    return new Set(currentInclude ?? [])
  })
  const [selectAll, setSelectAll] = React.useState(defaultChecked)
  const baseId = React.useId()

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelectAll(false)
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    setSelected(checked ? new Set(allIds) : new Set())
  }

  const handleSave = () => {
    if (selectAll || selected.size === allIds.length) {
      onSave(undefined)
    } else {
      onSave(Array.from(selected))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("serverTools.title", { name: serverName })}</DialogTitle>
          <DialogDescription className={isNewInConfig ? undefined : "sr-only"}>
            {isNewInConfig ? (
              <Trans
                ns="tools"
                i18nKey="serverTools.willAdd"
                values={{ name: serverName }}
                components={{ strong: <strong className="font-bold text-foreground" /> }}
                // The name is data: escape it so it cannot be read as markup, then show it as typed.
                tOptions={{ interpolation: { escapeValue: true } }}
                shouldUnescape
              />
            ) : (
              tr("serverTools.description")
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-1">
          <div className="flex items-center gap-2 border-b pb-2">
            <Checkbox
              id={`${baseId}-all`}
              checked={selectAll || selected.size === allIds.length}
              onCheckedChange={(checked) => handleSelectAll(!!checked)}
            />
            <Label htmlFor={`${baseId}-all`}>{tr("serverTools.selectAll")}</Label>
          </div>
          <ul className="flex flex-col gap-2">
            {appTools.map((t, i) => {
              const id = t.id ?? t.name
              const checked = selectAll || selected.has(id)
              const inputId = `${baseId}-tool-${i}`
              return (
                <li key={id} className="flex items-start gap-2" title={t.description || t.name}>
                  <Checkbox id={inputId} className="mt-0.5" checked={checked} onCheckedChange={() => toggle(id)} />
                  <Label htmlFor={inputId} className="flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-snug font-normal">
                    <span className="font-mono text-[0.8125rem] text-foreground">{id}</span>
                    {t.description && (
                      <span className="text-xs text-muted-foreground">
                        {t.description.slice(0, 80)}
                        {t.description.length > 80 ? "…" : ""}
                      </span>
                    )}
                  </Label>
                </li>
              )
            })}
          </ul>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("common:action.cancel")}
          </Button>
          <Button type="button" onClick={handleSave}>
            {tr("common:action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
