import { loadSyncCache, saveSyncCache } from '../cache';
import { patchRevenuePlansCache, type StoreRevenuePlanRow } from './revenuePlans';
import type {
  AcquiringProfilesOutboxPayload,
  DirectorCommissionDecisionPayload,
  DirectorControlDecisionPayload,
  DirectorSetPercentPayload,
  FinanceExpenseCategoryOutboxPayload,
  FinanceExpenseUpdateOutboxPayload,
  FinanceIncomeDeleteOutboxPayload,
  FinanceExpenseDeleteOutboxPayload,
  FinanceIncomeUpdateOutboxPayload,
  ManagerRevenuePlansPayload,
  ManagerStoreCommissionsOutboxPayload,
  ProcurementCostsOutboxPayload,
  FinanceAccountBalanceOutboxPayload,
  FinanceExpenseOutboxPayload,
  FinanceIncomeOutboxPayload,
  OutboxMutationType,
  OutboxPayload,
} from '../types';

type FinanceAccount = { id: string; name: string; kind: string; balance: number };
type FinanceExpense = {
  id: string;
  createdAt: string;
  title: string;
  amount: number;
  comment?: string;
  createdBy: string;
  accountId: string;
  accountName: string;
};
type FinanceIncome = {
  id: string;
  createdAt: string;
  workDay: string;
  amount: number;
  comment?: string;
  createdBy: string;
  accountId: string;
  accountName: string;
};
type FinanceCategoryAmountRow = { title: string; amount: number };

function financeExpenseCreatedAtForWorkDay(workDay: string, previousIso: string): string {
  const prev = new Date(previousIso);
  const base = Number.isNaN(prev.getTime()) ? new Date() : prev;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(base);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return `${workDay}T${part('hour')}:${part('minute')}:${part('second')}+03:00`;
}

const FINANCE_EXPENSE_CATEGORY_LABELS = [
  'Аренда',
  'Налоги',
  'ЗП',
  'Расходка',
  'Ремонт',
  'Техника',
  'Хоз-товары',
  'Попилили',
  'Прочие траты',
] as const;

type FinanceOpsSnapshot = {
  accounts: FinanceAccount[];
  expenses: FinanceExpense[];
  incomes: FinanceIncome[];
  categoryAmounts?: FinanceCategoryAmountRow[];
  totals: {
    cash: number;
    bank: number;
    balance: number;
    expenses: number;
    incomes: number;
    categoryTotal?: number;
  };
};

function defaultCategoryAmounts(): FinanceCategoryAmountRow[] {
  return FINANCE_EXPENSE_CATEGORY_LABELS.map((title) => ({ title, amount: 0 }));
}

function bumpCategoryAmount(
  rows: FinanceCategoryAmountRow[],
  expenseTitle: string,
  delta: number,
): FinanceCategoryAmountRow[] {
  const canonical = new Set<string>(FINANCE_EXPENSE_CATEGORY_LABELS);
  const misc = 'Прочие траты';
  const raw = expenseTitle.trim() || misc;
  const bucket = canonical.has(raw) ? raw : misc;
  return rows.map((row) =>
    row.title === bucket
      ? { ...row, amount: Math.round((row.amount + delta) * 100) / 100 }
      : row,
  );
}

type CommissionRequest = {
  id: string;
  status: string;
  sellerId: number;
  requestedPercent: number;
};

type SellerLike = {
  id: number;
  ratePercent: number;
};

export async function applyFinanceOptimistic(
  userId: number,
  type: OutboxMutationType,
  payload: OutboxPayload,
): Promise<void> {
  switch (type) {
    case 'FINANCE_INCOME':
      await applyIncome(userId, payload as FinanceIncomeOutboxPayload);
      break;
    case 'FINANCE_EXPENSE':
      await applyExpense(userId, payload as FinanceExpenseOutboxPayload);
      break;
    case 'FINANCE_ACCOUNT_BALANCE':
      await applyBalance(userId, payload as FinanceAccountBalanceOutboxPayload);
      break;
    case 'DIRECTOR_COMMISSION_DECISION':
      await applyCommissionDecision(userId, payload as DirectorCommissionDecisionPayload);
      break;
    case 'DIRECTOR_CONTROL_DECISION':
      await applyControlDecision(userId, payload as DirectorControlDecisionPayload);
      break;
    case 'DIRECTOR_SET_PERCENT':
      await applySetPercent(userId, payload as DirectorSetPercentPayload);
      break;
    case 'MANAGER_REVENUE_PLANS':
      await applyManagerPlans(userId, payload as ManagerRevenuePlansPayload);
      break;
    case 'FINANCE_INCOME_UPDATE':
      await applyIncomeUpdate(userId, payload as FinanceIncomeUpdateOutboxPayload);
      break;
    case 'FINANCE_EXPENSE_UPDATE':
      await applyExpenseUpdate(userId, payload as FinanceExpenseUpdateOutboxPayload);
      break;
    case 'FINANCE_INCOME_DELETE':
      await applyIncomeDelete(userId, payload as FinanceIncomeDeleteOutboxPayload);
      break;
    case 'FINANCE_EXPENSE_DELETE':
      await applyExpenseDelete(userId, payload as FinanceExpenseDeleteOutboxPayload);
      break;
    case 'FINANCE_EXPENSE_CATEGORY':
      await applyExpenseCategory(userId, payload as FinanceExpenseCategoryOutboxPayload);
      break;
    case 'MANAGER_STORE_COMMISSIONS':
      await applyManagerStoreCommissions(userId, payload as ManagerStoreCommissionsOutboxPayload);
      break;
    case 'ACQUIRING_PROFILES':
      await applyAcquiringProfiles(userId, payload as AcquiringProfilesOutboxPayload);
      break;
    case 'PROCUREMENT_COSTS':
      await applyProcurementCosts(userId, payload as ProcurementCostsOutboxPayload);
      break;
    default:
      break;
  }
}

async function loadFinance(userId: number): Promise<FinanceOpsSnapshot | null> {
  return loadSyncCache<FinanceOpsSnapshot>(userId, 'financeOps');
}

async function saveFinance(userId: number, snap: FinanceOpsSnapshot): Promise<void> {
  const categoryAmounts = snap.categoryAmounts ?? defaultCategoryAmounts();
  const categoryTotal = Math.round(
    categoryAmounts.reduce((sum, row) => sum + row.amount, 0) * 100,
  ) / 100;
  const totals = {
    cash: snap.accounts.filter((a) => a.kind === 'CASH').reduce((s, a) => s + a.balance, 0),
    bank: snap.accounts.filter((a) => a.kind === 'BANK').reduce((s, a) => s + a.balance, 0),
    balance: snap.accounts.reduce((s, a) => s + a.balance, 0),
    expenses: snap.expenses.reduce((s, e) => s + e.amount, 0),
    incomes: snap.incomes.reduce((s, i) => s + i.amount, 0),
    categoryTotal,
  };
  await saveSyncCache(userId, 'financeOps', { ...snap, categoryAmounts, totals });
}

async function applyIncome(userId: number, payload: FinanceIncomeOutboxPayload): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const account = snap.accounts.find((a) => a.id === payload.accountId);
  if (!account) {
    return;
  }
  const accounts = snap.accounts.map((a) =>
    a.id === payload.accountId
      ? { ...a, balance: Math.round((a.balance + payload.amount) * 100) / 100 }
      : a,
  );
  const incomes = [
    ...snap.incomes,
    {
      id: payload.incomeId,
      createdAt: payload.createdAt,
      workDay: payload.workDay,
      amount: payload.amount,
      comment: payload.comment,
      createdBy: 'offline',
      accountId: account.id,
      accountName: account.name,
    },
  ];
  await saveFinance(userId, { ...snap, accounts, incomes });
}

async function applyExpense(userId: number, payload: FinanceExpenseOutboxPayload): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const account = snap.accounts.find((a) => a.id === payload.accountId);
  if (!account) {
    return;
  }
  const amountCents = Math.round(payload.amount * 100);
  if (Math.round(account.balance * 100) < amountCents) {
    return;
  }
  const accounts = snap.accounts.map((a) =>
    a.id === payload.accountId
      ? { ...a, balance: Math.round((a.balance - payload.amount) * 100) / 100 }
      : a,
  );
  const expenses = [
    ...snap.expenses,
    {
      id: payload.expenseId,
      createdAt: payload.createdAt,
      title: payload.title,
      amount: payload.amount,
      comment: payload.comment,
      createdBy: 'offline',
      accountId: account.id,
      accountName: account.name,
    },
  ];
  const categoryAmounts = bumpCategoryAmount(
    snap.categoryAmounts ?? defaultCategoryAmounts(),
    payload.title,
    payload.amount,
  );
  await saveFinance(userId, { ...snap, accounts, expenses, categoryAmounts });
}

async function applyBalance(
  userId: number,
  payload: FinanceAccountBalanceOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const accounts = snap.accounts.map((a) =>
    a.id === payload.accountId ? { ...a, balance: payload.balance } : a,
  );
  await saveFinance(userId, { ...snap, accounts });
}

async function applyCommissionDecision(
  userId: number,
  payload: DirectorCommissionDecisionPayload,
): Promise<void> {
  const requests =
    (await loadSyncCache<CommissionRequest[]>(userId, 'commissionRequests')) ?? [];
  const updated = requests.map((r) =>
    r.id === payload.requestId ? { ...r, status: payload.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' } : r,
  );
  await saveSyncCache(userId, 'commissionRequests', updated);
  if (payload.decision === 'APPROVE') {
    const sellers = (await loadSyncCache<SellerLike[]>(userId, 'sellers')) ?? [];
    const req = requests.find((r) => r.id === payload.requestId);
    if (req) {
      await saveSyncCache(
        userId,
        'sellers',
        sellers.map((s) =>
          s.id === req.sellerId ? { ...s, ratePercent: req.requestedPercent } : s,
        ),
      );
    }
  }
}

type ControlRequestRow = { id: string };

async function applyControlDecision(
  userId: number,
  payload: DirectorControlDecisionPayload,
): Promise<void> {
  const requests =
    (await loadSyncCache<ControlRequestRow[]>(userId, 'controlRequests')) ?? [];
  await saveSyncCache(
    userId,
    'controlRequests',
    requests.filter((row) => row.id !== payload.requestId),
  );
}

async function applyIncomeUpdate(
  userId: number,
  payload: FinanceIncomeUpdateOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const existing = snap.incomes.find((row) => row.id === payload.incomeId);
  if (!existing) {
    return;
  }
  let accounts = snap.accounts.map((account) =>
    account.id === existing.accountId
      ? { ...account, balance: Math.round((account.balance - existing.amount) * 100) / 100 }
      : account,
  );
  accounts = accounts.map((account) =>
    account.id === payload.accountId
      ? { ...account, balance: Math.round((account.balance + payload.amount) * 100) / 100 }
      : account,
  );
  const targetAccount = accounts.find((account) => account.id === payload.accountId);
  const incomes = snap.incomes.map((row) =>
    row.id === payload.incomeId
      ? {
          ...row,
          accountId: payload.accountId,
          accountName: targetAccount?.name ?? row.accountName,
          amount: payload.amount,
          workDay: payload.workDay,
          comment: payload.comment,
        }
      : row,
  );
  await saveFinance(userId, { ...snap, accounts, incomes });
}

async function applyExpenseUpdate(
  userId: number,
  payload: FinanceExpenseUpdateOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const existing = snap.expenses.find((row) => row.id === payload.expenseId);
  if (!existing) {
    return;
  }
  let accounts = snap.accounts.map((account) =>
    account.id === existing.accountId
      ? { ...account, balance: Math.round((account.balance + existing.amount) * 100) / 100 }
      : account,
  );
  const targetAccount = accounts.find((account) => account.id === payload.accountId);
  const targetBalanceCents = Math.round((targetAccount?.balance ?? 0) * 100);
  const newAmountCents = Math.round(payload.amount * 100);
  if (targetBalanceCents < newAmountCents) {
    return;
  }
  accounts = accounts.map((account) =>
    account.id === payload.accountId
      ? { ...account, balance: Math.round((account.balance - payload.amount) * 100) / 100 }
      : account,
  );
  let categoryAmounts = snap.categoryAmounts ?? defaultCategoryAmounts();
  categoryAmounts = bumpCategoryAmount(categoryAmounts, existing.title, -existing.amount);
  categoryAmounts = bumpCategoryAmount(categoryAmounts, payload.title, payload.amount);
  const expenses = snap.expenses.map((row) =>
    row.id === payload.expenseId
      ? {
          ...row,
          accountId: payload.accountId,
          accountName: targetAccount?.name ?? row.accountName,
          title: payload.title,
          amount: payload.amount,
          comment: payload.comment,
          createdAt:
            payload.workDay && /^\d{4}-\d{2}-\d{2}$/.test(payload.workDay)
              ? financeExpenseCreatedAtForWorkDay(payload.workDay, row.createdAt)
              : row.createdAt,
        }
      : row,
  );
  await saveFinance(userId, { ...snap, accounts, expenses, categoryAmounts });
}

async function applyIncomeDelete(
  userId: number,
  payload: FinanceIncomeDeleteOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const existing = snap.incomes.find((row) => row.id === payload.incomeId);
  if (!existing) {
    return;
  }
  const accounts = snap.accounts.map((account) =>
    account.id === existing.accountId
      ? { ...account, balance: Math.round((account.balance - existing.amount) * 100) / 100 }
      : account,
  );
  const incomes = snap.incomes.filter((row) => row.id !== payload.incomeId);
  await saveFinance(userId, { ...snap, accounts, incomes });
}

async function applyExpenseDelete(
  userId: number,
  payload: FinanceExpenseDeleteOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const existing = snap.expenses.find((row) => row.id === payload.expenseId);
  if (!existing) {
    return;
  }
  const accounts = snap.accounts.map((account) =>
    account.id === existing.accountId
      ? { ...account, balance: Math.round((account.balance + existing.amount) * 100) / 100 }
      : account,
  );
  const categoryAmounts = bumpCategoryAmount(
    snap.categoryAmounts ?? defaultCategoryAmounts(),
    existing.title,
    -existing.amount,
  );
  const expenses = snap.expenses.filter((row) => row.id !== payload.expenseId);
  await saveFinance(userId, { ...snap, accounts, expenses, categoryAmounts });
}

async function applyExpenseCategory(
  userId: number,
  payload: FinanceExpenseCategoryOutboxPayload,
): Promise<void> {
  const snap = await loadFinance(userId);
  if (!snap) {
    return;
  }
  const categoryAmounts = (snap.categoryAmounts ?? defaultCategoryAmounts()).map((row) =>
    row.title === payload.title ? { ...row, amount: payload.amount } : row,
  );
  await saveFinance(userId, { ...snap, categoryAmounts });
}

async function applyManagerStoreCommissions(
  userId: number,
  payload: ManagerStoreCommissionsOutboxPayload,
): Promise<void> {
  await saveSyncCache(userId, 'managerStoreCommissions', payload.items);
}

async function applyAcquiringProfiles(
  userId: number,
  payload: AcquiringProfilesOutboxPayload,
): Promise<void> {
  const { normalizeAcquiringProfiles } = await import('../../acquiring/acquiringConfig');
  const existing = await loadSyncCache<Array<{ id: string; percent: number; label?: string; storeNames?: string[] }>>(
    userId,
    'acquiringProfiles',
  );
  const byId = new Map(existing?.map((row) => [row.id, row]) ?? []);
  const mergedInput = payload.profiles.map((row) => {
    const prev = byId.get(row.id);
    return {
      id: row.id,
      percent: row.percent,
      label: prev?.label,
      storeNames: prev?.storeNames,
    };
  });
  await saveSyncCache(userId, 'acquiringProfiles', normalizeAcquiringProfiles(mergedInput));
}

async function applyProcurementCosts(
  userId: number,
  payload: ProcurementCostsOutboxPayload,
): Promise<void> {
  await saveSyncCache(userId, 'procurementCosts', payload.items);
}

async function applyManagerPlans(
  userId: number,
  payload: ManagerRevenuePlansPayload,
): Promise<void> {
  const plans: StoreRevenuePlanRow[] = payload.items.map((item) => ({
    dayKey: payload.dayKey,
    storeName: item.storeName,
    planRevenue: item.planRevenue,
  }));
  await patchRevenuePlansCache(userId, payload.dayKey, plans);
}

async function applySetPercent(userId: number, payload: DirectorSetPercentPayload): Promise<void> {
  const sellers = (await loadSyncCache<SellerLike[]>(userId, 'sellers')) ?? [];
  await saveSyncCache(
    userId,
    'sellers',
    sellers.map((s) =>
      s.id === payload.sellerId ? { ...s, ratePercent: payload.ratePercent } : s,
    ),
  );
}
