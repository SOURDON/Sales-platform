import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/ui.css'
import App from './App.tsx'
import { installIosVisualViewportHeightVar } from './iosVisualViewportHeight'

installIosVisualViewportHeightVar()

const rootEl = document.getElementById('root')
const isTauriShell =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

async function startApp() {
  if (isTauriShell) {
    const backup = await import('./desktop/desktopLocalBackup')
    await backup.ensureDesktopLocalDataRestored()
    void backup.flushDesktopLocalBackup()
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
