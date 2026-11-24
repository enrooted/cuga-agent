/*
 * Surface asynchronous flow fires on the chat pages.
 *
 * A standing flow armed from the web chat fires later (cron / poll / push) with
 * sink "web", which has no channel to deliver to, so its answer would otherwise
 * appear only in Studio → Runs. This polls the runs feed and toasts NEW
 * web-sink fires with their output. Channel-armed flows already delivered to
 * their channel, so they are skipped.
 *
 * Ported from cuga-agent/src/frontend_workspaces/frontend/src/ChatLanding.tsx
 * ("Surface async flow fires in the web UI") (Copyright IBM Corp., Apache-2.0).
 * The original runs inside ChatLanding; here it is a renderless component
 * mounted once in App that is active on /chat routes only.
 */
import * as React from "react"
import { useLocation } from "react-router-dom"
import { toast } from "sonner"

import { useAuth } from "@/hooks/use-auth"
import i18n from "@/i18n"
import * as api from "@/lib/events/api"

type Run = {
  id: string
  kind?: string
  status?: string
  channel?: string
  agent?: string
  flow_name?: string
  started_at?: string
  finished_at?: string
}

/** On first load, still surface a fire from the last 2 minutes. */
const RECENT_MS = 120000

const isWebFire = (r: Run): boolean =>
  r?.kind === "flow" && String(r?.status || "").toUpperCase() === "SUCCEEDED" && (!r?.channel || /(^|,|\s)web(\s|,|$)/i.test(String(r.channel)))

export function FlowFireToasts() {
  const { ready } = useAuth()
  const { pathname } = useLocation()
  const active = ready && pathname.startsWith("/chat")

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    const seen = new Set<string>()
    let primed = false

    const toastRun = async (r: Run) => {
      let snippet = ""
      try {
        const d = await api.getEventsRunDetail(r.id)
        if (d.ok) snippet = String((await d.json())?.answer || "").slice(0, 140)
      } catch {
        /* detail is best-effort */
      }
      if (cancelled) return
      const flow = i18n.t("studio:toast.flow")
      toast.info(i18n.t("studio:toast.fired", { name: r.flow_name || r.agent || flow }), {
        description: snippet
          ? i18n.t("studio:toast.withOutput", { snippet: `${snippet}${snippet.length >= 140 ? "…" : ""}` })
          : i18n.t("studio:toast.ran", { agent: r.agent || flow }),
        duration: 5000,
      })
    }

    const poll = async () => {
      try {
        const res = await api.getEventsRuns()
        if (!res.ok) return
        const runs: Run[] = (await res.json())?.runs ?? []
        const fires = runs.filter(isWebFire)
        if (!primed) {
          // First pass: mark history seen, but still toast a very recent fire
          // (so opening the chat right after one shows it).
          primed = true
          const now = Date.now()
          for (const r of fires) {
            seen.add(r.id)
            const t = Date.parse(r.finished_at || r.started_at || "")
            if (!Number.isNaN(t) && now - t < RECENT_MS) await toastRun(r)
          }
          return
        }
        for (const r of fires) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          await toastRun(r)
        }
      } catch {
        /* never let polling break the chat */
      }
    }

    // Only poll when the events layer is mounted; vanilla CUGA → getEventsStatus() is null.
    api
      .getEventsStatus()
      .then((s) => {
        if (cancelled || !s) return
        void poll()
        timer = setInterval(() => void poll(), 25000)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [active])

  return null
}
