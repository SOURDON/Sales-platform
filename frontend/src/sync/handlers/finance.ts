import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

export async function flushFinanceEntry(
  apiBaseUrl: string,
  token: string,
  entry: OutboxEntry,
): Promise<FlushOutcome> {
  try {
    if (isEntry(entry, 'FINANCE_INCOME')) {
      const { payload } = entry;
      const response = await postJson(apiBaseUrl, token, '/admin/finance/incomes', {
        accountId: payload.accountId,
        amount: payload.amount,
        workDay: payload.workDay,
        comment: payload.comment,
        incomeId: payload.incomeId,
      });
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_EXPENSE')) {
      const { payload } = entry;
      const response = await postJson(apiBaseUrl, token, '/admin/finance/expenses', {
        accountId: payload.accountId,
        title: payload.title,
        amount: payload.amount,
        comment: payload.comment,
        expenseId: payload.expenseId,
      });
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_ACCOUNT_BALANCE')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/admin/finance/accounts/${encodeURIComponent(payload.accountId)}/balance`,
        { balance: payload.balance },
        'PUT',
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
