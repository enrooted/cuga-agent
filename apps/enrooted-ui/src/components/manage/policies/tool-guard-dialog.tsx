/*
 * Viewer for the generated tool guards of a Tool Guide policy: one tab per
 * target tool with violating examples, compliance examples and the policy
 * code, plus the "Guard enforcement" switch.
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/PoliciesConfig.tsx
 * (Copyright IBM Corp., Apache-2.0).
 */

import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ToolGuidePolicy } from "@/lib/manage/policies-api"
import { cn } from "@/lib/utils"

function ExampleList({ title, examples, tone }: { title: string; examples: string[]; tone: "warn" | "ok" }) {
  const { t } = useTranslation("policies")
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">{title}</h3>
      {examples.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("guardDialog.none")}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {examples.map((example, i) => (
            <li
              key={`${i}-${example}`}
              className={cn(
                "rounded-r-md border-l-[3px] px-3 py-2 text-sm leading-normal text-foreground",
                tone === "warn" ? "border-status-warn bg-status-warn/10" : "border-status-ok bg-status-ok/10"
              )}
            >
              {example}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function ToolGuardDialog({
  policy,
  policiesEnabled,
  onGuardsEnabledChange,
  onClose,
}: {
  policy: ToolGuidePolicy
  /** The global policy switch; the enforcement switch is locked while it is off. */
  policiesEnabled: boolean
  onGuardsEnabledChange: (enabled: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation("policies")
  const tools = policy.target_tools ?? []
  const switchId = `guards-enabled-${policy.id}`
  const guardsEnabled = policy.guards_enabled !== false
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug">{t("guardDialog.title", { name: policy.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t("guardDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 border-b pb-4">
            <label htmlFor={switchId} className="text-sm font-medium">
              {t("guardDialog.enforcement")}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                {guardsEnabled ? t("config.enabled") : t("config.disabled")}
              </span>
              <Switch
                id={switchId}
                checked={guardsEnabled}
                onCheckedChange={(checked) => onGuardsEnabledChange(checked)}
                disabled={!policiesEnabled}
              />
            </div>
          </div>

          {tools.length > 0 && (
            <Tabs defaultValue={tools[0]}>
              <div className="overflow-x-auto">
                <TabsList aria-label={t("guardDialog.tabs")}>
                  {tools.map((tool) => (
                    <TabsTrigger key={tool} value={tool}>
                      {tool}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {tools.map((tool) => {
                const guard = policy.tool_guards?.[tool] ?? {}
                return (
                  <TabsContent key={tool} value={tool} className="flex flex-col gap-5 pt-3">
                    <ExampleList title={t("guardDialog.violating")} examples={guard.violating_examples ?? []} tone="warn" />
                    <ExampleList title={t("guardDialog.compliance")} examples={guard.compliance_examples ?? []} tone="ok" />
                    <section className="flex flex-col gap-2">
                      <h3 className="text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase">{t("guardDialog.policyCode")}</h3>
                      <pre
                        className="overflow-x-auto rounded-md border bg-muted p-4 font-mono text-[0.8rem] leading-relaxed whitespace-pre text-foreground"
                        tabIndex={0}
                      >
                        <code>{guard.policy_code ?? ""}</code>
                      </pre>
                    </section>
                  </TabsContent>
                )
              })}
            </Tabs>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:action.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
