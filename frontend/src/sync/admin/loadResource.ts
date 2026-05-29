import { loadSyncCache, saveSyncCache } from '../cache';
import { isApiReachable } from '../network';
import type { SyncCacheKey } from '../types';

export type LoadResourceResult<T> = {
  data: T;
  fromCache: boolean;
};

export async function loadSyncResource<T>(
  apiBaseUrl: string,
  userId: number,
  cacheKey: SyncCacheKey,
  fetcher: () => Promise<T>,
  fallback: T,
): Promise<LoadResourceResult<T>> {
  const reachable = await isApiReachable(apiBaseUrl);
  if (reachable) {
    const fetchWithTimeout = () =>
      Promise.race([
        fetcher(),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error('cache fetch timeout')),
            22_000,
          );
        }),
      ]);

    try {
      const data = await fetchWithTimeout();
      await saveSyncCache(userId, cacheKey, data);
      return { data, fromCache: false };
    } catch {
      try {
        const data = await fetchWithTimeout();
        await saveSyncCache(userId, cacheKey, data);
        return { data, fromCache: false };
      } catch {
        // При онлайне не подставляем устаревший кэш — иначе суммы «прыгают».
        return { data: fallback, fromCache: false };
      }
    }
  }
  const cached = await loadSyncCache<T>(userId, cacheKey);
  if (cached !== null) {
    return { data: cached, fromCache: true };
  }
  return { data: fallback, fromCache: !reachable };
}

/** @deprecated use loadSyncResource */
export const loadAdminResource = loadSyncResource;
