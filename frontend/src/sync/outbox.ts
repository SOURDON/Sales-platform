import { deleteOutboxRow, getAllOutboxRows, putOutboxRow } from './db';
import type {
  AdminSaleOutboxPayload,
  OfflineQueuedSale,
  OutboxEntry,
  OutboxMutationType,
  OutboxPayload,
} from './types';

const LEGACY_STORAGE_PREFIX = 'sales-platform-offline-sales-v1';

function legacyKeyForUser(userId: number): string {
  return `${LEGACY_STORAGE_PREFIX}:${userId}`;
}

function parseLegacyQueue(raw: string): OfflineQueuedSale[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (row): row is OfflineQueuedSale =>
        row &&
        typeof row === 'object' &&
        typeof row.saleId === 'string' &&
        typeof row.sellerId === 'number' &&
        typeof row.totalAmount === 'number' &&
        typeof row.createdAt === 'string' &&
        Array.isArray(row.items) &&
        ['CASH', 'NON_CASH', 'TRANSFER'].includes(String(row.paymentType)),
    );
  } catch {
    return [];
  }
}

function saleToOutboxEntry(userId: number, sale: AdminSaleOutboxPayload): OutboxEntry {
  return {
    id: sale.saleId,
    userId,
    type: 'ADMIN_SALE',
    payload: sale,
    createdAt: sale.createdAt,
  };
}

export async function enqueueOutbox(
  userId: number,
  id: string,
  type: OutboxMutationType,
  payload: OutboxPayload,
  createdAt = new Date().toISOString(),
): Promise<void> {
  const rows = await listOutboxForUser(userId);
  if (rows.some((r) => r.id === id)) {
    return;
  }
  await putOutboxRow({ id, userId, type, payload, createdAt });
}

export async function migrateLegacyOfflineSalesQueue(userId: number): Promise<number> {
  if (typeof window === 'undefined') {
    return 0;
  }
  const key = legacyKeyForUser(userId);
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return 0;
  }
  const legacy = parseLegacyQueue(raw);
  if (legacy.length === 0) {
    window.localStorage.removeItem(key);
    return 0;
  }
  const existing = await listOutboxForUser(userId);
  const existingIds = new Set(existing.map((e) => e.id));
  let migrated = 0;
  for (const sale of legacy) {
    if (existingIds.has(sale.saleId)) {
      continue;
    }
    await putOutboxRow(saleToOutboxEntry(userId, sale));
    migrated += 1;
  }
  window.localStorage.removeItem(key);
  return migrated;
}

export async function listOutboxForUser(userId: number): Promise<OutboxEntry[]> {
  const rows = await getAllOutboxRows();
  return rows
    .filter((r) => r.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listAdminSalesQueue(userId: number): Promise<OfflineQueuedSale[]> {
  const rows = await listOutboxForUser(userId);
  return rows
    .filter((r) => r.type === 'ADMIN_SALE')
    .map((r) => r.payload as AdminSaleOutboxPayload);
}

export async function enqueueAdminSale(userId: number, sale: AdminSaleOutboxPayload): Promise<void> {
  await enqueueOutbox(userId, sale.saleId, 'ADMIN_SALE', sale, sale.createdAt);
}

export async function removeOutboxEntry(id: string): Promise<void> {
  await deleteOutboxRow(id);
}

export async function updateAdminSalePaymentInOutbox(
  userId: number,
  saleId: string,
  paymentType: AdminSaleOutboxPayload['paymentType'],
): Promise<boolean> {
  const rows = await listOutboxForUser(userId);
  const row = rows.find((r) => r.id === saleId && r.type === 'ADMIN_SALE');
  if (!row) {
    return false;
  }
  const payload = row.payload as AdminSaleOutboxPayload;
  if (payload.paymentType === paymentType) {
    return true;
  }
  await putOutboxRow({
    ...row,
    payload: { ...payload, paymentType },
  });
  return true;
}

export async function outboxCountForUser(userId: number): Promise<number> {
  return (await listOutboxForUser(userId)).length;
}

export type { OutboxMutationType };
