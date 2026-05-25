import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushDirectorEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  try {
    if (isEntry(entry, 'DIRECTOR_COMMISSION_DECISION')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/director/commission-requests/${encodeURIComponent(payload.requestId)}/decision`,
        { decision: payload.decision },
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'DIRECTOR_CONTROL_DECISION')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/director/control-requests/${encodeURIComponent(payload.requestId)}/decision`,
        { decision: payload.decision },
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'DIRECTOR_SET_PERCENT')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        '/admin/sellers/percent',
        { sellerId: payload.sellerId, ratePercent: payload.ratePercent },
        'PUT',
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'DIRECTOR_DEMO_PASSWORD')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/director/demo-accounts/${encodeURIComponent(payload.nickname)}/password`,
        { password: payload.password },
        'PATCH',
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    return 'drop';
  } catch {
    return 'retry';
  }
}
