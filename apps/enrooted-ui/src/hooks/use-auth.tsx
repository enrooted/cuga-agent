/*
 * Auth state (Carbon UI: AuthContext.tsx + AuthGate in App.tsx).
 * With CUGA auth disabled (the podman default) everyone is a local guest who
 * may manage; with OIDC enabled, unauthenticated users are sent to /auth/login.
 */
import * as React from "react"
import * as api from "@/lib/api"

interface AuthState {
  ready: boolean
  authEnabled: boolean
  authorizationEnabled: boolean
  user: api.UserInfo | null
  canManage: boolean
}

const AuthContext = React.createContext<AuthState>({
  ready: false,
  authEnabled: false,
  authorizationEnabled: false,
  user: null,
  canManage: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    ready: false,
    authEnabled: false,
    authorizationEnabled: false,
    user: null,
    canManage: true,
  })

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const config = await api.getAuthConfig()
        if (cancelled) return
        if (!config.enabled) {
          if (!cancelled)
            setState({ ready: true, authEnabled: false, authorizationEnabled: config.authorization_enabled, user: null, canManage: true })
          return
        }
        const params = new URLSearchParams(window.location.search)
        const code = params.get("code")
        const st = params.get("state")
        if (code && st && !(await api.handleOidcCallback(code, st))) throw new Error("Sign-in failed")
        const user = await api.getUserInfo()
        if (!user) {
          window.location.href = "/auth/login"
          return
        }
        if (!cancelled) {
          if (code && st && config.authorization_enabled && !user.canManage) {
            window.location.replace("/chat")
            return
          }
          setState({
            ready: true,
            authEnabled: true,
            authorizationEnabled: config.authorization_enabled,
            user,
            canManage: !config.authorization_enabled || user.canManage === true,
          })
        }
      } catch {
        if (!cancelled) window.location.href = "/auth/login"
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return React.useContext(AuthContext)
}
