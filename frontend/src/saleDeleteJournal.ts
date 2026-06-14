import { loadAdminCache, saveAdminCache } from './sync/cache';

export type SaleDeleteJournalEntry = {
  id: string;
  saleId: string;
  sellerName: string;
  amount: number;
  reason: string;
  createdAt: string;
  storeName: string;
  dayKey: string;
  status: 'local_removed' | 'pending_sync' | 'deleted';
};

export async function appendSaleDeleteJournal(
  userId: number,
  entry: SaleDeleteJournalEntry,
): Promise<void> {
  const rows = (await loadAdminCache<SaleDeleteJournalEntry[]>(userId, 'saleDeleteJournal')) ?? [];
  if (rows.some((row) => row.id === entry.id || row.saleId === entry.saleId)) {
    return;
  }
  await saveAdminCache(userId, 'saleDeleteJournal', [entry, ...rows].slice(0, 200));
}

export async function listSaleDeleteJournal(
  userId: number,
  storeName?: string,
  dayKey?: string,
): Promise<SaleDeleteJournalEntry[]> {
  const rows = (await loadAdminCache<SaleDeleteJournalEntry[]>(userId, 'saleDeleteJournal')) ?? [];
  return rows.filter((row) => {
    if (storeName && row.storeName !== storeName) {
      return false;
    }
    if (dayKey && row.dayKey !== dayKey) {
      return false;
    }
    return true;
  });
}
