import { saveSyncCache, loadSyncCache } from './cache';
import type { SyncCacheKey } from './types';

export const STORE_EQUIPMENT_CACHE_KEY = 'storeEquipment' as SyncCacheKey;

export type StoreEquipmentCachePayload = {
  stores: Array<{ storeName: string } & Record<string, unknown>>;
  customTypes: Array<{ id: string; label: string }>;
};

export async function loadStoreEquipmentCache(
  userId: number,
): Promise<StoreEquipmentCachePayload | null> {
  return loadSyncCache<StoreEquipmentCachePayload>(userId, STORE_EQUIPMENT_CACHE_KEY);
}

export async function saveStoreEquipmentCache(
  userId: number,
  payload: StoreEquipmentCachePayload,
): Promise<void> {
  await saveSyncCache(userId, STORE_EQUIPMENT_CACHE_KEY, payload);
}

const DEMO_ACCOUNTS_STORAGE_KEY = 'sales-platform-director-demo-accounts-v1';

export type DirectorDemoAccountRow = {
  nickname: string;
  fullName: string;
  role: string;
  storeName: string;
  password: string;
};

export function readDirectorDemoAccountsCache(): DirectorDemoAccountRow[] | null {
  try {
    const raw = window.sessionStorage.getItem(DEMO_ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DirectorDemoAccountRow[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDirectorDemoAccountsCache(rows: DirectorDemoAccountRow[]): void {
  try {
    window.sessionStorage.setItem(DEMO_ACCOUNTS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota */
  }
}
