import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Own prefix: nginx serves /_ui/ from this build and proxies everything else to CUGA.
  build: { assetsDir: "_ui" },
  server: {
    // `npm run dev`: proxy the API to a CUGA reachable at CUGA_URL (default the pod's port).
    proxy: Object.fromEntries(
      ["/stream", "/stop", "/api", "/auth", "/health"].map((p) => [
        p,
        { target: process.env.CUGA_URL ?? "http://localhost:7860", changeOrigin: false },
      ])
    ),
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
