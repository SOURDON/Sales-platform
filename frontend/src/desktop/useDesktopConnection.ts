import { useEffect, useState } from 'react';

export type DesktopConnectionState = {
  online: boolean;
  syncing: boolean;
};

export function useDesktopConnection(
  syncing = false,
  /** Healthcheck API (Tauri); если не задан — только navigator.onLine. */
  apiReachable?: boolean,
): DesktopConnectionState {
  const [navigatorOnline, setNavigatorOnline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setNavigatorOnline(true);
    const onOffline = () => setNavigatorOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const online =
    apiReachable !== undefined ? apiReachable && navigatorOnline : navigatorOnline;

  return { online, syncing };
}
