import { getCacheRow, getCacheRowRecord, putCacheRow } from './db';
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

export async function syncCacheAgeMs(
  userId: number,
  cacheKey: SyncCacheKey,
): Promise<number | null> {
  const row = await getCacheRowRecord<unknown>(userId, cacheKey);
  if (!row?.updatedAt) {
    return null;
  }
  const updated = Date.parse(row.updatedAt);
  if (!Number.isFinite(updated)) {
    return null;
  }
  return Math.max(0, Date.now() - updated);
}

/** @deprecated use saveSyncCache */
export const saveAdminCache = saveSyncCache;

/** @deprecated use loadSyncCache */
export const loadAdminCache = loadSyncCache;
