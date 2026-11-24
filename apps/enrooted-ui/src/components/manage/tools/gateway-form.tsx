/*
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/AddToolModal.tsx
 * (Copyright IBM Corp., Apache-2.0)
 *
 * The tool picker of the MCP gateway form: the instance's tools grouped by
 * gateway MCP server, each group with a select-all checkbox (indeterminate
 * when only some of its tools are selected).
 */
import * as React from "react"
import { useTranslation } from "react-i18next"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { GatewayServer } from "@/lib/manage/tools-types"

// The shared Checkbox draws a check for every non-empty state; a partly selected group shows a dash.
const INDETERMINATE_CLASS =
  "data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground data-indeterminate:before:h-0.5 data-indeterminate:before:w-2 data-indeterminate:before:rounded-full data-indeterminate:before:bg-current data-indeterminate:before:content-[''] data-indeterminate:[&_svg]:hidden"

export interface GatewayToolPickerProps {
  servers: GatewayServer[]
  selected: Set<string>
  disabled?: boolean
  onToggle: (names: string[], checked: boolean) => void
}

export function GatewayToolPicker({ servers, selected, disabled, onToggle }: GatewayToolPickerProps) {
  const { t: tr } = useTranslation("tools")
  const baseId = React.useId()
  return (
    <div role="group" aria-label={tr("gatewayPicker.label")} className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium text-foreground" role="status" aria-live="polite">
        {tr("gatewayPicker.heading", { count: selected.size })}
      </p>
      {servers.length === 0 && <p className="text-sm text-muted-foreground">{tr("gatewayPicker.empty")}</p>}
      {servers.map((sv, si) => {
        const names = sv.tools.map((t) => t.name)
        const all = names.every((n) => selected.has(n))
        const some = names.some((n) => selected.has(n))
        const serverId = `${baseId}-server-${si}`
        return (
          <div key={sv.name} role="group" aria-label={sv.name} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={serverId}
                className={INDETERMINATE_CLASS}
                disabled={disabled}
                checked={all && names.length > 0}
                indeterminate={!all && some}
                onCheckedChange={(checked) => onToggle(names, !!checked)}
              />
              <Label htmlFor={serverId} className="font-semibold">
                {sv.name} ({names.length})
              </Label>
            </div>
            <ul className="flex flex-col gap-2 pl-6">
              {sv.tools.map((t, ti) => {
                const toolId = `${serverId}-tool-${ti}`
                return (
                  <li key={t.name} className="flex items-start gap-2">
                    <Checkbox
                      id={toolId}
                      className="mt-0.5"
                      disabled={disabled}
                      checked={selected.has(t.name)}
                      onCheckedChange={(checked) => onToggle([t.name], !!checked)}
                    />
                    <Label htmlFor={toolId} className="flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-snug font-normal">
                      <span className="font-mono text-[0.8125rem] text-foreground">{t.name}</span>
                      {t.description && <span className="text-xs text-muted-foreground">{t.description}</span>}
                    </Label>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
