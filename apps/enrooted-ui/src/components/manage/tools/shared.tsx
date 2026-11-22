/*
 * Small shared pieces for the tools / secrets / sandbox / variables parts of Manage.
 * Secret list shaping ported from
 * cuga-agent/src/frontend_workspaces/frontend/src/AddToolModal.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import * as api from "@/lib/manage/tools-api"

/** Icon-only ghost button with the label as both aria-label and tooltip. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Error / warning notice: normal-colour words with an orange icon and border. */
export function Notice({
  title,
  children,
  action,
  className,
}: {
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Alert variant="destructive" className={className ? `border-status-warn/60 ${className}` : "border-status-warn/60"}>
      <TriangleAlertIcon className="text-status-warn!" />
      <AlertTitle>{title}</AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  )
}

/** A saved secret as the add-tool dialog offers it. */
export interface SecretOption {
  id: string
  description?: string
  ref: string
}

/**
 * Load the saved secrets and shape each into the reference stored in a tool's
 * auth value: vault:// in vault mode, the bare id for env-sourced ones, db:// otherwise.
 * Returns null when the secrets request itself was not OK (the list is then left as it was).
 */
export async function loadSecretOptions(agentId?: string): Promise<SecretOption[] | null> {
  const [secretsRes, configRes] = await Promise.all([api.getSecrets(agentId), api.getSecretsConfig()])
  let mode = "local"
  if (configRes.ok) {
    const cfg = (await configRes.json()) as { mode?: string }
    mode = cfg.mode || "local"
  }
  if (!secretsRes.ok) return null
  const data = (await secretsRes.json()) as {
    secrets?: { id: string; description?: string; source?: string }[]
    overrides?: { id: string; description?: string; source?: string }[]
  }
  const raw = data.secrets || data.overrides || []
  return raw.map((s) => ({
    id: s.id,
    description: s.description,
    ref:
      s.source === "vault" || mode === "vault"
        ? `vault://secret/${s.id}#value`
        : s.source === "env"
          ? s.id
          : `db://${s.id}`,
  }))
}
