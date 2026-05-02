/** Офлайн-очередь продаж (localStorage): при появлении сети отправляется тем же saleId (идемпотентность на сервере). */

export type OfflineQueuedSale = {
  saleId: string;
  sellerId: number;
  items: Array<{ name: string; qty: number }>;
  totalAmount: number;
  paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER';
  createdAt: string;
};

const STORAGE_PREFIX = 'sales-platform-offline-sales-v1';

function keyForUser(userId: number): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function readOfflineQueue(userId: number): OfflineQueuedSale[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(keyForUser(userId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (row): row is OfflineQueuedSale =>
        row &&
        typeof row === 'object' &&
        typeof (row as OfflineQueuedSale).saleId === 'string' &&
        typeof (row as OfflineQueuedSale).sellerId === 'number' &&
        typeof (row as OfflineQueuedSale).totalAmount === 'number' &&
        typeof (row as OfflineQueuedSale).createdAt === 'string' &&
        Array.isArray((row as OfflineQueuedSale).items) &&
        ['CASH', 'NON_CASH', 'TRANSFER'].includes(String((row as OfflineQueuedSale).paymentType)),
    );
  } catch {
    return [];
  }
}

export function writeOfflineQueue(userId: number, queue: OfflineQueuedSale[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(keyForUser(userId), JSON.stringify(queue));
  } catch {
    // квота / приватный режим — очередь просто не сохранится
  }
}

export function appendOfflineSale(userId: number, entry: OfflineQueuedSale): void {
  const q = readOfflineQueue(userId);
  if (q.some((row) => row.saleId === entry.saleId)) {
    return;
  }
  q.push(entry);
  writeOfflineQueue(userId, q);
}
