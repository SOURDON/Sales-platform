import { loadSyncCache, saveSyncCache, syncCacheAgeMs } from '../cache';
import { markApiReachableSuccess } from '../network';
import type { SyncCacheKey } from '../types';

export type LoadResourceResult<T> = {
  data: T;
  fromCache: boolean;
};

const FETCH_TIMEOUT_MS = 12_000;

export type LoadSyncResourceOptions<T> = {
  /** Вызывается, когда с сервера пришли свежие данные (после показа кэша). */
  onFresh?: (data: T) => void;
  /** Не ходить в сеть — только IndexedDB (ручное «только кэш»). */
  cacheOnly?: boolean;
  /** Если кэш моложе этого интервала — фоновый fetch не выполняется. */
  staleTimeMs?: number;
  /** Всегда ждать ответ сети (после мутаций). */
  preferNetwork?: boolean;
};

export async function loadSyncResource<T>(
  _apiBaseUrl: string,
  userId: number,
  cacheKey: SyncCacheKey,
  fetcher: () => Promise<T>,
  fallback: T,
  options?: LoadSyncResourceOptions<T>,
): Promise<LoadResourceResult<T>> {
  const cached = await loadSyncCache<T>(userId, cacheKey);

  const fetchFresh = async (): Promise<LoadResourceResult<T>> => {
    try {
      const data = await Promise.race([
        fetcher(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('cache fetch timeout')), FETCH_TIMEOUT_MS);
        }),
      ]);
      markApiReachableSuccess();
      await saveSyncCache(userId, cacheKey, data);
      options?.onFresh?.(data);
      return { data, fromCache: false };
    } catch {
      if (cached !== null) {
        return { data: cached, fromCache: true };
      }
      return { data: fallback, fromCache: true };
    }
  };

  if (options?.cacheOnly) {
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    return { data: fallback, fromCache: true };
  }

  if (options?.preferNetwork) {
    return fetchFresh();
  }

  if (cached !== null) {
    const staleTimeMs = options?.staleTimeMs ?? 45_000;
    if (staleTimeMs > 0) {
      const ageMs = await syncCacheAgeMs(userId, cacheKey);
      if (ageMs !== null && ageMs < staleTimeMs) {
        return { data: cached, fromCache: true };
      }
    }
    void fetchFresh();
    return { data: cached, fromCache: true };
  }

  return fetchFresh();
}

/** @deprecated use loadSyncResource */
export const loadAdminResource = loadSyncResource;
