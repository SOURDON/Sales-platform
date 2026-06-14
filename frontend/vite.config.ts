import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const tauriHost = process.env.TAURI_DEV_HOST
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM ?? process.env.TAURI_CLI_VERBOSITY)

function injectServiceWorkerPrecache() {
  return {
    name: 'inject-sw-precache',
    closeBundle() {
      const script = resolve(__dirname, 'scripts/inject-sw-precache.mjs')
      const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
      if (result.status !== 0) {
        throw new Error('inject-sw-precache failed')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), injectServiceWorkerPrecache()],
  clearScreen: !isTauri,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    host: tauriHost || true,
    port: 5173,
    strictPort: isTauri,
    hmr: tauriHost
      ? { protocol: 'ws', host: tauriHost, port: 1421 }
      : undefined,
    watch: isTauri ? { ignored: ['**/desktop/**'] } : undefined,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: isTauri
    ? {
        // WKWebView / WebView2; es2021 avoids esbuild downlevel errors on large bundles (Vite 8).
        target:
          process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
        minify: process.env.TAURI_ENV_DEBUG ? false : true,
        sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      }
    : undefined,
})
