/*
 * Knowledge citations — pure helpers.
 * Ported from cuga-agent agentic_chat/src/citations/{types,injectCitations,SourcesPanel}.ts
 * (Copyright IBM Corp., Apache-2.0).
 */

import i18n from "@/i18n"

export interface MessageSource {
  n: number
  cite_id: string
  filename: string
  page?: number | null
  section_path?: string
  scope: string // "agent" | "session"
  snippet: string
  score?: number
  query?: string
}

const PAGELESS_EXTENSIONS = [".txt", ".md", ".log", ".json", ".csv", ".xml", ".docx"]

/** Page label, honest about formats where "page" is really a chunk ordinal. */
export function pageLabel(source: Pick<MessageSource, "filename" | "page">): string {
  if (source.page === null || source.page === undefined) return ""
  const lower = source.filename.toLowerCase()
  if (PAGELESS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return ""
  return i18n.t("chat:sources.page", { page: source.page })
}

/** URL fragment that opens a PDF at the cited page; '' for everything else. */
export function pageFragment(source: Pick<MessageSource, "filename" | "page">): string {
  const { page } = source
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return ""
  return source.filename.toLowerCase().endsWith(".pdf") ? `#page=${page}` : ""
}

export function scopeLabel(scope: string): string {
  return scope === "session" ? i18n.t("chat:sources.scopeSession") : i18n.t("chat:sources.scopeAgent")
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// Same code-span splitter and marker regex as the Carbon UI / backend resolver.
const CODE_SPLIT =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|```[\s\S]*$|~~~[\s\S]*$|``[^`\n](?:[^`\n]|`[^`\n])*``|`[^`\n]*`)/g
const MARKER = /\[(\d{1,3})\](?![:(])/g

/**
 * Replace resolved [n] markers with <cuga-cite n=".." msg=".."> elements.
 * The markdown renderer maps that tag to the CitationChip React component.
 */
export function injectCitations(text: string, sources: MessageSource[], messageKey?: string) {
  if (!text || !sources?.length) return text
  const byN = new Map(sources.map((s) => [s.n, s]))
  return text
    .split(CODE_SPLIT)
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(MARKER, (whole, num) => {
        const source = byN.get(Number(num))
        if (!source) return whole
        return (
          `<cuga-cite n="${source.n}"` +
          (messageKey ? ` msg="${escapeAttr(messageKey)}"` : "") +
          `></cuga-cite>`
        )
      })
    })
    .join("")
}

/** Split a snippet into plain/mark segments for the retrieving query's terms. */
export function highlightSegments(snippet: string, query?: string) {
  const terms = (query || "")
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter((t) => t.length >= 3)
  if (!terms.length || !snippet) return [{ text: snippet, mark: false }]
  const re = new RegExp(`(${terms.join("|")})`, "giu")
  return snippet.split(re).map((part, i) => ({ text: part, mark: i % 2 === 1 && part.length > 0 }))
}
