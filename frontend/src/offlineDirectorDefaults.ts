import { saveSyncCache } from './sync/cache';
import { normalizeAcquiringProfiles } from './acquiring/acquiringConfig';
import { scheduleDesktopLocalBackup } from './desktop/desktopLocalBackup';
import type { RevenuePlansByDay, StoreRevenuePlanRow } from './sync/admin/revenuePlans';
import prodSnapshot from './offlineDirectorProdSnapshot.json';

const SEED_KEY = 'sales-platform-offline-director-seed-id';

type ProdSnapshot = {
  capturedAt?: string;
  dashboard?: unknown;
  financeOps?: unknown;
  acquiring?: {
    percent?: number;
    detkovPercent?: number;
    putintsevSberPercent?: number;
    lyokhaPercent?: number;
    profiles?: unknown;
  };
  commissions?: { items?: Array<{ storeName: string; percent: number }> };
  revenuePlans?: StoreRevenuePlanRow[];
  sellers?: unknown[];
  staff?: unknown[];
  products?: unknown[];
  procurement?: unknown[];
};

const snapshot = prodSnapshot as ProdSnapshot;

function revenuePlansByDay(rows: StoreRevenuePlanRow[] | undefined): RevenuePlansByDay {
  const blob: RevenuePlansByDay = {};
  for (const row of rows ?? []) {
    const day = row.dayKey?.trim();
    if (!day) {
      continue;
    }
    (blob[day] ??= []).push(row);
  }
  return blob;
}

function alreadySeeded(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.localStorage.getItem(SEED_KEY) === String(snapshot.capturedAt ?? '');
}

function markSeeded(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SEED_KEY, String(snapshot.capturedAt ?? '1'));
}

/** Подставляет снимок онлайн-аккаунта директора (кассы, приходы, статьи, эквайринг, персонал). */
export async function ensureOfflineDirectorDefaults(userId: number): Promise<void> {
  if (alreadySeeded()) {
    return;
  }
  const acquiring = normalizeAcquiringProfiles(snapshot.acquiring?.profiles, {
    putintsevVtb: snapshot.acquiring?.percent,
    detkovVtb: snapshot.acquiring?.detkovPercent,
    putintsevSber: snapshot.acquiring?.putintsevSberPercent,
    lyokhaRs: snapshot.acquiring?.lyokhaPercent,
  });
  await Promise.all([
    snapshot.financeOps ? saveSyncCache(userId, 'financeOps', snapshot.financeOps) : Promise.resolve(),
    saveSyncCache(userId, 'acquiringProfiles', acquiring),
    snapshot.dashboard ? saveSyncCache(userId, 'dashboard', snapshot.dashboard) : Promise.resolve(),
    snapshot.sellers ? saveSyncCache(userId, 'sellers', snapshot.sellers) : Promise.resolve(),
    snapshot.staff ? saveSyncCache(userId, 'staff', snapshot.staff) : Promise.resolve(),
    snapshot.products ? saveSyncCache(userId, 'products', snapshot.products) : Promise.resolve(),
    snapshot.procurement ? saveSyncCache(userId, 'procurementCosts', snapshot.procurement) : Promise.resolve(),
    saveSyncCache(userId, 'managerStoreCommissions', snapshot.commissions?.items ?? []),
    saveSyncCache(userId, 'revenuePlansByDay', revenuePlansByDay(snapshot.revenuePlans)),
  ]);
  markSeeded();
  scheduleDesktopLocalBackup();
}
