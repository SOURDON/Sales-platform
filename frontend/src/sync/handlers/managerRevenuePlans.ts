import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushManagerRevenuePlansEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  if (!isEntry(entry, 'MANAGER_REVENUE_PLANS')) {
    return 'drop';
  }
  const { payload } = entry;
  try {
    const response = await postJson(apiBaseUrl, token, '/admin/revenue-plans', {
      dayKey: payload.dayKey,
      items: payload.items,
    }, 'PUT');
    const outcome = outcomeFromResponse(response);
    if (outcome === 'ok') {
      await removeOutboxEntry(entry.id);
    }
    return outcome;
  } catch {
    return 'retry';
  }
}
