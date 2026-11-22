/*
 * Ported from cuga-agent frontend/src/knowledge/useSessionKnowledgeAttachments.ts
 * (Copyright IBM Corp., Apache-2.0). Logic unchanged; imports adapted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as api from "@/lib/api"
import type { AttachmentSnapshot } from "@/lib/chat-model"

export type KnowledgeAttachmentScope = "session" | "agent"

interface DocResponse {
  filename: string
  chunk_count?: number
  status?: string
  ingested_at?: string
}
interface DocMeta {
  displayName: string
  mimeType?: string
  sizeBytes?: number
}
export interface SessionKnowledgeDocument extends AttachmentSnapshot {
  chunk_count?: number
  status?: string
  ingested_at?: string
}
interface UploadTaskResponse {
  filename?: string
  status?: string
  file_tasks?: Record<string, { error?: string }>
  tasks?: UploadTaskResponse[]
}
interface PendingUpload {
  id: string
  file: File
  displayName: string
  mimeType?: string
  sizeBytes?: number
  status: "uploading" | "error"
  error?: string
}

export interface SessionAttachmentItem {
  id: string
  kind: "document" | "upload"
  status: "ready" | "uploading" | "error" | "deleting"
  knowledgeFilename?: string
  displayName: string
  mimeType?: string
  sizeBytes?: number
  chunkCount?: number
  ingestedAt?: string
  error?: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  py: "text/x-python",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
}

function guessMimeType(filename: string, fallback?: string) {
  if (fallback) return fallback
  const parts = filename.toLowerCase().split(".")
  return MIME_BY_EXTENSION[parts.length > 1 ? parts[parts.length - 1] : ""]
}

function toSnapshot(doc: DocResponse, meta: DocMeta | undefined, scope: KnowledgeAttachmentScope): SessionKnowledgeDocument {
  return {
    knowledge_filename: doc.filename,
    display_name: meta?.displayName ?? doc.filename,
    mime_type: guessMimeType(doc.filename, meta?.mimeType),
    size_bytes: meta?.sizeBytes,
    scope,
    chunk_count: doc.chunk_count,
    status: doc.status,
    ingested_at: doc.ingested_at,
  }
}

const createUploadId = (file: File) =>
  `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 10)}`

function getUploadError(task: UploadTaskResponse | undefined) {
  const info = task?.file_tasks ? Object.values(task.file_tasks)[0] : undefined
  return info?.error || "Ingestion failed"
}

export function useSessionKnowledgeAttachments({
  threadId,
  scope = "session",
  enabled = true,
  sessionDocsVersion = 0,
  onSessionDocsChanged,
  visibleDocumentMode = "all",
}: {
  threadId?: string | null
  scope?: KnowledgeAttachmentScope
  enabled?: boolean
  sessionDocsVersion?: number
  onSessionDocsChanged?: () => void
  visibleDocumentMode?: "all" | "tracked"
}) {
  const [documents, setDocuments] = useState<SessionKnowledgeDocument[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [loadError, setLoadError] = useState("")
  const requestRef = useRef(0)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [tracked, setTracked] = useState<Set<string>>(new Set())
  const metaRef = useRef<Map<string, DocMeta>>(new Map())
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const isAvailable = enabled && (scope === "agent" || Boolean(threadId))

  useEffect(() => {
    setDocuments([])
    setPendingUploads([])
    setDeleting(new Set())
    setTracked(new Set())
    metaRef.current = new Map()
  }, [enabled, scope, threadId])

  const refreshDocuments = useCallback(async () => {
    const request = ++requestRef.current
    const isCurrent = () => request === requestRef.current
    const tid = threadIdRef.current
    const currentScope = scopeRef.current
    if (!enabled || (currentScope === "session" && !tid)) {
      setIsLoading(false)
      setLoadError("")
      setDocuments([])
      return
    }
    setIsLoading(true)
    setLoadError("")
    try {
      const res =
        currentScope === "agent"
          ? await api.listKnowledgeDocuments()
          : await api.listSessionKnowledgeDocuments(tid!)
      if (!isCurrent()) return
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`)
      const data = await res.json()
      if (!isCurrent()) return
      const next = ((data.documents ?? []) as DocResponse[]).map((d) =>
        toSnapshot(d, metaRef.current.get(d.filename), currentScope)
      )
      setDocuments(next)
      setTracked((current) => {
        if (current.size === 0) return current
        const available = new Set(next.map((d) => d.knowledge_filename))
        const filtered = new Set([...current].filter((f) => available.has(f)))
        return filtered.size === current.size ? current : filtered
      })
    } catch (error) {
      if (isCurrent()) setLoadError(error instanceof Error ? error.message : "Failed to load documents")
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refreshDocuments()
    return () => {
      requestRef.current += 1
    }
  }, [refreshDocuments, sessionDocsVersion, threadId, scope])

  const uploadSingleFile = useCallback(async (upload: PendingUpload) => {
    const tid = threadIdRef.current
    const currentScope = scopeRef.current
    if (currentScope === "session" && !tid) throw new Error("Session attachments are unavailable.")
    setPendingUploads((cur) =>
      cur.map((i) => (i.id === upload.id ? { ...i, status: "uploading", error: undefined } : i))
    )
    const res =
      currentScope === "agent"
        ? await api.uploadKnowledgeDocuments([upload.file])
        : await api.uploadSessionKnowledgeDocuments(tid!, [upload.file])
    if (!res.ok) {
      const detail = await res.text().catch(() => "Upload failed")
      throw new Error(detail || "Upload failed")
    }
    const data = (await res.json().catch(() => ({}))) as UploadTaskResponse
    const task = data?.tasks?.[0] ?? data
    if (task?.status && task.status !== "completed") throw new Error(getUploadError(task))
    const canonical = typeof task?.filename === "string" && task.filename ? task.filename : upload.file.name
    const meta = { displayName: upload.displayName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes }
    metaRef.current.set(canonical, meta)
    setDocuments((cur) => [
      ...cur.filter((d) => d.knowledge_filename !== canonical),
      toSnapshot({ filename: canonical, status: "completed" }, meta, currentScope),
    ])
    setTracked((cur) => new Set(cur).add(canonical))
    setPendingUploads((cur) => cur.filter((i) => i.id !== upload.id))
    return canonical
  }, [])

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!isAvailable || files.length === 0) return
      const uploads: PendingUpload[] = files.map((file) => ({
        id: createUploadId(file),
        file,
        displayName: file.name,
        mimeType: guessMimeType(file.name, file.type),
        sizeBytes: file.size,
        status: "uploading",
      }))
      setPendingUploads((cur) => [...cur, ...uploads])
      const results = await Promise.allSettled(
        uploads.map(async (upload) => {
          try {
            await uploadSingleFile(upload)
            return true
          } catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed"
            setPendingUploads((cur) =>
              cur.map((i) => (i.id === upload.id ? { ...i, status: "error", error: message } : i))
            )
            return false
          }
        })
      )
      await refreshDocuments()
      if (results.some((r) => r.status === "fulfilled" && r.value)) onSessionDocsChanged?.()
    },
    [isAvailable, onSessionDocsChanged, refreshDocuments, uploadSingleFile]
  )

  const retryUpload = useCallback(
    async (uploadId: string) => {
      const upload = pendingUploads.find((i) => i.id === uploadId)
      if (!upload) return
      try {
        await uploadSingleFile(upload)
        await refreshDocuments()
        onSessionDocsChanged?.()
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed"
        setPendingUploads((cur) =>
          cur.map((i) => (i.id === uploadId ? { ...i, status: "error", error: message } : i))
        )
      }
    },
    [onSessionDocsChanged, pendingUploads, refreshDocuments, uploadSingleFile]
  )

  const dismissUpload = useCallback((uploadId: string) => {
    setPendingUploads((cur) => cur.filter((i) => i.id !== uploadId))
  }, [])

  const deleteDocument = useCallback(
    async (filename: string) => {
      const tid = threadIdRef.current
      const currentScope = scopeRef.current
      if (currentScope === "session" && !tid) return
      setDeleting((cur) => new Set(cur).add(filename))
      try {
        const res =
          currentScope === "agent"
            ? await api.deleteKnowledgeDocument(filename)
            : await api.deleteSessionKnowledgeDocument(tid!, filename)
        if (!res.ok) {
          const detail = await res.text().catch(() => "Delete failed")
          throw new Error(detail || "Delete failed")
        }
        metaRef.current.delete(filename)
        setTracked((cur) => {
          const next = new Set(cur)
          next.delete(filename)
          return next
        })
        setDocuments((cur) => cur.filter((d) => d.knowledge_filename !== filename))
        onSessionDocsChanged?.()
        await refreshDocuments()
      } finally {
        setDeleting((cur) => {
          const next = new Set(cur)
          next.delete(filename)
          return next
        })
      }
    },
    [onSessionDocsChanged, refreshDocuments]
  )

  const attachmentItems = useMemo<SessionAttachmentItem[]>(() => {
    const uploads = pendingUploads.map((u) => ({
      id: u.id,
      kind: "upload" as const,
      status: u.status,
      displayName: u.displayName,
      mimeType: u.mimeType,
      sizeBytes: u.sizeBytes,
      error: u.error,
    }))
    const visible =
      visibleDocumentMode === "tracked"
        ? documents.filter((d) => tracked.has(d.knowledge_filename))
        : documents
    const docs = visible.map((d) => ({
      id: d.knowledge_filename,
      kind: "document" as const,
      status: deleting.has(d.knowledge_filename) ? ("deleting" as const) : ("ready" as const),
      knowledgeFilename: d.knowledge_filename,
      displayName: d.display_name,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      chunkCount: d.chunk_count,
      ingestedAt: d.ingested_at,
    }))
    return [...uploads, ...docs]
  }, [deleting, documents, pendingUploads, tracked, visibleDocumentMode])

  const createMessageAttachmentSnapshot = useCallback(
    (): AttachmentSnapshot[] =>
      documents.map((d) => ({
        knowledge_filename: d.knowledge_filename,
        display_name: d.display_name,
        mime_type: d.mime_type,
        size_bytes: d.size_bytes,
        scope: d.scope,
      })),
    [documents]
  )

  return {
    documents,
    isLoading,
    isDeleting: deleting.size > 0,
    loadError,
    attachmentItems,
    isAvailable,
    isUploading: pendingUploads.some((i) => i.status === "uploading"),
    uploadFiles,
    retryUpload,
    dismissUpload,
    deleteDocument,
    refreshDocuments,
    createMessageAttachmentSnapshot,
  }
}
