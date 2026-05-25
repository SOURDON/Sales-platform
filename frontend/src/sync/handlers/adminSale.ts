import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushAdminSaleEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  if (!isEntry(entry, 'ADMIN_SALE')) {
    return 'drop';
  }
  const { payload } = entry;
  try {
    const response = await postJson(apiBaseUrl, token, '/admin/sales', {
      sellerId: payload.sellerId,
      items: payload.items,
      totalAmount: payload.totalAmount,
      paymentType: payload.paymentType,
      saleId: payload.saleId,
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
