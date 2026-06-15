import { removeOutboxEntry } from '../outbox';
import type { OutboxEntry } from '../types';
import { fetchWithTimeout } from '../fetchTimeout';
import { isEntry, outcomeFromResponse, postJson, type FlushOutcome } from './flushEntry';

async function deleteRequest(
  apiBaseUrl: string,
  token: string,
  path: string,
): Promise<Response> {
  const base = apiBaseUrl.replace(/\/$/, '');
  return fetchWithTimeout(
    `${base}${path}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    20_000,
  );
}

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
    if (isEntry(entry, 'FINANCE_INCOME_UPDATE')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/admin/finance/incomes/${encodeURIComponent(payload.incomeId)}`,
        {
          accountId: payload.accountId,
          amount: payload.amount,
          workDay: payload.workDay,
          comment: payload.comment,
        },
        'PUT',
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_EXPENSE_UPDATE')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        `/admin/finance/expenses/${encodeURIComponent(payload.expenseId)}`,
        {
          accountId: payload.accountId,
          title: payload.title,
          amount: payload.amount,
          comment: payload.comment,
        },
        'PUT',
      );
      const outcome = outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_INCOME_DELETE')) {
      const { payload } = entry;
      const response = await deleteRequest(
        apiBaseUrl,
        token,
        `/admin/finance/incomes/${encodeURIComponent(payload.incomeId)}`,
      );
      const outcome =
        response.ok || response.status === 404 ? 'ok' : outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_EXPENSE_DELETE')) {
      const { payload } = entry;
      const response = await deleteRequest(
        apiBaseUrl,
        token,
        `/admin/finance/expenses/${encodeURIComponent(payload.expenseId)}`,
      );
      const outcome =
        response.ok || response.status === 404 ? 'ok' : outcomeFromResponse(response);
      if (outcome === 'ok') {
        await removeOutboxEntry(entry.id);
      }
      return outcome;
    }
    if (isEntry(entry, 'FINANCE_EXPENSE_CATEGORY')) {
      const { payload } = entry;
      const response = await postJson(
        apiBaseUrl,
        token,
        '/admin/finance/expense-category-amount',
        { title: payload.title, amount: payload.amount },
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
