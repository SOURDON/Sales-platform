import { useEffect, useRef, useState } from 'react';
import {
  useDesktopConnection,
  type DesktopConnectionState,
  type UseDesktopConnectionOptions,
} from './useDesktopConnection';

const OFFLINE_UI_DELAY_MS = 6_000;
const SYNCING_UI_MIN_MS = 800;

/** Сглаживает мигание «На связи» / «Оффлайн» при фоновых healthcheck. */
export function useStableDesktopConnection(
  syncing: boolean,
  apiReachable?: boolean,
  options?: UseDesktopConnectionOptions,
): DesktopConnectionState {
  const raw = useDesktopConnection(syncing, apiReachable, options);
  const [display, setDisplay] = useState<DesktopConnectionState>(raw);
  const offlineTimerRef = useRef<number | null>(null);
  const syncingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (raw.online && !raw.syncing) {
      if (offlineTimerRef.current !== null) {
        window.clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      syncingSinceRef.current = null;
      setDisplay({ online: true, syncing: false });
      return;
    }

    if (raw.syncing) {
      if (offlineTimerRef.current !== null) {
        window.clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      if (syncingSinceRef.current === null) {
        syncingSinceRef.current = Date.now();
      }
      setDisplay({ online: raw.online, syncing: true });
      return;
    }

    if (!raw.online) {
      if (offlineTimerRef.current !== null) {
        return;
      }
      offlineTimerRef.current = window.setTimeout(() => {
        offlineTimerRef.current = null;
        setDisplay({ online: false, syncing: false });
      }, OFFLINE_UI_DELAY_MS);
      return;
    }

    if (syncingSinceRef.current !== null) {
      const elapsed = Date.now() - syncingSinceRef.current;
      const remaining = Math.max(0, SYNCING_UI_MIN_MS - elapsed);
      window.setTimeout(() => {
        syncingSinceRef.current = null;
        setDisplay({ online: raw.online, syncing: false });
      }, remaining);
      return;
    }

    setDisplay({ online: raw.online, syncing: false });
  }, [raw.online, raw.syncing]);

  useEffect(
    () => () => {
      if (offlineTimerRef.current !== null) {
        window.clearTimeout(offlineTimerRef.current);
      }
    },
    [],
  );

  return display;
}
