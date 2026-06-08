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

const ALREADY_HANDLED_RE =
  /already decided|уже обработана|not found or already|заявка не найдена/i;

export async function outcomeFromResponseAllowAlreadyHandled(
  response: Response,
): Promise<FlushOutcome> {
  if (response.ok) {
    return 'ok';
  }
  if (response.status === 401 || response.status === 403) {
    return 'drop';
  }
  if (response.status === 400) {
    try {
      const body = (await response.clone().json()) as { message?: string | string[] };
      const message = Array.isArray(body.message) ? body.message.join(' ') : body.message ?? '';
      if (ALREADY_HANDLED_RE.test(message)) {
        return 'ok';
      }
    } catch {
      /* ignore */
    }
  }
  return 'retry';
}

export function isEntry<T extends OutboxMutationType>(
  entry: OutboxEntry,
  type: T,
): entry is OutboxEntry & { type: T; payload: OutboxPayloadByType[T] } {
  return entry.type === type;
}
