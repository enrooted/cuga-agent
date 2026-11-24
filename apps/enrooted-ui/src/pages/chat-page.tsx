/*
 * The /chat and /chat/:agentId page — port of the Carbon UI's ChatLanding.tsx
 * (Copyright IBM Corp., Apache-2.0): conversation list, chat, agent panel
 * (tools / files / knowledge / skills), drafts, agent switcher, previews.
 */
import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { LockIcon, MenuIcon, PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon, TriangleAlertIcon } from "lucide-react"

import { AlertDialog } from "@/components/confirm-dialog"
import { AgentPanel, type AgentConfig, type AppConfig, type ChatAgentOption, type FileNode, type RightPanelSection, type SkillInfo } from "@/components/agent-panel"
import { ConversationsPanel, formatTimestamp, type ConversationThread } from "@/components/conversations-panel"
import { NavRail } from "@/components/nav-rail"
import { ChatView, type HomescreenConfig } from "@/components/chat/chat-view"
import { FilePreviewDialog, type FilePreview } from "@/components/file-preview-dialog"
import { Button } from "@/components/ui/button"
import { MemoryWorkspace } from "@/components/memory/memory-workspace"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import i18n from "@/i18n"
import * as api from "@/lib/api"
import { type AttachmentSnapshot } from "@/lib/chat-model"
import { cn } from "@/lib/utils"

const BP_HIDE_RIGHT = 1100
const BP_HIDE_LEFT = 768
const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".yaml", ".yml", ".log", ".csv", ".html", ".css", ".js", ".ts", ".py"]

interface DraftThread {
  threadId: string
  hasSentFirstMessage: boolean
}

async function prepareDraft(agentId: string, storageKey: string) {
  const saved = sessionStorage.getItem(storageKey)
  if (saved) {
    const res = await api.apiFetch(`/api/conversations/${encodeURIComponent(saved)}?agent_id=${encodeURIComponent(agentId)}`)
    if (res.ok && (await res.json()).status === "new") return saved
    if (!res.ok && res.status !== 404) throw new Error(i18n.t("chat:error.restoreChat", { status: res.status }))
    sessionStorage.removeItem(storageKey)
  }
  const res = await api.apiFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  })
  if (!res.ok) throw new Error(i18n.t("chat:error.createChat", { status: res.status }))
  return (await res.json()).id as string
}

function useWindowWidth() {
  const [w, setW] = React.useState(window.innerWidth)
  React.useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return w
}

export function ChatPage() {
  const { t } = useTranslation("chat")
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [agentRegistry, setAgentRegistry] = React.useState<boolean | null>(null)
  const [memoryEnabled, setMemoryEnabled] = React.useState(false)
  const activeView = memoryEnabled && searchParams.get("view") === "memory" ? "memory" : "chat"
  const setActiveView = (view: "chat" | "memory") => {
    const params = new URLSearchParams(searchParams)
    if (view === "memory") params.set("view", "memory")
    else params.delete("view")
    setSearchParams(params)
  }
  const agentId = agentRegistry === false ? "cuga-default" : routeAgentId || "cuga-default"
  React.useLayoutEffect(() => api.setKnowledgeAgentId(agentId), [agentId])

  const [availableAgents, setAvailableAgents] = React.useState<ChatAgentOption[]>([])
  const agentOptions: ChatAgentOption[] =
    availableAgents.length > 0
      ? [...availableAgents.filter((a) => a.kind === "supervisor"), ...availableAgents.filter((a) => a.kind !== "supervisor")]
      : [{ id: agentId }]

  // ui config + agent registry
  React.useEffect(() => {
    let cancelled = false
    api
      .getUiConfig()
      .then(async (c) => {
        if (cancelled) return
        setAgentRegistry(c.agent_registry)
        setMemoryEnabled(c.evolve_memory_enabled)
        if (!c.agent_registry) {
          if (routeAgentId && routeAgentId !== "cuga-default") navigate("/chat", { replace: true })
          return
        }
        const res = await api.getAgents()
        const data = res.ok ? await res.json() : null
        if (cancelled || !data?.agents) return
        setAvailableAgents(data.agents)
        if (routeAgentId && routeAgentId !== "cuga-default" && !data.agents.some((a: { id: string }) => a.id === routeAgentId)) {
          navigate("/chat", { replace: true })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentRegistry(false)
          setMemoryEnabled(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [navigate, routeAgentId])

  // ── threads & drafts ────────────────────────────────────────────────────
  const { user, ready: authReady, canManage } = useAuth()
  // Memory workspace: memories a response used or saved, and who may administer.
  const [focusedMemoryIds, setFocusedMemoryIds] = React.useState<string[]>([])
  const [focusedMemoryRelationship, setFocusedMemoryRelationship] = React.useState<"used" | "saved">("used")
  const canManageMemory = authReady && canManage
  const storageKey =JSON.stringify(["enrooted-draft", user?.sub, agentId])
  const [draft, setDraft] = React.useState<DraftThread>({ threadId: "", hasSentFirstMessage: false })
  const [draftRequest, setDraftRequest] = React.useState(0)
  const [draftError, setDraftError] = React.useState("")
  const pendingDraft = React.useRef<{ key: string; result: Promise<string> } | null>(null)
  React.useEffect(() => {
    let active = true
    const key = JSON.stringify([storageKey, draftRequest])
    if (pendingDraft.current?.key !== key) {
      pendingDraft.current = { key, result: prepareDraft(agentId, storageKey) }
    }
    pendingDraft.current.result.then((id) => {
      if (!active) return
      sessionStorage.setItem(storageKey, id)
      setDraft({ threadId: id, hasSentFirstMessage: false })
    }).catch((error: Error) => { if (active) setDraftError(error.message) })
    return () => { active = false }
  }, [storageKey, agentId, draftRequest])
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null)
  const [activeThreadId, setActiveThreadId] = React.useState(draft.threadId)
  const [threads, setThreads] = React.useState<ConversationThread[]>([])
  const [threadsLoading, setThreadsLoading] = React.useState(true)
  const threadsGeneration = React.useRef(0)
  const threadsSeq = React.useRef(0)
  const agentIdRef = React.useRef(agentId)
  agentIdRef.current = agentId
  const threadId = selectedThreadId ?? activeThreadId
  const [sessionDocsVersion, setSessionDocsVersion] = React.useState(0)

  // Switching agents navigates to /chat/:agentId, which remounts this page
  // (keyed route in App.tsx), so drafts/threads/config reset naturally.

  React.useEffect(() => {
    if (selectedThreadId == null) setActiveThreadId(draft.threadId)
  }, [draft.threadId, selectedThreadId])

  const refreshThreads = React.useCallback(async () => {
    const id = agentId
    const gen = threadsGeneration.current
    const seq = ++threadsSeq.current
    try {
      const rows = await api.getConversationThreads(id)
      if (seq === threadsSeq.current && id === agentIdRef.current && gen === threadsGeneration.current) {
        setThreads(rows)
      }
    } catch (e) {
      console.error("Error fetching threads:", e)
    }
  }, [agentId])

  React.useEffect(() => {
    let cancelled = false
    const gen = threadsGeneration.current
    ;(async () => {
      try {
        const rows = await api.getConversationThreads(agentId)
        if (!cancelled && gen === threadsGeneration.current) setThreads(rows)
      } catch (e) {
        if (!cancelled) toast.error(i18n.t("chat:toast.threadsLoadError"), { description: e instanceof Error ? e.message : i18n.t("chat:toast.threadsLoadErrorBody") })
      } finally {
        if (!cancelled) setThreadsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  const createAndActivateDraft = React.useCallback(() => {
    sessionStorage.removeItem(storageKey)
    setDraftError("")
    setDraft((d) => ({ ...d, threadId: "", hasSentFirstMessage: false }))
    setDraftRequest((n) => n + 1)
    setSelectedThreadId(null)
    setActiveThreadId("")
    setSessionDocsVersion((v) => v + 1)
  }, [storageKey])

  // ── agent configuration ─────────────────────────────────────────────────
  const [agentConfig, setAgentConfig] = React.useState<AgentConfig>({ name: agentId, description: "", apps: [] })
  const [configLoading, setConfigLoading] = React.useState(true)
  const [homescreen, setHomescreen] = React.useState<HomescreenConfig | undefined>(undefined)
  const [knowledgeEnabled, setKnowledgeEnabled] = React.useState(false)
  const [agentKnowledgeEnabled, setAgentKnowledgeEnabled] = React.useState(false)
  const [sessionKnowledgeEnabled, setSessionKnowledgeEnabled] = React.useState(false)
  const [citationsEnabled, setCitationsEnabled] = React.useState(true)
  const [agentContext, setAgentContext] = React.useState<{ agent_id: string; config_version: number | string | null } | undefined>()

  const clearDraftSessionFiles = React.useCallback(
    async (tid: string) => {
      if (!knowledgeEnabled || !sessionKnowledgeEnabled) return
      try {
        const res = await api.deleteSessionKnowledgeCollection(tid)
        if (!res.ok) toast.warning(i18n.t("chat:toast.draftCleanup"), { description: i18n.t("chat:toast.draftCleanupBody") })
      } catch {
        toast.warning(i18n.t("chat:toast.draftCleanup"), { description: i18n.t("chat:toast.draftCleanupBody") })
      }
    },
    [knowledgeEnabled, sessionKnowledgeEnabled]
  )

  React.useEffect(() => {
    let cancelled = false
    setConfigLoading(true)
    setAgentConfig({ name: agentId, description: "", apps: [] })
    ;(async () => {
      try {
        const [ctxRes, toolsRes, manageRes] = await Promise.all([
          api.getAgentContext(),
          api.getToolsList(false, agentId),
          api.getManageConfig(false, agentId),
        ])
        if (cancelled) return
        let name = "CUGA Default Agent"
        let description = i18n.t("chat:agent.defaultDescription")
        let configVersion: number | string | null = null
        if (ctxRes.ok) {
          const ctx = await ctxRes.json()
          if (cancelled) return
          const resolved = routeAgentId ? agentId : (ctx.agent_id ?? agentId)
          if (agentId === "cuga-default") configVersion = ctx.config_version ?? null
          setKnowledgeEnabled(ctx.knowledge_enabled ?? false)
          setAgentKnowledgeEnabled(ctx.agent_level_knowledge_enabled ?? false)
          setSessionKnowledgeEnabled(ctx.session_level_knowledge_enabled ?? false)
          setCitationsEnabled(ctx.citations_enabled ?? true)
          api.setKnowledgeAgentId(resolved)
          setAgentContext({ agent_id: resolved, config_version: ctx.config_version ?? null })
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let manage: any = null
        if (manageRes.ok) {
          manage = await manageRes.json()
          configVersion = manage?.version ?? (agentId === "cuga-default" ? configVersion : null)
          const ag = manage?.config?.agent
          if (ag?.name && String(ag.name).trim()) name = String(ag.name).trim()
          if (ag?.description != null && String(ag.description).trim()) description = String(ag.description).trim()
          const hs = manage?.config?.homescreen
          if (hs && typeof hs === "object") {
            setHomescreen({ isOn: hs.isOn ?? true, greeting: hs.greeting, starters: Array.isArray(hs.starters) ? hs.starters.slice(0, 4) : undefined })
          }
          const k = manage?.config?.knowledge
          if (k && typeof k === "object") {
            setKnowledgeEnabled(k.enabled ?? false)
            setAgentKnowledgeEnabled(k.agent_level_enabled ?? false)
            setSessionKnowledgeEnabled(k.session_level_enabled ?? false)
            setCitationsEnabled(k.citations_enabled ?? true)
          }
        }
        let apps: AppConfig[] = []
        if (toolsRes.ok) {
          const tools = (await toolsRes.json()).tools || []
          const byApp = new Map<string, AppConfig["tools"]>()
          for (const tool of tools) {
            const app = tool.app || i18n.t("chat:agent.unknownApp")
            if (!byApp.has(app)) byApp.set(app, [])
            byApp.get(app)!.push({ name: tool.name, description: tool.description || i18n.t("chat:agent.noDescription") })
          }
          apps = [...byApp].map(([appName, tools]) => ({ appName, tools }))
        } else {
          toast.warning(i18n.t("chat:toast.toolsLoadWarning"), {
            description: i18n.t("chat:toast.toolsLoadWarningBody", { status: toolsRes.status, statusText: toolsRes.statusText }),
          })
        }
        if (cancelled) return
        setAgentConfig({
          name,
          description,
          configVersion,
          kind: manage?.config?.agent?.kind ?? "single",
          supervisedAgents: manage?.config?.supervisor?.subAgents ?? [],
          apps,
        })
      } catch (e) {
        if (!cancelled) toast.error(i18n.t("chat:toast.configLoadError"), { description: e instanceof Error ? e.message : i18n.t("chat:toast.configLoadErrorBody") })
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId, routeAgentId])

  // Assistant profile: manage config name (else "CUGA"), logo unless hidden.
  const profile = {
    nickname: configLoading ? (agentId === "cuga-default" ? "CUGA" : agentId) : agentConfig.name === "CUGA Default Agent" ? "CUGA" : agentConfig.name,
  }

  // ── knowledge doc count ─────────────────────────────────────────────────
  const [knowledgeDocCount, setKnowledgeDocCount] = React.useState(0)
  React.useEffect(() => {
    if (!knowledgeEnabled || (!agentKnowledgeEnabled && !sessionKnowledgeEnabled)) {
      setKnowledgeDocCount(0)
      return
    }
    let cancelled = false
    Promise.all([
      agentKnowledgeEnabled ? api.listKnowledgeDocuments() : Promise.resolve(null),
      sessionKnowledgeEnabled ? api.listSessionKnowledgeDocuments(threadId) : Promise.resolve(null),
    ])
      .then(async ([a, s]) => {
        const ad = a && a.ok ? ((await a.json()).documents ?? []) : []
        const sd = s && s.ok ? ((await s.json()).documents ?? []) : []
        if (!cancelled) setKnowledgeDocCount(ad.length + sd.length)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [agentKnowledgeEnabled, knowledgeEnabled, sessionDocsVersion, sessionKnowledgeEnabled, threadId])

  // ── skills ──────────────────────────────────────────────────────────────
  const [skills, setSkills] = React.useState<SkillInfo[]>([])
  const [skillsLoading, setSkillsLoading] = React.useState(true)
  React.useEffect(() => {
    api
      .getSkills()
      .then(async (r) => (r.ok ? setSkills((await r.json()).skills || []) : undefined))
      .catch(() => undefined)
      .finally(() => setSkillsLoading(false))
  }, [])

  // ── workspace (polled every 2.5 s, like the Carbon UI) ──────────────────
  const [workspaceTree, setWorkspaceTree] = React.useState<FileNode[]>([])
  const [workspaceLoading, setWorkspaceLoading] = React.useState(true)
  const threadRef = React.useRef(threadId)
  React.useLayoutEffect(() => {
    threadRef.current = threadId
  }, [threadId])

  const fetchWorkspaceTree = React.useCallback(
    async (force = false) => {
      const tid = threadId
      const isCurrent = () => threadRef.current === tid
      try {
        if (force) setWorkspaceLoading(true)
        const res = await api.getWorkspaceTree(tid || undefined, force)
        if (res.ok) {
          const data = await res.json()
          if (isCurrent()) setWorkspaceTree(data.tree || [])
        } else if (force && isCurrent()) {
          toast.warning(i18n.t("chat:toast.workspaceRefreshFailed"), { description: `${res.status} ${res.statusText}` })
        }
      } catch (e) {
        if (force && isCurrent()) toast.error(i18n.t("chat:toast.workspaceRefreshFailed"), { description: e instanceof Error ? e.message : i18n.t("chat:error.unknown") })
      } finally {
        if (isCurrent()) setWorkspaceLoading(false)
      }
    },
    [threadId]
  )
  React.useEffect(() => {
    setWorkspaceTree([])
    setWorkspaceLoading(true)
  }, [threadId])
  React.useEffect(() => {
    void fetchWorkspaceTree()
    const timer = setInterval(() => void fetchWorkspaceTree(), 2500)
    return () => clearInterval(timer)
  }, [fetchWorkspaceTree])

  const uploadWorkspace = async (files: File[]) => {
    const tid = threadId?.trim()
    if (!tid) return void toast.warning(t("toast.uploadUnavailable"), { description: t("toast.uploadUnavailableBody") })
    try {
      await Promise.all(
        files.map(async (file) => {
          const res = await api.uploadWorkspaceFile(file, tid)
          if (!res.ok) {
            let detail = res.statusText
            try {
              detail = (await res.json()).detail || detail
            } catch {
              /* ignore */
            }
            throw new Error(`${file.name}: ${detail}`)
          }
        })
      )
      toast.success(t("toast.uploadComplete"), { description: t("toast.uploadCompleteBody", { count: files.length }) })
      await fetchWorkspaceTree()
    } catch (e) {
      toast.error(t("toast.uploadFailed"), { description: e instanceof Error ? e.message : i18n.t("chat:error.unknown") })
    }
  }

  const downloadWorkspace = async (path: string, name: string) => {
    try {
      const res = await api.getWorkspaceDownload(path, threadId || undefined)
      if (!res.ok) return void toast.error(t("toast.downloadFailed"), { description: res.statusText || `HTTP ${res.status}` })
      await api.saveResponseAsFile(res, name)
    } catch (e) {
      toast.error(t("toast.downloadFailed"), { description: e instanceof Error ? e.message : i18n.t("chat:error.unknown") })
    }
  }

  // ── previews ────────────────────────────────────────────────────────────
  const [preview, setPreview] = React.useState<FilePreview | null>(null)
  const closePreview = () => {
    if (preview?.pdfUrl) URL.revokeObjectURL(preview.pdfUrl)
    setPreview(null)
  }

  const openWorkspaceFile = async (node: FileNode) => {
    if (!TEXT_EXTENSIONS.some((ext) => node.name.toLowerCase().endsWith(ext))) {
      return void toast.info(t("toast.previewNotAvailable"), { description: t("toast.previewNotAvailableBody") })
    }
    try {
      const res = await api.getWorkspaceFile(node.path, threadId || undefined)
      if (!res.ok) return void toast.error(t("toast.fileLoadFailed"), { description: res.statusText })
      const data = await res.json()
      setPreview({ name: node.name, content: data.content, onDownload: () => void downloadWorkspace(node.path, node.name) })
    } catch (e) {
      toast.error(t("toast.fileLoadError"), { description: e instanceof Error ? e.message : i18n.t("chat:error.unknown") })
    }
  }

  const previewAttachment = async (a: AttachmentSnapshot) => {
    try {
      const res = await api.getKnowledgeDocumentFile(a.scope, a.knowledge_filename, a.scope === "session" ? threadId : undefined)
      if (!res.ok) return void toast.error(t("toast.previewUnavailable"), { description: res.statusText || t("toast.previewUnavailableBody") })
      const blob = await res.blob()
      const lower = a.display_name.toLowerCase()
      const url = URL.createObjectURL(blob)
      const download = () => {
        const link = document.createElement("a")
        link.href = url
        link.download = a.display_name
        link.click()
      }
      if (lower.endsWith(".pdf")) return setPreview({ name: a.display_name, pdfUrl: url, onDownload: download })
      if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        const content = await blob.text()
        URL.revokeObjectURL(url)
        return setPreview({ name: a.display_name, content, onDownload: () => void api.getKnowledgeDocumentFile(a.scope, a.knowledge_filename, a.scope === "session" ? threadId : undefined).then((r) => api.saveResponseAsFile(r, a.display_name)) })
      }
      download()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(t("toast.previewUnavailable"), { description: e instanceof Error ? e.message : i18n.t("chat:error.unknown") })
    }
  }

  // ── layout ──────────────────────────────────────────────────────────────
  const width = useWindowWidth()
  const [leftOpen, setLeftOpen] = React.useState(window.innerWidth >= BP_HIDE_LEFT)
  const [rightOpen, setRightOpen] = React.useState(window.innerWidth >= BP_HIDE_RIGHT)
  React.useEffect(() => {
    if (width < BP_HIDE_LEFT) setLeftOpen(false)
    if (width < BP_HIDE_RIGHT) setRightOpen(false)
    if (width >= BP_HIDE_LEFT && width >= BP_HIDE_RIGHT) {
      setLeftOpen(true)
      setRightOpen(true)
    }
  }, [width])
  const leftDocked = width >= BP_HIDE_LEFT
  const rightDocked = width >= BP_HIDE_RIGHT
  const [rightSection, setRightSection] = React.useState<RightPanelSection>("workspace")
  React.useEffect(() => {
    if (rightSection === "skills" && !skillsLoading && skills.length === 0) setRightSection("workspace")
  }, [rightSection, skills.length, skillsLoading])

  const toggleLeft = () => {
    setActiveView("chat")
    setLeftOpen((v) => !v)
    if (!rightDocked) setRightOpen(false)
  }
  const toggleRight = () => {
    if (!rightDocked) setLeftOpen(false)
    setRightOpen((v) => !v)
  }
  const openKnowledge = () => {
    setActiveView("chat")
    if (!rightDocked) setLeftOpen(false)
    setRightSection("knowledge")
    setRightOpen(true)
  }

  const [confirmRemoveAll, setConfirmRemoveAll] = React.useState(false)
  const removeAll = async () => {
    setConfirmRemoveAll(false)
    try {
      if (draft.threadId && !draft.hasSentFirstMessage) await clearDraftSessionFiles(draft.threadId)
      const toDelete = threads
      threadsGeneration.current += 1
      setThreads([])
      createAndActivateDraft()
      const results = await Promise.allSettled(toDelete.map((thread) => api.deleteConversation(thread.thread_id, agentId)))
      const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length
      await refreshThreads()
      if (failed) toast.error(t("toast.error"), { description: t("toast.removeSomeFailed", { failed, total: toDelete.length }) })
    } catch {
      toast.error(t("toast.error"), { description: t("toast.removeFailed") })
    }
  }

  const handleThreadChange = React.useCallback(
    (tid: string) => {
      setActiveThreadId(tid)
      if (tid === draft.threadId && !draft.hasSentFirstMessage) {
        sessionStorage.removeItem(storageKey)
        setDraft((d) => ({ ...d, hasSentFirstMessage: true }))
      }
      setSelectedThreadId(tid)
      void refreshThreads()
    },
    [draft.hasSentFirstMessage, draft.threadId, refreshThreads, storageKey]
  )

  // The saved state of the selected conversation cannot be loaded (/stream 409 "unavailable").
  const [unavailableThreadId, setUnavailableThreadId] = React.useState<string | null>(null)
  const handleStreamError = React.useCallback(
    (status: number, error?: string) => {
      if (status === 404) {
        // The conversation no longer exists: drop it from the list and start fresh.
        toast.warning(i18n.t("chat:toast.conversationUnavailable"), { description: i18n.t("chat:toast.conversationUnavailableBody") })
        if (selectedThreadId) setThreads((prev) => prev.filter((thread) => thread.thread_id !== selectedThreadId))
        createAndActivateDraft()
      } else if (status === 409) {
        if (error === "conflict") {
          toast.warning(i18n.t("chat:toast.responseRunning"), {
            description: i18n.t("chat:toast.responseRunningBody"),
          })
        } else if (error === "unavailable") {
          setUnavailableThreadId(threadId)
        } else {
          toast.warning(i18n.t("chat:toast.couldNotSend"), { description: i18n.t("chat:toast.couldNotSendBody") })
        }
      }
    },
    [createAndActivateDraft, selectedThreadId, threadId]
  )

  const startNew = async () => {
    if (draft.threadId && !draft.hasSentFirstMessage) await clearDraftSessionFiles(draft.threadId)
    setActiveView("chat")
    createAndActivateDraft()
    if (!leftDocked) setLeftOpen(false)
  }
  const selectThread = (tid: string) => {
    setSelectedThreadId(tid)
    if (!leftDocked) setLeftOpen(false)
  }

  const conversations = (
    <ConversationsPanel
      threads={threads}
      loading={threadsLoading}
      selectedThreadId={selectedThreadId}
      onSelect={selectThread}
      onRemoveAll={() => setConfirmRemoveAll(true)}
      onClose={() => setLeftOpen(false)}
    />
  )

  const showSwitcher = agentRegistry === true
  const rail = (
    <NavRail
      agentId={agentId}
      agentName={profile.nickname}
      agentContext={agentContext}
      agentOptions={agentOptions}
      showSwitcher={showSwitcher}
      onSwitchAgent={(next) => {
        if (next && next !== agentId) {
          navigate(`${next === "cuga-default" ? "/chat" : `/chat/${encodeURIComponent(next)}`}${activeView === "memory" ? "?view=memory" : ""}`)
        }
      }}
      onNew={() => void startNew()}
      conversationsOpen={leftOpen}
      onToggleConversations={toggleLeft}
    />
  )

  const agentPanel = (
    <AgentPanel
      agentConfig={agentConfig}
      configLoading={configLoading}
      availableAgents={availableAgents}
      section={rightSection}
      onSectionChange={setRightSection}
      onClose={() => setRightOpen(false)}
      workspaceTree={workspaceTree}
      workspaceLoading={workspaceLoading}
      onWorkspaceRefresh={() => void fetchWorkspaceTree(true)}
      onWorkspaceUpload={(f) => void uploadWorkspace(f)}
      onOpenFile={(n) => void openWorkspaceFile(n)}
      onDownloadFile={(n) => void downloadWorkspace(n.path, n.name)}
      threadId={threadId}
      sessionDocsVersion={sessionDocsVersion}
      onSessionDocsChanged={() => {
        setSessionDocsVersion((v) => v + 1)
        setRightSection("knowledge")
      }}
      knowledgeDocCount={knowledgeDocCount}
      onKnowledgeDocCountChanged={setKnowledgeDocCount}
      knowledgeEnabled={knowledgeEnabled}
      agentKnowledgeEnabled={agentKnowledgeEnabled}
      sessionKnowledgeEnabled={sessionKnowledgeEnabled}
      citationsEnabled={citationsEnabled}
      skills={skills}
      skillsLoading={skillsLoading}
    />
  )

  const selectedThread = threads.find((thread) => thread.thread_id === selectedThreadId)
  const chatTitle = selectedThread?.first_message?.trim() || t("common:nav.newConversation")
  const threadReadonly = Boolean(selectedThread && !["new", "active"].includes(selectedThread.status))
  const threadUnavailable = unavailableThreadId != null && unavailableThreadId === threadId
  const recent = threads.slice(0, 4).map((thread) => ({
    id: thread.thread_id,
    title: thread.first_message || t("common:conversations.untitled"),
    time: formatTimestamp(thread.updated_at),
  }))

  const headerButton = (label: string, icon: React.ReactNode, onClick: () => void, extra?: { expanded?: boolean; controls?: string }) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-expanded={extra?.expanded}
            aria-controls={extra?.controls}
            className="text-muted-foreground"
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  // Layout after OpenClaw's Control UI: icon rail · conversation list · chat · side panel.
  return (
    <div className="app-backdrop flex h-dvh">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:p-2">
        {t("page.skipToContent")}
      </a>
      {/* Navigation chrome (rail + list) is one glass surface over the backdrop. */}
      {leftDocked && <div className="glass-chrome flex shrink-0">{rail}</div>}
      {leftDocked && (
        <aside
          id="chat-conversations-panel"
          aria-label={t("common:conversations.title")}
          className={cn(
            "glass-chrome shrink-0 overflow-hidden border-r transition-[width] duration-200",
            leftOpen && activeView === "chat" ? "w-68" : "w-0 border-r-0"
          )}
        >
          <div className="h-full w-68">{conversations}</div>
        </aside>
      )}

      {activeView === "memory" && (
        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1">
          <MemoryWorkspace
            agentId={agentId}
            agentName={agentConfig.name}
            canManage={canManageMemory}
            focusEntityIds={focusedMemoryIds}
            focusRelationship={focusedMemoryRelationship}
            onClearFocus={() => setFocusedMemoryIds([])}
            onClose={() => setActiveView("chat")}
            onOpenConversation={(tid) => {
              selectThread(tid)
              setActiveView("chat")
            }}
          />
        </main>
      )}

      {/* Keep the chat (and any active stream) mounted while the memory view is shown. */}
      <div className={cn("flex min-h-0 min-w-0 flex-1", activeView === "memory" && "hidden")}>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
          {draftError && !threadId && <div role="alert" className="p-4">
            {draftError} <Button variant="outline" onClick={() => { setDraftError(""); setDraftRequest((n) => n + 1) }}>{t("page.retry")}</Button>
          </div>}
          {threadId && <ChatView
            key={`${agentId}`}
            agentId={agentId}
            threadId={threadId}
            title={chatTitle}
            isReadonly={threadReadonly || threadUnavailable}
            onStreamError={handleStreamError}
            banner={
              threadUnavailable ? (
                <div role="status" className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2 text-sm">
                  <TriangleAlertIcon className="size-4 shrink-0 text-status-warn" aria-hidden />
                  <span className="flex-1">
                    {t("page.banner.unavailable")}
                  </span>
                  <Button variant="outline" size="sm" onClick={createAndActivateDraft}>
                    {t("page.newChat")}
                  </Button>
                </div>
              ) : selectedThread?.status === "legacy" || selectedThread?.status === "external" ? (
                <div role="status" className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2 text-sm text-body">
                  <LockIcon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">
                    {selectedThread.status === "external"
                      ? t("page.banner.external")
                      : t("page.banner.legacy")}
                  </span>
                </div>
              ) : undefined
            }
            headerStart={
              !leftDocked
                ? headerButton(t("page.openNavigation"), <MenuIcon />, toggleLeft, { expanded: leftOpen })
                : !leftOpen
                  ? headerButton(t("common:nav.openConversations"), <PanelLeftOpenIcon />, toggleLeft, { expanded: false, controls: "chat-conversations-panel" })
                  : undefined
            }
            headerEnd={headerButton(
              rightOpen ? t("page.closeAgentPanel") : t("page.openAgentPanel"),
              rightOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />,
              toggleRight,
              { expanded: rightOpen, controls: "chat-agent-details-panel" }
            )}
            recent={recent}
            onSelectRecent={selectThread}
            homescreen={homescreen}
            profile={profile}
            knowledgeEnabled={knowledgeEnabled}
            sessionKnowledgeEnabled={sessionKnowledgeEnabled}
            sessionDocsVersion={sessionDocsVersion}
            onSessionDocsChanged={() => setSessionDocsVersion((v) => v + 1)}
            onThreadChange={handleThreadChange}
            onRestart={createAndActivateDraft}
            onOpenKnowledge={openKnowledge}
            onOpenMemoryUsage={memoryEnabled ? (entityIds, relationship) => {
              setFocusedMemoryRelationship(relationship)
              setFocusedMemoryIds(entityIds)
              setActiveView("memory")
            } : undefined}
            onPreviewAttachment={(a) => void previewAttachment(a)}
          />}
        </main>
        {rightDocked && (
          <aside
            id="chat-agent-details-panel"
            aria-label={t("page.agentDetails")}
            className={cn("glass-chrome shrink-0 overflow-hidden border-l transition-[width] duration-200", rightOpen ? "w-[26rem]" : "w-0 border-l-0")}
          >
            <div className="h-full w-[26rem]">{agentPanel}</div>
          </aside>
        )}
      </div>

      {/* Phones: rail and list share one drawer, as in OpenClaw's mobile navigation. */}
      {!leftDocked && (
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetContent side="left" showCloseButton={false} initialFocus={false} className="w-[21rem] max-w-[92vw] flex-row gap-0 p-0">
            <SheetTitle className="sr-only">{t("page.navigation")}</SheetTitle>
            <SheetDescription className="sr-only">{t("page.navigationDescription")}</SheetDescription>
            {rail}
            <div className="min-w-0 flex-1">{conversations}</div>
          </SheetContent>
        </Sheet>
      )}
      {!rightDocked && (
        <Sheet open={rightOpen} onOpenChange={setRightOpen}>
          <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[26rem]">
            <SheetTitle className="sr-only">{t("page.agentDetails")}</SheetTitle>
            <SheetDescription className="sr-only">{t("page.agentDetailsDescription")}</SheetDescription>
            {agentPanel}
          </SheetContent>
        </Sheet>
      )}

      <FilePreviewDialog preview={preview} onClose={closePreview} />
      <AlertDialog
        open={confirmRemoveAll}
        title={t("page.removeAll.title")}
        description={t("page.removeAll.description")}
        confirmLabel={t("common:conversations.removeAll")}
        onConfirm={() => void removeAll()}
        onCancel={() => setConfirmRemoveAll(false)}
      />
    </div>
  )
}
