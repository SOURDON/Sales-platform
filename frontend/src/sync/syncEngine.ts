import { flushOutbox } from './flushOutbox';
import { getApiBaseUrl } from '../apiBase';
import { subscribeNetwork } from './network';
import { listOutboxForUser, migrateLegacyOfflineSalesQueue } from './outbox';

export type SyncEngineOptions = {
  apiBaseUrl: string;
  token: string;
  userId: number;
  onSyncingChange?: (syncing: boolean) => void;
  onFlushed?: () => void;
  onReachableChange?: (reachable: boolean) => void;
  /** Периодический flush outbox (в вебе отключён — только online / ручной). */
  enablePeriodicFlush?: boolean;
  /** Tauri/Windows: не реагировать на navigator.onLine (часто ложный офлайн). */
  ignoreNavigatorOffline?: boolean;
};

export function startSyncEngine(options: SyncEngineOptions): () => void {
  const {
    token,
    userId,
    onSyncingChange,
    onFlushed,
    onReachableChange,
    enablePeriodicFlush = true,
    ignoreNavigatorOffline = false,
  } = options;
  let flushing = false;

  const runFlush = async (): Promise<boolean> => {
    if (flushing) {
      return false;
    }
    flushing = true;
    try {
      await migrateLegacyOfflineSalesQueue(userId);
      const pending = await listOutboxForUser(userId);
      if (pending.length === 0) {
        return false;
      }
      onSyncingChange?.(true);
      const pendingBefore = pending.length;
      await Promise.race([
        flushOutbox(getApiBaseUrl(), token, userId),
        new Promise<void>((resolve) => window.setTimeout(resolve, 20_000)),
      ]);
      const pendingAfter = (await listOutboxForUser(userId)).length;
      return pendingAfter < pendingBefore;
    } catch {
      return false;
    } finally {
      flushing = false;
      onSyncingChange?.(false);
    }
  };

  const flushAndRefresh = async () => {
    const didFlush = await runFlush();
    if (didFlush) {
      onFlushed?.();
    }
  };

  void migrateLegacyOfflineSalesQueue(userId).then(() => void flushAndRefresh());

  const network = subscribeNetwork(
    getApiBaseUrl,
    (reachable) => {
      onReachableChange?.(reachable);
      if (reachable) {
        void flushAndRefresh();
      }
    },
    { ignoreNavigatorOffline, pollMs: enablePeriodicFlush ? undefined : 600_000 },
  );

  const onOnline = () => void flushAndRefresh();
  window.addEventListener('online', onOnline);
  const interval = enablePeriodicFlush
    ? window.setInterval(() => void runFlush(), 120_000)
    : null;

  return () => {
    network.dispose();
    window.removeEventListener('online', onOnline);
    if (interval !== null) {
      window.clearInterval(interval);
    }
  };
}
