import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushAdminStaffEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  try {
    if (isEntry(entry, 'ADMIN_STAFF_ADD')) {
      const { payload } = entry;
      const response = await postJson(apiBaseUrl, token, '/admin/staff', {
        fullName: payload.fullName,
        nickname: payload.nickname,
        clientMemberId: payload.clientMemberId,
      });
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'ADMIN_STAFF_FROM_BASE')) {
      const response = await postJson(apiBaseUrl, token, '/admin/staff/from-base', {
        employeeId: entry.payload.employeeId,
      });
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'ADMIN_STAFF_REMOVE')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/admin/staff/${payload.staffId}/remove-from-store`,
        { storeName: payload.storeName },
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'ADMIN_STAFF_RESTORE')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/admin/staff/${payload.staffId}/restore-to-store`,
        { storeName: payload.storeName },
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
