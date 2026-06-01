import { loadSyncCache, saveSyncCache } from '../cache';
import { isApiReachable, markApiReachableSuccess } from '../network';
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
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = await loadSyncCache<T>(userId, cacheKey);
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    return { data: fallback, fromCache: true };
  }

  const fetchWithTimeout = () =>
    Promise.race([
      fetcher(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('cache fetch timeout')), 28_000);
      }),
    ]);

  try {
    const data = await fetchWithTimeout();
    markApiReachableSuccess();
    await saveSyncCache(userId, cacheKey, data);
    return { data, fromCache: false };
  } catch {
    const cached = await loadSyncCache<T>(userId, cacheKey);
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    const reachable = await isApiReachable(apiBaseUrl);
    return { data: fallback, fromCache: !reachable };
  }
}

/** @deprecated use loadSyncResource */
export const loadAdminResource = loadSyncResource;
