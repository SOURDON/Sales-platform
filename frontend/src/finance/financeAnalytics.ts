import { ALL_DEMO_STORE_NAMES } from '../inventory/normalizeInventoryOverview';

export type StoreRentSettings = Record<string, number>;

const RENT_STORAGE_KEY = 'sales-platform-store-rent-v1';

/** Доля кассы (выручки), вычитаемая из чистой в аналитике. */
export const ANALYTICS_CASH_OVERHEAD_RATE = 0.16;
export const ANALYTICS_CASH_OVERHEAD_LABEL = '16%';

export function readStoreRentSettings(): StoreRentSettings {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(RENT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoreRentSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoreRentSettings(settings: StoreRentSettings): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(RENT_STORAGE_KEY, JSON.stringify(settings));
}

export function parseRub(value: string | number | undefined | null): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const n = Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export type FinanceAnalyticsPeriod = {
  from: string;
  to: string;
};

export type PaymentBreakdown = {
  cash: number;
  nonCash: number;
  transfer: number;
};

export type StoreAnalyticsRow = {
  storeName: string;
  revenue: number;
  payroll: number;
  acquiringEstimate: number;
  netProfit: number;
  /** Доля кассы, удерживаемая сверху чистой (сейчас 16%). */
  overheadCashPct: number;
  rentTotal: number;
  netAfterOverhead: number;
  paybackDays: number | null;
  paymentBreakdown: PaymentBreakdown;
};

export type FinanceAnalyticsSummary = {
  daysInPeriod: number;
  stores: StoreAnalyticsRow[];
  totals: Omit<StoreAnalyticsRow, 'storeName' | 'paybackDays'>;
};

type SaleLike = {
  sellerId: number;
  totalAmount: number;
  createdAt: string;
  paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER';
  pendingSync?: boolean;
};

type SellerLike = {
  id: number;
  storeName: string;
};

type FinanceExpenseLike = {
  title?: string;
  amount: number;
  comment?: string;
  createdAt: string;
  workDay?: string;
};

type FinanceIncomeLike = {
  amount: number;
  comment?: string;
  createdAt: string;
  workDay?: string;
  accountId?: string;
};

function dayKeyFromIso(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function inPeriod(dayKey: string, period: FinanceAnalyticsPeriod): boolean {
  return dayKey >= period.from && dayKey <= period.to;
}

function periodDayCount(period: FinanceAnalyticsPeriod): number {
  const from = new Date(`${period.from}T12:00:00`);
  const to = new Date(`${period.to}T12:00:00`);
  const diff = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return Math.max(1, diff);
}

function storeFromComment(comment?: string): string | null {
  const value = comment?.trim() ?? '';
  if (!value) {
    return null;
  }
  return (ALL_DEMO_STORE_NAMES as readonly string[]).includes(value) ? value : null;
}

function paymentBucket(type?: string): keyof PaymentBreakdown {
  if (type === 'NON_CASH') {
    return 'nonCash';
  }
  if (type === 'TRANSFER') {
    return 'transfer';
  }
  return 'cash';
}

export function computeFinanceAnalytics(input: {
  period: FinanceAnalyticsPeriod;
  storeFilter: string;
  sales: SaleLike[];
  sellers: SellerLike[];
  expenses: FinanceExpenseLike[];
  incomes: FinanceIncomeLike[];
  dashboardStores?: Array<{ name: string; revenue: string; salaries: string; cash?: string }>;
  rentSettings: StoreRentSettings;
  acquiringPercentEstimate?: number;
}): FinanceAnalyticsSummary {
  const sellerStore = new Map(input.sellers.map((s) => [s.id, s.storeName]));
  const storeNames =
    input.storeFilter === '__all__'
      ? [...ALL_DEMO_STORE_NAMES]
      : [input.storeFilter];
  const days = periodDayCount(input.period);
  const acqPct = (input.acquiringPercentEstimate ?? 1.8) / 100;

  const rows: StoreAnalyticsRow[] = storeNames.map((storeName) => {
    const paymentBreakdown: PaymentBreakdown = { cash: 0, nonCash: 0, transfer: 0 };
    let revenue = 0;

    for (const sale of input.sales) {
      const store = sellerStore.get(sale.sellerId);
      if (store !== storeName) {
        continue;
      }
      const day = dayKeyFromIso(sale.createdAt);
      if (!inPeriod(day, input.period)) {
        continue;
      }
      revenue += sale.totalAmount;
      paymentBreakdown[paymentBucket(sale.paymentType)] += sale.totalAmount;
    }

    const dashStore = input.dashboardStores?.find((s) => s.name === storeName);
    if (revenue === 0 && dashStore && input.period.to === input.period.from) {
      revenue = parseRub(dashStore.revenue);
    }

    let payroll = 0;
    for (const expense of input.expenses) {
      const day = expense.workDay ?? dayKeyFromIso(expense.createdAt);
      if (!inPeriod(day, input.period)) {
        continue;
      }
      const title = expense.title?.trim() ?? '';
      const store = title === 'ЗП' ? storeFromComment(expense.comment) : storeFromComment(expense.comment);
      if (title === 'ЗП' && store === storeName) {
        payroll += expense.amount;
      }
    }
    if (payroll === 0 && dashStore && input.period.to === input.period.from) {
      payroll = parseRub(dashStore.salaries);
    }

    for (const income of input.incomes) {
      const day = income.workDay ?? dayKeyFromIso(income.createdAt);
      if (!inPeriod(day, input.period)) {
        continue;
      }
      const store = storeFromComment(income.comment);
      if (store !== storeName) {
        continue;
      }
      revenue += income.amount;
      paymentBreakdown.cash += income.amount;
    }

    const acquiringEstimate = Math.round(paymentBreakdown.nonCash * acqPct);
    const netProfit = revenue - payroll - acquiringEstimate;
    const overheadCashPct = Math.round(revenue * ANALYTICS_CASH_OVERHEAD_RATE);
    const rentTotal = input.rentSettings[storeName] ?? 0;
    const netBeforeRent = netProfit - overheadCashPct;
    const netAfterOverhead = netBeforeRent - rentTotal;
    const dailyRecoverable = netBeforeRent / days;
    const paybackDays =
      rentTotal > 0 && dailyRecoverable > 0 ? Math.ceil(rentTotal / dailyRecoverable) : null;

    return {
      storeName,
      revenue,
      payroll,
      acquiringEstimate,
      netProfit,
      overheadCashPct,
      rentTotal,
      netAfterOverhead,
      paybackDays,
      paymentBreakdown,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      payroll: acc.payroll + row.payroll,
      acquiringEstimate: acc.acquiringEstimate + row.acquiringEstimate,
      netProfit: acc.netProfit + row.netProfit,
      overheadCashPct: acc.overheadCashPct + row.overheadCashPct,
      rentTotal: acc.rentTotal + row.rentTotal,
      netAfterOverhead: acc.netAfterOverhead + row.netAfterOverhead,
      paymentBreakdown: {
        cash: acc.paymentBreakdown.cash + row.paymentBreakdown.cash,
        nonCash: acc.paymentBreakdown.nonCash + row.paymentBreakdown.nonCash,
        transfer: acc.paymentBreakdown.transfer + row.paymentBreakdown.transfer,
      },
    }),
    {
      revenue: 0,
      payroll: 0,
      acquiringEstimate: 0,
      netProfit: 0,
      overheadCashPct: 0,
      rentTotal: 0,
      netAfterOverhead: 0,
      paymentBreakdown: { cash: 0, nonCash: 0, transfer: 0 },
    },
  );

  return { daysInPeriod: days, stores: rows, totals };
}

export function financeThroughputJuneStartKey(): string {
  const now = new Date();
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(now),
  );
  return `${year}-06-01`;
}

export function formatAnalyticsDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  if (!y || !m || !d) {
    return dayKey;
  }
  return `${d}.${m}.${y}`;
}
