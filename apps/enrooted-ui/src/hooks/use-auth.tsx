/*
 * Auth state (Carbon UI: AuthContext.tsx + AuthGate in App.tsx).
 * With CUGA auth disabled (the podman default) everyone is a local guest who
 * may manage; with OIDC enabled, unauthenticated users are sent to /auth/login.
 */
import * as React from "react"
import * as api from "@/lib/api"

interface AuthState {
  ready: boolean
  /** Sign-in could not be completed and was not retried automatically. */
  signInFailed?: boolean
  /** Auth is on and the user chose Sign out: wait for them to sign in again. */
  signedOut?: boolean
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
    // A second failure in the same attempt stops here instead of looping.
    const redirectToLogin = () => {
      if (api.isLoginInProgress()) {
        api.clearLoginInProgress()
        if (!cancelled) setState((s) => ({ ...s, signInFailed: true }))
        return
      }
      api.login()
    }
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
        const target = code && st ? await api.handleOidcCallback(code, st) : null
        const user = await api.getUserInfo()
        if (!user) {
          if (api.isSignedOut()) {
            if (!cancelled) setState((s) => ({ ...s, ready: true, authEnabled: true, signedOut: true }))
            return
          }
          redirectToLogin()
          return
        }
        api.clearLoginInProgress()
        api.clearSignedOut()
        if (!cancelled) {
          if (target) {
            const path = new URL(target, window.location.origin).pathname
            const needsManage = /^\/(manage|studio)(\/|$)/.test(path)
            const destination = needsManage && config.authorization_enabled && !user.canManage ? "/chat" : target
            if (destination !== window.location.pathname + window.location.search + window.location.hash) {
              window.location.replace(destination)
              return
            }
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
        if (!cancelled) setState((s) => ({ ...s, signInFailed: true }))
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
