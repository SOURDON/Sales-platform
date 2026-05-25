import { fetchWithTimeout } from '../fetchTimeout';
import type { OutboxEntry, OutboxMutationType, OutboxPayloadByType } from '../types';

export type FlushOutcome = 'ok' | 'retry' | 'drop';

export async function postJson(
  apiBaseUrl: string,
  token: string,
  path: string,
  body: unknown,
  method = 'POST',
): Promise<Response> {
  const base = apiBaseUrl.replace(/\/$/, '');
  return fetchWithTimeout(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }, 20_000);
}

export function outcomeFromResponse(response: Response): FlushOutcome {
  if (response.ok) {
    return 'ok';
  }
  if (response.status === 401 || response.status === 403) {
    return 'drop';
  }
  return 'retry';
}

export function isEntry<T extends OutboxMutationType>(
  entry: OutboxEntry,
  type: T,
): entry is OutboxEntry & { type: T; payload: OutboxPayloadByType[T] } {
  return entry.type === type;
}
