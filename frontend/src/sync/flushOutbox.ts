import { flushAdminSaleEntry } from './handlers/adminSale';
import { flushAdminShiftCloseEntry } from './handlers/adminShiftClose';
import { flushAdminShiftOpenEntry } from './handlers/adminShiftOpen';
import { flushAdminStaffEntry } from './handlers/adminStaff';
import { flushAdminWriteOffEntry } from './handlers/adminWriteOff';
import { flushDirectorEntry } from './handlers/director';
import { flushFinanceEntry } from './handlers/finance';
import { flushManagerRevenuePlansEntry } from './handlers/managerRevenuePlans';
import type { FlushOutcome } from './handlers/flushEntry';
import { isApiReachable, markApiReachableSuccess } from './network';
import { listOutboxForUser } from './outbox';
import type { OutboxEntry } from './types';

export type FlushOutboxResult = {
  sent: number;
  remaining: number;
  stoppedAuth: boolean;
};

async function flushEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  switch (entry.type) {
    case 'ADMIN_SALE':
      return flushAdminSaleEntry(apiBaseUrl, token, entry);
    case 'ADMIN_WRITE_OFF':
      return flushAdminWriteOffEntry(apiBaseUrl, token, entry);
    case 'ADMIN_SHIFT_OPEN':
      return flushAdminShiftOpenEntry(apiBaseUrl, token, entry);
    case 'ADMIN_SHIFT_CLOSE':
      return flushAdminShiftCloseEntry(apiBaseUrl, token, entry);
    case 'ADMIN_STAFF_ADD':
    case 'ADMIN_STAFF_FROM_BASE':
    case 'ADMIN_STAFF_REMOVE':
    case 'ADMIN_STAFF_RESTORE':
      return flushAdminStaffEntry(apiBaseUrl, token, entry);
    case 'FINANCE_INCOME':
    case 'FINANCE_EXPENSE':
    case 'FINANCE_ACCOUNT_BALANCE':
      return flushFinanceEntry(apiBaseUrl, token, entry);
    case 'DIRECTOR_COMMISSION_DECISION':
    case 'DIRECTOR_CONTROL_DECISION':
    case 'DIRECTOR_SET_PERCENT':
    case 'DIRECTOR_DEMO_PASSWORD':
      return flushDirectorEntry(apiBaseUrl, token, entry);
    case 'MANAGER_REVENUE_PLANS':
      return flushManagerRevenuePlansEntry(apiBaseUrl, token, entry);
    default:
      return 'drop';
  }
}

export async function flushOutbox(
  apiBaseUrl: string,
  token: string,
  userId: number,
): Promise<FlushOutboxResult> {
  if (!(await isApiReachable(apiBaseUrl))) {
    const remaining = (await listOutboxForUser(userId)).length;
    return { sent: 0, remaining, stoppedAuth: false };
  }

  const entries = await listOutboxForUser(userId);
  let sent = 0;
  let stoppedAuth = false;

  for (const entry of entries) {
    const outcome = await flushEntry(apiBaseUrl, token, entry);
    if (outcome === 'ok') {
      sent += 1;
      markApiReachableSuccess();
      continue;
    }
    if (outcome === 'drop') {
      stoppedAuth = true;
      break;
    }
    break;
  }

  const remaining = (await listOutboxForUser(userId)).length;
  return { sent, remaining, stoppedAuth };
}
