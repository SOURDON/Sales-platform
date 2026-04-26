import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './App.css';

/** Календарный день в Europe/Moscow (как на backend для смен), YYYY-MM-DD */
function calendarDayKeyMoscow(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function todayKeyMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const base = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(base.getTime())) {
    return dayKey;
  }
  base.setDate(base.getDate() + deltaDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

/** Согласовано с backend AuthService.normProcurementKey — для Σ(себестоимость × qty) в отчёте. */
function normProcurementKey(raw: string): string {
  return String(raw).normalize('NFC').trim().replace(/\s+/g, ' ');
}

const DETKOV_ACQUIRING_STORES = new Set(
  ['Центр тех. зона', 'Центр пляж', 'Дельфин Тех.зона'].map((name) =>
    name.toLocaleLowerCase('ru-RU').trim(),
  ),
);

function isDetkovAcquiringStore(storeName: string): boolean {
  return DETKOV_ACQUIRING_STORES.has(String(storeName).toLocaleLowerCase('ru-RU').trim());
}

function parseGoodsCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.').trim());
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

/**
 * Сводка для админа на «Главной» считается на клиенте (продавцы, продажи, смены),
 * чтобы UI совпадал с запросом даже при старом ответе /dashboard/overview на сервере.
 */
function buildAdminHomeDashboard(
  api: DashboardResponse,
  storeName: string,
  sellers: SellerProfile[],
  sales: AdminSale[],
  shifts: ShiftInfo[],
): DashboardResponse {
  const storeSellers = sellers.filter((s) => s.storeName === storeName);
  const sellerIds = new Set(storeSellers.map((s) => s.id));
  const today = todayKeyMoscow();

  let storeRevenue = 0;
  let storeSalaries = 0;
  for (const s of storeSellers) {
    storeRevenue += s.salesAmount;
    storeSalaries += s.commissionAmount;
  }

  let payCash = 0;
  let payAcquiring = 0;
  let payTransfer = 0;
  for (const sale of sales) {
    if (!sellerIds.has(sale.sellerId)) {
      continue;
    }
    if (calendarDayKeyMoscow(sale.createdAt) !== today) {
      continue;
    }
    if (sale.paymentType === 'TRANSFER') {
      payTransfer += sale.totalAmount;
    } else if (sale.paymentType === 'NON_CASH') {
      payAcquiring += sale.totalAmount;
    } else {
      payCash += sale.totalAmount;
    }
  }

  const openShiftsForStore = shifts.filter(
    (sh) => sh.status === 'OPEN' && sh.assignedSellerIds.some((id) => sellerIds.has(id)),
  ).length;

  const metrics = [
    { label: 'Продажи (точка)', value: formatRub(storeRevenue) },
    { label: 'Открытые смены (точка)', value: String(openShiftsForStore) },
  ];

  const stores: DashboardResponse['stores'] = [
    {
      name: storeName,
      revenue: formatRub(storeRevenue),
      salaries: formatRub(storeSalaries),
      cash: formatRub(payCash),
      acquiring: formatRub(payAcquiring),
      transfer: formatRub(payTransfer),
    },
  ];

  const sellerRegister = [...storeSellers]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'))
    .map((s) => ({
      fullName: s.fullName,
      salary: formatRub(s.commissionAmount),
    }));

  return {
    ...api,
    title: storeName,
    metrics,
    stores,
    sellerRegister,
    writeOffs: undefined,
  };
}

type LoginResponse = {
  token: string;
  user: {
    id: number;
    nickname: string;
    fullName: string;
    role: 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT';
    storeName: string;
  };
};

type DashboardResponse = {
  role: 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT';
  sellerDataManagedByAdmin: boolean;
  title: string;
  metrics: Array<{ label: string; value: string }>;
  stores: Array<{
    name: string;
    revenue: string;
    salaries: string;
    cash?: string;
    acquiring?: string;
    transfer?: string;
  }>;
  writeOffs?: Array<{
    id: string;
    createdAt: string;
    name: string;
    qty: number;
    reason: 'Брак' | 'Поломка';
  }>;
  sellerRegister?: Array<{ fullName: string; salary: string }>;
};

type SellerProfile = {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
  salesAmount: number;
  checksCount: number;
  commissionAmount: number;
};

type CommissionRequest = {
  id: string;
  createdAt: string;
  sellerId: number;
  requestedByNickname: string;
  requestedPercent: number;
  previousPercent: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment?: string;
};

type ProductItem = { name: string; price: number };
type ProductProcurementCost = { name: string; cost: number };
type StoreRevenuePlan = { dayKey: string; storeName: string; planRevenue: number };
type AddSalePaymentType = 'CASH' | 'NON_CASH' | 'TRANSFER';

type AdminSale = {
  id: string;
  createdAt: string;
  sellerName: string;
  sellerId: number;
  totalAmount: number;
  units: number;
  items: Array<{ name: string; qty: number }>;
  paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER';
  /** Себестоимость по закупкам, считает backend (₽). */
  goodsCost?: number;
};

type ShiftInfo = {
  id: string;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  assignedSellerIds: number[];
  checksCount: number;
  itemsCount: number;
  status: 'OPEN' | 'CLOSED';
};

type CashDisciplineEvent = {
  id: string;
  createdAt: string;
  type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT';
  comment: string;
  createdBy: string;
};

type StaffMember = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
};

type GlobalEmployee = {
  id: number;
  fullName: string;
  nickname: string;
  homeStore: string;
  isActive: boolean;
};

type ThresholdNotification = {
  id: string;
  type: 'LOW_STOCK' | 'HIGH_DAMAGE_WRITE_OFF' | 'NO_SALES';
  message: string;
  createdAt: string;
};

type AuditLogItem = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  details: string;
};

type FinanceAccount = {
  id: string;
  name: string;
  kind: 'CASH' | 'BANK';
  balance: number;
};

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

type FinanceOpsSnapshot = {
  accounts: FinanceAccount[];
  expenses: FinanceExpense[];
  incomes: FinanceIncome[];
  totals: {
    cash: number;
    bank: number;
    balance: number;
    expenses: number;
    incomes: number;
  };
};

/** Backend base URL. In production builds, only VITE_API_URL (set at build time in Vercel) is used. */
const API_BASE_URL = (() => {
  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    if (typeof window !== 'undefined') {
      return `http://${window.location.hostname}:3000`;
    }
    return 'http://localhost:3000';
  }
  return '';
})();

const API_CONFIG_ERROR =
  !import.meta.env.DEV && !API_BASE_URL
    ? 'Сборка без адреса API: в Vercel добавьте переменную VITE_API_URL = https://… (URL backend на Render) и сделайте Redeploy.'
    : '';

function navTabClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'ghost navActive' : 'ghost';
}

type MobileNavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
};

function DockIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="dockIcon">
      {children}
    </span>
  );
}

function HomeIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <path
          d="M4 10.5L12 4l8 6.5M7.5 9.8V20h9V9.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </DockIcon>
  );
}

function ShiftIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 7.9v4.4l3 1.9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </DockIcon>
  );
}

function SalesIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <path
          d="M8.1 15.8c.8 1 2 1.5 3.5 1.5 1.8 0 3.2-1 3.2-2.5 0-1.6-1.5-2.2-3.2-2.7-1.8-.5-3.2-1.1-3.2-2.8 0-1.4 1.3-2.4 3.2-2.4 1.3 0 2.4.5 3.1 1.3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M11.6 5.1v13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </DockIcon>
  );
}

function TeamIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <circle cx="8.1" cy="9.1" r="2.3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="15.9" cy="9.1" r="2.3" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M4.2 17.8c.6-1.9 2.3-3.2 4.4-3.2 2 0 3.7 1.2 4.4 3M11 17.6c.6-1.7 2.2-2.9 4.1-2.9 1.9 0 3.5 1.2 4.2 3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </DockIcon>
  );
}

function ControlIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <path
          d="M12 4.6l5.7 2.1v4.6c0 3.2-2.1 6.1-5.7 7.6-3.6-1.5-5.7-4.4-5.7-7.6V6.7L12 4.6z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.4 11.8l2 2 3.4-3.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </DockIcon>
  );
}

function App() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [sellers, setSellers] = useState<SellerProfile[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productProcurementCosts, setProductProcurementCosts] = useState<ProductProcurementCost[]>([]);
  const [sales, setSales] = useState<AdminSale[]>([]);
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequest[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [cashEvents, setCashEvents] = useState<CashDisciplineEvent[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployee[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdNotification[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogItem[]>([]);
  const [adminError, setAdminError] = useState('');
  const [acquiringPercent, setAcquiringPercent] = useState('1.8');
  const [acquiringPercentDetkov, setAcquiringPercentDetkov] = useState('1.8');
  const [financeOps, setFinanceOps] = useState<FinanceOpsSnapshot>({
    accounts: [],
    expenses: [],
    incomes: [],
    totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
  });

  const homeDashboard = useMemo((): DashboardResponse | null => {
    if (!dashboard || !session) {
      return null;
    }
    if (session.user.role === 'ADMIN') {
      return buildAdminHomeDashboard(
        dashboard,
        session.user.storeName,
        sellers,
        sales,
        shifts,
      );
    }
    return dashboard;
  }, [dashboard, session, sellers, sales, shifts]);

  const loadDashboard = async (token: string) => {
    setDashboardLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Dashboard error');
      }

      const data = (await response.json()) as DashboardResponse;
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadSellers = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/sellers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error('sellers error');
      }
      const data = (await response.json()) as SellerProfile[];
      setSellers(data);
      setAdminError('');
    } catch {
      setSellers([]);
      setAdminError('Не удалось загрузить продавцов.');
    }
  };

  const loadProducts = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/products`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('products error');
    }
    const data = (await response.json()) as ProductItem[];
    setProducts(data);
  };

  const loadProductProcurementCosts = useCallback(async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('procurement costs error');
    }
    setProductProcurementCosts((await response.json()) as ProductProcurementCost[]);
  }, []);

  const saveProductProcurementCosts = async (
    token: string,
    items: Array<{ name: string; cost: number }>,
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) {
      throw new Error('save procurement costs error');
    }
    await loadProductProcurementCosts(token);
    await loadSales(token);
  };

  const loadRevenuePlans = async (token: string, dayKey: string) => {
    const response = await fetch(
      `${API_BASE_URL}/admin/revenue-plans?dayKey=${encodeURIComponent(dayKey)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error('load revenue plans error');
    }
    return (await response.json()) as StoreRevenuePlan[];
  };

  const saveRevenuePlans = async (
    token: string,
    dayKey: string,
    items: Array<{ storeName: string; planRevenue: number }>,
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/revenue-plans`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dayKey, items }),
    });
    if (!response.ok) {
      throw new Error('save revenue plans error');
    }
    return (await response.json()) as StoreRevenuePlan[];
  };

  const loadAcquiringPercent = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/acquiring-percent`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('acquiring percent error');
    }
    const data = (await response.json()) as { percent: number; detkovPercent?: number };
    setAcquiringPercent(String(data.percent));
    setAcquiringPercentDetkov(
      String(Number.isFinite(data.detkovPercent) ? data.detkovPercent : data.percent),
    );
  };

  const saveAcquiringPercent = async (token: string, value: string) => {
    const num = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/acquiring-percent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ percent: num }),
    });
    if (!response.ok) {
      throw new Error('save acquiring percent error');
    }
    const data = (await response.json()) as { percent: number };
    setAcquiringPercent(String(data.percent));
  };

  const saveAcquiringPercentDetkov = async (token: string, value: string) => {
    const num = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/acquiring-percent/detkov`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ percent: num }),
    });
    if (!response.ok) {
      throw new Error('save detkov acquiring percent error');
    }
    const data = (await response.json()) as { percent: number };
    setAcquiringPercentDetkov(String(data.percent));
  };

  const loadFinanceOps = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/finance/ops`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('finance ops error');
    }
    const raw = (await response.json()) as Partial<FinanceOpsSnapshot>;
    setFinanceOps({
      accounts: raw.accounts ?? [],
      expenses: raw.expenses ?? [],
      incomes: raw.incomes ?? [],
      totals: {
        cash: raw.totals?.cash ?? 0,
        bank: raw.totals?.bank ?? 0,
        balance: raw.totals?.balance ?? 0,
        expenses: raw.totals?.expenses ?? 0,
        incomes: raw.totals?.incomes ?? 0,
      },
    });
  };

  const addFinanceIncome = async (
    token: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => {
    const num = Number(String(payload.amount).replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/finance/incomes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        accountId: payload.accountId,
        amount: num,
        workDay: payload.workDay,
        comment: payload.comment,
      }),
    });
    if (!response.ok) {
      throw new Error('add finance income error');
    }
    await loadFinanceOps(token);
  };

  const addFinanceExpense = async (
    token: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => {
    const amount = Number(String(payload.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/finance/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        accountId: payload.accountId,
        title: payload.title,
        amount,
        comment: payload.comment,
      }),
    });
    if (!response.ok) {
      throw new Error('add finance expense error');
    }
    await loadFinanceOps(token);
  };

  const setFinanceAccountBalance = async (token: string, accountId: string, balanceStr: string) => {
    const num = Number(String(balanceStr).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/finance/accounts/${encodeURIComponent(accountId)}/balance`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ balance: num }),
    });
    if (!response.ok) {
      throw new Error('set finance account balance error');
    }
    await loadFinanceOps(token);
  };

  const loadSales = useCallback(async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/sales?ts=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('sales error');
    }
    const data = (await response.json()) as AdminSale[];
    setSales(data);
  }, []);

  const refreshFinanceInputs = useCallback(async () => {
    if (!session?.token) {
      return;
    }
    await Promise.all([loadSales(session.token), loadProductProcurementCosts(session.token)]);
  }, [session?.token, loadSales, loadProductProcurementCosts]);

  const loadCommissionRequests = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/commission-requests`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('requests error');
    }
    const data = (await response.json()) as CommissionRequest[];
    setCommissionRequests(data);
  };

  const loadShifts = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('shifts error');
    setShifts((await response.json()) as ShiftInfo[]);
  };

  const loadCashEvents = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/cash-discipline`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('cash events error');
    setCashEvents((await response.json()) as CashDisciplineEvent[]);
  };

  const loadStaff = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('staff error');
    setStaff((await response.json()) as StaffMember[]);
  };

  const loadGlobalEmployees = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/employees/global`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('global employees error');
    setGlobalEmployees((await response.json()) as GlobalEmployee[]);
  };

  const loadThresholds = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/notifications/thresholds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('thresholds error');
    setThresholds((await response.json()) as ThresholdNotification[]);
  };

  const loadAuditLog = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/audit-log`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('audit log error');
    setAuditLog((await response.json()) as AuditLogItem[]);
  };


  const setDirectorPercent = async (token: string, sellerId: number, ratePercent: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/sellers/percent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sellerId, ratePercent }),
    });
    if (!response.ok) {
      throw new Error('set percent error');
    }
    await loadSellers(token);
    await loadCommissionRequests(token);
  };

  const decideRequest = async (token: string, requestId: string, decision: 'APPROVE' | 'REJECT') => {
    const response = await fetch(
      `${API_BASE_URL}/director/commission-requests/${requestId}/decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision }),
      },
    );
    if (!response.ok) {
      throw new Error('decision error');
    }
    await loadSellers(token);
    await loadCommissionRequests(token);
  };

  const addSale = async (
    token: string,
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER',
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sellerId, items, totalAmount, paymentType }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = 'Не удалось сохранить продажу';
      try {
        const parsed = JSON.parse(text) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadSellers(token);
    await loadSales(token);
  };

  const addWriteOff = async (
    token: string,
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/write-offs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, qty, reason }),
    });
    if (!response.ok) {
      throw new Error('write-off error');
    }
    await loadDashboard(token);
  };

  const openShift = async (token: string, assignedSellerIds: number[]) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assignedSellerIds }),
    });
    if (!response.ok) throw new Error('open shift error');
    await loadShifts(token);
  };

  const closeShift = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('close shift error');
    await loadShifts(token);
  };

  const addCashEvent = async (
    token: string,
    type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT',
    comment: string,
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/cash-discipline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, comment }),
    });
    if (!response.ok) throw new Error('cash event error');
    await loadCashEvents(token);
  };

  const addStaffMember = async (token: string, fullName: string, nickname: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fullName, nickname }),
    });
    if (!response.ok) throw new Error('add staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const addStaffFromBase = async (token: string, employeeId: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/from-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId }),
    });
    if (!response.ok) throw new Error('add from base error');
    await loadStaff(token);
    await loadSellers(token);
  };

  const deactivateStaff = async (token: string, id: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/deactivate`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('deactivate staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const activateStaff = async (token: string, id: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/activate`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('activate staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const assignStaffToShift = async (token: string, id: number, shiftId: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/assign-shift`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shiftId }),
    });
    if (!response.ok) throw new Error('assign shift error');
    await loadStaff(token);
    await loadShifts(token);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!API_BASE_URL) {
      setError(API_CONFIG_ERROR || 'Адрес сервера не задан.');
      return;
    }
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nickname, password }),
      });

      if (!response.ok) {
        throw new Error('Неверный логин или пароль');
      }

      const data = (await response.json()) as LoginResponse;
      setSession(data);
      setPassword('');
      navigate('/home', { replace: true });
      await loadDashboard(data.token);
      if (data.user.role === 'ADMIN' || data.user.role === 'DIRECTOR' || data.user.role === 'ACCOUNTANT') {
        setAdminError('');
        try {
          await loadSellers(data.token);
          await loadProducts(data.token);
          await loadProductProcurementCosts(data.token);
          await loadSales(data.token);
          await loadCommissionRequests(data.token);
          await loadShifts(data.token);
          if (data.user.role === 'ADMIN') {
            await loadCashEvents(data.token);
            await loadThresholds(data.token);
            await loadAuditLog(data.token);
          } else {
            setCashEvents([]);
            setThresholds([]);
            setAuditLog([]);
          }
          if (data.user.role === 'DIRECTOR' || data.user.role === 'ACCOUNTANT') {
            try {
              await Promise.all([loadAcquiringPercent(data.token), loadFinanceOps(data.token)]);
            } catch {
              setAcquiringPercent('1.8');
              setAcquiringPercentDetkov('1.8');
              setFinanceOps({
                accounts: [],
                expenses: [],
                incomes: [],
                totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
              });
            }
          } else {
            setAcquiringPercent('1.8');
            setAcquiringPercentDetkov('1.8');
            setFinanceOps({
              accounts: [],
              expenses: [],
              incomes: [],
              totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
            });
          }
          await loadStaff(data.token);
          await loadGlobalEmployees(data.token);
        } catch {
          setSellers([]);
          setProducts([]);
          setSales([]);
          setProductProcurementCosts([]);
          setCommissionRequests([]);
          setShifts([]);
          setCashEvents([]);
          setStaff([]);
          setThresholds([]);
          setAuditLog([]);
          setAcquiringPercent('1.8');
          setAcquiringPercentDetkov('1.8');
          setFinanceOps({
            accounts: [],
            expenses: [],
            incomes: [],
            totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
          });
          setAdminError('Не удалось загрузить панель администратора.');
        }
      } else {
        setSellers([]);
        setProducts([]);
        setSales([]);
        setProductProcurementCosts([]);
        setCommissionRequests([]);
        setShifts([]);
        setCashEvents([]);
        setStaff([]);
        setThresholds([]);
        setAuditLog([]);
        setAcquiringPercent('1.8');
        setAcquiringPercentDetkov('1.8');
        setFinanceOps({
          accounts: [],
          expenses: [],
          incomes: [],
          totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
        });
      }
    } catch {
      setSession(null);
      setDashboard(null);
      setSellers([]);
      setProducts([]);
      setSales([]);
      setProductProcurementCosts([]);
      setCommissionRequests([]);
      setShifts([]);
      setCashEvents([]);
      setStaff([]);
      setGlobalEmployees([]);
      setThresholds([]);
      setAuditLog([]);
      setAcquiringPercent('1.8');
      setError(
        'Не удалось войти. Проверьте логин/пароль, что backend запущен, в Vercel задан VITE_API_URL (https://…), в Render у backend в CORS_ORIGIN — адрес фронта.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    setDashboard(null);
    setSellers([]);
    setProducts([]);
    setSales([]);
    setProductProcurementCosts([]);
    setCommissionRequests([]);
    setShifts([]);
    setCashEvents([]);
    setStaff([]);
    setThresholds([]);
    setAuditLog([]);
    setAcquiringPercent('1.8');
    setAcquiringPercentDetkov('1.8');
    setFinanceOps({
      accounts: [],
      expenses: [],
      incomes: [],
      totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
    });
    navigate('/', { replace: true });
  };

  if (!session) {
    return (
      <main className="app">
        <section className="card">
          <header className="brandHeader">
            <span className="badge">Геленджикская бухта</span>
            <h1>Фотографы</h1>
            <p className="subtitle">Авторизация в системе</p>
          </header>

          {API_CONFIG_ERROR ? (
            <p className="error" role="alert">
              {API_CONFIG_ERROR}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="form">
            <label>
              Никнейм
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Введите никнейм"
                required
              />
            </label>

            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Введите пароль"
                required
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button type="submit" className="primaryAction" disabled={loading}>
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>

          <div className="help">
            <p>Тестовые пользователи:</p>
            <ul>
              <li>
                <code>director / 123456</code> — директор, все 8 точек
              </li>
              <li>
                <code>buh / 123456</code> — бухгалтер, просмотр по всем точкам
              </li>
              <li>
                <code>admin1</code>…<code>admin8 / 123456</code> — по одной точке каждый
              </li>
              <li>
                <code>seller1</code>…<code>seller8 / 123456</code> — продавцы
              </li>
            </ul>
          </div>
        </section>
      </main>
    );
  }

  const role = session.user.role;
  const isSellerOnly = role === 'SELLER';
  const isReadOnlyObserver = role === 'ACCOUNTANT';
  const isFinanceViewer = role === 'ACCOUNTANT' || role === 'DIRECTOR';
  const shiftLabel = isFinanceViewer ? 'Оперативка' : 'Смена';
  const controlLabel = isReadOnlyObserver ? 'Отчёт' : 'Контроль';
  const mobileNavItems: MobileNavItem[] = isSellerOnly
    ? [
        { to: '/home', label: 'Главная', icon: <HomeIcon />, end: true },
        { to: '/shift', label: 'Смена', icon: <ShiftIcon /> },
      ]
    : [
        { to: '/home', label: 'Главная', icon: <HomeIcon />, end: true },
        { to: '/shift', label: shiftLabel, icon: <ShiftIcon /> },
        { to: '/sales', label: 'Продажи', icon: <SalesIcon /> },
        { to: '/team', label: 'Команда', icon: <TeamIcon /> },
        { to: '/control', label: controlLabel, icon: <ControlIcon /> },
      ];

  return (
    <main className="app appWorkspace">
      <section className="card cardWorkspace">
        <header className="brandHeader">
          <span className="badge">Геленджикская бухта</span>
          <h1>Фотографы</h1>
          <p className="subtitle">Рабочий стол</p>
        </header>

        <div className="quickNav desktopNav" role="tablist" aria-label="Разделы">
          <NavLink to="/home" className={navTabClass} end>
            Главная
          </NavLink>
          <NavLink to="/shift" className={navTabClass}>
            {shiftLabel}
          </NavLink>
          {!isSellerOnly && (
            <>
              <NavLink to="/sales" className={navTabClass}>
                Продажи
              </NavLink>
              <NavLink to="/team" className={navTabClass}>
                Команда
              </NavLink>
              <NavLink to="/control" className={navTabClass}>
                {controlLabel}
              </NavLink>
            </>
          )}
        </div>

        {adminError && <p className="error">{adminError}</p>}

        <div className="pageOutlet">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route
              path="/home"
              element={
                <div className="dashboard homeDashboard">
                  <div className="success homeProfileCard">
                    <h2>Профиль</h2>
                    <div className="homeProfileGrid">
                      <div className="homeProfileRow">
                        <span className="homeProfileKey">Пользователь</span>
                        <span className="homeProfileVal">{session.user.fullName}</span>
                      </div>
                      <div className="homeProfileRow">
                        <span className="homeProfileKey">Ник</span>
                        <span className="homeProfileVal">{session.user.nickname}</span>
                      </div>
                      <div className="homeProfileRow">
                        <span className="homeProfileKey">Роль</span>
                        <span className="homeProfileVal">{session.user.role}</span>
                      </div>
                      <div className="homeProfileRow">
                        <span className="homeProfileKey">Точка</span>
                        <span className="homeProfileVal">{session.user.storeName}</span>
                      </div>
                    </div>
                  </div>

                  <section className="sectionCard homePanelSection">
                    {dashboardLoading ? (
                      <p className="muted">Загружаем сводку...</p>
                    ) : (
                      homeDashboard && (
                        <>
                          {homeDashboard.sellerDataManagedByAdmin && homeDashboard.role !== 'ADMIN' && (
                            <p className="notice">Данные продавца заполняет администратор точки.</p>
                          )}
                          <h3 className="homePanelTitle">{homeDashboard.title}</h3>
                          <div className="metrics homeMetricsTight">
                            {homeDashboard.metrics
                              .filter(
                                (metric) =>
                                  homeDashboard.role !== 'ADMIN' ||
                                  !metric.label.toLowerCase().includes('чистая прибыль'),
                              )
                              .map((metric) => (
                                <article key={metric.label} className="metricCard">
                                  <p>{metric.label}</p>
                                  <strong>{metric.value}</strong>
                                </article>
                              ))}
                          </div>

                          <div className="homeStoresList">
                            {homeDashboard.stores.map((store) => (
                              <article key={store.name} className="homeStoreCard">
                                <h4 className="homeStoreCardTitle">{store.name}</h4>
                                <dl className="homeStoreDl">
                                  <div className="homeStoreRow">
                                    <dt>Выручка</dt>
                                    <dd>{store.revenue}</dd>
                                  </div>
                                  {homeDashboard.role === 'ADMIN' ? (
                                    <>
                                      <div className="homeStoreRow">
                                        <dt>Наличные</dt>
                                        <dd>{store.cash ?? '—'}</dd>
                                      </div>
                                      <div className="homeStoreRow">
                                        <dt>Эквайринг</dt>
                                        <dd>{store.acquiring ?? '—'}</dd>
                                      </div>
                                      <div className="homeStoreRow">
                                        <dt>Переводы</dt>
                                        <dd>{store.transfer ?? '—'}</dd>
                                      </div>
                                    </>
                                  ) : null}
                                  <div className="homeStoreRow homeStoreRowAccent">
                                    <dt>Затраты на зарплату</dt>
                                    <dd>{store.salaries}</dd>
                                  </div>
                                </dl>
                              </article>
                            ))}
                          </div>

                          {homeDashboard.role === 'ADMIN' ? (
                            <div className="adminSellerRegister">
                              <h4>Кассы сотрудников</h4>
                              <p className="adminSellerRegisterHint">Начислено за сегодня (к выплате)</p>
                              {homeDashboard.sellerRegister && homeDashboard.sellerRegister.length > 0 ? (
                                <ul>
                                  {homeDashboard.sellerRegister.map((row) => (
                                    <li key={row.fullName}>
                                      <span className="adminSellerRegisterName">{row.fullName}</span>
                                      <span className="adminSellerRegisterAmount">{row.salary}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="muted">Продавцы по точке ещё не привязаны — после добавления появятся зарплаты за сегодня.</p>
                              )}
                            </div>
                          ) : null}
                        </>
                      )
                    )}
                  </section>
                  <section className="sectionCard homeLogoutSection">
                    <button type="button" className="ghost homeLogoutButton" onClick={handleLogout}>
                      Выйти
                    </button>
                  </section>
                </div>
              }
            />
            <Route
              path="/shift"
              element={
                <div className="dashboard">
                  <section className="sectionCard">
                    {isFinanceViewer ? (
                      <FinanceOpsPanel
                        token={session.token}
                        isDirector={role === 'DIRECTOR'}
                        snapshot={financeOps}
                        onAddIncome={addFinanceIncome}
                        onAddExpense={addFinanceExpense}
                        onSetAccountBalance={setFinanceAccountBalance}
                      />
                    ) : (
                      <ShiftPanel
                        token={session.token}
                        sellers={sellers}
                        shifts={shifts}
                        readOnly={isReadOnlyObserver}
                        onOpen={openShift}
                        onClose={closeShift}
                      />
                    )}
                  </section>
                </div>
              }
            />
            <Route
              path="/sales"
              element={
                isSellerOnly ? (
                  <Navigate to="/home" replace />
                ) : (
                  <div className="dashboard">
                    {!isReadOnlyObserver && (
                      <>
                        {!isFinanceViewer && (
                          <>
                            <section className="sectionCard">
                              <AddSaleForm
                                sellers={(() => {
                                  const open = shifts.find((s) => s.status === 'OPEN');
                                  if (!open) {
                                    return [] as SellerProfile[];
                                  }
                                  return sellers.filter((x) => open.assignedSellerIds.includes(x.id));
                                })()}
                                hasOpenShift={shifts.some((s) => s.status === 'OPEN')}
                                products={products}
                                token={session.token}
                                onAddSale={addSale}
                              />
                            </section>
                            <section className="sectionCard">
                              <WriteOffForm
                                products={products}
                                token={session.token}
                                onAddWriteOff={addWriteOff}
                              />
                            </section>
                          </>
                        )}
                      </>
                    )}
                    {isFinanceViewer ? (
                      <section className="sectionCard">
                        <AccountantProcurementPanel
                          token={session.token}
                          products={products}
                          procurementCosts={productProcurementCosts}
                          acquiringPercent={acquiringPercent}
                          acquiringPercentDetkov={acquiringPercentDetkov}
                          onAcquiringPercentChange={setAcquiringPercent}
                          onAcquiringPercentDetkovChange={setAcquiringPercentDetkov}
                          onSaveAcquiringPercent={saveAcquiringPercent}
                          onSaveAcquiringPercentDetkov={saveAcquiringPercentDetkov}
                          onSave={saveProductProcurementCosts}
                        />
                      </section>
                    ) : (
                      <section className="sectionCard">
                        <div className="salesLog">
                          <h3>Недавние продажи</h3>
                          {sales.length === 0 ? (
                            <p className="muted">Пока нет внесенных продаж</p>
                          ) : (
                            <div className="salesList">
                              {sales.map((sale) => (
                                <article key={sale.id} className="saleItem">
                                  <p className="saleHeader">
                                    <strong>{new Date(sale.createdAt).toLocaleString('ru-RU')}</strong> –{' '}
                                    {sale.sellerName}
                                    <span className="salePay">
                                      {sale.paymentType === 'NON_CASH'
                                        ? 'Безнал'
                                        : sale.paymentType === 'TRANSFER'
                                          ? 'Перевод'
                                          : 'Наличные'}
                                    </span>
                                    <span className="saleTotal">
                                      Итог: {sale.totalAmount.toLocaleString('ru-RU')} ₽
                                    </span>
                                  </p>
                                  <ul>
                                    {sale.items.map((line) => (
                                      <li key={line.name}>
                                        {line.name} × {line.qty}
                                      </li>
                                    ))}
                                  </ul>
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                )
              }
            />
            <Route
              path="/team"
              element={
                isSellerOnly ? (
                  <Navigate to="/home" replace />
                ) : (
                  <div className="dashboard teamPage">
                    <section className="sectionCard teamPanelCard">
                      <StaffPanel
                        token={session.token}
                        staff={staff}
                        sellers={sellers}
                        globalEmployees={globalEmployees}
                        shifts={shifts}
                        role={role}
                        readOnly={isReadOnlyObserver}
                        onAdd={addStaffMember}
                        onAddFromBase={addStaffFromBase}
                        onDeactivate={deactivateStaff}
                        onActivate={activateStaff}
                        onAssignShift={assignStaffToShift}
                        onDirectorSetPercent={setDirectorPercent}
                      />
                    </section>
                    {role === 'DIRECTOR' && (
                      <section className="sectionCard">
                        <DirectorRequestList
                          requests={commissionRequests.filter((item) => item.status === 'PENDING')}
                          token={session.token}
                          onDecide={decideRequest}
                        />
                      </section>
                    )}
                  </div>
                )
              }
            />
            <Route
              path="/control"
              element={
                isSellerOnly ? (
                  <Navigate to="/home" replace />
                ) : (
                  <div className="dashboard">
                    {isFinanceViewer ? (
                      <>
                        <section className="sectionCard">
                          <FinanceReportPanel
                            token={session.token}
                            sales={sales}
                            sellers={sellers}
                            procurementCosts={productProcurementCosts}
                            role={role}
                            acquiringPercent={acquiringPercent}
                            acquiringPercentDetkov={acquiringPercentDetkov}
                            onRefreshFinanceInputs={refreshFinanceInputs}
                            onLoadPlans={loadRevenuePlans}
                            onSavePlans={saveRevenuePlans}
                          />
                        </section>
                      </>
                    ) : (
                      <>
                        <section className="sectionCard">
                          <CashDisciplinePanel
                            token={session.token}
                            events={cashEvents}
                            readOnly={isReadOnlyObserver}
                            onAdd={addCashEvent}
                          />
                        </section>
                        <section className="sectionCard">
                          <ThresholdPanel notifications={thresholds} />
                        </section>
                        <section className="sectionCard">
                          <AuditLogPanel items={auditLog} />
                        </section>
                      </>
                    )}
                  </div>
                )
              }
            />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </div>

      </section>
      <nav
        className="mobileDock"
        aria-label="Навигация по разделам"
        style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
      >
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={navTabClass}
            end={item.end}
            aria-label={item.label}
            title={item.label}
          >
            {item.icon}
          </NavLink>
        ))}
      </nav>
    </main>
  );
}

function AddSaleForm({
  sellers,
  hasOpenShift,
  products,
  token,
  onAddSale,
}: {
  sellers: SellerProfile[];
  hasOpenShift: boolean;
  products: ProductItem[];
  token: string;
  onAddSale: (
    token: string,
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER',
  ) => Promise<void>;
}) {
  const [sellerId, setSellerId] = useState(sellers[0]?.id ?? 0);
  const [paymentType, setPaymentType] = useState<AddSalePaymentType>('CASH');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [totalAmount, setTotalAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const resolvedSeller = sellers.find((s) => s.id === sellerId) ?? sellers[0] ?? null;
  const selectSellerId = resolvedSeller?.id ?? '';

  const updateQty = (name: string, value: string) => {
    setQty((current) => ({ ...current, [name]: value }));
  };

  const submit = async () => {
    if (!hasOpenShift) {
      setFormError('Сначала откройте смену в разделе «Смена».');
      return;
    }
    if (sellers.length === 0) {
      setFormError('В смене нет продавцов. В разделе «Смена» добавьте людей в текущую смену.');
      return;
    }
    if (!resolvedSeller) {
      setFormError('Выберите продавца');
      return;
    }
    const items = products
      .map((item) => ({
        name: item.name,
        qty: Number(qty[item.name] || 0) || 0,
      }))
      .filter((line) => line.qty > 0);
    if (items.length === 0) {
      setFormError('Укажите хотя бы одну позицию');
      return;
    }
    const parsedTotal = Number(totalAmount);
    if (!parsedTotal || parsedTotal <= 0) {
      setFormError('Укажите итоговую сумму продажи');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      await onAddSale(token, resolvedSeller.id, items, parsedTotal, paymentType);
      setQty({});
      setTotalAmount('');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addSaleForm">
      <h4>Добавить продажу</h4>
      <p className="hint">
        Продажа только для продавцов, назначенных на текущую смену. Укажите товары, сумму и вид оплаты.
      </p>
      {!hasOpenShift && (
        <p className="error" role="alert">
          Нет открытой смены — откройте её в разделе «Смена».
        </p>
      )}
      {hasOpenShift && sellers.length === 0 && (
        <p className="error" role="alert">
          В смене пока никого нет. В «Смене» нажмите «Добавить в смену» и отметьте продавцов.
        </p>
      )}
      <div className="addSaleRow">
        <label>
          Продавец
          <select
            value={selectSellerId}
            onChange={(event) => setSellerId(Number(event.target.value))}
            disabled={sellers.length === 0}
          >
            {sellers.length === 0 ? (
              <option value="">—</option>
            ) : (
              sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.fullName}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          Вид оплаты
          <select
            value={paymentType}
            onChange={(event) => setPaymentType(event.target.value as AddSalePaymentType)}
          >
            <option value="CASH">Наличные</option>
            <option value="NON_CASH">Безнал</option>
            <option value="TRANSFER">Перевод</option>
          </select>
        </label>
        <label>
          Итоговая сумма продажи (₽)
          <input
            inputMode="decimal"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
            placeholder="Например, 4250"
          />
        </label>
        <button
          className="primaryAction"
          type="button"
          onClick={submit}
          disabled={busy || !hasOpenShift || sellers.length === 0}
        >
          Сохранить продажу
        </button>
      </div>
      {formError && <p className="error">{formError}</p>}
      <div className="productGrid">
        {products.map((item) => (
          <label key={item.name} className="productCell">
            <div className="productName">{item.name}</div>
            <input
              inputMode="numeric"
              value={qty[item.name] ?? ''}
              onChange={(event) => updateQty(item.name, event.target.value)}
              placeholder="0"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function WriteOffForm({
  products,
  token,
  onAddWriteOff,
}: {
  products: ProductItem[];
  token: string;
  onAddWriteOff: (
    token: string,
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
  ) => Promise<void>;
}) {
  const [name, setName] = useState(products[0]?.name ?? '');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<'Брак' | 'Поломка'>('Брак');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async () => {
    if (!name) {
      setFormError('Выберите товар');
      return;
    }
    const parsedQty = Number(qty);
    if (!parsedQty || parsedQty <= 0) {
      setFormError('Введите корректное количество');
      return;
    }

    setFormError('');
    setBusy(true);
    try {
      await onAddWriteOff(token, name, parsedQty, reason);
      setQty('1');
    } catch {
      setFormError('Не удалось сохранить списание');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="writeOffForm">
      <h4>Списание товара (поштучно)</h4>
      <div className="writeOffRow">
        <label>
          Товар
          <select value={name} onChange={(event) => setName(event.target.value)}>
            {products.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Количество (шт.)
          <input
            inputMode="numeric"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </label>
        <label>
          Причина
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as 'Брак' | 'Поломка')}
          >
            <option value="Брак">Брак</option>
            <option value="Поломка">Поломка</option>
          </select>
        </label>
        <button className="primaryAction" type="button" onClick={submit} disabled={busy}>
          Списать
        </button>
      </div>
      {formError && <p className="error">{formError}</p>}
    </div>
  );
}

function FinanceOpsPanel({
  token,
  isDirector,
  snapshot,
  onAddIncome,
  onAddExpense,
  onSetAccountBalance,
}: {
  token: string;
  isDirector: boolean;
  snapshot: FinanceOpsSnapshot;
  onAddIncome: (
    token: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => Promise<void>;
  onAddExpense: (
    token: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => Promise<void>;
  onSetAccountBalance: (token: string, accountId: string, balance: string) => Promise<void>;
}) {
  const cashAccount = snapshot.accounts.find((a) => a.kind === 'CASH');
  const bankAccounts = snapshot.accounts.filter((a) => a.kind === 'BANK');
  const bankAccountsOrdered = useMemo(
    () =>
      [...bankAccounts].sort((a, b) => {
        const rank = (id: string) => {
          if (id === 'fa-bank-main') return 0;
          if (id === 'fa-bank-extra') return 1;
          return 10;
        };
        return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'ru-RU');
      }),
    [bankAccounts],
  );
  const [incomeWorkDay, setIncomeWorkDay] = useState(todayKeyMoscow());
  const [incomeAmountCash, setIncomeAmountCash] = useState('');
  const [incomeCommentCash, setIncomeCommentCash] = useState('');
  const [incomeBankDrafts, setIncomeBankDrafts] = useState<
    Record<string, { amount: string; comment: string }>
  >({});
  const [expenseAccountId, setExpenseAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseComment, setExpenseComment] = useState('');
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [balanceAdjustOpen, setBalanceAdjustOpen] = useState(false);
  const [adjustAccountId, setAdjustAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [adjustNewBalance, setAdjustNewBalance] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  useEffect(() => {
    if (snapshot.accounts.length === 0) {
      return;
    }
    if (!adjustAccountId || !snapshot.accounts.some((a) => a.id === adjustAccountId)) {
      setAdjustAccountId(snapshot.accounts[0]!.id);
    }
  }, [adjustAccountId, snapshot.accounts]);

  useEffect(() => {
    if (!expenseAccountId && snapshot.accounts.length > 0) {
      setExpenseAccountId(snapshot.accounts[0].id);
    }
  }, [expenseAccountId, snapshot.accounts]);

  useEffect(() => {
    if (bankAccounts.length === 0) {
      return;
    }
    setIncomeBankDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const b of bankAccounts) {
        if (next[b.id] === undefined) {
          next[b.id] = { amount: '', comment: '' };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bankAccounts]);

  const incomeSumByAccountId = useMemo(() => {
    const m = new Map<string, number>();
    for (const inc of snapshot.incomes ?? []) {
      m.set(inc.accountId, (m.get(inc.accountId) ?? 0) + inc.amount);
    }
    return m;
  }, [snapshot.incomes]);

  const accountsForIncomeHistory = useMemo(() => {
    const list: FinanceAccount[] = [];
    if (cashAccount) {
      list.push(cashAccount);
    }
    list.push(...bankAccountsOrdered);
    return list;
  }, [cashAccount, bankAccountsOrdered]);

  const fmt = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;
  const incomeTotal = snapshot.totals.incomes ?? 0;

  return (
    <div className="opsCard">
      <h4>Оперативные финансы</h4>
      <p className="hint">
        Баланс накапливается отдельно по каждому счёту. За рабочий день вносите приход в блоке «Наличка» или в блоке
        нужного расчётного счёта (деньги уходят в разные банки). Расходы уменьшают остаток на выбранном счёте.
      </p>
      <div className="metrics financeMetrics5">
        <article className="metricCard">
          <p>Наличка (остаток)</p>
          <strong>{fmt(snapshot.totals.cash)}</strong>
        </article>
        <article className="metricCard">
          <p>Р/с (всего на счетах)</p>
          <strong>{fmt(snapshot.totals.bank)}</strong>
        </article>
        <article className="metricCard">
          <p>Общий остаток</p>
          <strong>{fmt(snapshot.totals.balance)}</strong>
        </article>
        <article className="metricCard">
          <p>Учтено приходов (детализация)</p>
          <strong>{fmt(incomeTotal)}</strong>
          {accountsForIncomeHistory.length > 0 ? (
            <div className="incomeByAccountBreakdown" aria-label="Сумма приходов по счетам">
              {accountsForIncomeHistory.map((acc) => (
                <div key={acc.id}>
                  {acc.name}: {fmt(incomeSumByAccountId.get(acc.id) ?? 0)}
                </div>
              ))}
            </div>
          ) : null}
        </article>
        <article className="metricCard">
          <p>Всего расходов</p>
          <strong>{fmt(snapshot.totals.expenses)}</strong>
        </article>
      </div>

      <div className="addSaleForm">
        <h4>Записать приход за день</h4>
        <div className="inlineGrid">
          <label>
            Рабочий день (МСК) — для всех счетов в форме
            <input type="date" value={incomeWorkDay} onChange={(event) => setIncomeWorkDay(event.target.value)} />
          </label>
        </div>

        {cashAccount ? (
          <div className="incomeAccountBlock">
            <h5>Приход — {cashAccount.name}</h5>
            <div className="inlineGrid">
              <label>
                Сумма
                <input
                  value={incomeAmountCash}
                  onChange={(event) => setIncomeAmountCash(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                Комментарий
                <input value={incomeCommentCash} onChange={(event) => setIncomeCommentCash(event.target.value)} />
              </label>
            </div>
            <div className="inlineActions">
              <button
                type="button"
                className="primaryAction"
                disabled={busyId === `income-${cashAccount.id}`}
                onClick={async () => {
                  setError('');
                  setStatus('');
                  const n = Number(String(incomeAmountCash).replace(',', '.'));
                  if (!Number.isFinite(n) || n <= 0) {
                    setError('Укажите сумму прихода в наличку');
                    return;
                  }
                  setBusyId(`income-${cashAccount.id}`);
                  try {
                    await onAddIncome(token, {
                      accountId: cashAccount.id,
                      amount: incomeAmountCash,
                      workDay: incomeWorkDay,
                      comment: incomeCommentCash,
                    });
                    setIncomeAmountCash('');
                    setIncomeCommentCash('');
                    setStatus('Приход в наличку записан, баланс обновлён.');
                  } catch {
                    setError('Не удалось записать приход');
                  } finally {
                    setBusyId('');
                  }
                }}
              >
                Добавить приход (нал)
              </button>
            </div>
          </div>
        ) : null}

        {bankAccountsOrdered.map((b) => {
          const row = incomeBankDrafts[b.id] ?? { amount: '', comment: '' };
          return (
            <div className="incomeAccountBlock" key={b.id}>
              <h5>Приход — {b.name}</h5>
              <p className="muted incomeAccountHint">Безнал на этот расчётный счёт (отдельный банк / поток).</p>
              <div className="inlineGrid">
                <label>
                  Сумма
                  <input
                    value={row.amount}
                    onChange={(event) =>
                      setIncomeBankDrafts((prev) => ({
                        ...prev,
                        [b.id]: { ...row, amount: event.target.value },
                      }))
                    }
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Комментарий
                  <input
                    value={row.comment}
                    onChange={(event) =>
                      setIncomeBankDrafts((prev) => ({
                        ...prev,
                        [b.id]: { ...row, comment: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="inlineActions">
                <button
                  type="button"
                  className="primaryAction"
                  disabled={busyId === `income-${b.id}`}
                  onClick={async () => {
                    setError('');
                    setStatus('');
                    const n = Number(String(row.amount).replace(',', '.'));
                    if (!Number.isFinite(n) || n <= 0) {
                      setError(`Укажите сумму прихода для «${b.name}»`);
                      return;
                    }
                    setBusyId(`income-${b.id}`);
                    try {
                      await onAddIncome(token, {
                        accountId: b.id,
                        amount: row.amount,
                        workDay: incomeWorkDay,
                        comment: row.comment,
                      });
                      setIncomeBankDrafts((prev) => ({
                        ...prev,
                        [b.id]: { amount: '', comment: '' },
                      }));
                      setStatus(`Приход на «${b.name}» записан, баланс обновлён.`);
                    } catch {
                      setError('Не удалось записать приход');
                    } finally {
                      setBusyId('');
                    }
                  }}
                >
                  Добавить приход
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Счёт</th>
              <th>Тип</th>
              <th>Остаток (по приходам и расходам)</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td>{account.kind === 'CASH' ? 'Наличка' : 'Расчётный счёт'}</td>
                <td>
                  <strong>{fmt(account.balance)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDirector && (
        <div className="balanceAdjustBlock">
          <div className="inlineActions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setAdjustError('');
                setBalanceAdjustOpen((open) => {
                  if (open) {
                    return false;
                  }
                  const id = adjustAccountId || snapshot.accounts[0]?.id;
                  if (id) {
                    const acc = snapshot.accounts.find((a) => a.id === id);
                    if (acc) {
                      setAdjustNewBalance(String(acc.balance));
                    }
                    if (!adjustAccountId) {
                      setAdjustAccountId(id);
                    }
                  }
                  return true;
                });
              }}
            >
              {balanceAdjustOpen ? 'Скрыть корректировку' : 'Корректировка остатка'}
            </button>
          </div>
          {balanceAdjustOpen ? (
            <div className="addSaleForm">
              <p className="hint">
                Запишите фактический остаток по выбранному счёту. Событие попадает в журнал аудита.
              </p>
              <div className="inlineGrid">
                <label>
                  Счёт
                  <select
                    value={adjustAccountId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setAdjustAccountId(id);
                      const acc = snapshot.accounts.find((a) => a.id === id);
                      if (acc) {
                        setAdjustNewBalance(String(acc.balance));
                      }
                    }}
                  >
                    {snapshot.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Новый остаток, ₽
                  <input
                    value={adjustNewBalance}
                    onChange={(event) => setAdjustNewBalance(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className="inlineActions">
                <button
                  type="button"
                  className="primaryAction"
                  disabled={adjustBusy}
                  onClick={async () => {
                    if (!adjustAccountId) {
                      setAdjustError('Нет доступных счетов');
                      return;
                    }
                    setAdjustBusy(true);
                    setAdjustError('');
                    setStatus('');
                    try {
                      await onSetAccountBalance(token, adjustAccountId, adjustNewBalance);
                      setStatus('Остаток обновлён.');
                      setBalanceAdjustOpen(false);
                    } catch {
                      setAdjustError('Не удалось сохранить остаток. Нужны права директора.');
                    } finally {
                      setAdjustBusy(false);
                    }
                  }}
                >
                  Сохранить остаток
                </button>
              </div>
              {adjustError ? <p className="error">{adjustError}</p> : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="addSaleForm">
        <h4>Добавить расход</h4>
        <div className="inlineGrid">
          <label>
            Счёт списания
            <select value={expenseAccountId} onChange={(event) => setExpenseAccountId(event.target.value)}>
              {snapshot.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Статья расхода
            <input value={expenseTitle} onChange={(event) => setExpenseTitle(event.target.value)} />
          </label>
          <label>
            Сумма
            <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} />
          </label>
          <label>
            Комментарий
            <input value={expenseComment} onChange={(event) => setExpenseComment(event.target.value)} />
          </label>
        </div>
        <div className="inlineActions">
          <button
            type="button"
            className="primaryAction"
            disabled={busyId === 'expense'}
            onClick={async () => {
              setBusyId('expense');
              setError('');
              setStatus('');
              try {
                await onAddExpense(token, {
                  accountId: expenseAccountId,
                  title: expenseTitle,
                  amount: expenseAmount,
                  comment: expenseComment,
                });
                setExpenseTitle('');
                setExpenseAmount('');
                setExpenseComment('');
                setStatus('Расход добавлен.');
              } catch {
                setError('Не удалось добавить расход');
              } finally {
                setBusyId('');
              }
            }}
          >
            Добавить расход
          </button>
        </div>
      </div>

      {status && <p className="success">{status}</p>}
      {error && <p className="error">{error}</p>}

      <h4 className="financeSubheading">Последние приходы по счетам</h4>
      {accountsForIncomeHistory.length === 0 ? (
        <p className="muted">Счетов нет — приходы не настроены.</p>
      ) : (
        accountsForIncomeHistory.map((acc) => {
          const list = (snapshot.incomes ?? []).filter((item) => item.accountId === acc.id);
          return (
            <div className="incomeHistorySection" key={acc.id}>
              <h5 className="incomeHistoryHeading">{acc.name}</h5>
              <div className="opsList">
                {list.length === 0 ? (
                  <p className="muted">По этому счёту приходов пока нет.</p>
                ) : (
                  list.slice(0, 20).map((item) => (
                    <p key={item.id}>
                      День {item.workDay} | {fmt(item.amount)}
                      {item.comment ? ` | ${item.comment}` : ''}
                    </p>
                  ))
                )}
              </div>
            </div>
          );
        })
      )}

      <h4 className="financeSubheading">Последние расходы</h4>
      <div className="opsList">
        {snapshot.expenses.length === 0 ? (
          <p className="muted">Расходов пока нет.</p>
        ) : (
          snapshot.expenses.slice(0, 20).map((item) => (
            <p key={item.id}>
              {new Date(item.createdAt).toLocaleString('ru-RU')} | {item.title} | {fmt(item.amount)} |{' '}
              {item.accountName}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function ShiftPanel({
  token,
  sellers,
  shifts,
  readOnly,
  onOpen,
  onClose,
}: {
  token: string;
  sellers: SellerProfile[];
  shifts: ShiftInfo[];
  readOnly?: boolean;
  onOpen: (token: string, assignedSellerIds: number[]) => Promise<void>;
  onClose: (token: string) => Promise<void>;
}) {
  const [selectedSellerIds, setSelectedSellerIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const openShift = shifts.find((item) => item.status === 'OPEN');

  const toggleSeller = (id: number) => {
    setSelectedSellerIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div className="opsCard">
      <h4>Открытие/закрытие смены</h4>
      {readOnly && (
        <p className="notice">Роль «Бухгалтер»: только просмотр, без открытия и закрытия смен.</p>
      )}
      {openShift && !readOnly && (
        <p className="notice shiftNotice">
          Смена уже идёт. Отметьте ещё продавцов и нажмите «Добавить в смену» — все выбранные
          останутся на одной смене.
        </p>
      )}
      <div className="inlineGrid">
        {sellers.map((seller) => (
          <label key={seller.id}>
            <input
              type="checkbox"
              checked={selectedSellerIds.includes(seller.id)}
              onChange={() => toggleSeller(seller.id)}
              disabled={readOnly}
            />
            {seller.fullName}
            <span className="muted"> ({seller.storeName})</span>
          </label>
        ))}
      </div>
      <div className="inlineActions">
        <button
          className="primaryAction"
          type="button"
          disabled={busy || readOnly}
          onClick={async () => {
            setBusy(true);
            try {
              await onOpen(token, selectedSellerIds);
            } finally {
              setBusy(false);
            }
          }}
        >
          {openShift ? 'Добавить в смену' : 'Открыть смену'}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !openShift || readOnly}
          onClick={async () => {
            setBusy(true);
            try {
              await onClose(token);
            } finally {
              setBusy(false);
            }
          }}
        >
          Закрыть смену
        </button>
      </div>
      <div className="opsList">
        {shifts.map((shift) => (
          <p key={shift.id}>
            {shift.status} | Открыл: {shift.openedBy} | Закрыл: {shift.closedBy ?? '-'} | Чеки:{' '}
            {shift.checksCount} | Товары: {shift.itemsCount}
          </p>
        ))}
      </div>
    </div>
  );
}

function CashDisciplinePanel({
  token,
  events,
  readOnly,
  onAdd,
}: {
  token: string;
  events: CashDisciplineEvent[];
  readOnly?: boolean;
  onAdd: (
    token: string,
    type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT',
    comment: string,
  ) => Promise<void>;
}) {
  const [type, setType] = useState<'RETURN' | 'CANCEL' | 'ADJUSTMENT'>('RETURN');
  const [comment, setComment] = useState('');
  return (
    <div className="opsCard">
      <h4>Кассовая дисциплина</h4>
      {!readOnly && (
        <div className="inlineGrid">
          <label>
            Тип
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value as 'RETURN' | 'CANCEL' | 'ADJUSTMENT')
              }
            >
              <option value="RETURN">Возврат</option>
              <option value="CANCEL">Отмена</option>
              <option value="ADJUSTMENT">Корректировка</option>
            </select>
          </label>
          <label>
            Комментарий (обязательно)
            <input value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <button
            className="primaryAction"
            type="button"
            onClick={async () => {
              await onAdd(token, type, comment);
              setComment('');
            }}
          >
            Добавить
          </button>
        </div>
      )}
      <div className="opsList">
        {events.map((event) => (
          <p key={event.id}>
            {new Date(event.createdAt).toLocaleString('ru-RU')} | {event.type} | {event.comment} |{' '}
            {event.createdBy}
          </p>
        ))}
      </div>
    </div>
  );
}

function TeamMemberCard({
  token,
  member,
  seller,
  role,
  readOnly,
  openShiftId,
  onDeactivate,
  onActivate,
  onAssignShift,
  onDirectorSetPercent,
}: {
  token: string;
  member: StaffMember;
  seller?: SellerProfile;
  role: 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT';
  readOnly?: boolean;
  openShiftId?: string;
  onDeactivate: (token: string, id: number) => Promise<void>;
  onActivate: (token: string, id: number) => Promise<void>;
  onAssignShift: (token: string, id: number, shiftId: string) => Promise<void>;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const [newPercent, setNewPercent] = useState(String(seller?.ratePercent ?? 0));
  const [busy, setBusy] = useState(false);

  const applyDirector = async () => {
    if (!seller) {
      return;
    }
    setBusy(true);
    try {
      await onDirectorSetPercent(token, seller.id, Number(newPercent) || 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="teamMemberCard">
      <div className="teamMemberTop">
        <div>
          <p className="teamMemberName">
            <strong>{member.fullName}</strong>{' '}
            <span className="teamMemberNick">({member.nickname})</span>
          </p>
          <p className="teamMemberMeta">
            Смена: {member.assignedShiftId ?? '—'}
          </p>
        </div>
        <span
          className={member.isActive ? 'statusPill statusPillOn' : 'statusPill statusPillOff'}
        >
          {member.isActive ? 'Активен' : 'Отключён'}
        </span>
      </div>

      {!readOnly && (
        <div className="inlineActions teamMemberActions">
          <button
            type="button"
            className="ghost"
            disabled={!openShiftId}
            onClick={() => openShiftId && onAssignShift(token, member.id, openShiftId)}
          >
            <span className="btnTextFull">Назначить на открытую смену</span>
            <span className="btnTextShort">К смене</span>
          </button>
          {member.isActive ? (
            <button type="button" className="ghost" onClick={() => onDeactivate(token, member.id)}>
              <span className="btnTextFull">Деактивировать</span>
              <span className="btnTextShort">Откл.</span>
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => onActivate(token, member.id)}>
              Активировать
            </button>
          )}
        </div>
      )}

      {seller && (
        <div className="teamMemberStats">
          <div className="statCell">
            <span className="statLabel">Продажи</span>
            <span className="statValue">{seller.salesAmount.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="statCell">
            <span className="statLabel">Чеки</span>
            <span className="statValue">{seller.checksCount}</span>
          </div>
          <div className="statCell">
            <span className="statLabel">Начислено</span>
            <span className="statValue">{seller.commissionAmount.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="statCell">
            <span className="statLabel">% сейчас</span>
            <span className="statValue strong">{seller.ratePercent}%</span>
          </div>
        </div>
      )}

      {seller && role === 'DIRECTOR' && (
        <div className="directorPercent teamPercentEdit">
          <label>
            Новый % (директор)
            <input value={newPercent} onChange={(event) => setNewPercent(event.target.value)} />
          </label>
          <button className="primaryAction" type="button" onClick={applyDirector} disabled={busy}>
            OK
          </button>
        </div>
      )}

      {seller && (role === 'ADMIN' || role === 'ACCOUNTANT') && (
        <p className="hint teamHint">Процент меняет только директор (по согласованию).</p>
      )}

      {!seller && (
        <p className="hint teamHint">Нет профиля продавца — показатели появятся после синхронизации.</p>
      )}
    </article>
  );
}

function StaffPanel({
  token,
  staff,
  sellers,
  globalEmployees,
  shifts,
  role,
  readOnly,
  onAdd,
  onAddFromBase,
  onDeactivate,
  onActivate,
  onAssignShift,
  onDirectorSetPercent,
}: {
  token: string;
  staff: StaffMember[];
  sellers: SellerProfile[];
  globalEmployees: GlobalEmployee[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT';
  readOnly?: boolean;
  onAdd: (token: string, fullName: string, nickname: string) => Promise<void>;
  onAddFromBase: (token: string, employeeId: number) => Promise<void>;
  onDeactivate: (token: string, id: number) => Promise<void>;
  onActivate: (token: string, id: number) => Promise<void>;
  onAssignShift: (token: string, id: number, shiftId: string) => Promise<void>;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [pickedEmployeeId, setPickedEmployeeId] = useState<number | null>(null);
  const firstGlobalId = globalEmployees[0]?.id ?? 0;
  const selectedEmployeeId =
    pickedEmployeeId !== null && globalEmployees.some((employee) => employee.id === pickedEmployeeId)
      ? pickedEmployeeId
      : firstGlobalId;
  const staffIds = new Set(staff.map((member) => member.id));
  const selectedEmployee = globalEmployees.find((employee) => employee.id === selectedEmployeeId);
  const alreadyInStore = selectedEmployee ? staffIds.has(selectedEmployee.id) : false;
  const openShift = shifts.find((item) => item.status === 'OPEN');
  return (
    <div className="opsCard staffPanelRoot">
      <h4 className="staffPanelTitle">Управление персоналом</h4>
      <p className="staffPanelIntro">
        {readOnly
          ? 'Просмотр персонала и показателей (роль «Бухгалтер»).'
          : 'Добавьте сотрудника вручную или из общей базы. Ниже — карточки с действиями и показателями.'}
      </p>
      {!readOnly && (
        <>
          <div className="inlineGrid staffPanelAddRow">
            <label>
              ФИО
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Ник
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
            </label>
            <button
              className="primaryAction"
              type="button"
              onClick={async () => {
                await onAdd(token, fullName, nickname);
                setFullName('');
                setNickname('');
              }}
            >
              Добавить сотрудника
            </button>
          </div>
          <div className="inlineGrid inlineGridStaffBase staffBaseBlock">
            <label>
              Сотрудник из общей базы
              <select
                value={selectedEmployeeId}
                onChange={(event) => setPickedEmployeeId(Number(event.target.value))}
              >
                {globalEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} ({employee.nickname}) - {employee.homeStore}
                    {staffIds.has(employee.id) ? ' [уже в этой точке]' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primaryAction"
              type="button"
              disabled={!selectedEmployeeId || alreadyInStore}
              onClick={() => selectedEmployeeId && onAddFromBase(token, selectedEmployeeId)}
            >
              Добавить из общей базы
            </button>
            <p className="inlineStatus">{alreadyInStore ? 'Уже добавлен в эту точку' : ''}</p>
          </div>
        </>
      )}
      <div className="opsList teamRoster">
        {staff.map((member) => {
          const seller = sellers.find((item) => item.id === member.id);
          return (
            <TeamMemberCard
              key={seller ? `${member.id}-${seller.ratePercent}` : String(member.id)}
              token={token}
              member={member}
              seller={seller}
              role={role}
              readOnly={readOnly}
              openShiftId={openShift?.id}
              onDeactivate={onDeactivate}
              onActivate={onActivate}
              onAssignShift={onAssignShift}
              onDirectorSetPercent={onDirectorSetPercent}
            />
          );
        })}
      </div>
    </div>
  );
}

function ThresholdPanel({ notifications }: { notifications: ThresholdNotification[] }) {
  return (
    <div className="opsCard">
      <h4>Пороговые уведомления</h4>
      <div className="opsList">
        {notifications.length === 0 ? (
          <p>Нет активных уведомлений</p>
        ) : (
          notifications.map((item) => (
            <p key={item.id}>
              [{item.type}] {item.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function AccountantProcurementPanel({
  token,
  products,
  procurementCosts,
  acquiringPercent,
  acquiringPercentDetkov,
  onAcquiringPercentChange,
  onAcquiringPercentDetkovChange,
  onSaveAcquiringPercent,
  onSaveAcquiringPercentDetkov,
  onSave,
}: {
  token: string;
  products: ProductItem[];
  procurementCosts: ProductProcurementCost[];
  acquiringPercent: string;
  acquiringPercentDetkov: string;
  onAcquiringPercentChange: (value: string) => void;
  onAcquiringPercentDetkovChange: (value: string) => void;
  onSaveAcquiringPercent: (token: string, value: string) => Promise<void>;
  onSaveAcquiringPercentDetkov: (token: string, value: string) => Promise<void>;
  onSave: (token: string, items: Array<{ name: string; cost: number }>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [acquiringSaveError, setAcquiringSaveError] = useState('');
  const [acquiringDetkovSaveError, setAcquiringDetkovSaveError] = useState('');

  const byName = new Map(procurementCosts.map((item) => [item.name.trim(), item.cost]));
  const rows = products.map((item) => ({
    name: item.name,
    currentCost: byName.get(item.name.trim()) ?? 0,
  }));

  const save = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const payload = rows.map((row) => ({
        name: row.name,
        cost: Math.max(0, Number(draft[row.name] ?? row.currentCost) || 0),
      }));
      await onSave(token, payload);
      setStatus('Закупочные цены сохранены.');
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить закупочные цены');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="opsCard">
      <h4>Закупочные цены товаров (директор и бухгалтер)</h4>
      <p className="hint">Эти значения используются в расчёте затрат на товар и сохраняются на backend.</p>
      <div className="inlineGrid">
        <label>
          Эквайринг, %
          <input
            value={acquiringPercent}
            onChange={(event) => {
              setAcquiringSaveError('');
              onAcquiringPercentChange(event.target.value);
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              void (async () => {
                try {
                  await onSaveAcquiringPercent(token, value);
                } catch {
                  setAcquiringSaveError('Не удалось сохранить ставку эквайринга');
                }
              })();
            }}
            placeholder="Например 1.8"
          />
        </label>
        <label>
          Экварийнг Детков, %
          <input
            value={acquiringPercentDetkov}
            onChange={(event) => {
              setAcquiringDetkovSaveError('');
              onAcquiringPercentDetkovChange(event.target.value);
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              void (async () => {
                try {
                  await onSaveAcquiringPercentDetkov(token, value);
                } catch {
                  setAcquiringDetkovSaveError('Не удалось сохранить ставку Экварийнг Детков');
                }
              })();
            }}
            placeholder="Например 1.8"
          />
        </label>
      </div>
      {acquiringSaveError && <p className="error">{acquiringSaveError}</p>}
      {acquiringDetkovSaveError && <p className="error">{acquiringDetkovSaveError}</p>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Закупочная цена</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  <input
                    value={draft[row.name] ?? String(row.currentCost)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [row.name]: event.target.value,
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inlineActions">
        <button type="button" className="primaryAction" onClick={save} disabled={busy}>
          {busy ? 'Сохраняем...' : 'Сохранить закупочные цены'}
        </button>
      </div>
      {status && <p className="success">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function FinanceReportPanel({
  token,
  sales,
  sellers,
  procurementCosts,
  role,
  acquiringPercent,
  acquiringPercentDetkov,
  onRefreshFinanceInputs,
  onLoadPlans,
  onSavePlans,
}: {
  token: string;
  sales: AdminSale[];
  sellers: SellerProfile[];
  procurementCosts: ProductProcurementCost[];
  role: 'DIRECTOR' | 'ACCOUNTANT' | 'ADMIN' | 'SELLER';
  acquiringPercent: string;
  acquiringPercentDetkov: string;
  onRefreshFinanceInputs: () => Promise<void>;
  onLoadPlans: (token: string, dayKey: string) => Promise<StoreRevenuePlan[]>;
  onSavePlans: (
    token: string,
    dayKey: string,
    items: Array<{ storeName: string; planRevenue: number }>,
  ) => Promise<StoreRevenuePlan[]>;
}) {
  const [rangeFrom, setRangeFrom] = useState(todayKeyMoscow);
  const [rangeTo, setRangeTo] = useState(todayKeyMoscow);
  const fromDay = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
  const toDay = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
  const refreshFinanceRef = useRef(onRefreshFinanceInputs);
  refreshFinanceRef.current = onRefreshFinanceInputs;

  useEffect(() => {
    void refreshFinanceRef.current().catch(() => {
      /* ignore: родитель покажет ошибки при логине */
    });
  }, [token, rangeFrom, rangeTo]);
  const [plans, setPlans] = useState<StoreRevenuePlan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [plansBusy, setPlansBusy] = useState(false);
  const [plansStatus, setPlansStatus] = useState('');
  const [plansError, setPlansError] = useState('');
  const procurementByNormKey = new Map(
    procurementCosts.map((item) => [normProcurementKey(item.name), item.cost]),
  );
  const salesForDay = sales.filter((sale) => {
    const day = calendarDayKeyMoscow(sale.createdAt);
    return day >= fromDay && day <= toDay;
  });
  const planByStore = new Map(plans.map((item) => [item.storeName, item.planRevenue]));

  useEffect(() => {
    let disposed = false;
    setPlansError('');
    onLoadPlans(token, toDay)
      .then((items) => {
        if (disposed) {
          return;
        }
        setPlans(items);
      })
      .catch(() => {
        if (!disposed) {
          setPlansError('Не удалось загрузить план выручки');
        }
      });
    return () => {
      disposed = true;
    };
  }, [token, toDay]);

  const storeNames = Array.from(
    new Set([
      ...sellers.map((seller) => seller.storeName),
      ...sales
        .map((sale) => sellers.find((s) => s.id === sale.sellerId)?.storeName)
        .filter((name): name is string => Boolean(name)),
    ]),
  ).sort((a, b) => a.localeCompare(b, 'ru-RU'));

  const acquiringRateDefault = Math.max(0, Number(acquiringPercent) || 0);
  const acquiringRateDetkov = Math.max(0, Number(acquiringPercentDetkov) || 0);
  const rows = storeNames.map((storeName) => {
    const sellerIds = new Set(
      sellers.filter((seller) => seller.storeName === storeName).map((seller) => seller.id),
    );
    const storeSales = salesForDay.filter((sale) => sellerIds.has(sale.sellerId));
    const revenue = storeSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const nonCashRevenue = storeSales
      .filter((sale) => sale.paymentType === 'NON_CASH')
      .reduce((sum, sale) => sum + sale.totalAmount, 0);
    const transferRevenue = storeSales
      .filter((sale) => sale.paymentType === 'TRANSFER')
      .reduce((sum, sale) => sum + sale.totalAmount, 0);
    const cashRevenue = storeSales
      .filter((sale) => sale.paymentType !== 'NON_CASH' && sale.paymentType !== 'TRANSFER')
      .reduce((sum, sale) => sum + sale.totalAmount, 0);
    const acquiringRateForStore = isDetkovAcquiringStore(storeName)
      ? acquiringRateDetkov
      : acquiringRateDefault;
    const acquiringFee = (nonCashRevenue * acquiringRateForStore) / 100;
    const goodsSpent = storeSales.reduce((sum, sale) => {
      const fromApi = parseGoodsCost(sale.goodsCost);
      if (Number.isFinite(fromApi)) {
        return sum + fromApi;
      }
      return (
        sum +
        (sale.items ?? []).reduce(
          (lineSum, line) =>
            lineSum + (procurementByNormKey.get(normProcurementKey(String(line.name))) ?? 0) * line.qty,
          0,
        )
      );
    }, 0);
    const rateBySellerId = new Map(sellers.map((seller) => [seller.id, seller.ratePercent]));
    const salaries = storeSales.reduce(
      (sum, sale) => sum + (sale.totalAmount * (rateBySellerId.get(sale.sellerId) ?? 0)) / 100,
      0,
    );
    const profitWithoutGoods = revenue - salaries - acquiringFee;
    const profitWithGoods = revenue - salaries - acquiringFee - goodsSpent;

    return {
      storeName,
      revenue,
      cashRevenue,
      nonCashRevenue,
      transferRevenue,
      planRevenue: Math.max(0, Number(planDraft[storeName] ?? planByStore.get(storeName) ?? 0) || 0),
      goodsSpent,
      salaries,
      profitWithoutGoods,
      profitWithGoods,
      acquiringFee,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      cashRevenue: acc.cashRevenue + row.cashRevenue,
      nonCashRevenue: acc.nonCashRevenue + row.nonCashRevenue,
      transferRevenue: acc.transferRevenue + row.transferRevenue,
      planRevenue: acc.planRevenue + row.planRevenue,
      goodsSpent: acc.goodsSpent + row.goodsSpent,
      salaries: acc.salaries + row.salaries,
      profitWithoutGoods: acc.profitWithoutGoods + row.profitWithoutGoods,
      profitWithGoods: acc.profitWithGoods + row.profitWithGoods,
      acquiringFee: acc.acquiringFee + row.acquiringFee,
    }),
    {
      revenue: 0,
      cashRevenue: 0,
      nonCashRevenue: 0,
      transferRevenue: 0,
      planRevenue: 0,
      goodsSpent: 0,
      salaries: 0,
      profitWithoutGoods: 0,
      profitWithGoods: 0,
      acquiringFee: 0,
    },
  );

  const exportRows = rows.map((row) => ({
    Период: `${fromDay}..${toDay}`,
    Магазин: row.storeName,
    'План выручки': Math.round(row.planRevenue),
    'Факт выручки': Math.round(row.revenue),
    Наличные: Math.round(row.cashRevenue),
    Эквайринг: Math.round(row.nonCashRevenue),
    Переводы: Math.round(row.transferRevenue),
    'Отклонение (факт-план)': Math.round(row.revenue - row.planRevenue),
    'Затраты на товар': Math.round(row.goodsSpent),
    'К выплате зарплаты': Math.round(row.salaries),
    'Затраты на эквайринг': Math.round(row.acquiringFee),
    'Прибыль без товара': Math.round(row.profitWithoutGoods),
    'Прибыль с товаром': Math.round(row.profitWithGoods),
  }));

  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-report-${fromDay}_${toDay}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Отчет');
    XLSX.writeFile(wb, `finance-report-${fromDay}_${toDay}.xlsx`);
  };

  const savePlans = async () => {
    setPlansBusy(true);
    setPlansStatus('');
    setPlansError('');
    try {
      const payload = rows.map((row) => ({
        storeName: row.storeName,
        planRevenue: Math.max(0, Number(planDraft[row.storeName] ?? row.planRevenue) || 0),
      }));
      const updated = await onSavePlans(token, toDay, payload);
      setPlans(updated);
      setPlanDraft({});
      setPlansStatus('План выручки сохранен.');
    } catch {
      setPlansError('Не удалось сохранить план выручки');
    } finally {
      setPlansBusy(false);
    }
  };

  const applyRangePreset = (days: number) => {
    const to = todayKeyMoscow();
    const from = shiftDayKey(to, -(days - 1));
    setRangeFrom(from);
    setRangeTo(to);
  };

  return (
    <div className="opsCard">
      <h4>{role === 'DIRECTOR' ? 'Финансовый отчёт директора' : 'Полный отчёт по магазинам'}</h4>
      <p className="hint">
        Списания не учитываются в формулах прибыли: (1) Выручка - ЗП - Эквайринг; (2) Выручка - ЗП - Эквайринг - Товар.
        Продажи в отчёте считаются по выбранному
        диапазону дат (МСК). «Потрачено на товар» = по каждому чеку сумма (кол-во × закупочная цена за шт.) по всем
        позициям; если в чеке несколько товаров — складываются; по магазину за день — сумма по всем чекам. Закупки
        и эквайринг настраиваются на вкладке «Продажи».
      </p>
      <div className="inlineGrid financeRangeGrid">
        <label>
          Период с (МСК)
          <input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} />
        </label>
        <label>
          Период по (МСК)
          <input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} />
        </label>
      </div>
      <div className="inlineActions financeRangeActions">
        <button type="button" className="ghost" onClick={() => applyRangePreset(1)}>
          Сегодня
        </button>
        <button type="button" className="ghost" onClick={() => applyRangePreset(7)}>
          7 дней
        </button>
        <button type="button" className="ghost" onClick={() => applyRangePreset(30)}>
          30 дней
        </button>
        <p className="inlineStatus">Период отчёта: {fromDay} - {toDay}</p>
      </div>
      <div className="inlineActions">
        <button type="button" className="primaryAction" onClick={savePlans} disabled={plansBusy}>
          {plansBusy ? 'Сохраняем план...' : 'Сохранить план выручки'}
        </button>
        <button type="button" className="ghost" onClick={exportCsv}>
          Экспорт CSV
        </button>
        <button type="button" className="ghost" onClick={exportXlsx}>
          Экспорт XLSX
        </button>
      </div>
      {plansStatus && <p className="success">{plansStatus}</p>}
      {plansError && <p className="error">{plansError}</p>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Магазин</th>
              <th className="thPlan">План выручки</th>
              <th>Выручка</th>
              <th>Наличные</th>
              <th>Эквайринг</th>
              <th>Переводы</th>
              <th>Отклонение (факт-план)</th>
              <th>Потрачено на товар</th>
              <th>К выплате зарплаты</th>
              <th>Затраты на эквайринг</th>
              <th>Прибыль (выручка - ЗП - эквайринг)</th>
              <th>Прибыль (выручка - ЗП - эквайринг - товар)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.storeName}>
                <td>{row.storeName}</td>
                <td className="tdPlan">
                  <input
                    className="financeReportPlanInput"
                    value={planDraft[row.storeName] ?? String(row.planRevenue)}
                    onChange={(event) =>
                      setPlanDraft((current) => ({
                        ...current,
                        [row.storeName]: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>{row.revenue.toLocaleString('ru-RU')} ₽</td>
                <td>{row.cashRevenue.toLocaleString('ru-RU')} ₽</td>
                <td>{row.nonCashRevenue.toLocaleString('ru-RU')} ₽</td>
                <td>{row.transferRevenue.toLocaleString('ru-RU')} ₽</td>
                <td>{(row.revenue - row.planRevenue).toLocaleString('ru-RU')} ₽</td>
                <td>{row.goodsSpent.toLocaleString('ru-RU')} ₽</td>
                <td>{row.salaries.toLocaleString('ru-RU')} ₽</td>
                <td>{row.acquiringFee.toLocaleString('ru-RU')} ₽</td>
                <td>{row.profitWithoutGoods.toLocaleString('ru-RU')} ₽</td>
                <td>{row.profitWithGoods.toLocaleString('ru-RU')} ₽</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Итого</strong>
              </td>
              <td>
                <strong>{totals.planRevenue.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.revenue.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.cashRevenue.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.nonCashRevenue.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.transferRevenue.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{(totals.revenue - totals.planRevenue).toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.goodsSpent.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.salaries.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.acquiringFee.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.profitWithoutGoods.toLocaleString('ru-RU')} ₽</strong>
              </td>
              <td>
                <strong>{totals.profitWithGoods.toLocaleString('ru-RU')} ₽</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLogPanel({ items }: { items: AuditLogItem[] }) {
  return (
    <div className="opsCard">
      <h4>История действий (audit log)</h4>
      <div className="opsList">
        {items.map((item) => (
          <p key={item.id}>
            {new Date(item.createdAt).toLocaleString('ru-RU')} | {item.actor} | {item.action} | {item.details}
          </p>
        ))}
      </div>
    </div>
  );
}

function DirectorRequestList({
  requests,
  token,
  onDecide,
}: {
  requests: CommissionRequest[];
  token: string;
  onDecide: (token: string, id: string, decision: 'APPROVE' | 'REJECT') => Promise<void>;
}) {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="directorQueue">
      <h4>Заявки на смену процента</h4>
      {requests.map((request) => (
        <article key={request.id} className="requestCard">
          <p>
            <strong>{request.requestedByNickname}</strong> просит для продавца #{request.sellerId}: с{' '}
            {request.previousPercent}% на {request.requestedPercent}%
          </p>
          {request.comment && <p className="hint">Комментарий: {request.comment}</p>}
          <div className="requestActions">
            <button
              className="primaryAction"
              type="button"
              onClick={() => onDecide(token, request.id, 'APPROVE')}
            >
              Согласовать
            </button>
            <button type="button" className="ghost" onClick={() => onDecide(token, request.id, 'REJECT')}>
              Отклонить
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default App;
