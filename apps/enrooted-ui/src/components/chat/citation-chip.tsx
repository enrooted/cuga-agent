import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { pageLabel, scopeLabel, type MessageSource } from "@/lib/citations"

/** Inline [n] citation: hover shows the source card, click opens the Sources panel. */
export function CitationChip({
  n,
  source,
  onOpen,
}: {
  n: number
  source?: MessageSource
  onOpen: () => void
}) {
  const { t } = useTranslation("chat")
  const chip = (
    <Badge
      variant="secondary"
      className="mx-0.5 h-4.5 min-w-4.5 cursor-pointer rounded-full px-1.5 align-text-top text-[0.7rem] tabular-nums"
      render={<button type="button" onClick={onOpen} aria-label={t("sources.source", { n })} />}
    >
      {n}
    </Badge>
  )
  if (!source) return chip
  const preview = (source.snippet || "").replace(/\s+/g, " ").slice(0, 140)
  const page = pageLabel(source)
  return (
    <HoverCard>
      <HoverCardTrigger render={<span />}>{chip}</HoverCardTrigger>
      <HoverCardContent className="w-72 cursor-pointer" onClick={onOpen}>
        <div className="flex flex-col gap-1">
          <span className="truncate font-medium" dir="auto">
            {source.filename}
          </span>
          <span className="text-xs text-muted-foreground">
            {scopeLabel(source.scope)}
            {page ? ` · ${page}` : ""}
            {source.section_path ? ` · ${source.section_path}` : ""}
          </span>
          {preview && <span className="text-xs text-muted-foreground italic">{t("sources.preview", { text: preview })}</span>}
          <span className="text-xs text-primary">{t("sources.clickToView")}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
