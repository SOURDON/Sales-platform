import { useEffect, useRef } from 'react';

/**
 * Периодически и при возврате на вкладку обновляет данные с сервера (веб без Tauri).
 */
export function useLiveSessionRefresh(
  enabled: boolean,
  refresh: () => void,
  intervalMs = 300_000,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const run = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      refreshRef.current();
    };
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
  }, [enabled, intervalMs]);
}
