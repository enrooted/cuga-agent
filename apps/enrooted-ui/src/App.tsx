import { ThemeProvider } from "next-themes"
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { ChatPage } from "@/pages/chat-page"
import { ManageDashboard } from "@/pages/manage-dashboard"
import { ManagePage } from "@/pages/manage-page"
import { Skeleton } from "@/components/ui/skeleton"

function Gate({ children }: { children: React.ReactNode }) {
  const { ready } = useAuth()
  if (!ready) {
    return (
      <div className="flex h-dvh flex-col" aria-label="Loading CUGA…">
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
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          </Gate>
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
  const { canManage } = useAuth()
  if (!canManage) {
    return (
      <div className="app-backdrop flex h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="text-sm text-body">Your account can't manage agents.</p>
        <a href="/chat" className="text-sm text-link underline">
          Back to chat
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
