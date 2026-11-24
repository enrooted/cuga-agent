import * as React from "react"
import { BotIcon } from "lucide-react"

import trilogin from "@/assets/brand/trilogin-trefargad.svg"
import triloginLight from "@/assets/brand/trilogin-trefargad-ljus.svg"
import { getUiConfig } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The agent's picture: the enrooted trilogin (original files, unmodified), the
 * light-background variant in light mode and the dark-background one in dark
 * mode. Replaces the CUGA owl everywhere in this UI. It is never rotated here;
 * the rotating one is the loading <Spinner>.
 *
 * When the server sets `hide_cuga_logo` (white-label installs) a plain agent
 * icon takes its place, as the Carbon UI drops its logo and assistant avatar.
 */
export function AgentMark({ className }: { className?: string }) {
  const [hidden, setHidden] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    void getUiConfig().then((c) => alive && setHidden(c.hide_cuga_logo))
    return () => {
      alive = false
    }
  }, [])
  return (
    <span data-slot="agent-mark" aria-hidden className={cn("inline-flex size-8 shrink-0", className)}>
      {hidden ? (
        <BotIcon className="size-full text-muted-foreground" />
      ) : (
        <>
          <img src={triloginLight} alt="" className="size-full dark:hidden" />
          <img src={trilogin} alt="" className="hidden size-full dark:block" />
        </>
      )}
    </span>
  )
}
