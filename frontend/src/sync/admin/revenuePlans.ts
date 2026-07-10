import { getApiBaseUrl } from '../../apiBase';
import { loadSyncCache, saveSyncCache } from '../cache';
import { isApiReachable } from '../network';
import type { LoadResourceResult } from './loadResource';

export type StoreRevenuePlanRow = {
  dayKey: string;
  storeName: string;
  planRevenue: number;
};

export type RevenuePlansByDay = Record<string, StoreRevenuePlanRow[]>;

export async function loadRevenuePlansWithCache(
  _apiBaseUrl: string,
  userId: number,
  dayKey: string,
  fetcher: () => Promise<StoreRevenuePlanRow[]>,
): Promise<LoadResourceResult<StoreRevenuePlanRow[]>> {
  const empty: StoreRevenuePlanRow[] = [];
  const reachable = await isApiReachable(getApiBaseUrl);
  if (reachable) {
    try {
      const data = await fetcher();
      const blob = (await loadSyncCache<RevenuePlansByDay>(userId, 'revenuePlansByDay')) ?? {};
      blob[dayKey] = data;
      await saveSyncCache(userId, 'revenuePlansByDay', blob);
      return { data, fromCache: false };
    } catch {
      // fall through
    }
  }
  const blob = await loadSyncCache<RevenuePlansByDay>(userId, 'revenuePlansByDay');
  const cached = blob?.[dayKey];
  if (cached) {
    return { data: cached, fromCache: true };
  }
  return { data: empty, fromCache: !reachable };
}

export async function patchRevenuePlansCache(
  userId: number,
  dayKey: string,
  plans: StoreRevenuePlanRow[],
): Promise<void> {
  const blob = (await loadSyncCache<RevenuePlansByDay>(userId, 'revenuePlansByDay')) ?? {};
  blob[dayKey] = plans;
  await saveSyncCache(userId, 'revenuePlansByDay', blob);
}
