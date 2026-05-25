import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushAdminWriteOffEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  if (!isEntry(entry, 'ADMIN_WRITE_OFF')) {
    return 'drop';
  }
  const { payload } = entry;
  try {
    const response = await postJson(apiBaseUrl, token, '/admin/write-offs', {
      name: payload.name,
      qty: payload.qty,
      reason: payload.reason,
      requestId: payload.requestId,
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
