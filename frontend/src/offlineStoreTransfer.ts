import { isTauriRuntime } from './desktop/tauri';
import { loadSyncCache, saveSyncCache } from './sync/cache';
import { readOfflineStoreSettings } from './offlineStoreSettings';
import { pullOfflineAdminSnapshot } from './offlineStoreSeed';
import { scheduleDesktopLocalBackup } from './desktop/desktopLocalBackup';

export const STORE_TRANSFER_KIND = 'fotografy-store-snapshot';

type StaffRow = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  storeName: string;
  assignedStores: string[];
  staffPosition: 'SALES' | 'RETOUCHER' | 'MANAGER';
  retoucherRatePercent?: number;
  earningsAmount: number;
};

type SellerRow = {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
  salesAmount: number;
  checksCount: number;
  commissionAmount: number;
};

type ShiftRow = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  assignedSellerIds: number[];
  checksCount: number;
  itemsCount: number;
};

type SaleRow = {
  id: string;
  createdAt: string;
  sellerName: string;
  sellerId: number;
  totalAmount: number;
  units: number;
  items: Array<{ name: string; qty: number }>;
  paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER';
  pendingSync?: boolean;
};

export type StoreOfflineTransfer = {
  version: 1;
  kind: typeof STORE_TRANSFER_KIND;
  exportedAt: string;
  storeName: string;
  staff: StaffRow[];
  sellers: SellerRow[];
  shifts: ShiftRow[];
  sales: SaleRow[];
  products: Array<{ name: string; price: number }>;
  managerStoreCommissions: Array<{ storeName: string; percent: number }>;
};

function belongsToStore(member: StaffRow, storeName: string): boolean {
  const assigned = member.assignedStores ?? [];
  if (assigned.includes(storeName)) {
    return true;
  }
  return member.storeName === storeName;
}

function mergeById<T extends { id: string | number }>(current: T[], incoming: T[]): T[] {
  const map = new Map<string | number, T>();
  for (const row of current) {
    map.set(row.id, row);
  }
  for (const row of incoming) {
    map.set(row.id, row);
  }
  return [...map.values()];
}

export async function buildStoreTransferSnapshot(userId: number): Promise<StoreOfflineTransfer> {
  const snapshot = await pullOfflineAdminSnapshot(userId);
  return {
    version: 1,
    kind: STORE_TRANSFER_KIND,
    exportedAt: new Date().toISOString(),
    storeName: readOfflineStoreSettings().storeName,
    staff: snapshot.staff,
    sellers: snapshot.sellers,
    shifts: snapshot.shifts,
    sales: snapshot.sales,
    products: snapshot.products,
    managerStoreCommissions: snapshot.managerStoreCommissions,
  };
}

export async function exportStoreTransferToFile(userId: number): Promise<'saved' | 'cancelled'> {
  const payload = await buildStoreTransferSnapshot(userId);
  const filename = `fotografy-store-${payload.storeName.replace(/[^\p{L}\p{N}-]+/gu, '_')}.json`;
  const text = JSON.stringify(payload, null, 2);
  if (!isTauriRuntime()) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return 'saved';
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) {
    return 'cancelled';
  }
  await writeTextFile(path, text);
  return 'saved';
}

export function parseStoreTransfer(raw: string): StoreOfflineTransfer {
  const parsed = JSON.parse(raw) as StoreOfflineTransfer;
  if (parsed?.version !== 1 || parsed.kind !== STORE_TRANSFER_KIND || !parsed.storeName) {
    throw new Error('Это не файл выгрузки кассы Fotografy Store');
  }
  return parsed;
}

export async function importStoreTransferToDirector(
  directorUserId: number,
  transfer: StoreOfflineTransfer,
): Promise<string> {
  const storeName = transfer.storeName.trim();
  const [staff, sellers, shifts, sales, products, commissions] = await Promise.all([
    loadSyncCache<StaffRow[]>(directorUserId, 'staff'),
    loadSyncCache<SellerRow[]>(directorUserId, 'sellers'),
    loadSyncCache<ShiftRow[]>(directorUserId, 'shifts'),
    loadSyncCache<SaleRow[]>(directorUserId, 'sales'),
    loadSyncCache<Array<{ name: string; price: number }>>(directorUserId, 'products'),
    loadSyncCache<Array<{ storeName: string; percent: number }>>(
      directorUserId,
      'managerStoreCommissions',
    ),
  ]);

  const incomingSellerIds = new Set(transfer.sellers.map((row) => row.id));
  const nextStaff = [
    ...(staff ?? []).filter((member) => !belongsToStore(member, storeName)),
    ...transfer.staff,
  ];
  const nextSellers = [
    ...(sellers ?? []).filter((seller) => seller.storeName !== storeName),
    ...transfer.sellers,
  ];
  const nextSales = [
    ...(sales ?? []).filter((sale) => !incomingSellerIds.has(sale.sellerId)),
    ...transfer.sales,
  ];
  const nextShifts = mergeById(shifts ?? [], transfer.shifts);
  const productMap = new Map((products ?? []).map((row) => [row.name, row]));
  for (const row of transfer.products) {
    productMap.set(row.name, row);
  }
  const commissionMap = new Map((commissions ?? []).map((row) => [row.storeName, row]));
  for (const row of transfer.managerStoreCommissions) {
    commissionMap.set(row.storeName, row);
  }
  if (transfer.managerStoreCommissions.length === 0) {
    commissionMap.set(storeName, { storeName, percent: 0 });
  }

  await Promise.all([
    saveSyncCache(directorUserId, 'staff', nextStaff),
    saveSyncCache(directorUserId, 'sellers', nextSellers),
    saveSyncCache(directorUserId, 'shifts', nextShifts),
    saveSyncCache(directorUserId, 'sales', nextSales),
    saveSyncCache(directorUserId, 'products', [...productMap.values()]),
    saveSyncCache(directorUserId, 'managerStoreCommissions', [...commissionMap.values()]),
  ]);
  scheduleDesktopLocalBackup();
  return storeName;
}

export async function pickAndImportStoreTransfer(
  directorUserId: number,
): Promise<{ storeName: string } | 'cancelled'> {
  let raw = '';
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path || Array.isArray(path)) {
      return 'cancelled';
    }
    raw = await readTextFile(path);
  } else {
    raw = await new Promise<string>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve('');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      };
      input.click();
    });
    if (!raw) {
      return 'cancelled';
    }
  }
  const storeName = await importStoreTransferToDirector(directorUserId, parseStoreTransfer(raw));
  return { storeName };
}
