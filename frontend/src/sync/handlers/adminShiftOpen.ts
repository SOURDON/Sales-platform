import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushAdminShiftOpenEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  if (!isEntry(entry, 'ADMIN_SHIFT_OPEN')) {
    return 'drop';
  }
  const { payload } = entry;
  try {
    const response = await postJson(apiBaseUrl, token, '/admin/shifts/open', {
      assignedSellerIds: payload.assignedSellerIds,
      clientShiftId: payload.clientShiftId,
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
