import * as React from "react"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"
import { LogInIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom"

import { FlowFireToasts } from "@/components/events/flow-fire-toasts"
import { getEventsStatus } from "@/lib/events/api"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { AgentMark } from "@/components/agent-mark"
import { Button } from "@/components/ui/button"
import * as api from "@/lib/api"
import { ChatPage } from "@/pages/chat-page"
import { ManageDashboard } from "@/pages/manage-dashboard"
import { ManagePage } from "@/pages/manage-page"
import { Skeleton } from "@/components/ui/skeleton"

// Studio is LAZY on purpose: it is the events control plane, reachable only at
// /studio and only when the events service answers, so its code is a separate
// chunk fetched on navigation.
const StudioPage = React.lazy(() => import("@/pages/studio-page").then((m) => ({ default: m.StudioPage })))

function RouteLoading() {
  const { t } = useTranslation()
  return (
    <div className="app-backdrop flex h-dvh flex-col" role="status" aria-live="polite" aria-label={t("app.loadingStudio")}>
      <Skeleton className="h-12 w-full rounded-none" />
      <div className="grid flex-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    </div>
  )
}

// Renders its children only when the events layer is mounted and enabled;
// otherwise redirects home. The nav entry already hides when events is off;
// this also blocks DIRECT navigation to /studio.
function EventsGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"checking" | "on" | "off">("checking")
  React.useEffect(() => {
    getEventsStatus()
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"))
  }, [])
  if (state === "checking") return <RouteLoading /> // don't flash Studio before the check resolves
  if (state === "off") return <Navigate to="/" replace />
  return <>{children}</>
}

function Gate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { ready, signInFailed, signedOut } = useAuth()
  React.useEffect(() => {
    const notify = () => toast(t("account.sessionExpired"), {
      id: "session-expired", duration: Infinity,
      action: { label: t("account.signIn"), onClick: api.login },
    })
    window.addEventListener(api.SESSION_EXPIRED_EVENT, notify)
    return () => window.removeEventListener(api.SESSION_EXPIRED_EVENT, notify)
  }, [t])
  if (signInFailed || signedOut) {
    return (
      <div className="app-backdrop flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <AgentMark className="size-12" />
        <h1 className="text-xl font-semibold">{t(signInFailed ? "account.signInFailedTitle" : "account.signedOutTitle")}</h1>
        <p className="text-sm text-body">{t(signInFailed ? "account.signInFailedBody" : "account.signedOutBody")}</p>
        <Button className="mt-2" onClick={api.login}>
          <LogInIcon data-icon="inline-start" />
          {t(signInFailed ? "action.retry" : "account.signIn")}
        </Button>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="flex h-dvh flex-col" aria-label={t("app.loading", { brand: "CUGA" })}>
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="flex flex-1 gap-4 p-4">
          <Skeleton className="hidden h-full w-72 md:block" />
          <Skeleton className="h-full flex-1" />
        </div>
      </div>
    )
  }
  return <>{children}</>
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="cuga-chat-theme" disableTransitionOnChange>
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <Gate>
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatPage key="cuga-default" />} />
              <Route path="/chat/:agentId" element={<ChatRoute />} />
              <Route path="/manage" element={<RequireManage><ManageDashboard /></RequireManage>} />
              <Route path="/manage/:agentId" element={<RequireManage><ManageRoute /></RequireManage>} />
              <Route
                path="/studio"
                element={
                  <RequireManage>
                    <EventsGate>
                      <React.Suspense fallback={<RouteLoading />}>
                        <StudioPage />
                      </React.Suspense>
                    </EventsGate>
                  </RequireManage>
                }
              />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          </Gate>
          <FlowFireToasts />
          {/* No richColors: green/orange are status colours, never text. The icon carries the status. */}
          <Toaster closeButton position="top-right" />
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  )
}

// Manage needs the ServiceOwner / ServiceAdmin role when authorization is on
// (the original's RequireRole); `canManage` comes from /auth/userinfo.
function RequireManage({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  if (!canManage) {
    return (
      <div className="app-backdrop flex h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">{t("app.notAuthorized")}</h1>
        <p className="text-sm text-body">{t("app.notAuthorizedBody")}</p>
        <a href="/chat" className="text-sm text-link underline">
          {t("app.backToChat")}
        </a>
      </div>
    )
  }
  return <>{children}</>
}

// One page instance per agent: all of the config state resets on switch.
function ManageRoute() {
  const { agentId } = useParams()
  return <ManagePage key={agentId ?? "cuga-default"} />
}

// Remount the page when switching agents (same route pattern, different param).
function ChatRoute() {
  const { agentId } = useParams()
  return <ChatPage key={agentId ?? "cuga-default"} />
}

export default App
