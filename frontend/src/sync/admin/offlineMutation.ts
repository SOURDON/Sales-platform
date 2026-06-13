import { applyFinanceOptimistic } from './optimisticFinance';
import { applyOptimisticOutbox } from './optimistic';
import { enqueueOutbox } from '../outbox';
import type { OutboxMutationType, OutboxPayload } from '../types';

export function isLikelyOfflineFetchError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('время ожидания') || msg.includes('network')) {
      return true;
    }
  }
  return false;
}

export async function runAdminMutation(
  userId: number,
  clientId: string,
  type: OutboxMutationType,
  payload: OutboxPayload,
  online: () => Promise<void>,
): Promise<'online' | 'queued'> {
  try {
    await online();
    return 'online';
  } catch (error) {
    if (!isLikelyOfflineFetchError(error)) {
      throw error;
    }
    const createdAt =
      'createdAt' in payload && typeof payload.createdAt === 'string'
        ? payload.createdAt
        : new Date().toISOString();
    await enqueueOutbox(userId, clientId, type, payload, createdAt);
    if (type.startsWith('ADMIN_')) {
      await applyOptimisticOutbox(userId, type, payload);
    } else {
      await applyFinanceOptimistic(userId, type, payload);
    }
    return 'queued';
  }
}

export function newClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
