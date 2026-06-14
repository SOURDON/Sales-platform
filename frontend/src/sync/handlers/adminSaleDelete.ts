import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushAdminSaleDeleteEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  if (!isEntry(entry, 'ADMIN_SALE_DELETE_REQUEST')) {
    return 'drop';
  }
  const { payload } = entry;
  const saleId = String(payload.saleId ?? '').trim();
  const reason = String(payload.reason ?? '').trim();
  if (!saleId || !reason) {
    await removeOutboxEntry(entry.id);
    return 'ok';
  }
  try {
    const response = await postJson(apiBaseUrl, token, '/admin/sales/delete', {
      saleId,
      reason,
    });
    const outcome = outcomeFromResponse(response);
    if (outcome === 'ok') {
      await removeOutboxEntry(entry.id);
    }
    return outcome;
  } catch {
    return 'retry';
  }
}
