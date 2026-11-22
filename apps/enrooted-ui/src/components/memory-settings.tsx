import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"

type Preferences = { instance_enabled: boolean; user_enabled: boolean }

export function MemorySettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const res = await apiFetch("/api/memory/settings", { signal: controller.signal })
        if (!res.ok) throw new Error("Could not load your memory settings.")
        setPreferences(await res.json())
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message)
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  async function toggle() {
    if (!preferences) return
    setSaving(true)
    setError("")
    try {
      const res = await apiFetch("/api/memory/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !preferences.user_enabled }),
      })
      if (!res.ok) throw new Error("Could not save your memory settings.")
      setPreferences(await res.json())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid max-w-md gap-4">
      <h1 className="text-xl font-semibold">Conversation memory</h1>
      {error && <p role="alert">{error}</p>}
      {!preferences && !error && <p role="status">Loading memory settings…</p>}
      {preferences && (preferences.instance_enabled ? <>
        <p>Memory is {preferences.user_enabled ? "on" : "off"} for your conversations.</p>
        <Button onClick={toggle} disabled={saving}>Turn memory {preferences.user_enabled ? "off" : "on"}</Button>
      </> : <p>Memory is disabled for this service.</p>)}
    </section>
  )
}
