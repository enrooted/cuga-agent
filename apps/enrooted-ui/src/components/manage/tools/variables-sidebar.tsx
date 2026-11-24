/*
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/VariablesSidebar.tsx
 * and VariablePopup.tsx (Copyright IBM Corp., Apache-2.0)
 *
 * The variables an agent turn produced: pick a turn, list its variables, open
 * one for the full value and download it (JSON for a dict, Markdown otherwise).
 *
 * The original is a fixed left-edge drawer; here it is a normal block that fills
 * its container (Manage shows it inside a dialog), with the same collapse toggle.
 */
import * as React from "react"
import { ChevronLeftIcon, DownloadIcon, Table2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Markdown } from "@/components/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import i18n from "@/i18n"
import type { VariableInfo, VariablesHistoryItem } from "@/lib/manage/tools-types"

import { IconButton } from "./shared"

export type { VariableInfo, VariablesHistoryItem }

export interface VariablesSidebarProps {
  /** Variable name → { type, description, value_preview, count_items }. */
  variables: Record<string, unknown>
  history?: VariablesHistoryItem[]
  selectedAnswerId?: string | null
  onSelectAnswer?: (answerId: string) => void
}

export interface SelectedVariable {
  name: string
  type: string
  description?: string
  value_preview: string
  count_items?: number
}

const NO_HISTORY: VariablesHistoryItem[] = []

function toVariable(name: string, raw: unknown): SelectedVariable {
  const v = (raw && typeof raw === "object" ? raw : {}) as VariableInfo
  return {
    name,
    type: v.type == null ? "" : String(v.type),
    description: v.description ? String(v.description) : undefined,
    value_preview: v.value_preview == null ? "" : String(v.value_preview),
    count_items: typeof v.count_items === "number" ? v.count_items : undefined,
  }
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function VariablesSidebar({
  variables,
  history = NO_HISTORY,
  selectedAnswerId,
  onSelectAnswer,
}: VariablesSidebarProps) {
  const { t } = useTranslation("tools")
  const [isExpanded, setIsExpanded] = React.useState(true)
  const [selectedVariable, setSelectedVariable] = React.useState<SelectedVariable | null>(null)
  const variableKeys = Object.keys(variables)

  if (variableKeys.length === 0 && history.length === 0) {
    return null
  }

  return (
    <>
      {isExpanded ? (
        <section className="flex min-h-0 flex-col gap-3" aria-label={t("variables.title")}>
          <header className="flex flex-wrap items-center gap-2">
            <IconButton label={t("variables.collapse")} onClick={() => setIsExpanded(false)}>
              <ChevronLeftIcon />
            </IconButton>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Table2Icon className="size-4" aria-hidden="true" />
              {t("variables.title")}
              <Badge variant="secondary">{variableKeys.length}</Badge>
            </h3>
            {history.length > 0 && (
              <NativeSelect
                id="variables-history-select"
                size="sm"
                className="w-full"
                aria-label={t("variables.selectTurn")}
                title={t("variables.selectTurn")}
                value={selectedAnswerId || ""}
                onChange={(e) => onSelectAnswer?.(e.target.value)}
              >
                {history.map((item) => {
                  const count = Object.keys(item.variables).length
                  return (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {t("variables.historyOption", { title: item.title, count, time: formatTimestamp(item.timestamp) })}
                    </NativeSelectOption>
                  )
                })}
              </NativeSelect>
            )}
          </header>

          {history.length > 0 && (
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {t("variables.viewing", {
                  title: history.find((h) => h.id === selectedAnswerId)?.title || t("variables.latestTurn"),
                })}
              </span>
              <span>{t("variables.turnsTotal", { count: history.length })}</span>
            </p>
          )}

          {variableKeys.length === 0 && history.length > 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              <p>{t("variables.emptyTurn")}</p>
              <p>{t("variables.emptyTurnHint")}</p>
            </div>
          ) : (
            <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              {variableKeys.map((varName) => {
                const variable = toVariable(varName, variables[varName])
                const preview = variable.value_preview
                return (
                  <li key={varName}>
                    <button
                      type="button"
                      onClick={() => setSelectedVariable(variable)}
                      className="flex w-full flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-left transition-colors outline-none hover:border-ring hover:bg-foreground/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <code className="truncate font-mono text-[0.8125rem] font-semibold text-foreground">
                          {varName}
                        </code>
                        {variable.type && <Badge variant="outline">{variable.type}</Badge>}
                      </span>
                      {variable.description && (
                        <span className="text-xs text-muted-foreground">{variable.description}</span>
                      )}
                      {variable.count_items !== undefined && variable.count_items > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {t("variables.items", { count: variable.count_items })}
                        </span>
                      )}
                      {preview && (
                        <span className="font-mono text-xs break-all text-muted-foreground">
                          {preview.substring(0, 80) + (preview.length > 80 ? "..." : "")}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : (
        // Toggle shown while the panel is collapsed
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("variables.showPanel", { count: variableKeys.length })}
            aria-expanded={false}
            onClick={() => setIsExpanded(true)}
          >
            <Table2Icon data-icon="inline-start" />
            {t("variables.title")}
            <Badge variant="secondary">{variableKeys.length}</Badge>
          </Button>
        </div>
      )}

      {selectedVariable && <VariablePopup variable={selectedVariable} onClose={() => setSelectedVariable(null)} />}
    </>
  )
}

export interface VariablePopupProps {
  variable: SelectedVariable
  onClose: () => void
}

export function VariablePopup({ variable, onClose }: VariablePopupProps) {
  const { t } = useTranslation("tools")
  const handleDownload = () => {
    // Check if variable is a dict type and try to download as JSON
    if (variable.type === "dict") {
      try {
        // Attempt to parse the value_preview as JSON
        const jsonData: unknown = JSON.parse(variable.value_preview)
        // Use octet-stream to force the browser to respect the .json extension
        downloadBlob(JSON.stringify(jsonData, null, 2), "application/octet-stream", `${variable.name}.json`)
        return
      } catch {
        // If JSON parsing fails, fall back to markdown
      }
    }

    // Default to markdown download
    const content = `# ${t("variables.popup.heading", { name: variable.name })}\n\n**${t("variables.popup.type")}:** ${variable.type}\n\n${variable.description ? `**${t("variables.popup.description")}:** ${variable.description}\n\n` : ""}**${t("variables.popup.value")}:**\n\`\`\`\n${variable.value_preview}\n\`\`\``
    downloadBlob(content, "text/markdown", `${variable.name}.md`)
  }

  const formattedContent = `## ${variable.name}\n\n**${t("variables.popup.type")}:** \`${variable.type}\`${variable.count_items ? ` (${t("variables.items", { count: variable.count_items })})` : ""}\n\n${variable.description ? `**${t("variables.popup.description")}:** ${variable.description}\n\n` : ""}**${t("variables.popup.value")}:**\n\`\`\`\n${variable.value_preview}\n\`\`\``

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogDescription className="font-mono text-xs">{variable.name}</DialogDescription>
          <DialogTitle>{t("variables.popup.title")}</DialogTitle>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <Markdown>{formattedContent}</Markdown>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common:action.close")}
          </Button>
          <Button type="button" onClick={handleDownload}>
            <DownloadIcon data-icon="inline-start" />
            {t("variables.popup.download", { format: variable.type === "dict" ? "JSON" : "MD" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
