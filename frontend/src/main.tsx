import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/ui.css'
import App from './App.tsx'
import { bootstrapApiBaseUrl } from './apiBase'
import { installIosVisualViewportHeightVar } from './iosVisualViewportHeight'

installIosVisualViewportHeightVar()

const rootEl = document.getElementById('root')
const isTauriShell =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

async function startApp() {
  if (isTauriShell) {
    try {
      const backup = await import('./desktop/desktopLocalBackup')
      await backup.ensureDesktopLocalDataRestored()
      void backup.flushDesktopLocalBackup()
    } catch (error) {
      console.error('Desktop local backup init failed:', error)
    }
    const localOffline =
      import.meta.env.VITE_OFFLINE_STORE === '1' || import.meta.env.VITE_OFFLINE_DIRECTOR === '1'
    if (!localOffline) {
      try {
        const resolved = await bootstrapApiBaseUrl()
        console.info('[api] endpoint:', resolved)
      } catch (error) {
        console.error('API bootstrap failed:', error)
      }
    }
  }

  if (!rootEl) {
    return
  }

  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

void startApp()
