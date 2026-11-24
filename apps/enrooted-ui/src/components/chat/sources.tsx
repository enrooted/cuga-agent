import * as React from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { highlightSegments, pageLabel, scopeLabel, type MessageSource } from "@/lib/citations"
import { cn } from "@/lib/utils"

const MAX_VISIBLE = 8

/** Row of source cards under an answer (Carbon UI: MessageSources). */
export function MessageSources({ sources, onOpen }: { sources: MessageSource[]; onOpen: (n: number) => void }) {
  const { t } = useTranslation("chat")
  if (!sources?.length) return null
  const visible = sources.slice(0, MAX_VISIBLE)
  const hidden = sources.length - visible.length
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label={t("sources.answerSources")}>
      <span className="text-xs font-medium text-muted-foreground">{t("sources.title")}</span>
      {visible.map((s) => (
        <Button
          key={s.n}
          role="listitem"
          variant="outline"
          size="xs"
          onClick={() => onOpen(s.n)}
          title={`${s.filename} — ${scopeLabel(s.scope)}`}
          className="max-w-56"
        >
          <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[0.65rem]">
            {s.n}
          </Badge>
          <span className="truncate" dir="auto">
            {s.filename}
          </span>
          {pageLabel(s) && <span className="text-muted-foreground">{pageLabel(s)}</span>}
        </Button>
      ))}
      {hidden > 0 && (
        <Button variant="outline" size="xs" onClick={() => onOpen(visible.length + 1)}>
          {t("sources.more", { count: hidden })}
        </Button>
      )}
    </div>
  )
}

/** Right-hand sheet listing a message's sources (Carbon UI: SourcesPanel). */
export function SourcesSheet({
  sources,
  activeN,
  open,
  onOpenChange,
  onOpenDocument,
}: {
  sources: MessageSource[]
  activeN: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenDocument: (source: MessageSource) => Promise<boolean>
}) {
  const { t } = useTranslation("chat")
  const activeRef = React.useRef<HTMLDivElement | null>(null)
  const [unavailable, setUnavailable] = React.useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({})

  React.useEffect(() => {
    if (open) setTimeout(() => activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50)
  }, [activeN, open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("sources.title")}</SheetTitle>
          <SheetDescription>{t("sources.cited", { count: sources.length })}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {sources.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{t("sources.empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {sources.map((s) => (
            <div
              key={s.cite_id ?? s.n}
              ref={s.n === activeN ? activeRef : undefined}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3 transition-colors",
                s.n === activeN && "border-primary bg-muted/50"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {s.n}
                </Badge>
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium" dir="auto">
                  {s.filename}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {scopeLabel(s.scope)}
                {pageLabel(s) ? ` · ${pageLabel(s)}` : ""}
              </span>
              {s.section_path && <span className="text-xs text-muted-foreground">{s.section_path}</span>}
              <blockquote
                className={cn(
                  "cursor-pointer border-l-2 pl-3 text-xs leading-relaxed text-muted-foreground",
                  !expanded[s.n] && "line-clamp-6"
                )}
                onClick={() => setExpanded((e) => ({ ...e, [s.n]: !e[s.n] }))}
              >
                {highlightSegments(s.snippet, s.query).map((seg, i) =>
                  seg.mark ? (
                    <mark key={i} className="rounded-sm bg-primary/15 text-foreground">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </blockquote>
              {s.snippet.length > 350 && (
                <Button
                  variant="link"
                  size="xs"
                  className="w-fit px-0"
                  aria-expanded={!!expanded[s.n]}
                  onClick={() => setExpanded((e) => ({ ...e, [s.n]: !e[s.n] }))}
                >
                  {expanded[s.n] ? t("sources.showLess") : t("sources.showMore")}
                </Button>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {s.query && <span>{t("sources.foundFor", { query: s.query })}</span>}
                {typeof s.score === "number" && (
                  <span
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                    title={t("sources.relevance")}
                  >
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${Math.round(Math.min(1, Math.max(0, s.score)) * 100)}%` }}
                    />
                  </span>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  className="ml-auto"
                  disabled={!!unavailable[s.n]}
                  title={unavailable[s.n] ? t("sources.documentGone") : undefined}
                  onClick={async () => {
                    const ok = await onOpenDocument(s).catch(() => false)
                    if (!ok) setUnavailable((u) => ({ ...u, [s.n]: true }))
                  }}
                >
                  {t("sources.openDocument")}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
