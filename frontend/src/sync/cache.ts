import { getCacheRow, putCacheRow } from './db';
import type { SyncCacheKey } from './types';

export async function saveSyncCache<T>(
  userId: number,
  cacheKey: SyncCacheKey,
  data: T,
): Promise<void> {
  await putCacheRow({
    key: `${userId}:${cacheKey}`,
    userId,
    cacheKey,
    data,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadSyncCache<T>(userId: number, cacheKey: SyncCacheKey): Promise<T | null> {
  return getCacheRow<T>(userId, cacheKey);
}

/** @deprecated use saveSyncCache */
export const saveAdminCache = saveSyncCache;

/** @deprecated use loadSyncCache */
export const loadAdminCache = loadSyncCache;
