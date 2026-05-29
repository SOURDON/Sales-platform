import { useEffect } from 'react';

/**
 * Периодически и при возврате на вкладку обновляет данные с сервера (веб без Tauri).
 */
export function useLiveSessionRefresh(enabled: boolean, refresh: () => void, intervalMs = 60_000) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const run = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(run, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [enabled, refresh, intervalMs]);
}
