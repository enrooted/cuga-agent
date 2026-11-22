/*
 * Knowledge panel > Search Test tab: run a query against the agent's permanent
 * documents and inspect the scored passages.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/KnowledgeConfig.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { FileTextIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/manage/knowledge-api"
import type { KnowledgeSearchResult, KnowledgeToast } from "@/lib/manage/knowledge-types"
import { asNumber, asRecord } from "./knowledge-helpers"
import { MessageTile, NumberField, StatusBadge, TextField, Tile } from "./parts"

// Score bands of the original: > 0.7 good, > 0.4 middling, otherwise weak.
function scoreTone(score: number): "ok" | "neutral" | "warn" {
  if (score > 0.7) return "ok"
  if (score > 0.4) return "neutral"
  return "warn"
}

function queryWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

// Client-side highlight: split the text on the query terms.
function splitOnQuery(text: string, query: string): string[] {
  const words = queryWords(query)
  if (words.length === 0) return [text]
  const regex = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  )
  return text.split(regex)
}

function SearchResultCard({
  result,
  query,
  expanded,
  onToggle,
}: {
  result: KnowledgeSearchResult
  query: string
  expanded: boolean
  onToggle: () => void
}) {
  const passage = result.text || result.content || ""
  // Limit the preview to 3 lines (handles badly parsed text with many short lines).
  const lines = passage.split("\n")
  const previewLines = lines.slice(0, 3).join("\n")
  const preview =
    previewLines.length > 150
      ? previewLines.slice(0, 150) + "..."
      : lines.length > 3
        ? previewLines + "..."
        : previewLines
  const displayText = expanded ? passage : preview
  const words = queryWords(query)
  const tone = scoreTone(result.score)
  const expandable = lines.length > 3 || passage.length > 150

  return (
    <Tile accent={tone === "neutral" ? "neutral" : tone} className="p-0">
      <button
        type="button"
        aria-expanded={expandable ? expanded : undefined}
        onClick={onToggle}
        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{result.filename}</span>
            {result.page != null && <StatusBadge tone="neutral">p.{result.page}</StatusBadge>}
          </span>
          <StatusBadge tone={tone} title="Relevance score">
            {result.score.toFixed(2)}
          </StatusBadge>
        </span>
        <span className="text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {splitOnQuery(displayText, query).map((part, j) =>
            words.some((w) => part.toLowerCase() === w.toLowerCase()) ? (
              <mark key={j} className="rounded-sm bg-foreground/10 px-0.5 font-bold text-foreground">
                {part}
              </mark>
            ) : (
              <span key={j}>{part}</span>
            )
          )}
        </span>
        {expandable && (
          <span className="text-xs text-link underline">
            {expanded ? "Show less" : "Show full passage"}
          </span>
        )}
      </button>
    </Tile>
  )
}

export function SearchTab({
  agentLevelEnabled,
  onToast,
}: {
  agentLevelEnabled: boolean
  onToast?: KnowledgeToast
}) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchLimit, setSearchLimit] = React.useState(10)
  const [searchThreshold, setSearchThreshold] = React.useState(0)
  const [searchResults, setSearchResults] = React.useState<KnowledgeSearchResult[]>([])
  const [searchTime, setSearchTime] = React.useState<number | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [searchCompleted, setSearchCompleted] = React.useState(false)
  const [expandedResult, setExpandedResult] = React.useState<number | null>(null)

  const handleSearch = async () => {
    if (!agentLevelEnabled) {
      onToast?.(
        "warning",
        "Agent knowledge is disabled",
        "Enable agent-level knowledge in Settings to search permanent documents."
      )
      return
    }
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchCompleted(false)
    setSearchResults([])
    setSearchTime(null)
    setExpandedResult(null)
    try {
      const res = await api.searchKnowledge(searchQuery, searchLimit, searchThreshold)
      if (res.ok) {
        const data = asRecord((await res.json()) as unknown)
        const results = Array.isArray(data?.results) ? (data.results as KnowledgeSearchResult[]) : []
        setSearchResults(results.filter((r) => asRecord(r) !== null && typeof r.score === "number"))
        setSearchCompleted(true)
        setSearchTime(asNumber(data?.query_time_ms) ?? null)
      } else {
        onToast?.("error", "Search failed", "Could not search knowledge base")
      }
    } catch (e) {
      onToast?.("error", "Search failed", (e instanceof Error && e.message) || "Network error")
    } finally {
      setSearching(false)
    }
  }

  if (!agentLevelEnabled) {
    return (
      <MessageTile title="Agent-level knowledge search is disabled">
        Search testing in Manage only applies to permanent agent documents. Re-enable agent-level
        knowledge in Settings to test retrieval here.
      </MessageTile>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end gap-3">
        <TextField
          id="knowledge-search-query"
          label="Search query"
          hideLabel
          className="flex-1"
          placeholder="Search your knowledge base..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void handleSearch()
            }
          }}
        />
        <Button type="button" onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>
          {searching ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <SearchIcon data-icon="inline-start" />}
          {searching ? "Searching..." : "Search"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          id="knowledge-search-limit"
          label="Limit"
          value={searchLimit}
          min={1}
          max={100}
          onChange={setSearchLimit}
        />
        <NumberField
          id="knowledge-search-threshold"
          label="Score threshold"
          value={searchThreshold}
          min={0}
          max={1}
          step={0.1}
          onChange={setSearchThreshold}
        />
      </div>

      {searchResults.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Results ({searchResults.length})</h4>
            {searchTime !== null && <span className="text-xs text-muted-foreground">{searchTime}ms</span>}
          </div>
          {searchResults.map((r, i) => (
            <SearchResultCard
              key={i}
              result={r}
              query={searchQuery}
              expanded={expandedResult === i}
              onToggle={() => setExpandedResult(expandedResult === i ? null : i)}
            />
          ))}
        </div>
      )}

      {searchResults.length === 0 && !searching && searchCompleted && searchQuery && (
        <MessageTile>No results found. Try a different query.</MessageTile>
      )}
    </div>
  )
}
