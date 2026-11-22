import * as React from "react"
import { useNavigate } from "react-router-dom"
import { MenuIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { NavRail } from "@/components/nav-rail"
import type { ChatAgentOption } from "@/components/agent-panel"
import lockupOnDark from "@/assets/brand/enrooted-logotyp-mork-bakgrund.svg"
import lockupOnLight from "@/assets/brand/enrooted-logotyp-ljus-bakgrund.svg"
import * as api from "@/lib/api"

const BP_DOCK_RAIL = 768

function useWindowWidth() {
  const [w, setW] = React.useState(window.innerWidth)
  React.useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return w
}

/**
 * Frame of the Manage pages: the same icon rail as the chat, and a glass title
 * bar that floats over the page content. The rail's agent menu switches between
 * agents' configuration pages.
 */
export function ManageShell({
  agentId,
  agentName,
  agentContext,
  onNew,
  newLabel,
  titleStart,
  title,
  titleEnd,
  children,
}: {
  /** The agent being configured; omit on the dashboard. */
  agentId?: string
  agentName?: string
  agentContext?: { agent_id: string; config_version: number | string | null }
  onNew?: () => void
  newLabel?: string
  titleStart?: React.ReactNode
  title: React.ReactNode
  titleEnd?: React.ReactNode
  /** Page content. It starts under the 48 px title bar: pad it with pt-12. */
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const docked = useWindowWidth() >= BP_DOCK_RAIL
  const [navOpen, setNavOpen] = React.useState(false)
  const [agents, setAgents] = React.useState<ChatAgentOption[]>([])
  const [registry, setRegistry] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api
      .getUiConfig()
      .then(async (c) => {
        if (cancelled || !c.agent_registry) return
        setRegistry(true)
        const res = await api.getAgents()
        if (!res.ok || cancelled) return
        const data = await res.json()
        setAgents(Array.isArray(data.agents) ? data.agents : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const rail = (
    <NavRail
      section="manage"
      agentId={agentId ?? "cuga-default"}
      agentName={agentName || "Agents"}
      agentContext={agentContext}
      agentOptions={agents}
      showSwitcher={registry && agents.length > 0}
      onSwitchAgent={(next) => {
        setNavOpen(false)
        navigate(`/manage/${encodeURIComponent(next)}`)
      }}
      onNew={onNew}
      newLabel={newLabel}
    />
  )

  return (
    <div className="app-backdrop flex h-dvh">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:p-2">
        Skip to main content
      </a>
      {docked && <div className="glass-chrome flex shrink-0">{rail}</div>}
      <main id="main-content" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none">
        <div className="glass-chrome absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 border-b px-3">
          {!docked && (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" className="text-muted-foreground" onClick={() => setNavOpen(true)}>
              <MenuIcon />
            </Button>
          )}
          {titleStart}
          <div className="flex min-w-0 items-baseline gap-2">{title}</div>
          <div className="ml-auto flex shrink-0 items-center gap-1">{titleEnd}</div>
        </div>
        {children}
      </main>

      {!docked && (
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" showCloseButton={false} initialFocus={false} className="w-56 flex-row gap-0 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Agent, chat and agents</SheetDescription>
            {rail}
            <div className="p-3">
              <img src={lockupOnLight} alt="enrooted" className="h-[22px] w-auto min-w-[120px] dark:hidden" />
              <img src={lockupOnDark} alt="enrooted" className="hidden h-[22px] w-auto min-w-[120px] dark:block" />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
