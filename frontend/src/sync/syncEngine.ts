import { flushOutbox } from './flushOutbox';
import { subscribeNetwork } from './network';
import { listOutboxForUser, migrateLegacyOfflineSalesQueue } from './outbox';

export type SyncEngineOptions = {
  apiBaseUrl: string;
  token: string;
  userId: number;
  onSyncingChange?: (syncing: boolean) => void;
  onFlushed?: () => void;
  onReachableChange?: (reachable: boolean) => void;
};

export function startSyncEngine(options: SyncEngineOptions): () => void {
  const { apiBaseUrl, token, userId, onSyncingChange, onFlushed, onReachableChange } = options;
  let flushing = false;

  const runFlush = async () => {
    if (flushing) {
      return;
    }
    flushing = true;
    try {
      await migrateLegacyOfflineSalesQueue(userId);
      const pending = await listOutboxForUser(userId);
      if (pending.length === 0) {
        onFlushed?.();
        return;
      }
      onSyncingChange?.(true);
      await Promise.race([
        flushOutbox(apiBaseUrl, token, userId),
        new Promise<void>((resolve) => window.setTimeout(resolve, 20_000)),
      ]);
      onFlushed?.();
    } catch {
      onFlushed?.();
    } finally {
      flushing = false;
      onSyncingChange?.(false);
    }
  };

  void migrateLegacyOfflineSalesQueue(userId).then(() => onFlushed?.());

  const network = subscribeNetwork(apiBaseUrl, (reachable) => {
    onReachableChange?.(reachable);
    if (reachable) {
      void runFlush();
    }
  });

  void runFlush();

  const onOnline = () => void runFlush();
  window.addEventListener('online', onOnline);
  const interval = window.setInterval(() => void runFlush(), 60_000);

  return () => {
    network.dispose();
    window.removeEventListener('online', onOnline);
    window.clearInterval(interval);
  };
}
