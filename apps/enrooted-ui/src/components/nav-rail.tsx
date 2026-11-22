import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { BotIcon, BrainIcon, LayoutGridIcon, LogOutIcon, MessagesSquareIcon, PlusIcon, UserIcon, WorkflowIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AgentMark } from "@/components/agent-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ChatAgentOption } from "@/components/agent-panel"
import { useAuth } from "@/hooks/use-auth"
import * as api from "@/lib/api"
import { cn } from "@/lib/utils"

function initials(name?: string, email?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/)
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase()
  }
  return email ? email[0].toUpperCase() : null
}

/** One 36 px control in the rail, with its name in a tooltip on the right. */
function RailItem({
  label,
  selected,
  children,
  render,
  ...props
}: {
  label: string
  selected?: boolean
  children: React.ReactNode
  render?: React.ReactElement
} & Omit<React.ComponentProps<typeof Button>, "render" | "children">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={label}
            className={cn("text-muted-foreground [&_svg:not([class*='size-'])]:size-[19px]", "aria-expanded:bg-transparent aria-expanded:text-muted-foreground",
              selected && "bg-foreground/8 text-foreground hover:bg-foreground/12 aria-expanded:bg-foreground/8 aria-expanded:text-foreground"
            )}
            render={render}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Icon rail on the far left (layout after OpenClaw's Control UI): the active
 * agent on top (opens the agent menu), the accented "+" for a new
 * conversation, the views, and theme + account at the bottom. Replaces the
 * Carbon UI's top bar (CugaHeader). /manage is CUGA's own Agents app, proxied
 * by nginx, so it is a plain link.
 */
export function NavRail({
  agentId,
  agentName,
  agentContext,
  agentOptions,
  showSwitcher,
  onSwitchAgent,
  onNew,
  newLabel = "New conversation",
  section = "chat",
  conversationsOpen = false,
  onToggleConversations,
  className,
}: {
  agentId: string
  agentName: string
  agentContext?: { agent_id: string; config_version: number | string | null }
  agentOptions: ChatAgentOption[]
  showSwitcher: boolean
  onSwitchAgent: (agentId: string) => void
  /** The accented + under the agent picture. Omit to hide it. */
  onNew?: () => void
  newLabel?: string
  /** Which part of the app the rail sits in: decides what is selected and what the chat item does. */
  section?: "chat" | "manage"
  conversationsOpen?: boolean
  onToggleConversations?: () => void
  className?: string
}) {
  const { user, authEnabled, canManage } = useAuth()
  const { pathname, search } = useLocation()
  const [ui, setUi] = React.useState<api.UiConfig | null>(null)
  React.useEffect(() => {
    api.getUiConfig().then(setUi)
  }, [])

  const chatPath = agentId !== "cuga-default" ? `/chat/${encodeURIComponent(agentId)}` : "/chat"
  const inMemory = pathname.startsWith("/chat") && new URLSearchParams(search).get("view") === "memory"
  const ini = initials(user?.name, user?.email ?? user?.sub)

  return (
    <nav aria-label="CUGA" className={cn("flex w-13 shrink-0 flex-col items-center gap-2 border-r px-1 py-2", className)}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={`Agent: ${agentName}`} />} />}
          >
            <AgentMark className="size-7" />
          </TooltipTrigger>
          <TooltipContent side="right">{agentName}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">{agentName}</span>
              <span className="font-mono text-xs font-normal">
                {agentContext?.agent_id ?? agentId}
                {agentContext?.config_version != null ? ` · v${agentContext.config_version}` : ""}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {showSwitcher && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Switch agent</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agentId} onValueChange={(v) => onSwitchAgent(String(v))}>
                  {agentOptions.map((a) => (
                    <DropdownMenuRadioItem key={a.id} value={a.id}>
                      {a.kind === "supervisor" ? <WorkflowIcon /> : <BotIcon />}
                      <span className="truncate">{a.name?.trim() || a.id}</span>
                      {a.kind === "supervisor" && <Badge variant="secondary">Supervisor</Badge>}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onNew && (
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-lg" aria-label={newLabel} onClick={onNew} />}>
            <PlusIcon className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="right">{newLabel}</TooltipContent>
        </Tooltip>
      )}

      <Separator className="my-1 w-7!" />

      {section === "chat" ? (
        <RailItem
          label={conversationsOpen ? "Close conversations" : "Open conversations"}
          selected={conversationsOpen && !inMemory}
          aria-expanded={conversationsOpen}
          aria-controls="chat-conversations-panel"
          onClick={onToggleConversations}
        >
          <MessagesSquareIcon />
        </RailItem>
      ) : (
        <RailItem label="Chat" render={<Link to={chatPath} />}>
          <MessagesSquareIcon />
        </RailItem>
      )}
      {canManage && (
        <RailItem label="Agents" selected={section === "manage"} render={<Link to="/manage" />}>
          <LayoutGridIcon />
        </RailItem>
      )}
      {ui?.evolve_memory_enabled && (
        <RailItem label="Memory" selected={inMemory} render={<Link to={`${chatPath}?view=memory`} />}>
          <BrainIcon />
        </RailItem>
      )}

      <div className="mt-auto flex flex-col items-center gap-2">
        <ThemeToggle side="right" />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="User profile" />}>
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{ini ?? <UserIcon className="size-4" />}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                {authEnabled ? (
                  <>
                    {user?.name && <span className="text-sm text-foreground">{user.name}</span>}
                    {(user?.email ?? user?.sub) && <span className="text-xs font-normal">{user?.email ?? user?.sub}</span>}
                  </>
                ) : (
                  <span className="text-sm text-foreground">Guest</span>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {authEnabled && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void api.logout()}>
                    <LogOutIcon />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
