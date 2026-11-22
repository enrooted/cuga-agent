import * as React from "react"
import { Link } from "react-router-dom"
import {
  AppWindowIcon,
  BotIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  LockIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  WorkflowIcon,
  WrenchIcon,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSessionKnowledgeAttachments } from "@/hooks/use-session-knowledge-attachments"
import * as api from "@/lib/api"
import { cn } from "@/lib/utils"

// ── types ──────────────────────────────────────────────────────────────────
export interface AppTool {
  name: string
  description: string
}
export interface AppConfig {
  appName: string
  tools: AppTool[]
}
export interface SupervisorMember {
  kind: "internal" | "a2a"
  ref?: string
  name?: string
  endpoint?: string
}
export interface ChatAgentOption {
  id: string
  name?: string
  kind?: "single" | "supervisor"
  description?: string
}
export interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileNode[]
}
export interface SkillInfo {
  name: string
  description: string
  requirements: string[]
  source: string
}
export interface AgentConfig {
  name: string
  description: string
  configVersion?: number | string | null
  kind?: "single" | "supervisor"
  supervisedAgents?: SupervisorMember[]
  apps: AppConfig[]
}
export type RightPanelSection = "configuration" | "workspace" | "knowledge" | "skills"

const truncate = (text: string, max = 100) => (text.length <= max ? text : text.substring(0, max) + "...")

function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="flex flex-col gap-3 p-1" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  )
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// ── tools ──────────────────────────────────────────────────────────────────
function ToolsSection({ apps }: { apps: AppConfig[] }) {
  if (apps.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WrenchIcon />
          </EmptyMedia>
          <EmptyTitle>No tools</EmptyTitle>
          <EmptyDescription>Connect tools to this agent in Manage.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Accordion multiple>
      {apps.map((app) => (
        <AccordionItem key={app.appName} value={app.appName}>
          <AccordionTrigger>
            <span className="flex flex-1 items-center gap-2">
              <AppWindowIcon className="size-4 text-primary" />
              <span className="flex-1 font-semibold">{app.appName}</span>
              <Badge variant="secondary">
                {app.tools.length} tool{app.tools.length !== 1 ? "s" : ""}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <ItemGroup>
              {app.tools.map((tool) => (
                <Item key={tool.name} size="sm">
                  <ItemMedia>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-mono text-xs">{tool.name}</ItemTitle>
                    <ItemDescription title={tool.description}>{truncate(tool.description, 120)}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

// ── supervisor roster ──────────────────────────────────────────────────────
function SupervisorRoster({ members, agents }: { members: SupervisorMember[]; agents: ChatAgentOption[] }) {
  if (members.length === 0) return <p className="p-2 text-sm">No agents are assigned to this supervisor.</p>
  return (
    <ItemGroup aria-label="Supervised agents">
      {members.map((member, index) => {
        const agent = member.kind === "internal" ? agents.find((a) => a.id === member.ref) : undefined
        const name = agent?.name?.trim() || member.name || member.ref || "Unknown agent"
        const Icon = agent?.kind === "supervisor" ? WorkflowIcon : BotIcon
        return (
          <Item key={`${member.kind}:${member.ref || member.name}:${index}`} variant="outline" size="sm">
            <ItemMedia>
              <Icon className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {name}
                <Badge variant={member.kind === "a2a" ? "secondary" : "outline"}>
                  {member.kind === "a2a" ? "External A2A" : "Agent"}
                </Badge>
              </ItemTitle>
              {member.ref && <code className="text-xs">{member.ref}</code>}
              {agent?.description && <ItemDescription>{agent.description}</ItemDescription>}
              {member.kind === "internal" &&
                member.ref &&
                (agents.length > 0 && !agent ? (
                  <p role="status" className="flex items-center gap-1 text-xs text-warn-text">
                    <TriangleAlertIcon className="size-3.5 shrink-0 text-status-warn" />
                    Agent unavailable. Update the supervisor configuration.
                  </p>
                ) : (
                  <Link to={`/chat/${encodeURIComponent(member.ref)}`} className="text-xs text-primary underline-offset-4 hover:underline">
                    Chat with {name}
                  </Link>
                ))}
            </ItemContent>
          </Item>
        )
      })}
    </ItemGroup>
  )
}

// ── workspace ──────────────────────────────────────────────────────────────
function collectDirectoryPaths(nodes: FileNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.type === "directory") {
        out.add(n.path)
        if (n.children?.length) walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

const JSON_UPLOAD_SUFFIXES = [".json", ".jsonl", ".ndjson"]

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  onDownload,
}: {
  node: FileNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string, open: boolean) => void
  onOpenFile: (node: FileNode) => void
  onDownload: (node: FileNode) => void
}) {
  const indent = { paddingLeft: `${depth * 0.875 + 0.25}rem` }
  if (node.type === "directory") {
    const open = expanded.has(node.path)
    return (
      <Collapsible open={open} onOpenChange={(o) => onToggle(node.path, o)}>
        <CollapsibleTrigger
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm hover:bg-muted"
          style={indent}
        >
          <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          {open ? <FolderOpenIcon className="size-4 shrink-0" /> : <FolderIcon className="size-4 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onDownload={onDownload}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <div className="group flex items-center gap-1.5 rounded-md py-0.5 pr-1 hover:bg-muted" style={indent}>
      <span className="w-3.5 shrink-0" />
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => onOpenFile(node)}>
        {node.name}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Download ${node.name}`}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onDownload(node)}
      >
        <DownloadIcon />
      </Button>
    </div>
  )
}

function WorkspaceSection({
  tree,
  loading,
  onRefresh,
  onUpload,
  onOpenFile,
  onDownload,
}: {
  tree: FileNode[]
  loading: boolean
  onRefresh: () => void
  onUpload: (files: File[]) => void
  onOpenFile: (node: FileNode) => void
  onDownload: (node: FileNode) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const prevDirs = React.useRef<Set<string>>(new Set())

  // New directories open automatically; vanished ones are forgotten (Carbon UI behaviour).
  React.useEffect(() => {
    const valid = collectDirectoryPaths(tree)
    const prev = prevDirs.current
    setExpanded((cur) => {
      const next = new Set<string>()
      for (const p of cur) if (valid.has(p)) next.add(p)
      for (const p of valid) if (!prev.has(p)) next.add(p)
      return next
    })
    prevDirs.current = valid
  }, [tree])

  return (
    <div
      className={cn("relative flex min-h-48 flex-col gap-2", dragOver && "rounded-lg ring-2 ring-primary")}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer?.types.includes("Files")) setDragOver(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setDragOver(false)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          JSON_UPLOAD_SUFFIXES.some((s) => f.name.toLowerCase().endsWith(s))
        )
        if (files.length > 0) onUpload(files)
      }}
    >
      <div className="flex justify-end gap-1">
        <input
          ref={inputRef}
          type="file"
          accept=".json,.jsonl,.ndjson"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            if (files.length > 0) onUpload(files)
            e.target.value = ""
          }}
        />
        <IconAction label="Upload JSON files" onClick={() => inputRef.current?.click()}>
          <UploadIcon />
        </IconAction>
        <IconAction label="Refresh workspace" onClick={onRefresh}>
          <RefreshCwIcon />
        </IconAction>
      </div>
      {loading ? (
        <ListSkeleton rows={4} label="Loading workspace files…" />
      ) : tree.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderIcon />
            </EmptyMedia>
            <EmptyTitle>No workspace files.</EmptyTitle>
            <EmptyDescription>Upload JSON files — they appear under workspace/uploads/</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div role="tree" aria-label="Workspace">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={(path, open) =>
                setExpanded((cur) => {
                  const next = new Set(cur)
                  if (open) next.add(path)
                  else next.delete(path)
                  return next
                })
              }
              onOpenFile={onOpenFile}
              onDownload={onDownload}
            />
          ))}
        </div>
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-background/85 text-sm font-medium">
          Drop JSON files here to upload
        </div>
      )}
    </div>
  )
}

// ── knowledge (port of agentic_chat KnowledgeSidePanel, inline mode) ────────
interface KnowledgeDoc {
  filename: string
  chunk_count: number
  status: string
  ingested_at: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function KnowledgeSection({
  threadId,
  sessionDocsVersion,
  onSessionDocsChanged,
  onDocCountChanged,
  knowledgeEnabled,
  agentKnowledgeEnabled,
  sessionKnowledgeEnabled,
  citationsEnabled,
  agentLabel,
}: {
  threadId: string
  sessionDocsVersion: number
  onSessionDocsChanged: () => void
  onDocCountChanged: (n: number) => void
  knowledgeEnabled: boolean
  agentKnowledgeEnabled: boolean
  sessionKnowledgeEnabled: boolean
  citationsEnabled: boolean
  agentLabel: string
}) {
  const agentScope = knowledgeEnabled && agentKnowledgeEnabled
  const sessionScope = knowledgeEnabled && sessionKnowledgeEnabled
  const [agentDocs, setAgentDocs] = React.useState<KnowledgeDoc[]>([])
  const [agentLoading, setAgentLoading] = React.useState(true)
  const [agentError, setAgentError] = React.useState("")

  React.useEffect(() => {
    if (!agentScope) return
    let cancelled = false
    setAgentLoading(true)
    setAgentError("")
    api
      .listKnowledgeDocuments()
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`)
        const body = await res.json()
        if (!cancelled) setAgentDocs(body?.documents ?? [])
      })
      .catch((e) => !cancelled && setAgentError(e instanceof Error ? e.message : "Failed to load documents"))
      .finally(() => !cancelled && setAgentLoading(false))
    return () => {
      cancelled = true
    }
  }, [agentScope, sessionDocsVersion])

  const conversationReady = sessionScope && Boolean(threadId)
  const [citations, setCitations] = React.useState<boolean | null>(null)
  const [citationsSaving, setCitationsSaving] = React.useState(false)
  const citationsReq = React.useRef(0)
  React.useEffect(() => {
    const req = ++citationsReq.current
    setCitationsSaving(false)
    setCitations(null)
    if (!threadId) return
    let cancelled = false
    api
      .getSessionKnowledgeSettings(threadId)
      .then((r) => {
        if (cancelled || req !== citationsReq.current) return
        const v = r.overrides?.citations_enabled
        setCitations(typeof v === "boolean" ? v : null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [threadId])

  const onCitationsChange = async (next: boolean) => {
    if (!conversationReady || citationsSaving) return
    const req = ++citationsReq.current
    setCitationsSaving(true)
    const prev = citations
    setCitations(next)
    try {
      await api.patchSessionKnowledgeSettings(threadId, { citations_enabled: next })
    } catch {
      if (req === citationsReq.current) setCitations(prev)
    } finally {
      if (req === citationsReq.current) setCitationsSaving(false)
    }
  }

  const session = useSessionKnowledgeAttachments({
    threadId: sessionScope ? threadId : "",
    enabled: sessionScope,
    sessionDocsVersion,
    onSessionDocsChanged,
  })

  React.useEffect(() => {
    onDocCountChanged(agentDocs.length + session.documents.length)
  }, [agentDocs.length, session.documents.length, onDocCountChanged])

  const fileRef = React.useRef<HTMLInputElement>(null)
  const [dropHover, setDropHover] = React.useState(false)

  if (!knowledgeEnabled || (!agentScope && !sessionScope)) {
    return (
      <Alert>
        <AlertTitle>
          {!knowledgeEnabled
            ? `Knowledge isn't available for ${agentLabel}.`
            : `Knowledge scopes are turned off for ${agentLabel}.`}
        </AlertTitle>
        <AlertDescription>
          {!knowledgeEnabled
            ? "To turn it back on or update documents, open Manage and change the knowledge settings there."
            : "Re-enable agent-level or session-level knowledge in Manage to make documents available here again."}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {agentScope && (
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Agent Knowledge</h4>
          {agentLoading && agentDocs.length === 0 ? (
            <ListSkeleton rows={2} label="Loading agent documents…" />
          ) : agentError ? (
            <Alert variant="destructive">
              <AlertTitle>{agentError}</AlertTitle>
            </Alert>
          ) : agentDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agent documents</p>
          ) : (
            <ItemGroup>
              {agentDocs.map((doc) => (
                <Item key={doc.filename} size="sm" variant="outline">
                  <ItemMedia>
                    <FileTextIcon className="size-4" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate">{doc.filename}</ItemTitle>
                    <ItemDescription>
                      {doc.chunk_count} chunks · {relativeTime(doc.ingested_at)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockIcon className="size-3" /> Managed in Settings
          </span>
        </section>
      )}

      {sessionScope && (
        <section className="flex flex-col gap-2">
          <div>
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">This Conversation</h4>
            <p className="text-xs text-muted-foreground">Only available in this chat session</p>
          </div>
          {citationsEnabled && (
            <Field orientation="horizontal" data-disabled={!conversationReady || citationsSaving || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="session-citations-toggle">Citations for this chat</FieldLabel>
                <FieldDescription>Show numbered sources under answers</FieldDescription>
              </FieldContent>
              <Switch
                id="session-citations-toggle"
                checked={citations ?? true}
                onCheckedChange={(v) => void onCitationsChange(v)}
                disabled={!conversationReady || citationsSaving}
              />
            </Field>
          )}
          {(citationsSaving || session.isDeleting) && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> {citationsSaving ? "Saving citation settings…" : "Removing document…"}
            </span>
          )}
          {session.isLoading && session.documents.length === 0 ? (
            <ListSkeleton rows={2} label="Loading conversation documents…" />
          ) : session.loadError ? (
            <Alert variant="destructive">
              <AlertTitle>{session.loadError}</AlertTitle>
            </Alert>
          ) : session.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No session documents</p>
          ) : (
            <ItemGroup>
              {session.documents.map((doc) => (
                <Item key={doc.knowledge_filename} size="sm" variant="outline">
                  <ItemMedia>
                    <FileTextIcon className="size-4" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate">{doc.display_name}</ItemTitle>
                    <ItemDescription>
                      {doc.chunk_count ?? 0} chunks · {doc.ingested_at ? relativeTime(doc.ingested_at) : "Just now"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove document ${doc.display_name}`}
                      disabled={session.isDeleting}
                      onClick={() => void session.deleteDocument(doc.knowledge_filename).catch(() => undefined)}
                    >
                      <Trash2Icon />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
          <button
            type="button"
            disabled={session.isUploading || !conversationReady}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDropHover(true)
            }}
            onDragLeave={() => setDropHover(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDropHover(false)
              if (!conversationReady) return
              const files = Array.from(e.dataTransfer.files)
              if (files.length > 0) void session.uploadFiles(files)
            }}
            className={cn(
              "rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              dropHover && "border-primary bg-muted"
            )}
          >
            {conversationReady ? "Drag and drop files here or click to upload" : "Session files are temporarily unavailable"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) void session.uploadFiles(files)
              e.target.value = ""
            }}
          />
          {session.isUploading && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Uploading...
            </span>
          )}
        </section>
      )}
    </div>
  )
}

// ── skills ─────────────────────────────────────────────────────────────────
function SkillsSection({ skills, loading }: { skills: SkillInfo[]; loading: boolean }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  if (loading) return <ListSkeleton label="Loading skills…" />
  if (skills.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindowIcon />
          </EmptyMedia>
          <EmptyTitle>No skills installed</EmptyTitle>
          <EmptyDescription>Skills will appear here once configured</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {skills.map((skill) => {
        const isOpen = expanded.has(skill.name)
        const long = (skill.description?.length || 0) > 100
        return (
          <Card key={skill.name} size="sm">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2">
                <AppWindowIcon className="size-4 shrink-0" />
                <span className="truncate">{skill.name}</span>
              </CardTitle>
              <CardAction>
                <Badge variant="secondary">{skill.source}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {(isOpen || !long ? skill.description : truncate(skill.description || "", 100)) || "No description available"}
              </p>
              {long && (
                <Button
                  variant="link"
                  size="xs"
                  className="w-fit px-0"
                  onClick={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur)
                      if (isOpen) next.delete(skill.name)
                      else next.add(skill.name)
                      return next
                    })
                  }
                >
                  {isOpen ? "Show less" : "Show more"}
                </Button>
              )}
              {skill.requirements?.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] font-bold tracking-wide uppercase">Requirements</span>
                  <div className="flex flex-wrap gap-1.5">
                    {skill.requirements.map((r) => (
                      <Badge key={r} variant="outline">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ── panel ──────────────────────────────────────────────────────────────────
const SECTION_META: Record<RightPanelSection, { title: string; subtitle: string; icon: React.ElementType }> = {
  configuration: { title: "Tools", subtitle: "Apps and tools available to this agent", icon: WrenchIcon },
  workspace: { title: "Workspace", subtitle: "Files available in the current workspace", icon: FolderIcon },
  knowledge: { title: "Knowledge", subtitle: "Agent and conversation documents for retrieval", icon: FileTextIcon },
  skills: { title: "Skills", subtitle: "Installed automation workflows", icon: AppWindowIcon },
}

export function AgentPanel(props: {
  agentConfig: AgentConfig
  configLoading: boolean
  availableAgents: ChatAgentOption[]
  section: RightPanelSection
  onSectionChange: (s: RightPanelSection) => void
  onClose: () => void
  workspaceTree: FileNode[]
  workspaceLoading: boolean
  onWorkspaceRefresh: () => void
  onWorkspaceUpload: (files: File[]) => void
  onOpenFile: (node: FileNode) => void
  onDownloadFile: (node: FileNode) => void
  threadId: string
  sessionDocsVersion: number
  onSessionDocsChanged: () => void
  knowledgeDocCount: number
  onKnowledgeDocCountChanged: (n: number) => void
  knowledgeEnabled: boolean
  agentKnowledgeEnabled: boolean
  sessionKnowledgeEnabled: boolean
  citationsEnabled: boolean
  skills: SkillInfo[]
  skillsLoading: boolean
}) {
  const { agentConfig, section } = props
  const isSupervisor = agentConfig.kind === "supervisor"
  const totalTools = agentConfig.apps.reduce((s, a) => s + a.tools.length, 0)
  const counts: Record<RightPanelSection, number> = {
    configuration: isSupervisor ? (agentConfig.supervisedAgents ?? []).length : totalTools,
    workspace: props.workspaceTree.length,
    knowledge: props.knowledgeDocCount,
    skills: props.skills.length,
  }
  const sections: Array<{ id: RightPanelSection; label: string }> = [
    { id: "configuration", label: isSupervisor ? "Agents" : "Tools" },
    { id: "workspace", label: "Files" },
    { id: "knowledge", label: "Knowledge" },
    ...(props.skills.length > 0 ? [{ id: "skills" as const, label: "Skills" }] : []),
  ]
  const meta =
    section === "configuration" && isSupervisor
      ? { title: "Supervised agents", subtitle: "Published agents available for delegation", icon: WorkflowIcon }
      : SECTION_META[section]
  const HeaderIcon = isSupervisor ? WorkflowIcon : AppWindowIcon
  const SectionIcon = meta.icon

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <HeaderIcon className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{agentConfig.name}</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{agentConfig.description}</p>
            {agentConfig.configVersion != null && (
              <Badge variant="outline" className="mt-2">
                Config v{agentConfig.configVersion}
              </Badge>
            )}
          </div>
        </div>
        <IconAction label="Close panel" onClick={props.onClose}>
          <PanelRightCloseIcon />
        </IconAction>
      </div>

      <Tabs
        value={section}
        onValueChange={(v) => props.onSectionChange(v as RightPanelSection)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="px-4 pt-3">
          <TabsList className="w-full" aria-label="Agent details sections">
            {sections.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {sections.map((s) => (
          <TabsContent key={s.id} value={s.id} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start gap-2.5 px-4 pt-4 pb-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <SectionIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{meta.title}</h3>
                  <Badge variant="secondary">{counts[section]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
              </div>
            </div>
            <Separator />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {s.id === "configuration" &&
                (props.configLoading ? (
                  <ListSkeleton label="Loading agent details…" />
                ) : isSupervisor ? (
                  <SupervisorRoster members={agentConfig.supervisedAgents ?? []} agents={props.availableAgents} />
                ) : (
                  <ToolsSection apps={agentConfig.apps} />
                ))}
              {s.id === "workspace" && (
                <WorkspaceSection
                  tree={props.workspaceTree}
                  loading={props.workspaceLoading}
                  onRefresh={props.onWorkspaceRefresh}
                  onUpload={props.onWorkspaceUpload}
                  onOpenFile={props.onOpenFile}
                  onDownload={props.onDownloadFile}
                />
              )}
              {s.id === "knowledge" && (
                <KnowledgeSection
                  threadId={props.threadId}
                  sessionDocsVersion={props.sessionDocsVersion}
                  onSessionDocsChanged={props.onSessionDocsChanged}
                  onDocCountChanged={props.onKnowledgeDocCountChanged}
                  knowledgeEnabled={props.knowledgeEnabled}
                  agentKnowledgeEnabled={props.agentKnowledgeEnabled}
                  sessionKnowledgeEnabled={props.sessionKnowledgeEnabled}
                  citationsEnabled={props.citationsEnabled}
                  agentLabel={agentConfig.name}
                />
              )}
              {s.id === "skills" && <SkillsSection skills={props.skills} loading={props.skillsLoading} />}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
