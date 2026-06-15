import { useEffect, useState } from 'react';

export type DesktopConnectionState = {
  online: boolean;
  syncing: boolean;
};

export type UseDesktopConnectionOptions = {
  /** Tauri: не требовать navigator.onLine (часто ложный офлайн). */
  trustApiOnly?: boolean;
};

export function useDesktopConnection(
  syncing = false,
  apiReachable?: boolean,
  options?: UseDesktopConnectionOptions,
): DesktopConnectionState {
  const trustApiOnly = options?.trustApiOnly === true;
  const [navigatorOnline, setNavigatorOnline] = useState(true);

  useEffect(() => {
    if (trustApiOnly) {
      return;
    }
    const sync = () => setNavigatorOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [trustApiOnly]);

  const online = trustApiOnly
    ? apiReachable !== false
    : apiReachable !== undefined
      ? apiReachable && navigatorOnline
      : navigatorOnline;

  return { online, syncing };
}
