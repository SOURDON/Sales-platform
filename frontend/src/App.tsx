import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, TouchEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './App.css';
import { appendOfflineSale, readOfflineQueue, writeOfflineQueue, type OfflineQueuedSale } from './offlineSalesQueue';

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

/** Точки со ставкой «Путинцев Сбербанк». Пока пусто — в отчёте везде ВТБ/Детков; добавьте `storeName.toLowerCase()` при необходимости. */
const PUTINTSEV_SBER_ACQUIRING_STORES = new Set<string>();

function isPutintsevSberAcquiringStore(storeName: string): boolean {
  return PUTINTSEV_SBER_ACQUIRING_STORES.has(String(storeName).toLocaleLowerCase('ru-RU').trim());
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

function managerIssueCategoryLabel(category: ManagerIssueCategory): string {
  switch (category) {
    case 'PERSONNEL':
      return 'Персонал';
    case 'INSPECTION':
      return 'Проверка';
    case 'GOODS':
      return 'Товар';
    case 'EQUIPMENT_BREAKDOWN':
      return 'Поломка техники';
    case 'NEEDS':
      return 'Что-то нужно';
    default:
      return category;
  }
}

type StaffPositionKind = 'SALES' | 'RETOUCHER';

type StaffMember = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
  storeName: string;
  /** Привязки к торговым точкам (из StoreStaffAssignment); если нет — fallback ниже. */
  assignedStores?: string[];
  staffPosition: StaffPositionKind;
  /** Доля от выручки точки за день (ретушёр); с бэкенда. */
  retoucherRatePercent?: number;
  /** Для ретушёра, ₽; с бэкенда. */
  earningsAmount: number;
};

/** Точки сотрудника; до выката API со старыми клиентами — по домашней точке из профиля. */
function staffAssignedStores(member: StaffMember): string[] {
  if (Array.isArray(member.assignedStores)) {
    return member.assignedStores;
  }
  return member.storeName ? [member.storeName] : [];
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
  staff: StaffMember[],
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
  const retoucherStaff = staff.filter(
    (m) => m.staffPosition === 'RETOUCHER' && m.storeName === storeName,
  );
  for (const r of retoucherStaff) {
    storeSalaries += Math.round(r.earningsAmount);
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
  for (const r of retoucherStaff) {
    sellerRegister.push({
      fullName: r.fullName,
      salary: formatRub(Math.round(r.earningsAmount)),
    });
  }
  sellerRegister.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

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
    role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
    storeName: string;
  };
};

type DashboardResponse = {
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
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
  /** Продажи за текущий «сегодня» по бизнес-логике recomputeSeller. */
  salesAmount: number;
  checksCount: number;
  commissionAmount: number;
  /** Сумма всех продаж по чекам продавца (за всё время). */
  lifetimeSalesAmount?: number;
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

type InventoryOverviewResponse = {
  warehouseKey: string;
  storeNames: string[];
  products: Array<{
    name: string;
    price: number;
    qtyWarehouse: number;
    qtyInStores: number;
    qtyGrandTotal: number;
  }>;
};

type StoreInventoryDetailResponse = {
  storeName: string;
  warehouseKey: string;
  products: Array<{
    name: string;
    price: number;
    qtyInStore: number;
    qtyOnWarehouse: number;
  }>;
};
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
  /** Локальная очередь без сети — отправится при восстановлении связи */
  pendingSync?: boolean;
};

type DirectorControlRequest = {
  id: string;
  createdAt: string;
  kind: 'SALE_DELETE' | 'WRITE_OFF';
  state: string;
  requestedByNickname: string;
  storeName: string;
  payload: Record<string, unknown>;
  summary: string;
};

type ManagerIssueCategory = 'PERSONNEL' | 'INSPECTION' | 'GOODS' | 'EQUIPMENT_BREAKDOWN' | 'NEEDS';

type ManagerIssue = {
  id: string;
  createdAt: string;
  storeName: string;
  createdByNickname: string;
  category: ManagerIssueCategory;
  message: string;
  status: 'NEW' | 'IN_PROGRESS' | 'DONE';
  startedAt?: string;
  startedBy?: string;
  completedAt?: string;
  completedBy?: string;
};

type MessengerThreadPreview = {
  threadKey: string;
  kind: 'general' | 'dm';
  title: string;
  peerNickname?: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastOutgoing: boolean;
  /** Кто отправил последнее сообщение (для второй строки, в стиле Telegram). */
  lastSenderLabel: string;
  unreadCount: number;
};

type MessengerInboxResponse = {
  threads: MessengerThreadPreview[];
  totalUnread: number;
};

type MessengerLine = {
  id: string;
  createdAt: string;
  body: string;
  senderLabel: string;
  authorNickname: string;
  outgoing: boolean;
};

function offlineQueueToAdminSales(queue: OfflineQueuedSale[], sellers: SellerProfile[]): AdminSale[] {
  return queue.map((q) => {
    const seller = sellers.find((s) => s.id === q.sellerId);
    const units = q.items.reduce((sum, line) => sum + line.qty, 0);
    return {
      id: q.saleId,
      createdAt: q.createdAt,
      sellerName: seller?.fullName ?? `Продавец #${q.sellerId}`,
      sellerId: q.sellerId,
      totalAmount: q.totalAmount,
      units,
      items: q.items,
      paymentType: q.paymentType,
      pendingSync: true,
    };
  });
}

function isLikelyOfflineFetchError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  return error instanceof TypeError;
}

/** Заработок ретушёра по точке: сумма по календарным дням (доля от выручки точки за каждый день). */
function retoucherEarnRubSnapshot(
  storeName: string,
  sellers: SellerProfile[],
  sales: AdminSale[],
  ratePercent: number,
  todayKey: string,
): { todayRub: number; lifetimeRub: number } {
  const sellerIds = new Set(sellers.filter((s) => s.storeName === storeName).map((s) => s.id));
  const revByDay = new Map<string, number>();
  for (const sale of sales) {
    if (!sellerIds.has(sale.sellerId)) {
      continue;
    }
    const day = calendarDayKeyMoscow(sale.createdAt);
    revByDay.set(day, (revByDay.get(day) ?? 0) + sale.totalAmount);
  }
  let lifetimeRub = 0;
  for (const rev of revByDay.values()) {
    lifetimeRub += Math.round((rev * ratePercent) / 100);
  }
  const todayRev = revByDay.get(todayKey) ?? 0;
  const todayRub = Math.round((todayRev * ratePercent) / 100);
  return { todayRub, lifetimeRub };
}

/** Σ продаж продавца по всем чекам (из API `lifetimeSalesAmount` или сумма snapshot). */
function sellerLifetimeSalesRub(seller: SellerProfile | undefined, sales: AdminSale[]): number {
  if (!seller) {
    return 0;
  }
  if (
    typeof seller.lifetimeSalesAmount === 'number' &&
    Number.isFinite(seller.lifetimeSalesAmount)
  ) {
    return seller.lifetimeSalesAmount;
  }
  const raw = sales
    .filter((sale) => sale.sellerId === seller.id)
    .reduce((acc, sale) => acc + sale.totalAmount, 0);
  return Math.round(raw * 100) / 100;
}

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

type GlobalEmployee = {
  id: number;
  fullName: string;
  nickname: string;
  homeStore: string;
  isActive: boolean;
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
  badge?: number;
};

const SESSION_STORAGE_KEY = 'sales-platform-session-v1';
const SESSION_PERSISTENCE_KEY = 'sales-platform-session-persistence-v1';

type SessionPersistence = 'local' | 'session';

function readStoredSession(): LoginResponse | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw =
      window.localStorage.getItem(SESSION_STORAGE_KEY) ??
      window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LoginResponse;
    if (!parsed?.token || !parsed?.user?.nickname) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readSessionPersistence(): SessionPersistence {
  if (typeof window === 'undefined') {
    return 'session';
  }
  return window.localStorage.getItem(SESSION_PERSISTENCE_KEY) === 'local' ? 'local' : 'session';
}

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

/** Иконка «конверт» для вкладки общего чата (точки, директор, управляющий). */
function OrgChatDockIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg">
        <path
          d="M4 7.4h16v10.2H4V7.4z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M4.4 7.8L12 12.9l7.6-5.1"
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
  const location = useLocation();
  const restoredSession = useMemo(() => readStoredSession(), []);
  const restoredPersistence = useMemo(() => readSessionPersistence(), []);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(restoredPersistence === 'local');
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState<LoginResponse | null>(restoredSession);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [sellers, setSellers] = useState<SellerProfile[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productProcurementCosts, setProductProcurementCosts] = useState<ProductProcurementCost[]>([]);
  const [sales, setSales] = useState<AdminSale[]>([]);
  const [offlineQueueTick, setOfflineQueueTick] = useState(0);
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequest[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployee[]>([]);
  const [adminError, setAdminError] = useState('');
  const [salesNotice, setSalesNotice] = useState('');
  const [managerIssues, setManagerIssues] = useState<ManagerIssue[]>([]);
  const [managerIssueNotice, setManagerIssueNotice] = useState('');
  const [teamDayKey, setTeamDayKey] = useState(todayKeyMoscow());
  const [acquiringPercent, setAcquiringPercent] = useState('1.8');
  const [acquiringPercentDetkov, setAcquiringPercentDetkov] = useState('1.8');
  const [acquiringPercentPutintsevSber, setAcquiringPercentPutintsevSber] = useState('1.8');
  const [salesExpanded, setSalesExpanded] = useState(false);
  const [financeOps, setFinanceOps] = useState<FinanceOpsSnapshot>({
    accounts: [],
    expenses: [],
    incomes: [],
    totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
  });
  const [inventoryOverview, setInventoryOverview] = useState<InventoryOverviewResponse | null>(null);
  const [storeInventory, setStoreInventory] = useState<StoreInventoryDetailResponse | null>(null);
  const [messengerInbox, setMessengerInbox] = useState<MessengerInboxResponse | null>(null);
  const [messengerUnreadTotal, setMessengerUnreadTotal] = useState(0);
  /** Открытый чат сохраняется при переходах по разделам; закрывается только «Назад» или выход. */
  const [messengerPersistThreadKey, setMessengerPersistThreadKey] = useState<string | null>(null);
  const [messengerPersistThreadTitle, setMessengerPersistThreadTitle] = useState('');

  const refreshMessengerInbox = useCallback(async () => {
    const token = session?.token;
    const r = session?.user?.role;
    if (!token || (r !== 'ADMIN' && r !== 'DIRECTOR' && r !== 'MANAGER')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/admin/chat/inbox`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as MessengerInboxResponse;
      setMessengerInbox(data);
      setMessengerUnreadTotal(typeof data.totalUnread === 'number' ? data.totalUnread : 0);
    } catch {
      /* ignore */
    }
  }, [session?.token, session?.user?.role]);

  useEffect(() => {
    if (!session?.token) {
      return;
    }
    const r = session.user.role;
    if (r !== 'ADMIN' && r !== 'DIRECTOR' && r !== 'MANAGER') {
      return;
    }
    void refreshMessengerInbox();
    const arm = () => {
      const ms =
        typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 45000 : 5500;
      return window.setInterval(() => void refreshMessengerInbox(), ms);
    };
    let intervalId = arm();
    const onVis = () => {
      window.clearInterval(intervalId);
      intervalId = arm();
      if (document.visibilityState === 'visible') {
        void refreshMessengerInbox();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(intervalId);
    };
  }, [session?.token, session?.user?.role, refreshMessengerInbox]);

  const pendingOfflineSales = useMemo(() => {
    if (!session?.user?.id) {
      return [] as AdminSale[];
    }
    return offlineQueueToAdminSales(readOfflineQueue(session.user.id), sellers);
  }, [session?.user?.id, sellers, offlineQueueTick]);

  const salesMerged = useMemo(
    () => [...sales, ...pendingOfflineSales],
    [sales, pendingOfflineSales],
  );

  const homeDashboard = useMemo((): DashboardResponse | null => {
    if (!dashboard || !session) {
      return null;
    }
    if (session.user.role === 'ADMIN') {
      return buildAdminHomeDashboard(
        dashboard,
        session.user.storeName,
        sellers,
        salesMerged,
        shifts,
        staff,
      );
    }
    return dashboard;
  }, [dashboard, session, sellers, salesMerged, shifts, staff]);

  const todayStoreSales = useMemo(() => {
    if (!session) {
      return [] as AdminSale[];
    }
    const todayKey = todayKeyMoscow();
    const currentStoreName = session.user.storeName;
    const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));
    return salesMerged.filter((sale) => {
      const saleStore = sellerStoreById.get(sale.sellerId);
      return saleStore === currentStoreName && calendarDayKeyMoscow(sale.createdAt) === todayKey;
    });
  }, [salesMerged, sellers, session]);

  const todaySoldProducts = useMemo(() => {
    if (!session) {
      return [] as Array<{ name: string; qty: number }>;
    }
    const todayKey = todayKeyMoscow();
    const currentStoreName = session.user.storeName;
    const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));
    const qtyByProduct = new Map<string, number>();
    for (const sale of salesMerged) {
      const saleStore = sellerStoreById.get(sale.sellerId);
      if (saleStore !== currentStoreName || calendarDayKeyMoscow(sale.createdAt) !== todayKey) {
        continue;
      }
      for (const line of sale.items) {
        qtyByProduct.set(line.name, (qtyByProduct.get(line.name) ?? 0) + line.qty);
      }
    }
    return Array.from(qtyByProduct.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ru-RU'));
  }, [salesMerged, sellers, session]);

  const directorCashflowPages = useMemo(() => {
    if (session?.user.role !== 'DIRECTOR') {
      return [] as Array<{ key: string; title: string; amount: number }>;
    }
    const todayKey = todayKeyMoscow();
    const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));

    const acquiringRateDefault = Math.max(0, Number(acquiringPercent) || 0);
    const acquiringRateDetkov = Math.max(0, Number(acquiringPercentDetkov) || 0);
    const acquiringRatePutintsevSber = Math.max(0, Number(acquiringPercentPutintsevSber) || 0);

    let rsDvtb = 0;
    let rsPvtb = 0;
    let rsPsber = 0;
    let cashTotal = 0;

    for (const sale of salesMerged) {
      if (calendarDayKeyMoscow(sale.createdAt) !== todayKey) {
        continue;
      }
      const storeName = sellerStoreById.get(sale.sellerId);
      if (!storeName) {
        continue;
      }
      if (sale.paymentType !== 'NON_CASH' && sale.paymentType !== 'TRANSFER') {
        cashTotal += sale.totalAmount;
        continue;
      }

      const isDetkov = isDetkovAcquiringStore(storeName);
      const isPutintsevSber = isPutintsevSberAcquiringStore(storeName);
      const rate = isDetkov ? acquiringRateDetkov : isPutintsevSber ? acquiringRatePutintsevSber : acquiringRateDefault;
      const netAmount =
        sale.paymentType === 'NON_CASH' ? sale.totalAmount - (sale.totalAmount * rate) / 100 : sale.totalAmount;

      if (isDetkov) {
        rsDvtb += netAmount;
      } else if (isPutintsevSber) {
        rsPsber += netAmount;
      } else {
        rsPvtb += netAmount;
      }
    }

    return [
      { key: 'rs-d-vtb', title: 'Р/с Д ВТБ', amount: Math.round(rsDvtb * 100) / 100 },
      { key: 'rs-p-vtb', title: 'Р/С П ВТБ', amount: Math.round(rsPvtb * 100) / 100 },
      { key: 'rs-p-sber', title: 'Р/с П СБЕР', amount: Math.round(rsPsber * 100) / 100 },
      { key: 'cash', title: 'Наличные', amount: Math.round(cashTotal * 100) / 100 },
    ];
  }, [
    acquiringPercent,
    acquiringPercentDetkov,
    acquiringPercentPutintsevSber,
    salesMerged,
    sellers,
    session?.user.role,
  ]);

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

  const loadInventoryOverview = useCallback(async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/inventory/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setInventoryOverview(null);
      return;
    }
    setInventoryOverview((await response.json()) as InventoryOverviewResponse);
  }, []);

  const loadStoreInventory = useCallback(async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/inventory/my-store`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setStoreInventory(null);
      return;
    }
    setStoreInventory((await response.json()) as StoreInventoryDetailResponse);
  }, []);

  const replenishWarehouse = async (token: string, name: string, qtyStr: string) => {
    const qty = Number(String(qtyStr).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Укажите количество больше нуля');
    }
    const response = await fetch(`${API_BASE_URL}/admin/inventory/warehouse/replenish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, qty }),
    });
    if (!response.ok) {
      throw new Error('Не удалось пополнить склад');
    }
    await loadInventoryOverview(token);
  };

  const transferFromWarehouseToStore = async (
    token: string,
    storeName: string,
    name: string,
    qtyStr: string,
  ) => {
    const qty = Number(String(qtyStr).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Укажите количество больше нуля');
    }
    const response = await fetch(`${API_BASE_URL}/admin/inventory/transfer-from-warehouse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ storeName, name, qty }),
    });
    if (!response.ok) {
      throw new Error('Не удалось принять товар со склада');
    }
    await loadStoreInventory(token);
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
    const data = (await response.json()) as {
      percent: number;
      detkovPercent?: number;
      putintsevSberPercent?: number;
    };
    setAcquiringPercent(String(data.percent));
    setAcquiringPercentDetkov(
      String(Number.isFinite(data.detkovPercent) ? data.detkovPercent : data.percent),
    );
    const putintsevSber =
      typeof data.putintsevSberPercent === 'number' && Number.isFinite(data.putintsevSberPercent)
        ? data.putintsevSberPercent
        : data.percent;
    setAcquiringPercentPutintsevSber(String(putintsevSber));
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

  const saveAcquiringPercentPutintsevSber = async (token: string, value: string) => {
    const num = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/acquiring-percent/putintsev-sber`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ percent: num }),
    });
    if (!response.ok) {
      throw new Error('save putintsev sber acquiring percent error');
    }
    const data = (await response.json()) as { percent: number };
    setAcquiringPercentPutintsevSber(String(data.percent));
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

  const flushOfflineSalesQueue = useCallback(async (token: string, userId: number) => {
    const queueBefore = readOfflineQueue(userId);
    if (queueBefore.length === 0) {
      return;
    }
    const remaining: OfflineQueuedSale[] = [];
    for (const entry of queueBefore) {
      try {
        const response = await fetch(`${API_BASE_URL}/admin/sales`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            sellerId: entry.sellerId,
            items: entry.items,
            totalAmount: entry.totalAmount,
            paymentType: entry.paymentType,
            saleId: entry.saleId,
          }),
        });
        if (!response.ok) {
          remaining.push(entry);
        }
      } catch {
        remaining.push(entry);
      }
    }
    writeOfflineQueue(userId, remaining);
    try {
      await loadSales(token);
      await loadSellers(token);
    } catch {
      // нет сети — очередь уже короче, продажи подтянутся при следующем онлайне
    }
    setOfflineQueueTick((x) => x + 1);
  }, [loadSales]);

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

  const loadManagerIssues = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/manager-issues`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('manager issues error');
    }
    setManagerIssues((await response.json()) as ManagerIssue[]);
  };

  const createManagerIssue = async (
    token: string,
    payload: { category: ManagerIssueCategory; message: string },
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/manager-issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = 'Не удалось отправить обращение';
      try {
        const parsed = (await response.json()) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadManagerIssues(token);
  };

  const startManagerIssue = async (token: string, issueId: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/manager-issues/${issueId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let message = 'Не удалось взять обращение в работу';
      try {
        const parsed = (await response.json()) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadManagerIssues(token);
  };

  const completeManagerIssue = async (token: string, issueId: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/manager-issues/${issueId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let message = 'Не удалось завершить обращение';
      try {
        const parsed = (await response.json()) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadManagerIssues(token);
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
    await loadStaff(token);
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
    const saleId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sellerId, items, totalAmount, paymentType, saleId }),
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
    } catch (error) {
      const uid = session?.user?.id;
      if (uid !== undefined && isLikelyOfflineFetchError(error)) {
        appendOfflineSale(uid, {
          saleId,
          sellerId,
          items,
          totalAmount,
          paymentType,
          createdAt: new Date().toISOString(),
        });
        setOfflineQueueTick((x) => x + 1);
        return;
      }
      throw error instanceof Error ? error : new Error('Не удалось сохранить продажу');
    }

    try {
      await loadSellers(token);
      await loadSales(token);
      if (session?.user.role === 'ADMIN') {
        await loadStoreInventory(token);
      }
    } catch {
      // продажа уже записана на сервере; список обновится при следующей загрузке или офлайн-синке
    }
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
      let message = 'Не удалось отправить заявку на списание';
      try {
        const parsed = (await response.json()) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadDashboard(token);
    if (session?.user.role === 'ADMIN') {
      await loadStoreInventory(token);
    }
  };

  const requestSaleDelete = async (token: string, saleId: string) => {
    setSalesNotice('');
    const response = await fetch(`${API_BASE_URL}/admin/sales/delete-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ saleId }),
    });
    if (!response.ok) {
      let message = 'Не удалось отправить запрос';
      try {
        const parsed = (await response.json()) as { message?: string | string[] };
        if (typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    await loadSales(token);
    await loadDashboard(token);
    setSalesNotice('Запрос на отмену продажи отправлен директору.');
  };

  const openShift = async (token: string, assignedSellerIds: number[]) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assignedSellerIds }),
    });
    if (!response.ok) throw new Error('open shift error');
    await Promise.all([loadShifts(token), loadStaff(token)]);
  };

  const closeShift = async (token: string, assignedSellerIds: number[] = []) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assignedSellerIds }),
    });
    if (!response.ok) throw new Error('close shift error');
    await Promise.all([loadShifts(token), loadStaff(token)]);
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

  const removeStaffFromStore = async (token: string, id: number, storeName?: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/remove-from-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storeName }),
    });
    if (!response.ok) throw new Error('remove staff from store error');
    await Promise.all([loadStaff(token), loadSellers(token), loadShifts(token), loadGlobalEmployees(token)]);
  };

  const restoreStaffToStore = async (token: string, staffId: number, storeName: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${staffId}/restore-to-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storeName }),
    });
    if (!response.ok) throw new Error('restore staff to store error');
    await Promise.all([loadStaff(token), loadSellers(token), loadShifts(token), loadGlobalEmployees(token)]);
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
      const loadDashboardWithRetry = async (token: string) => {
        try {
          await loadDashboard(token);
          return true;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          try {
            await loadDashboard(token);
            return true;
          } catch {
            return false;
          }
        }
      };

      const loginRequest = async (path = '/auth/login') => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15000);
        try {
          return await fetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nickname, password }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      let response: Response;
      try {
        response = await loginRequest();
      } catch {
        // Однократный повтор помогает при кратковременной сетевой просадке.
        response = await loginRequest();
      }

      if (!response.ok) {
        if (response.status === 404) {
          response = await loginRequest('/api/auth/login');
        }
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Неверный логин или пароль');
        }
        if (response.status === 404) {
          throw new Error(
            'Сервер авторизации недоступен (404). Проверьте VITE_API_URL и что backend запущен.',
          );
        }
        throw new Error(`Ошибка входа: ${response.status}`);
      }

      const data = (await response.json()) as LoginResponse;
      setSession(data);
      setPassword('');
      navigate('/home', { replace: true });
      const dashboardLoaded = await loadDashboardWithRetry(data.token);
      if (!dashboardLoaded) {
        setAdminError('Вход выполнен, но сводка загрузится с задержкой. Обновите страницу через пару секунд.');
      }
      if (
        data.user.role === 'ADMIN' ||
        data.user.role === 'DIRECTOR' ||
        data.user.role === 'ACCOUNTANT' ||
        data.user.role === 'MANAGER'
      ) {
        setAdminError('');
        const baseLoads = await Promise.allSettled([
          loadSellers(data.token),
          loadProducts(data.token),
          loadProductProcurementCosts(data.token),
          loadSales(data.token),
          loadCommissionRequests(data.token),
          loadShifts(data.token),
          loadStaff(data.token),
          loadGlobalEmployees(data.token),
          loadManagerIssues(data.token),
        ]);

        await Promise.allSettled([
          ...(data.user.role === 'DIRECTOR' || data.user.role === 'ACCOUNTANT'
            ? [loadInventoryOverview(data.token)]
            : []),
          ...(data.user.role === 'ADMIN' ? [loadStoreInventory(data.token)] : []),
        ]);

        if (data.user.role === 'DIRECTOR' || data.user.role === 'ACCOUNTANT') {
          const financeLoads = await Promise.allSettled([
            loadAcquiringPercent(data.token),
            loadFinanceOps(data.token),
          ]);
          const hasFinanceFailure = financeLoads.some((item) => item.status === 'rejected');
          if (hasFinanceFailure) {
            setAcquiringPercent('1.8');
            setAcquiringPercentDetkov('1.8');
            setAcquiringPercentPutintsevSber('1.8');
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
          setAcquiringPercentPutintsevSber('1.8');
          setFinanceOps({
            accounts: [],
            expenses: [],
            incomes: [],
            totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
          });
        }

        const hasBaseFailure = baseLoads.some((item) => item.status === 'rejected');
        if (hasBaseFailure) {
          setAdminError('Часть данных загрузилась с задержкой. Обновите страницу, если что-то не появилось.');
        }
      } else {
        setSellers([]);
        setProducts([]);
        setSales([]);
        setProductProcurementCosts([]);
        setCommissionRequests([]);
        setShifts([]);
        setStaff([]);
        setAcquiringPercent('1.8');
        setAcquiringPercentDetkov('1.8');
        setAcquiringPercentPutintsevSber('1.8');
        setFinanceOps({
          accounts: [],
          expenses: [],
          incomes: [],
          totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
        });
        setInventoryOverview(null);
        setStoreInventory(null);
      }
    } catch (e) {
      setSession(null);
      setDashboard(null);
      setSellers([]);
      setProducts([]);
      setSales([]);
      setProductProcurementCosts([]);
      setCommissionRequests([]);
      setShifts([]);
      setStaff([]);
      setGlobalEmployees([]);
      setAcquiringPercent('1.8');
      setAcquiringPercentDetkov('1.8');
      setAcquiringPercentPutintsevSber('1.8');
      setInventoryOverview(null);
      setStoreInventory(null);
      const errorText =
        e instanceof Error && e.message
          ? e.message
          : 'Не удалось войти. Проверьте логин/пароль, что backend запущен, в Vercel задан VITE_API_URL (https://…), в Render у backend в CORS_ORIGIN — адрес фронта.';
      setError(
        errorText,
      );
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_PERSISTENCE_KEY);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setSalesNotice('');
    setManagerIssues([]);
    setManagerIssueNotice('');
    setSession(null);
    setDashboard(null);
    setSellers([]);
    setProducts([]);
    setSales([]);
    setProductProcurementCosts([]);
    setCommissionRequests([]);
    setShifts([]);
    setStaff([]);
    setAcquiringPercent('1.8');
    setAcquiringPercentDetkov('1.8');
    setAcquiringPercentPutintsevSber('1.8');
    setFinanceOps({
      accounts: [],
      expenses: [],
      incomes: [],
      totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
    });
    setInventoryOverview(null);
    setStoreInventory(null);
    setMessengerInbox(null);
    setMessengerUnreadTotal(0);
    setMessengerPersistThreadKey(null);
    setMessengerPersistThreadTitle('');
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(SESSION_PERSISTENCE_KEY);
    navigate('/', { replace: true });
  };

  useEffect(() => {
    if (session) {
      const serialized = JSON.stringify(session);
      if (rememberMe) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, serialized);
        window.localStorage.setItem(SESSION_PERSISTENCE_KEY, 'local');
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
        window.localStorage.setItem(SESSION_PERSISTENCE_KEY, 'session');
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      return;
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, [rememberMe, session]);

  useEffect(() => {
    if (!session?.token || session.user.id == null) {
      return;
    }
    const token = session.token;
    const userId = session.user.id;
    const run = () => {
      void flushOfflineSalesQueue(token, userId);
    };
    run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [session?.token, session?.user?.id, flushOfflineSalesQueue]);

  useEffect(() => {
    if (!restoredSession || !session || restoredSession.token !== session.token) {
      return;
    }
    void (async () => {
      try {
        try {
          await loadDashboard(session.token);
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          await loadDashboard(session.token);
        }
        if (
          session.user.role === 'ADMIN' ||
          session.user.role === 'DIRECTOR' ||
          session.user.role === 'ACCOUNTANT' ||
          session.user.role === 'MANAGER'
        ) {
          await Promise.allSettled([
            loadSellers(session.token),
            loadProducts(session.token),
            loadProductProcurementCosts(session.token),
            loadSales(session.token),
            loadCommissionRequests(session.token),
            loadShifts(session.token),
            loadStaff(session.token),
            loadGlobalEmployees(session.token),
            loadManagerIssues(session.token),
          ]);
          await Promise.allSettled([
            ...(session.user.role === 'DIRECTOR' || session.user.role === 'ACCOUNTANT'
              ? [loadInventoryOverview(session.token)]
              : []),
            ...(session.user.role === 'ADMIN' ? [loadStoreInventory(session.token)] : []),
          ]);
        }
      } catch {
        setAdminError('Сессия восстановлена, но часть данных загрузится с задержкой.');
      }
    })();
  }, [loadInventoryOverview, loadProductProcurementCosts, loadStoreInventory, restoredSession, session]);

  useEffect(() => {
    if (!session?.token) {
      return;
    }
    const r = session.user.role;
    if ((r === 'DIRECTOR' || r === 'ACCOUNTANT') && location.pathname === '/sales') {
      void loadInventoryOverview(session.token);
    }
  }, [loadInventoryOverview, location.pathname, session]);

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    if (!session?.user) {
      return [];
    }
    const r = session.user.role;
    const retoucher = r === 'RETOUCHER';
    const sellerOnly = r === 'SELLER';
    const readOnlyObserver = r === 'ACCOUNTANT' || r === 'MANAGER';
    const financeViewer = r === 'ACCOUNTANT' || r === 'DIRECTOR' || r === 'MANAGER';
    const shiftL = financeViewer ? 'Оперативка' : 'Смена';
    const usesOrgChat = r === 'ADMIN' || r === 'DIRECTOR' || r === 'MANAGER';
    const controlL = usesOrgChat ? 'Чат' : readOnlyObserver ? 'Отчёт' : 'Контроль';
    const chatBadge =
      usesOrgChat && messengerUnreadTotal > 0 ? messengerUnreadTotal : undefined;
    if (retoucher) {
      return [{ to: '/home', label: 'Главная', icon: <HomeIcon />, end: true }];
    }
    if (sellerOnly) {
      return [
        { to: '/home', label: 'Главная', icon: <HomeIcon />, end: true },
        { to: '/shift', label: 'Смена', icon: <ShiftIcon /> },
      ];
    }
    return [
      { to: '/home', label: 'Главная', icon: <HomeIcon />, end: true },
      { to: '/shift', label: shiftL, icon: <ShiftIcon /> },
      { to: '/sales', label: 'Продажи', icon: <SalesIcon /> },
      { to: '/team', label: 'Команда', icon: <TeamIcon /> },
      {
        to: '/control',
        label: controlL,
        icon: usesOrgChat ? <OrgChatDockIcon /> : <ControlIcon />,
        badge: chatBadge,
      },
    ];
  }, [session, messengerUnreadTotal]);

  if (!session) {
    return (
      <main className="app">
        <section className="card loginCard">
          <header className="brandHeader">
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

            <label className="rememberMeRow">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>Запомнить меня</span>
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
                <code>manager / 123456</code> — управляющий, зарплаты по всем точкам и обращения
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
              <li>
                <code>reto1</code>…<code>reto8 / 123456</code> — ретушёры (5% от выручки точки)
              </li>
            </ul>
          </div>
        </section>
      </main>
    );
  }

  const role = session.user.role;
  const isRetoucher = role === 'RETOUCHER';
  const isSellerOnly = role === 'SELLER';
  const isManager = role === 'MANAGER';
  const isReadOnlyObserver = role === 'ACCOUNTANT' || role === 'MANAGER';
  const isFinanceViewer = role === 'ACCOUNTANT' || role === 'DIRECTOR';
  const shiftLabel = isFinanceViewer || isManager ? 'Оперативка' : 'Смена';
  const usesOrgChat = role === 'ADMIN' || role === 'DIRECTOR' || role === 'MANAGER';
  const controlLabel = usesOrgChat ? 'Чат' : isReadOnlyObserver ? 'Отчёт' : 'Контроль';
  const messengerChromeLayout = usesOrgChat && location.pathname === '/control';

  return (
    <main className={`app appWorkspace${messengerChromeLayout ? ' appWorkspace--messengerChrome' : ''}`}>
      <section
        className={`card cardWorkspace${messengerChromeLayout ? ' cardWorkspace--messengerChrome' : ''}`}
      >
        {!messengerChromeLayout ? (
          <header className="brandHeader">
            <h1>Фотографы</h1>
          </header>
        ) : null}

        <div className="quickNav desktopNav" role="tablist" aria-label="Разделы">
          <NavLink to="/home" className={navTabClass} end>
            Главная
          </NavLink>
          {!isRetoucher && (
            <NavLink to="/shift" className={navTabClass}>
              {shiftLabel}
            </NavLink>
          )}
          {!isRetoucher && !isSellerOnly && (
            <>
              <NavLink to="/sales" className={navTabClass}>
                Продажи
              </NavLink>
              <NavLink to="/team" className={navTabClass}>
                Команда
              </NavLink>
              <NavLink to="/control" className={navTabClass}>
                {controlLabel}
                {usesOrgChat && messengerUnreadTotal > 0 ? (
                  <span className="desktopChatBadge">
                    {messengerUnreadTotal > 99 ? '99+' : messengerUnreadTotal}
                  </span>
                ) : null}
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
                <div
                  className={`dashboard homeDashboard${
                    homeDashboard?.role === 'DIRECTOR' ||
                    homeDashboard?.role === 'ACCOUNTANT' ||
                    homeDashboard?.role === 'MANAGER'
                      ? ' homeDashboardDirectorSkin'
                      : ''
                  }`}
                >
                  <section className="sectionCard homePanelSection">
                    {dashboardLoading ? (
                      <p className="muted">Загружаем сводку...</p>
                    ) : (
                      homeDashboard && (
                        <>
                          {homeDashboard.sellerDataManagedByAdmin && homeDashboard.role === 'SELLER' && (
                            <p className="notice">Данные продавца заполняет администратор точки.</p>
                          )}
                          <h3 className="homePanelTitle">{homeDashboard.title}</h3>
                          {homeDashboard.role === 'DIRECTOR' && session ? (
                            <DirectorHomeApprovalsCarousel
                              token={session.token}
                              onDecided={() => {
                                void loadDashboard(session.token);
                              }}
                            />
                          ) : null}
                          {homeDashboard.role !== 'ADMIN' ? (
                            (() => {
                              const visibleMetrics = homeDashboard.metrics.filter((metric) => {
                                const l = metric.label.toLowerCase().trim();
                                if (l.includes('чистая прибыль')) {
                                  return false;
                                }
                                if (l.includes('закупки') && l.includes('оценка')) {
                                  return false;
                                }
                                if (l === 'открытые смены') {
                                  return false;
                                }
                                if (homeDashboard.role === 'MANAGER' && l.includes('ставка')) {
                                  return false;
                                }
                                return true;
                              });
                              if (homeDashboard.role === 'DIRECTOR' && visibleMetrics.length >= 2) {
                                const topLine = visibleMetrics.slice(0, 2);
                                const rest = visibleMetrics.slice(2);
                                return (
                                  <>
                                    <div className="metrics homeMetricsTopLine">
                                      {topLine.map((metric) => (
                                        <article key={metric.label} className="metricCard">
                                          <p>{metric.label}</p>
                                          <strong>{metric.value}</strong>
                                        </article>
                                      ))}
                                    </div>
                                    {rest.length > 0 ? (
                                      <div className="metrics homeMetricsTight">
                                        {rest.map((metric) => (
                                          <article key={metric.label} className="metricCard">
                                            <p>{metric.label}</p>
                                            <strong>{metric.value}</strong>
                                          </article>
                                        ))}
                                      </div>
                                    ) : null}
                                  </>
                                );
                              }
                              return (
                                <div className="metrics homeMetricsTight">
                                  {visibleMetrics.map((metric) => (
                                    <article key={metric.label} className="metricCard">
                                      <p>{metric.label}</p>
                                      <strong>{metric.value}</strong>
                                    </article>
                                  ))}
                                </div>
                              );
                            })()
                          ) : null}

                          {homeDashboard.role === 'ADMIN' ? (
                            <div className="homeStoresList">
                              {homeDashboard.stores.map((store) => (
                                <article key={store.name} className="homeStoreCard">
                                  <dl className="homeStoreDl">
                                    <div className="homeStoreRow">
                                      <dt>Выручка</dt>
                                      <dd>{store.revenue}</dd>
                                    </div>
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
                                  </dl>
                                </article>
                              ))}
                            </div>
                          ) : homeDashboard.role === 'DIRECTOR' ||
                            homeDashboard.role === 'ACCOUNTANT' ? (
                            <div className="homeStoresAggregateCard">
                              <h4 className="homeStoresAggregateTitle">Выручка по точкам</h4>
                              <ul className="homeStoresMiniList">
                                {homeDashboard.stores.map((store) => (
                                  <li key={store.name} className="homeStoresMiniRow">
                                    <span className="homeStoresMiniName">{store.name}</span>
                                    <span className="homeStoresMiniValue">{store.revenue}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : homeDashboard.role === 'MANAGER' ? null : (
                            <div className="homeStoresList">
                              {homeDashboard.stores.map((store) => (
                                <article key={store.name} className="homeStoreCard">
                                  <dl className="homeStoreDl">
                                    <div className="homeStoreRow">
                                      <dt>Выручка</dt>
                                      <dd>{store.revenue}</dd>
                                    </div>
                                  </dl>
                                </article>
                              ))}
                            </div>
                          )}

                          {homeDashboard.role === 'MANAGER' && session ? (
                            <ManagerHomeIssuesPanel
                              token={session.token}
                              items={managerIssues}
                              onStart={startManagerIssue}
                            />
                          ) : null}

                          {homeDashboard.role === 'DIRECTOR' ? (
                            <DirectorCashflowCarousel pages={directorCashflowPages} />
                          ) : null}

                          {homeDashboard.role === 'ADMIN' ? (
                            <>
                              <div className="adminSellerRegister">
                                <h4>Кассы сотрудников</h4>
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
                              <div className="soldProductsBlock homeSoldProductsBlock">
                                <h4>Проданные товары</h4>
                                <ul>
                                  {(todaySoldProducts.length === 0
                                    ? [{ name: 'Продаж по товарам нет', qty: 0 }]
                                    : todaySoldProducts
                                  ).map((item) => (
                                    <li key={item.name}>
                                      <span>{item.name}</span>
                                      <strong>{item.qty} шт.</strong>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <ManagerIssueMiniForm
                                token={session.token}
                                notice={managerIssueNotice}
                                onSubmit={async (payload) => {
                                  await createManagerIssue(session.token, payload);
                                  setManagerIssueNotice('Обращение отправлено управляющему');
                                  window.setTimeout(() => setManagerIssueNotice(''), 3500);
                                }}
                              />
                            </>
                          ) : null}
                        </>
                      )
                    )}
                  </section>
                  <section
                    className={`sectionCard homeLogoutSection${
                      role === 'DIRECTOR' || role === 'ACCOUNTANT' || role === 'MANAGER'
                        ? ' directorHomeLogoutStrip'
                        : ''
                    }`}
                  >
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
                    {isManager ? null : isFinanceViewer ? (
                      <FinanceOpsPanel
                        token={session.token}
                        isDirector={role === 'DIRECTOR'}
                        snapshot={financeOps}
                        onAddIncome={addFinanceIncome}
                        onAddExpense={addFinanceExpense}
                        onSetAccountBalance={setFinanceAccountBalance}
                      />
                    ) : (
                      <>
                        <ShiftPanel
                          token={session.token}
                          staff={staff}
                          shifts={shifts}
                          role={role}
                          readOnly={isReadOnlyObserver}
                          onOpen={openShift}
                          onClose={closeShift}
                        />
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
                          onRemoveFromStore={removeStaffFromStore}
                          onDirectorSetPercent={setDirectorPercent}
                          showOnlyCards
                        />
                        {role === 'ADMIN' ? (
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
                            onRemoveFromStore={removeStaffFromStore}
                            onDirectorSetPercent={setDirectorPercent}
                            hideCards
                            managementAccordion
                          />
                        ) : null}
                      </>
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
                          </>
                        )}
                      </>
                    )}
                    {isManager ? (
                      <section className="sectionCard">
                        <ManagerIssuesInbox
                          token={session.token}
                          issues={managerIssues}
                          onComplete={completeManagerIssue}
                        />
                      </section>
                    ) : isFinanceViewer ? (
                      role === 'DIRECTOR' ? (
                        <section className="sectionCard">
                          <FinanceReportPanel
                            token={session.token}
                            sales={salesMerged}
                            sellers={sellers}
                            procurementCosts={productProcurementCosts}
                            role={role}
                            acquiringPercent={acquiringPercent}
                            acquiringPercentDetkov={acquiringPercentDetkov}
                            acquiringPercentPutintsevSber={acquiringPercentPutintsevSber}
                            onRefreshFinanceInputs={refreshFinanceInputs}
                            onLoadPlans={loadRevenuePlans}
                            onSavePlans={saveRevenuePlans}
                          />
                        </section>
                      ) : (
                        <>
                          <section className="sectionCard inventorySectionCard">
                            <DirectorWarehousePanel
                              token={session.token}
                              overview={inventoryOverview}
                              onReload={() => loadInventoryOverview(session.token)}
                              onReplenish={replenishWarehouse}
                            />
                          </section>
                          <section className="sectionCard">
                            <AccountantProcurementPanel
                              token={session.token}
                              products={products}
                              procurementCosts={productProcurementCosts}
                              acquiringPercent={acquiringPercent}
                              acquiringPercentDetkov={acquiringPercentDetkov}
                              acquiringPercentPutintsevSber={acquiringPercentPutintsevSber}
                              onAcquiringPercentChange={setAcquiringPercent}
                              onAcquiringPercentDetkovChange={setAcquiringPercentDetkov}
                              onAcquiringPercentPutintsevSberChange={setAcquiringPercentPutintsevSber}
                              onSaveAcquiringPercent={saveAcquiringPercent}
                              onSaveAcquiringPercentDetkov={saveAcquiringPercentDetkov}
                              onSaveAcquiringPercentPutintsevSber={saveAcquiringPercentPutintsevSber}
                              onSave={saveProductProcurementCosts}
                            />
                          </section>
                        </>
                      )
                    ) : (
                      <>
                        <section className="sectionCard">
                          <div className="salesLog">
                            {salesNotice ? <p className="notice saleRequestNotice">{salesNotice}</p> : null}
                            <button
                              type="button"
                              className={`salesToggle ${salesExpanded ? 'salesToggleOpen' : ''}`}
                              onClick={() => setSalesExpanded((current) => !current)}
                              aria-expanded={salesExpanded}
                            >
                              <span>Продажи за сегодня · {session.user.storeName}</span>
                              <span className="salesToggleIcon" aria-hidden>
                                ▾
                              </span>
                            </button>
                            <div className={`salesAccordion ${salesExpanded ? 'salesAccordionOpen' : ''}`}>
                              {todayStoreSales.length === 0 ? (
                                <p className="muted">За сегодня по этой точке продаж нет</p>
                              ) : (
                                <div className="salesList">
                                  {todayStoreSales.map((sale) => (
                                    <article
                                      key={sale.id}
                                      className={`saleItem ${sale.pendingSync ? 'saleItemPendingSync' : ''}`}
                                    >
                                      <p className="saleHeader">
                                        <strong>{new Date(sale.createdAt).toLocaleTimeString('ru-RU')}</strong> –{' '}
                                        {sale.sellerName}
                                        {sale.pendingSync ? (
                                          <span className="salePendingBadge"> нет сети · отправится позже</span>
                                        ) : null}
                                        <span className="salePay">
                                          {sale.paymentType === 'NON_CASH'
                                            ? 'Безнал'
                                            : sale.paymentType === 'TRANSFER'
                                              ? 'Перевод'
                                              : 'Наличные'}
                                        </span>
                                        <span className="saleHeaderTrailing">
                                          {role === 'ADMIN' && !sale.pendingSync ? (
                                            <button
                                              type="button"
                                              className="saleDeleteRequestIconBtn"
                                              title="Запросить у директора удаление этой продажи"
                                              aria-label="Запросить у директора удаление этой продажи"
                                              onClick={() => {
                                                void (async () => {
                                                  try {
                                                    await requestSaleDelete(session.token, sale.id);
                                                  } catch (e) {
                                                    setSalesNotice(
                                                      e instanceof Error ? e.message : 'Не удалось отправить запрос',
                                                    );
                                                  }
                                                })();
                                              }}
                                            >
                                              <svg
                                                className="saleDeleteRequestIconSvg"
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                aria-hidden
                                              >
                                                <path d="M3 6h18" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                <path d="M10 11v6M14 11v6" />
                                              </svg>
                                            </button>
                                          ) : null}
                                          <span className="saleTotal">
                                            Итог: {sale.totalAmount.toLocaleString('ru-RU')} ₽
                                          </span>
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
                          </div>
                        </section>
                      </>
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
                      {isFinanceViewer || isManager ? (
                        <TeamStoresOverview
                          token={session.token}
                          staff={staff}
                          sellers={sellers}
                          sales={salesMerged}
                          shifts={shifts}
                          role={role}
                          onDirectorSetPercent={setDirectorPercent}
                          onRemoveFromStore={removeStaffFromStore}
                          onRestoreStaffToStore={restoreStaffToStore}
                          reportDayKey={isManager ? teamDayKey : undefined}
                          onReportDayKeyChange={isManager ? setTeamDayKey : undefined}
                          hideRemovedStaff={isManager}
                          readOnlyTeamActions={isManager}
                        />
                      ) : (
                        role === 'ADMIN' ? (
                          <>
                            <div className="inventorySectionCard">
                              <StoreInventoryControlPanel
                                token={session.token}
                                detail={storeInventory}
                                storeName={session.user.storeName}
                                onReload={() => loadStoreInventory(session.token)}
                                onReceiveFromWarehouse={transferFromWarehouseToStore}
                              />
                            </div>
                            <div>
                              <WriteOffForm
                                products={products}
                                token={session.token}
                                onAddWriteOff={addWriteOff}
                              />
                            </div>
                          </>
                        ) : (
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
                            onRemoveFromStore={removeStaffFromStore}
                            onDirectorSetPercent={setDirectorPercent}
                            hideCards
                          />
                        )
                      )}
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
                  <div className={usesOrgChat ? 'dashboard dashboardMessengerPage' : 'dashboard'}>
                    {usesOrgChat ? (
                      <MessengerHub
                        token={session.token}
                        inbox={messengerInbox}
                        refreshInbox={refreshMessengerInbox}
                        persistedThreadKey={messengerPersistThreadKey}
                        persistedThreadTitle={messengerPersistThreadTitle}
                        onPersistThreadOpen={(key, title) => {
                          setMessengerPersistThreadKey(key);
                          setMessengerPersistThreadTitle(title);
                        }}
                        onPersistThreadClose={() => {
                          setMessengerPersistThreadKey(null);
                          setMessengerPersistThreadTitle('');
                        }}
                      />
                    ) : role === 'ACCOUNTANT' ? (
                      <section className="sectionCard">
                        <FinanceReportPanel
                          token={session.token}
                          sales={salesMerged}
                          sellers={sellers}
                          procurementCosts={productProcurementCosts}
                          role={role}
                          acquiringPercent={acquiringPercent}
                          acquiringPercentDetkov={acquiringPercentDetkov}
                          acquiringPercentPutintsevSber={acquiringPercentPutintsevSber}
                          onRefreshFinanceInputs={refreshFinanceInputs}
                          onLoadPlans={loadRevenuePlans}
                          onSavePlans={saveRevenuePlans}
                        />
                      </section>
                    ) : null}
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
            <span className="dockNavCell">
              {item.icon}
              {item.badge !== undefined && item.badge > 0 ? (
                <span className="dockUnreadBadge">{item.badge >= 99 ? '99+' : item.badge}</span>
              ) : null}
            </span>
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
          <div className="paymentTypeRow" role="group" aria-label="Вид оплаты">
            <button
              type="button"
              className={`ghost paymentTypeBtn ${paymentType === 'CASH' ? 'paymentTypeBtnActive' : ''}`}
              onClick={() => setPaymentType('CASH')}
            >
              Нал
            </button>
            <button
              type="button"
              className={`ghost paymentTypeBtn ${paymentType === 'NON_CASH' ? 'paymentTypeBtnActive' : ''}`}
              onClick={() => setPaymentType('NON_CASH')}
            >
              Безнал
            </button>
            <button
              type="button"
              className={`ghost paymentTypeBtn ${paymentType === 'TRANSFER' ? 'paymentTypeBtnActive' : ''}`}
              onClick={() => setPaymentType('TRANSFER')}
            >
              Перевод
            </button>
          </div>
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
      </div>
      {formError && <p className="error">{formError}</p>}
      <div className="productGrid">
        {products.map((item) => (
          <label key={item.name} className="productCell">
            <div className="productRow">
              <span className="productName">{item.name}</span>
              <input
                inputMode="numeric"
                value={qty[item.name] ?? ''}
                onChange={(event) => updateQty(item.name, event.target.value)}
                placeholder="0"
              />
            </div>
          </label>
        ))}
      </div>
      <button
        className="primaryAction addSaleSubmitBottom"
        type="button"
        onClick={submit}
        disabled={busy || !hasOpenShift || sellers.length === 0}
      >
        Сохранить продажу
      </button>
    </div>
  );
}

function DirectorHomeApprovalsCarousel({
  token,
  onDecided,
}: {
  token: string;
  onDecided: () => void;
}) {
  const [items, setItems] = useState<DirectorControlRequest[]>([]);
  const [index, setIndex] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState('');
  const touchStartX = useRef<number | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/director/control-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as DirectorControlRequest[];
    setItems(data);
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (items.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, items.length - 1));
  }, [items.length]);

  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setBanner('');
    setBusyId(id);
    try {
      const response = await fetch(`${API_BASE_URL}/director/control-requests/${id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        let message = 'Не удалось применить решение';
        try {
          const parsed = (await response.json()) as { message?: string | string[] };
          if (typeof parsed.message === 'string') {
            message = parsed.message;
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      await load();
      onDecided();
      setBanner(decision === 'APPROVE' ? 'Согласовано' : 'Отклонено');
      window.setTimeout(() => setBanner(''), 4000);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null || items.length < 2) {
      return;
    }
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    const threshold = 48;
    if (dx > threshold) {
      setIndex((i) => Math.max(0, i - 1));
    } else if (dx < -threshold) {
      setIndex((i) => Math.min(items.length - 1, i + 1));
    }
  };

  if (items.length === 0) {
    return null;
  }

  const current = items[index] ?? items[0];
  const at = new Date(current.createdAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="directorApprovalsCarousel" aria-label="Запросы на согласование">
      <div className="directorApprovalsCarouselHeader">
        <h4 className="directorApprovalsCarouselTitle">Согласования</h4>
        <span className="directorApprovalsCarouselBadge">{items.length}</span>
      </div>
      {banner ? <p className="notice directorApprovalsCarouselBanner">{banner}</p> : null}
      <div
        className="directorApprovalsCarouselViewport"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="region"
        aria-roledescription="carousel"
      >
        <article className="directorApprovalsCarouselCard" key={current.id}>
          <p className="directorApprovalsCarouselKind">
            {current.kind === 'SALE_DELETE' ? 'Отмена продажи' : 'Списание товара'}
          </p>
          <p className="directorApprovalsCarouselSummary">{current.summary}</p>
          <p className="directorApprovalsCarouselMeta">{at}</p>
          <div className="directorApprovalsCarouselActions">
            <button
              type="button"
              className="directorApprovalsCarouselBtn directorApprovalsCarouselBtnReject"
              disabled={busyId === current.id}
              onClick={() => void decide(current.id, 'REJECT')}
            >
              Отклонить
            </button>
            <button
              type="button"
              className="directorApprovalsCarouselBtn directorApprovalsCarouselBtnApprove"
              disabled={busyId === current.id}
              onClick={() => void decide(current.id, 'APPROVE')}
            >
              {busyId === current.id ? '…' : 'Согласовать'}
            </button>
          </div>
        </article>
      </div>
      {items.length > 1 ? (
        <div className="directorApprovalsCarouselDots" role="tablist" aria-label="Выбор заявки">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`directorApprovalsCarouselDot ${i === index ? 'directorApprovalsCarouselDotActive' : ''}`}
              aria-label={`Заявка ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatOrgChatTimeLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

async function parseOrgChatErrorResponse(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'message' in data) {
      const m = (data as { message: unknown }).message;
      if (typeof m === 'string') {
        return m;
      }
      if (Array.isArray(m)) {
        return m.map(String).join(', ');
      }
    }
  } catch {
    /* ignore */
  }
  return (await response.text().catch(() => '')) || `Ошибка ${response.status}`;
}

function formatMessengerInboxTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (calendarDayKeyMoscow(iso) === todayKeyMoscow()) {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    }
    const diffMs = now.getTime() - d.getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (diffMs >= 0 && diffMs < weekMs) {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        weekday: 'short',
      }).format(d);
    }
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'short',
    }).format(d);
  } catch {
    return '';
  }
}

/** Нижняя строка превью: только текст сообщения (имя — отдельной строкой, как в Telegram). */
function messengerPreviewBodyLine(t: MessengerThreadPreview): string {
  const body = (t.lastMessageBody ?? '').trim();
  if (!body) {
    return 'Нет сообщений';
  }
  return body;
}

/** Вторая строка: имя отправителя последнего сообщения. */
function messengerListSenderLine(t: MessengerThreadPreview): string {
  const body = (t.lastMessageBody ?? '').trim();
  if (!body) {
    return '';
  }
  return (t.lastSenderLabel ?? '').trim();
}

function messengerAvatarToneClass(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `messengerAvatar--tone${Math.abs(h) % 8}`;
}

function formatMessengerUnreadCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace('.', ',')}K`;
  }
  return String(n);
}

function MessengerHub({
  token,
  inbox,
  refreshInbox,
  persistedThreadKey,
  persistedThreadTitle,
  onPersistThreadOpen,
  onPersistThreadClose,
}: {
  token: string;
  inbox: MessengerInboxResponse | null;
  refreshInbox: () => Promise<void>;
  persistedThreadKey: string | null;
  persistedThreadTitle: string;
  onPersistThreadOpen: (threadKey: string, title: string) => void;
  onPersistThreadClose: () => void;
}) {
  const threadKey = persistedThreadKey;
  const threadTitleResolved = useMemo(() => {
    if (!threadKey) {
      return '';
    }
    const fromInbox = inbox?.threads?.find((t) => t.threadKey === threadKey)?.title?.trim();
    return fromInbox || persistedThreadTitle.trim() || threadKey;
  }, [threadKey, persistedThreadTitle, inbox?.threads]);

  const [messages, setMessages] = useState<MessengerLine[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingThread, setLoadingThread] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [threadError, setThreadError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const threads = inbox?.threads ?? [];

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      el.scrollTop = el.scrollHeight;
    });
  };

  const updateStickToBottomFromScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 100;
  };

  const loadThreadMessages = useCallback(async () => {
    if (!threadKey) {
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/admin/chat/messages?threadKey=${encodeURIComponent(threadKey)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new Error(await parseOrgChatErrorResponse(response));
      }
      const data = (await response.json()) as { messages?: MessengerLine[] };
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setThreadError('');
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Не удалось загрузить переписку');
    } finally {
      setLoadingThread(false);
    }
  }, [token, threadKey]);

  useEffect(() => {
    if (!threadKey) {
      setMessages([]);
      setThreadError('');
      setLoadingThread(false);
      return;
    }
    setLoadingThread(true);
    stickToBottomRef.current = true;
    void loadThreadMessages();

    const markReadOnce = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/admin/chat/read`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ threadKey }),
        });
        if (response.ok) {
          void refreshInbox();
        }
      } catch {
        /* ignore */
      }
    };
    void markReadOnce();

    const pollMs =
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 45000 : 5500;
    const intervalId = window.setInterval(() => void loadThreadMessages(), pollMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadThreadMessages();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
    };
  }, [threadKey, loadThreadMessages, refreshInbox, token]);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom();
    }
  }, [messages]);

  const openList = () => {
    onPersistThreadClose();
    void refreshInbox();
  };

  const openThread = (key: string, title: string) => {
    onPersistThreadOpen(key, title);
    setDraft('');
    setThreadError('');
  };

  const handleThreadSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sendBusy || !threadKey) {
      return;
    }
    setSendBusy(true);
    setThreadError('');
    try {
      const response = await fetch(`${API_BASE_URL}/admin/chat/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ threadKey, body: text }),
      });
      if (!response.ok) {
        throw new Error(await parseOrgChatErrorResponse(response));
      }
      setDraft('');
      stickToBottomRef.current = true;
      await loadThreadMessages();
      void refreshInbox();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Не отправлено');
    } finally {
      setSendBusy(false);
    }
  };

  if (!threadKey) {
    return (
      <section className="sectionCard messengerHub" aria-label="Сообщения">
        <header className="messengerHubHeader">
          <div>
            <h3 className="messengerHubTitle">Сообщения</h3>
            <p className="messengerHubSubtitle">Общий чат и личные диалоги со всеми участниками сети.</p>
          </div>
        </header>

        <ul className="messengerThreadList" aria-label="Чаты">
          {threads.map((t) => {
            const initial = (t.title.trim()[0] ?? '?').toUpperCase();
            const unread = t.unreadCount > 0;
            const senderLine = messengerListSenderLine(t);
            const previewLine = messengerPreviewBodyLine(t);
            const hasMsg = Boolean((t.lastMessageBody ?? '').trim());
            return (
              <li key={t.threadKey}>
                <button
                  type="button"
                  className="messengerThreadRow"
                  onClick={() => openThread(t.threadKey, t.title)}
                >
                  <span
                    className={`messengerAvatar ${messengerAvatarToneClass(t.threadKey)}`}
                    aria-hidden
                  >
                    {initial}
                  </span>
                  <span className="messengerThreadTextCol">
                    <span className="messengerTgTitleRow">
                      <span className="messengerThreadName">{t.title}</span>
                    </span>
                    {senderLine ? <span className="messengerThreadSender">{senderLine}</span> : null}
                    <span className="messengerThreadPreview">{previewLine}</span>
                  </span>
                  <span className="messengerThreadRightCol">
                    {hasMsg ? (
                      <span className="messengerThreadTime">{formatMessengerInboxTime(t.lastMessageAt)}</span>
                    ) : null}
                    {unread ? (
                      <span className="messengerUnreadBadge">{formatMessengerUnreadCount(t.unreadCount)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const placeholder =
    threadKey === 'general'
      ? 'Сообщение для всех точек и руководства…'
      : 'Личное сообщение…';

  const threadSubtitle =
    threadKey === 'general' ? 'Общий чат сети' : 'Личные сообщения';
  const navAvatarLetter = (threadTitleResolved.trim()[0] ?? '?').toUpperCase();

  return (
    <section className="sectionCard messengerHub messengerHubThread" aria-label={threadTitleResolved}>
      <header className="messengerTgFloatingHeader">
        <button type="button" className="messengerTgPill messengerTgPillBack" onClick={openList} aria-label="Назад">
          <svg className="messengerTgBackSvg" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path
              fill="currentColor"
              d="M15.5 19.5 8 12l7.5-7.5 1.4 1.4L10.8 12l6.1 6.1-1.4 1.4z"
            />
          </svg>
        </button>
        <div className="messengerTgPill messengerTgPillTitle">
          <h3 className="messengerThreadNavTitle">{threadTitleResolved}</h3>
          <p className="messengerThreadNavSubtitle">{threadSubtitle}</p>
        </div>
        <div
          className={`messengerTgNavAvatar ${messengerAvatarToneClass(threadKey)}`}
          aria-hidden
        >
          {navAvatarLetter}
        </div>
      </header>

      {threadError ? (
        <p className="error orgChatError" role="alert">
          {threadError}
        </p>
      ) : null}

      <div
        ref={scrollRef}
        className="orgChatScroll orgChatScroll--thread"
        aria-live="polite"
        onScroll={updateStickToBottomFromScroll}
      >
        {loadingThread && messages.length === 0 ? (
          <p className="muted orgChatEmpty">Загрузка сообщений…</p>
        ) : messages.length === 0 ? (
          <p className="muted orgChatEmpty">Пока нет сообщений — напишите первым.</p>
        ) : (
          <ul className="orgChatList">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`orgChatBubbleWrap ${m.outgoing ? 'orgChatBubbleWrap--mine' : ''}`}
              >
                <article className={`orgChatBubble ${m.outgoing ? 'orgChatBubble--mine' : ''}`}>
                  <div className="orgChatBubbleMeta">
                    <span className="orgChatSender">{m.senderLabel}</span>
                    <time className="orgChatTime" dateTime={m.createdAt}>
                      {formatOrgChatTimeLabel(m.createdAt)}
                    </time>
                  </div>
                  <p className="orgChatBody">{m.body}</p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="orgChatComposer orgChatComposer--tg" onSubmit={(e) => void handleThreadSubmit(e)}>
        <div className="orgChatComposerShell">
          <textarea
            className="orgChatInput orgChatInput--tg"
            rows={1}
            maxLength={4000}
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={sendBusy}
            aria-label="Текст сообщения"
          />
          <button
            type="submit"
            className="orgChatSendFab"
            disabled={sendBusy || !draft.trim()}
            aria-label={sendBusy ? 'Отправка' : 'Отправить'}
          >
            <svg className="orgChatSendFabSvg" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M3 18v-4.6l11.5-2.2L3 9V5l18 7-18 6z"
              />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

function DirectorCashflowCarousel({
  pages,
}: {
  pages: Array<{ key: string; title: string; amount: number }>;
}) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (pages.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, pages.length - 1));
  }, [pages.length]);

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null || pages.length < 2) {
      return;
    }
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    const threshold = 48;
    if (dx > threshold) {
      setIndex((i) => Math.max(0, i - 1));
    } else if (dx < -threshold) {
      setIndex((i) => Math.min(pages.length - 1, i + 1));
    }
  };

  if (pages.length === 0) {
    return null;
  }

  const current = pages[index] ?? pages[0];
  return (
    <div className="directorCashflowCarousel" aria-label="Наличные и поступления по точкам">
      <div className="directorCashflowCarouselHeader">
        <h4 className="directorCashflowCarouselTitle">Итоги по всем точкам</h4>
        <span className="directorCashflowCarouselBadge">{pages.length}</span>
      </div>
      <div
        className="directorCashflowCarouselViewport"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="region"
        aria-roledescription="carousel"
      >
        <article className="directorCashflowCarouselCard">
          <div className="directorCashflowMainRow">
            <span className="directorCashflowAccountTitle">{current.title}</span>
            <strong className="directorCashflowAccountValue">{formatRub(current.amount)}</strong>
          </div>
        </article>
      </div>
      {pages.length > 1 ? (
        <div className="directorCashflowCarouselDots" role="tablist" aria-label="Выбор точки">
          {pages.map((page, i) => (
            <button
              key={page.key}
              type="button"
              className={`directorCashflowCarouselDot ${i === index ? 'directorCashflowCarouselDotActive' : ''}`}
              aria-label={page.title}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
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
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [formOk, setFormOk] = useState('');

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
    setFormOk('');
    setBusy(true);
    try {
      await onAddWriteOff(token, name, parsedQty, reason);
      setQty('1');
      setFormOk('Заявка отправлена директору. Списание выполнится после согласования.');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось отправить заявку');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`writeOffForm writeOffFormCarousel ${expanded ? 'writeOffFormCarouselOpen' : ''}`}>
      <button
        type="button"
        className={`writeOffCarouselToggle ${expanded ? 'writeOffCarouselToggleOpen' : ''}`}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="write-off-carousel-body"
      >
        <span className="writeOffCarouselToggleTitle">Списание товара (поштучно)</span>
        <span className="writeOffCarouselToggleIcon" aria-hidden>
          ▾
        </span>
      </button>
      <div
        id="write-off-carousel-body"
        className={`writeOffCarouselBody ${expanded ? 'writeOffCarouselBodyOpen' : ''}`}
      >
        <p className="muted writeOffPolicyHint">
          Списание со склада точки возможно только после согласования директора.
        </p>
        {formOk ? <p className="notice writeOffOk">{formOk}</p> : null}
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
    </div>
  );
}

function ManagerIssueMiniForm({
  token,
  notice,
  onSubmit,
}: {
  token: string;
  notice: string;
  onSubmit: (payload: { category: ManagerIssueCategory; message: string }) => Promise<void>;
}) {
  void token;
  const [category, setCategory] = useState<ManagerIssueCategory>('NEEDS');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      setError('Опишите обращение хотя бы в 5 символов');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit({ category, message: trimmed });
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить обращение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="managerIssueMini">
      <h4>Обращение управляющему</h4>
      {notice ? <p className="notice managerIssueMiniNotice">{notice}</p> : null}
      <div className="managerIssueMiniRow">
        <label>
          Категория
          <select value={category} onChange={(e) => setCategory(e.target.value as ManagerIssueCategory)}>
            <option value="PERSONNEL">Персонал</option>
            <option value="INSPECTION">Проверка</option>
            <option value="GOODS">Товар</option>
            <option value="EQUIPMENT_BREAKDOWN">Поломка техники</option>
            <option value="NEEDS">Что-то нужно</option>
          </select>
        </label>
        <label>
          Сообщение
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Коротко опишите проблему"
          />
        </label>
        <button type="button" className="ghost managerIssueMiniBtn" onClick={submit} disabled={busy}>
          {busy ? '…' : 'Отправить'}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function ManagerIssueCarousel({
  title,
  items,
  actionLabel,
  onAction,
  emptyText,
  kind,
}: {
  title: string;
  items: ManagerIssue[];
  actionLabel?: string;
  onAction?: (issueId: string) => Promise<void>;
  emptyText: string;
  kind: 'inbox' | 'active' | 'done';
}) {
  const [index, setIndex] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState('');
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (items.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, items.length - 1));
  }, [items.length]);

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null || items.length < 2) {
      return;
    }
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    const threshold = 48;
    if (dx > threshold) {
      setIndex((i) => Math.max(0, i - 1));
    } else if (dx < -threshold) {
      setIndex((i) => Math.min(items.length - 1, i + 1));
    }
  };

  if (items.length === 0) {
    return (
      <div className={`managerIssueFlowCard managerIssueFlowCard--${kind}`}>
        <div className="managerIssueFlowHead">
          <h4>{title}</h4>
          <span className="managerIssueFlowBadge">0</span>
        </div>
        <p className="muted">{emptyText}</p>
      </div>
    );
  }

  const current = items[index] ?? items[0];
  const at = new Date(current.createdAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`managerIssueFlowCard managerIssueFlowCard--${kind}`}>
      <div className="managerIssueFlowHead">
        <h4>{title}</h4>
        <span className="managerIssueFlowBadge">{items.length}</span>
      </div>
      {banner ? <p className="notice managerIssueFlowBanner">{banner}</p> : null}
      <div
        className="managerIssueFlowViewport"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="region"
        aria-roledescription="carousel"
      >
        <article className="managerIssueFlowSlide" key={current.id}>
          <p className="managerIssueFlowKind">{managerIssueCategoryLabel(current.category)}</p>
          <p className="managerIssueFlowSummary">
            <strong>{current.storeName}</strong>: {current.message}
          </p>
          <p className="managerIssueFlowMeta">{at}</p>
          {actionLabel && onAction ? (
            <div className="managerIssueFlowActions">
              <button
                type="button"
                className="managerIssueFlowBtn"
                disabled={busyId === current.id}
                onClick={() => {
                  void (async () => {
                    setBanner('');
                    setBusyId(current.id);
                    try {
                      await onAction(current.id);
                      setBanner(actionLabel === 'Выполнено' ? 'Перенесено в выполнено' : 'Передано в работу');
                      window.setTimeout(() => setBanner(''), 3000);
                    } catch (e) {
                      setBanner(e instanceof Error ? e.message : 'Ошибка');
                    } finally {
                      setBusyId(null);
                    }
                  })();
                }}
              >
                {busyId === current.id ? '…' : actionLabel}
              </button>
            </div>
          ) : null}
        </article>
      </div>
      {items.length > 1 ? (
        <div className="managerIssueFlowDots" role="tablist" aria-label={`Слайды: ${title}`}>
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`managerIssueFlowDot ${i === index ? 'managerIssueFlowDotActive' : ''}`}
              aria-label={`Заявка ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ManagerHomeIssuesPanel({
  token,
  items,
  onStart,
}: {
  token: string;
  items: ManagerIssue[];
  onStart: (token: string, issueId: string) => Promise<void>;
}) {
  const inboxItems = items.filter((item) => item.status === 'NEW');
  return (
    <ManagerIssueCarousel
      title="Согласования"
      items={inboxItems}
      actionLabel="В работу"
      onAction={(issueId) => onStart(token, issueId)}
      emptyText="Новых обращений нет."
      kind="inbox"
    />
  );
}

function ManagerIssuesInbox({
  token,
  issues,
  onComplete,
}: {
  token: string;
  issues: ManagerIssue[];
  onComplete: (token: string, issueId: string) => Promise<void>;
}) {
  const inProgress = issues.filter((item) => item.status === 'IN_PROGRESS');
  const done = issues.filter((item) => item.status === 'DONE');

  return (
    <div className="opsCard managerIssuesInbox">
      <ManagerIssueCarousel
        title="В работе"
        items={inProgress}
        actionLabel="Выполнено"
        onAction={(issueId) => onComplete(token, issueId)}
        emptyText="Активных обращений пока нет."
        kind="active"
      />
      <ManagerIssueCarousel
        title="Выполнено"
        items={done}
        emptyText="Выполненных обращений пока нет."
        kind="done"
      />
    </div>
  );
}

/** Порядок счётов на главном блоке оперативных финансов (остатки и приход за день). */
const FINANCE_OPS_PRIMARY_ACCOUNT_IDS = [
  'fa-bank-extra',
  'fa-bank-main',
  'fa-bank-putintsev-sber',
  'fa-cash-main',
] as const;

const FINANCE_EXPENSE_CATEGORY_LABELS = [
  'Аренда',
  'Налоги',
  'ЗП',
  'Расходка',
  'Прочие траты',
] as const;

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
  const bankAccountsOrdered = useMemo(() => {
    const primaryIds = FINANCE_OPS_PRIMARY_ACCOUNT_IDS as readonly string[];
    const rank = (id: string) => {
      const i = primaryIds.indexOf(id);
      return i === -1 ? 50 : i;
    };
    return [...bankAccounts].sort(
      (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'ru-RU'),
    );
  }, [bankAccounts]);

  const primaryFinanceAccounts = useMemo(() => {
    const map = new Map(snapshot.accounts.map((a) => [a.id, a]));
    return FINANCE_OPS_PRIMARY_ACCOUNT_IDS.map((id) => map.get(id)).filter(
      (a): a is FinanceAccount => Boolean(a),
    );
  }, [snapshot.accounts]);

  const [incomeDraftsByAccount, setIncomeDraftsByAccount] = useState<Record<string, string>>({});
  const [selectedIncomeAccountId, setSelectedIncomeAccountId] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [expenseTitle, setExpenseTitle] = useState<
    (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number]
  >(FINANCE_EXPENSE_CATEGORY_LABELS[0]);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [balanceAdjustOpen, setBalanceAdjustOpen] = useState(false);
  const [adjustAccountId, setAdjustAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [adjustNewBalance, setAdjustNewBalance] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [incomesHistoryOpen, setIncomesHistoryOpen] = useState(false);
  const [expensesHistoryOpen, setExpensesHistoryOpen] = useState(false);
  const [expenseArticlesSheetOpen, setExpenseArticlesSheetOpen] = useState(false);

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
    const ids = FINANCE_OPS_PRIMARY_ACCOUNT_IDS.filter((id) =>
      snapshot.accounts.some((a) => a.id === id),
    );
    setIncomeDraftsByAccount((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of ids) {
        if (next[id] === undefined) {
          next[id] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [snapshot.accounts]);

  useEffect(() => {
    if (primaryFinanceAccounts.length === 0) {
      return;
    }
    setSelectedIncomeAccountId((cur) =>
      primaryFinanceAccounts.some((a) => a.id === cur) ? cur : primaryFinanceAccounts[0]!.id,
    );
  }, [primaryFinanceAccounts]);

  const accountsForIncomeHistory = useMemo(() => {
    const list: FinanceAccount[] = [];
    if (cashAccount) {
      list.push(cashAccount);
    }
    list.push(...bankAccountsOrdered);
    return list;
  }, [cashAccount, bankAccountsOrdered]);

  const fmt = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;

  const expenseTotalsByArticle = useMemo(() => {
    const canonical = new Set<string>(FINANCE_EXPENSE_CATEGORY_LABELS);
    const totals = new Map<string, number>();
    for (const label of FINANCE_EXPENSE_CATEGORY_LABELS) {
      totals.set(label, 0);
    }
    const misc = 'Прочие траты';
    for (const e of snapshot.expenses) {
      const raw = (e.title ?? '').trim() || misc;
      const bucket = canonical.has(raw) ? raw : misc;
      const prev = totals.get(bucket) ?? 0;
      totals.set(bucket, Math.round((prev + e.amount) * 100) / 100);
    }
    return FINANCE_EXPENSE_CATEGORY_LABELS.map((label) => ({
      title: label,
      total: totals.get(label) ?? 0,
    }));
  }, [snapshot.expenses]);

  const expensesGrandTotal = useMemo(
    () =>
      Math.round(
        expenseTotalsByArticle.reduce((sum, row) => sum + row.total, 0) * 100,
      ) / 100,
    [expenseTotalsByArticle],
  );

  const submitIncomeForSelectedAccount = async () => {
    setError('');
    setStatus('');
    if (!selectedIncomeAccountId) {
      setError('Выберите счёт');
      return;
    }
    const amountStr = incomeDraftsByAccount[selectedIncomeAccountId] ?? '';
    const n = Number(String(amountStr).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError('Укажите сумму прихода');
      return;
    }
    setBusyId(`income-${selectedIncomeAccountId}`);
    try {
      await onAddIncome(token, {
        accountId: selectedIncomeAccountId,
        amount: amountStr,
        workDay: todayKeyMoscow(),
      });
      setIncomeDraftsByAccount((prev) => ({
        ...prev,
        [selectedIncomeAccountId]: '',
      }));
      const acc = snapshot.accounts.find((a) => a.id === selectedIncomeAccountId);
      setStatus(acc ? `Приход на «${acc.name}» записан, баланс обновлён.` : 'Приход записан.');
    } catch {
      setError('Не удалось записать приход');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className={`opsCard financeOpsCard ${isDirector ? 'financeOpsCardDirector' : ''}`}>
      <div className="financeOpsShell">
      <h4>Оперативные финансы</h4>
      <div className="financeOpsBankTotalCallout" role="note">
        <span className="financeOpsBankTotalCalloutLabel">общее</span>
        <span className="financeOpsBankTotalCalloutValue">{fmt(snapshot.totals.balance)}</span>
      </div>

      <div className="financeOpsBalancesGrid">
        {primaryFinanceAccounts.map((acc) => (
          <article key={acc.id} className="metricCard financeOpsBalanceCard">
            <p>{acc.name?.trim() || 'Счёт'}</p>
            <strong>{fmt(acc.balance)}</strong>
          </article>
        ))}
      </div>

      <div className="financeOpsIncomeBlock addSaleForm">
        <h4>Приход за день по счетам</h4>
        <label className="financeOpsAccountsPick">
          Счёт прихода
          <div className="financeOpsAccountBtnRow" role="group" aria-label="Счёт для записи прихода">
            {primaryFinanceAccounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                className={`ghost paymentTypeBtn financeOpsAccountPickBtn ${
                  selectedIncomeAccountId === acc.id ? 'paymentTypeBtnActive' : ''
                }`}
                onClick={() => setSelectedIncomeAccountId(acc.id)}
              >
                {acc.name}
              </button>
            ))}
          </div>
        </label>
        <div className="addSaleRow financeOpsIncomeFieldsRow">
          <label>
            Сумма прихода (₽)
            <input
              inputMode="decimal"
              value={incomeDraftsByAccount[selectedIncomeAccountId] ?? ''}
              onChange={(event) =>
                setIncomeDraftsByAccount((prev) => ({
                  ...prev,
                  [selectedIncomeAccountId]: event.target.value,
                }))
              }
              placeholder="Например, 15000"
            />
          </label>
        </div>
        <button
          type="button"
          className="primaryAction addSaleSubmitBottom"
          disabled={
            !selectedIncomeAccountId ||
            busyId === `income-${selectedIncomeAccountId}` ||
            primaryFinanceAccounts.length === 0
          }
          onClick={submitIncomeForSelectedAccount}
        >
          Записать приход
        </button>
      </div>

      {isDirector && (
        <div className="balanceAdjustBlock">
          <button
            type="button"
            className={`primaryAction financeBalanceAdjustToggle ${balanceAdjustOpen ? 'financeBalanceAdjustToggleOpen' : ''}`}
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
        <div className="financeOpsExpensePickRow">
          <label className="financeOpsExpenseUnifiedPick">
            <span className="financeOpsExpenseUnifiedPickCaption">Счёт списания</span>
            <select
              className="financeOpsExpenseUnifiedSelect"
              value={expenseAccountId}
              onChange={(event) => setExpenseAccountId(event.target.value)}
              aria-label="Счёт списания"
            >
              {snapshot.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="financeOpsExpenseUnifiedPick">
            <span className="financeOpsExpenseUnifiedPickCaption">Статья расхода</span>
            <select
              className="financeOpsExpenseUnifiedSelect"
              value={expenseTitle}
              onChange={(event) =>
                setExpenseTitle(
                  event.target.value as (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number],
                )
              }
              aria-label="Статья расхода"
            >
              {FINANCE_EXPENSE_CATEGORY_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="addSaleRow financeOpsExpenseAmountRow">
          <label>
            Сумма
            <input
              inputMode="decimal"
              value={expenseAmount}
              onChange={(event) => setExpenseAmount(event.target.value)}
              placeholder="Например, 5000"
            />
          </label>
        </div>
        <div className="inlineActions financeOpsExpenseActions">
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
                });
                setExpenseTitle(FINANCE_EXPENSE_CATEGORY_LABELS[0]);
                setExpenseAmount('');
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

      <div className="financeHistoryAccordions">
        <section className={`procurementAccordion ${incomesHistoryOpen ? '' : 'procurementAccordion--collapsed'}`}>
          <button
            type="button"
            className="procurementAccordionTrigger"
            aria-expanded={incomesHistoryOpen}
            onClick={() => setIncomesHistoryOpen((open) => !open)}
          >
            <span className="procurementAccordionTriggerTitle financeHistoryAccordionTitle">
              Последние приходы по счетам
            </span>
            <span className="procurementAccordionChevron" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="procurementAccordionPanel">
            <div className="procurementAccordionPanelInner">
              <div className="procurementAccordionBody financeHistoryAccordionBody">
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
              </div>
            </div>
          </div>
        </section>

        <section className={`procurementAccordion ${expensesHistoryOpen ? '' : 'procurementAccordion--collapsed'}`}>
          <button
            type="button"
            className="procurementAccordionTrigger"
            aria-expanded={expensesHistoryOpen}
            onClick={() => setExpensesHistoryOpen((open) => !open)}
          >
            <span className="procurementAccordionTriggerTitle financeHistoryAccordionTitle">
              Последние расходы
            </span>
            <span className="procurementAccordionChevron" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="procurementAccordionPanel">
            <div className="procurementAccordionPanelInner">
              <div className="procurementAccordionBody financeHistoryAccordionBody">
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
            </div>
          </div>
        </section>
      </div>

      <section
        className={`financeOpsExpenseArticlesSheet ${
          expenseArticlesSheetOpen ? 'financeOpsExpenseArticlesSheet--open' : ''
        }`}
      >
        <button
          type="button"
          className="financeOpsExpenseArticlesSheetHandle"
          aria-expanded={expenseArticlesSheetOpen}
          aria-controls="finance-ops-expense-articles-panel"
          onClick={() => setExpenseArticlesSheetOpen((open) => !open)}
        >
          <span className="financeOpsExpenseArticlesSheetHandleLabel">Расходы по статьям</span>
          <span className="financeOpsExpenseArticlesSheetHandleRight">
            <span className="financeOpsExpenseArticlesSheetHandleTotal">{fmt(expensesGrandTotal)}</span>
            <span className="financeOpsExpenseArticlesSheetHandleChevron" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </span>
        </button>
        <div
          className="financeOpsExpenseArticlesSheetPanel"
          id="finance-ops-expense-articles-panel"
          aria-hidden={!expenseArticlesSheetOpen}
        >
          <div className="financeOpsExpenseArticlesSheetPanelInner">
            <p className="financeOpsExpenseArticlesSheetHint">
              Прокрутите вбок — суммы по каждой статье за всё время учёта.
            </p>
            <div
              className="financeOpsExpenseArticlesCarousel"
              role="list"
              aria-label="Суммы расходов по статьям"
            >
              {expenseTotalsByArticle.map((row) => (
                <article
                  key={row.title}
                  className="financeOpsExpenseArticlesChip"
                  role="listitem"
                >
                  <span className="financeOpsExpenseArticlesChipTitle">{row.title}</span>
                  <strong className="financeOpsExpenseArticlesChipAmount">{fmt(row.total)}</strong>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}

function ShiftPanel({
  token,
  staff,
  shifts,
  role,
  readOnly,
  onOpen,
  onClose,
}: {
  token: string;
  staff: StaffMember[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  readOnly?: boolean;
  onOpen: (token: string, assignedSellerIds: number[]) => Promise<void>;
  onClose: (token: string, assignedSellerIds: number[]) => Promise<void>;
}) {
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const shiftAssignableStaff = useMemo(
    () => staff.filter((member) => member.isActive),
    [staff],
  );

  const toggleStaff = (id: number) => {
    setSelectedStaffIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div className="opsCard shiftPanelCard">
      <h4>Открытие/закрытие смены</h4>
      {readOnly && (
        <p className="notice">Роль «Бухгалтер»: только просмотр, без открытия и закрытия смен.</p>
      )}
      {openShift && !readOnly && (
        <p className="notice shiftNotice">
          Смена уже идёт. Отметьте ещё сотрудников и нажмите «Добавить в смену» — все выбранные
          останутся на одной смене.
        </p>
      )}
      <div className="shiftSellerList">
        {shiftAssignableStaff.map((member) => (
          <label
            key={member.id}
            className="shiftSellerRow"
            title={`${member.fullName} (${member.storeName})`}
          >
            <input
              type="checkbox"
              checked={selectedStaffIds.includes(member.id)}
              onChange={() => toggleStaff(member.id)}
              disabled={readOnly}
            />
            <span className="shiftSellerText">
              <span className="shiftSellerName">{member.fullName}</span>
              <span className="shiftSellerStore">
                {' '}
                — {member.storeName} {member.staffPosition === 'RETOUCHER' ? '(ретушёр)' : '(продавец)'}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="inlineActions shiftActionsRow">
        <button
          className="primaryAction"
          type="button"
          disabled={busy || readOnly}
          onClick={async () => {
            setBusy(true);
            try {
              await onOpen(token, selectedStaffIds);
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
          disabled={busy || !openShift || readOnly || selectedStaffIds.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await onClose(token, selectedStaffIds);
              setSelectedStaffIds([]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Закрыть смену
        </button>
      </div>
      {role !== 'ADMIN' && (
        <div className="opsList">
          {shifts.map((shift) => (
            <p key={shift.id}>
              {shift.status} | Открыл: {shift.openedBy} | Закрыл: {shift.closedBy ?? '-'} | Чеки:{' '}
              {shift.checksCount} | Товары: {shift.itemsCount}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamMemberCard({
  token,
  member,
  seller,
  role,
  openShiftId,
  onDirectorSetPercent,
}: {
  token: string;
  member: StaffMember;
  seller?: SellerProfile;
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  openShiftId?: string;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const isRetoucher = member.staffPosition === 'RETOUCHER';
  const isShiftOpen = Boolean(openShiftId && member.assignedShiftId === openShiftId);
  const shiftStatusLabel = isShiftOpen ? 'Смена открыта' : 'Смена закрыта';
  const retoucherRatePct = member.retoucherRatePercent ?? 5;
  const retoucherImpliedRevToday =
    isRetoucher && retoucherRatePct > 0
      ? Math.round(member.earningsAmount / (retoucherRatePct / 100))
      : 0;
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
    <article
      className={`teamMemberCard ${isShiftOpen ? 'teamMemberCardShiftOpen' : 'teamMemberCardShiftClosed'}`}
    >
      <div className="teamMemberTop">
        <div>
          <p className="teamMemberName">
            <strong>{member.fullName}</strong>{' '}
            <span className="teamMemberNick">({member.nickname})</span>
            {isRetoucher ? (
              <span className="statusPill statusPillOn retoucherBadge">Ретушёр</span>
            ) : null}
          </p>
          <p className="teamMemberMeta">
            Смена: {member.assignedShiftId ?? '—'}
          </p>
          <p className={`teamMemberShiftState ${isShiftOpen ? 'shiftOpen' : 'shiftClosed'}`}>
            {shiftStatusLabel}
          </p>
        </div>
        <span
          className={member.isActive ? 'statusPill statusPillOn' : 'statusPill statusPillOff'}
        >
          {member.isActive ? 'Активен' : 'Отключён'}
        </span>
      </div>

      {isRetoucher && (
        <div className="teamMemberStats">
          <div className="statCell">
            <span className="statLabel">Выручка точки (сегодня)</span>
            <span className="statValue">
              {retoucherImpliedRevToday.toLocaleString('ru-RU')} ₽
            </span>
          </div>
          <div className="statCell">
            <span className="statLabel">{`Начислено (${retoucherRatePct}%)`}</span>
            <span className="statValue">{Math.round(member.earningsAmount).toLocaleString('ru-RU')} ₽</span>
          </div>
        </div>
      )}

      {!isRetoucher && seller && (
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

      {!isRetoucher && seller && role === 'DIRECTOR' && (
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

      {!isRetoucher && !seller && (
        <p className="hint teamHint">Нет профиля продавца — показатели появятся после синхронизации.</p>
      )}
    </article>
  );
}

function TeamStoresOverview({
  token,
  staff,
  sellers,
  sales,
  shifts,
  role,
  onDirectorSetPercent,
  onRemoveFromStore,
  onRestoreStaffToStore,
  reportDayKey,
  onReportDayKeyChange,
  hideRemovedStaff,
  readOnlyTeamActions,
}: {
  token: string;
  staff: StaffMember[];
  sellers: SellerProfile[];
  sales: AdminSale[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
  onRemoveFromStore: (token: string, id: number, storeName?: string) => Promise<void>;
  onRestoreStaffToStore: (token: string, staffId: number, storeName: string) => Promise<void>;
  reportDayKey?: string;
  onReportDayKeyChange?: (dayKey: string) => void;
  hideRemovedStaff?: boolean;
  readOnlyTeamActions?: boolean;
}) {
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const openShiftId = openShift?.id;
  const canEditPercent = role === 'DIRECTOR' || role === 'ACCOUNTANT';
  const sellerById = new Map(sellers.map((item) => [item.id, item]));
  const todayActual = todayKeyMoscow();
  const calendarReportKey = reportDayKey ?? todayActual;
  const reportIsToday = calendarReportKey === todayActual;
  const managerPayrollView = role === 'MANAGER';
  const todaySalesBySellerId = new Map<number, number>();
  const [draftPercent, setDraftPercent] = useState<Record<number, string>>({});
  const [busyPercentMemberId, setBusyPercentMemberId] = useState<number | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [percentEditingId, setPercentEditingId] = useState<number | null>(null);
  const skipPercentBlurSave = useRef(false);

  const restoreStoreChoices = useMemo(() => {
    const names = new Set<string>();
    for (const s of sellers) {
      names.add(s.storeName);
    }
    for (const m of staff) {
      for (const sn of staffAssignedStores(m)) {
        names.add(sn);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ru-RU'));
  }, [sellers, staff]);

  const [restorePickStore, setRestorePickStore] = useState<Record<number, string>>({});
  const [restoreBusyId, setRestoreBusyId] = useState<number | null>(null);

  const [storeAccordionOpen, setStoreAccordionOpen] = useState<Record<string, boolean>>({});

  /** По умолчанию секции свёрнуты; открыто только при явном `true`. */
  const isStoreAccordionOpen = (name: string) => storeAccordionOpen[name] === true;

  const toggleStoreAccordion = (name: string) => {
    setStoreAccordionOpen((prev) => ({
      ...prev,
      [name]: !(prev[name] === true),
    }));
  };

  /** Блок «Удалённые сотрудники»: по умолчанию свёрнут. */
  const [removedStaffAccordionOpen, setRemovedStaffAccordionOpen] = useState(false);

  for (const sale of sales) {
    if (calendarDayKeyMoscow(sale.createdAt) !== calendarReportKey) {
      continue;
    }
    todaySalesBySellerId.set(sale.sellerId, (todaySalesBySellerId.get(sale.sellerId) ?? 0) + sale.totalAmount);
  }

  const storeNamesFromAssignments = new Set<string>();
  for (const member of staff) {
    if (!member.isActive) {
      continue;
    }
    for (const sn of staffAssignedStores(member)) {
      storeNamesFromAssignments.add(sn);
    }
  }
  const storesSorted = Array.from(storeNamesFromAssignments).sort((a, b) =>
    a.localeCompare(b, 'ru-RU'),
  );

  const removedStaffRows = staff.filter((member) => {
    const assigns = staffAssignedStores(member);
    return !member.isActive || assigns.length === 0;
  });
  removedStaffRows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

  return (
    <div className="staffPanelRoot staffPanelStoresOverview">
      <h4 className="staffPanelTitle">Команда по магазинам</h4>
      {onReportDayKeyChange ? (
        <div className="teamReportDateBar">
          <label className="teamReportDateLabel">
            <span>Дата отчётности</span>
            <input
              type="date"
              value={reportDayKey ?? todayActual}
              onChange={(event) => onReportDayKeyChange(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <div className="teamStoresBoard">
        {storesSorted.map((storeName) => {
          const members = staff.filter(
            (member) =>
              member.isActive && staffAssignedStores(member).includes(storeName),
          );
          if (members.length === 0) {
            return null;
          }
          const accordionExpanded = isStoreAccordionOpen(storeName);
          return (
          <section
            key={storeName}
            className={`teamStoreSection ${accordionExpanded ? '' : 'teamStoreSection--collapsed'}`}
          >
            <button
              type="button"
              className="teamStoreAccordionTrigger"
              aria-expanded={accordionExpanded}
              onClick={() => toggleStoreAccordion(storeName)}
            >
              <span className="teamStoreTitleText">{storeName}</span>
              <span className="teamStoreAccordionChevron" aria-hidden>
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="currentColor" d="M7 10l5 5 5-5z" />
                </svg>
              </span>
            </button>
            <div className="teamStoreAccordionPanel">
              <div className="teamStoreAccordionPanelInner">
                <div className={managerPayrollView ? 'teamManagerPayrollList' : 'teamStoreGrid'}>
                    {managerPayrollView ? (
                      <div className="teamManagerPayrollHeader">
                        <span>Имя</span>
                        <span>Зарплата за день</span>
                      </div>
                    ) : null}
              {members
                .slice()
                .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'))
                .map((member) => {
                  const seller = sellerById.get(member.id);
                  const isRetoucher = member.staffPosition === 'RETOUCHER';
                  const isShiftOpen = Boolean(openShiftId && member.assignedShiftId === openShiftId);
                  const ratePctRetoucher = member.retoucherRatePercent ?? 5;
                  const retoucherEarn = isRetoucher
                    ? retoucherEarnRubSnapshot(storeName, sellers, sales, ratePctRetoucher, calendarReportKey)
                    : null;
                  if (managerPayrollView) {
                    const salaryDayRub = isRetoucher
                      ? (retoucherEarn?.todayRub ?? 0)
                      : Math.round(
                          ((todaySalesBySellerId.get(member.id) ?? 0) * (seller?.ratePercent ?? 0)) / 100,
                        );
                    const compactName = member.fullName
                      .replace(` — ${storeName}`, '')
                      .replace(` - ${storeName}`, '')
                      .trim();
                    return (
                      <div key={`${storeName}-${member.id}`} className="teamManagerPayrollRow">
                        <span className="teamManagerPayrollName">{compactName || member.fullName}</span>
                        <span className="teamManagerPayrollSalary">
                          {salaryDayRub.toLocaleString('ru-RU')} ₽
                        </span>
                      </div>
                    );
                  }
                  const todaySales = todaySalesBySellerId.get(member.id) ?? 0;
                  const lifetimeSalesSeller = sellerLifetimeSalesRub(seller, sales);
                  const statPrimaryLabel = isRetoucher
                    ? reportIsToday
                      ? 'Заработок за сегодня'
                      : 'Заработок за выбранный день'
                    : reportIsToday
                      ? 'Продажи за сегодня'
                      : 'Продажи за выбранный день';
                  const statPrimaryRub = isRetoucher ? retoucherEarn!.todayRub : todaySales;
                  const statSecondaryLabel = isRetoucher ? 'Заработок за всё время' : 'Продажи за всё время';
                  const statSecondaryRub = isRetoucher ? retoucherEarn!.lifetimeRub : lifetimeSalesSeller;
                  const baselinePercent = seller?.ratePercent ?? member.retoucherRatePercent ?? 5;
                  const currentPercent = baselinePercent;
                  const percentEditable = canEditPercent && Boolean(seller || isRetoucher);

                  return (
                    <article
                      key={`${storeName}-${member.id}`}
                      className={`teamMemberCard storeTeamMemberCard ${isShiftOpen ? 'teamMemberCardShiftOpen' : 'teamMemberCardShiftClosed'}`}
                    >
                      <div className="teamMemberTop">
                        <div>
                          <p className="teamMemberName">
                            <strong>{member.fullName}</strong>{' '}
                            <span className="teamMemberNick">({member.nickname})</span>
                            {isRetoucher ? (
                              <span className="statusPill statusPillOn retoucherBadge">Ретушёр</span>
                            ) : null}
                          </p>
                          <p className={`teamMemberShiftState ${isShiftOpen ? 'shiftOpen' : 'shiftClosed'}`}>
                            {isShiftOpen ? 'Смена открыта' : 'Смена закрыта'}
                          </p>
                        </div>
                        {!readOnlyTeamActions ? (
                          <div className="teamMemberTopActions">
                            <button
                              type="button"
                              className="teamMemberDeletePill"
                              aria-label="Убрать из магазина"
                              disabled={removingMemberId === member.id}
                              title="Убрать сотрудника из этого магазина"
                              onClick={async () => {
                                const ok = window.confirm(
                                  `Убрать «${member.fullName}» из точки «${storeName}»?`,
                                );
                                if (!ok) {
                                  return;
                                }
                                setRemovingMemberId(member.id);
                                try {
                                  await onRemoveFromStore(token, member.id, storeName);
                                } finally {
                                  setRemovingMemberId(null);
                                }
                              }}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                                <path
                                  d="M4 7h16M9 3h6M10 11v6M14 11v6M6.5 7l1 13h9l1-13"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="teamMemberStats">
                        <div className="statCell">
                          <span className="statLabel">{statPrimaryLabel}</span>
                          <span className="statValue">{statPrimaryRub.toLocaleString('ru-RU')} ₽</span>
                        </div>
                        <div className="statCell">
                          <span className="statLabel">{statSecondaryLabel}</span>
                          <span className="statValue">{statSecondaryRub.toLocaleString('ru-RU')} ₽</span>
                        </div>
                        {percentEditable ? (
                          percentEditingId === member.id ? (
                            <div className="statCell statCellPercentEdit">
                              <span className="statLabel">Текущий %</span>
                              <input
                                className="statPercentInlineInput"
                                value={draftPercent[member.id] ?? String(currentPercent)}
                                disabled={busyPercentMemberId === member.id}
                                autoFocus
                                inputMode="decimal"
                                onChange={(event) =>
                                  setDraftPercent((prev) => ({
                                    ...prev,
                                    [member.id]: event.target.value,
                                  }))
                                }
                                onBlur={async () => {
                                  if (skipPercentBlurSave.current) {
                                    skipPercentBlurSave.current = false;
                                    return;
                                  }
                                  if (percentEditingId !== member.id) {
                                    return;
                                  }
                                  const raw = (draftPercent[member.id] ?? '').trim().replace(',', '.');
                                  setPercentEditingId(null);
                                  if (!raw) {
                                    setDraftPercent((prev) => {
                                      const next = { ...prev };
                                      delete next[member.id];
                                      return next;
                                    });
                                    return;
                                  }
                                  const next = Number(raw);
                                  const safe = Number.isFinite(next) ? next : baselinePercent;
                                  if (safe !== baselinePercent) {
                                    setBusyPercentMemberId(member.id);
                                    try {
                                      await onDirectorSetPercent(token, member.id, safe);
                                    } finally {
                                      setBusyPercentMemberId(null);
                                    }
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    skipPercentBlurSave.current = true;
                                    setPercentEditingId(null);
                                    setDraftPercent((prev) => {
                                      const next = { ...prev };
                                      delete next[member.id];
                                      return next;
                                    });
                                  }
                                  if (event.key === 'Enter') {
                                    (event.target as HTMLInputElement).blur();
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="statCell statPercentToggleBtn"
                              disabled={busyPercentMemberId === member.id}
                              onClick={() => {
                                setPercentEditingId(member.id);
                                setDraftPercent((prev) => ({
                                  ...prev,
                                  [member.id]: String(baselinePercent),
                                }));
                              }}
                            >
                              <span className="statLabel">Текущий %</span>
                              <span className="statValue strong">{currentPercent}%</span>
                            </button>
                          )
                        ) : (
                          <div className="statCell">
                            <span className="statLabel">Текущий %</span>
                            <span className="statValue strong">{currentPercent}%</span>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
                </div>
              </div>
            </div>
          </section>
          );
        })}
      </div>

      {!hideRemovedStaff ? (
      <section
        className={`teamStoresRemovedWrap ${removedStaffAccordionOpen ? '' : 'teamStoresRemovedWrap--collapsed'}`}
      >
        <button
          type="button"
          id="team-stores-removed-heading"
          className="teamStoresRemovedAccordionTrigger"
          aria-expanded={removedStaffAccordionOpen}
          aria-controls="team-stores-removed-panel"
          onClick={() => setRemovedStaffAccordionOpen((open) => !open)}
        >
          <span className="teamStoresRemovedTriggerTitle">Удалённые сотрудники</span>
          <span className="teamStoresRemovedAccordionChevron" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </span>
        </button>
        <div
          id="team-stores-removed-panel"
          className="teamStoresRemovedAccordionPanel"
          role="region"
          aria-labelledby="team-stores-removed-heading"
        >
          <div className="teamStoresRemovedAccordionPanelInner">
            <p className="teamStoresRemovedIntro">
              Отключённые учётные записи и те, у кого не осталось привязки ни к одной точке после исключения из
              состава.
            </p>
            {removedStaffRows.length === 0 ? (
              <p className="teamStoresRemovedEmpty">Записей пока нет.</p>
            ) : (
              <ul className="teamStoresRemovedList">
                {removedStaffRows.map((member) => {
                  const isRetoucher = member.staffPosition === 'RETOUCHER';
                  const reasonLabel = !member.isActive ? 'Отключён' : 'Не привязан к точкам';
                  const chosenStore =
                    restorePickStore[member.id] ?? restoreStoreChoices[0] ?? '';
                  return (
                    <li key={`removed-${member.id}`} className="teamStoresRemovedRow">
                      <span className="teamStoresRemovedName">
                        <strong>{member.fullName}</strong>{' '}
                        <span className="teamMemberNick">({member.nickname})</span>
                      </span>
                      <span className="teamStoresRemovedBadges">
                        {isRetoucher ? (
                          <span className="statusPill statusPillOn retoucherBadge">Ретушёр</span>
                        ) : (
                          <span className="teamStoresRemovedRoleSeller">Продавец</span>
                        )}
                      </span>
                      <span className="teamStoresRemovedReason">{reasonLabel}</span>
                      <span className="teamStoresRemovedRestore">
                        <select
                          className="teamStoresRestoreSelect"
                          aria-label={`Точка для восстановления ${member.fullName}`}
                          value={chosenStore}
                          onChange={(event) =>
                            setRestorePickStore((prev) => ({
                              ...prev,
                              [member.id]: event.target.value,
                            }))
                          }
                          disabled={restoreStoreChoices.length === 0 || restoreBusyId === member.id}
                        >
                          {restoreStoreChoices.length === 0 ? (
                            <option value="">Нет точек в списке</option>
                          ) : (
                            restoreStoreChoices.map((sn) => (
                              <option key={sn} value={sn}>
                                {sn}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          className="teamStoresRestoreBtn"
                          disabled={
                            restoreStoreChoices.length === 0 ||
                            !chosenStore ||
                            restoreBusyId === member.id
                          }
                          onClick={async () => {
                            const ok = window.confirm(
                              `Вернуть «${member.fullName}» в точку «${chosenStore}»? Учётная запись будет активна.`,
                            );
                            if (!ok) {
                              return;
                            }
                            setRestoreBusyId(member.id);
                            try {
                              await onRestoreStaffToStore(token, member.id, chosenStore);
                            } finally {
                              setRestoreBusyId(null);
                            }
                          }}
                        >
                          {restoreBusyId === member.id ? '…' : 'Вернуть'}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
      ) : null}
    </div>
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
  showOnlyCards,
  hideCards,
  managementAccordion,
  onAdd,
  onAddFromBase,
  onRemoveFromStore,
  onDirectorSetPercent,
}: {
  token: string;
  staff: StaffMember[];
  sellers: SellerProfile[];
  globalEmployees: GlobalEmployee[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  readOnly?: boolean;
  showOnlyCards?: boolean;
  hideCards?: boolean;
  managementAccordion?: boolean;
  onAdd: (token: string, fullName: string, nickname: string) => Promise<void>;
  onAddFromBase: (token: string, employeeId: number) => Promise<void>;
  onRemoveFromStore: (token: string, id: number, storeName?: string) => Promise<void>;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [pickedEmployeeId, setPickedEmployeeId] = useState<number | null>(null);
  const baseCandidates = globalEmployees.filter((employee) => {
    const existing = staff.find((member) => member.id === employee.id);
    return existing?.staffPosition !== 'RETOUCHER';
  });
  const firstGlobalId = baseCandidates[0]?.id ?? 0;
  const selectedEmployeeId =
    pickedEmployeeId !== null && baseCandidates.some((employee) => employee.id === pickedEmployeeId)
      ? pickedEmployeeId
      : firstGlobalId;
  const staffIds = new Set(staff.map((member) => member.id));
  const selectedEmployee = baseCandidates.find((employee) => employee.id === selectedEmployeeId);
  const alreadyInStore = selectedEmployee ? staffIds.has(selectedEmployee.id) : false;
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const removableSalesStaff = staff.filter((member) => member.staffPosition === 'SALES');
  const [pickedRemovalStaffId, setPickedRemovalStaffId] = useState<number | null>(null);
  const firstRemovableStaffId = removableSalesStaff[0]?.id ?? 0;
  const selectedRemovalStaffId =
    pickedRemovalStaffId !== null && removableSalesStaff.some((member) => member.id === pickedRemovalStaffId)
      ? pickedRemovalStaffId
      : firstRemovableStaffId;
  const selectedRemovalStaff = removableSalesStaff.find((member) => member.id === selectedRemovalStaffId);
  const shouldRenderCards = !hideCards || showOnlyCards;
  const [staffCardsBlockOpen, setStaffCardsBlockOpen] = useState(false);
  const [managementAccordionOpen, setManagementAccordionOpen] = useState(false);

  if (showOnlyCards) {
    return (
      <div className="opsCard staffPanelRoot">
        <section
          className={`staffCardsBlockAccordion ${staffCardsBlockOpen ? '' : 'staffCardsBlockAccordion--collapsed'}`}
        >
          <button
            type="button"
            className="staffCardsBlockAccordionTrigger"
            aria-expanded={staffCardsBlockOpen}
            onClick={() => setStaffCardsBlockOpen((open) => !open)}
          >
            <span className="staffCardsBlockAccordionTitle">Карточки сотрудников</span>
            <span className="staffCardsBlockAccordionChevron" aria-hidden>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="staffCardsBlockAccordionPanel">
            <div className="staffCardsBlockAccordionPanelInner">
              <div className="opsList teamRoster">
                {staff.map((member) => {
                  const seller = sellers.find((item) => item.id === member.id);
                  return (
                    <TeamMemberCard
                      key={
                        member.staffPosition === 'RETOUCHER'
                          ? `reto-${member.id}`
                          : seller
                            ? `${member.id}-${seller.ratePercent}`
                            : String(member.id)
                      }
                      token={token}
                      member={member}
                      seller={seller}
                      role={role}
                      openShiftId={openShift?.id}
                      onDirectorSetPercent={onDirectorSetPercent}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="opsCard staffPanelRoot">
      {managementAccordion ? (
        <section
          className={`staffManagementAccordion ${managementAccordionOpen ? '' : 'staffManagementAccordion--collapsed'}`}
        >
          <button
            type="button"
            className="staffManagementAccordionTrigger"
            aria-expanded={managementAccordionOpen}
            onClick={() => setManagementAccordionOpen((open) => !open)}
          >
            <span className="staffManagementAccordionTitle">Управление персоналом</span>
            <span className="staffManagementAccordionChevron" aria-hidden>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="staffManagementAccordionPanel">
            <div className="staffManagementAccordionPanelInner">
              {readOnly ? (
                <p className="staffPanelIntro">Просмотр персонала (бухгалтер).</p>
              ) : null}
              {!readOnly && (
                <>
                  <div className="inlineGrid staffPanelAddRow">
                    <label className="staffPanelAddField">
                      <span>ФИО</span>
                      <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
                    </label>
                    <label className="staffPanelAddField">
                      <span>Ник</span>
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
                        {baseCandidates.map((employee) => (
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
                    <p className="inlineStatus">
                      {baseCandidates.length === 0
                        ? 'Доступных продавцов в общей базе нет'
                        : alreadyInStore
                          ? 'Уже добавлен в эту точку'
                          : ''}
                    </p>
                  </div>
                  <div className="inlineGrid inlineGridStaffBase staffBaseBlock">
                    <label>
                      Убрать продавца из магазина
                      <select
                        value={selectedRemovalStaffId}
                        onChange={(event) => setPickedRemovalStaffId(Number(event.target.value))}
                      >
                        {removableSalesStaff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.fullName} ({member.nickname}) - {member.storeName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="ghost"
                      type="button"
                      disabled={!selectedRemovalStaffId}
                      onClick={async () => {
                        if (!selectedRemovalStaff) {
                          return;
                        }
                        await onRemoveFromStore(token, selectedRemovalStaff.id, selectedRemovalStaff.storeName);
                        setPickedRemovalStaffId(null);
                      }}
                    >
                      Убрать из магазина
                    </button>
                    <p className="inlineStatus">
                      {removableSalesStaff.length === 0 ? 'Нет продавцов для удаления из точки' : ''}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <h4 className="staffPanelTitle">Управление персоналом</h4>
          <p className="staffPanelIntro">
            {readOnly
              ? 'Просмотр персонала и показателей (роль «Бухгалтер»).'
              : 'Добавьте сотрудника вручную или из общей базы. Ниже — карточки с действиями и показателями.'}
          </p>
          {!readOnly && (
            <>
              <div className="inlineGrid staffPanelAddRow">
                <label className="staffPanelAddField">
                  <span>ФИО</span>
                  <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </label>
                <label className="staffPanelAddField">
                  <span>Ник</span>
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
                    {baseCandidates.map((employee) => (
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
                <p className="inlineStatus">
                  {baseCandidates.length === 0
                    ? 'Доступных продавцов в общей базе нет'
                    : alreadyInStore
                      ? 'Уже добавлен в эту точку'
                      : ''}
                </p>
              </div>
              <div className="inlineGrid inlineGridStaffBase staffBaseBlock">
                <label>
                  Убрать продавца из магазина
                  <select
                    value={selectedRemovalStaffId}
                    onChange={(event) => setPickedRemovalStaffId(Number(event.target.value))}
                  >
                    {removableSalesStaff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName} ({member.nickname}) - {member.storeName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="ghost"
                  type="button"
                  disabled={!selectedRemovalStaffId}
                  onClick={async () => {
                    if (!selectedRemovalStaff) {
                      return;
                    }
                    await onRemoveFromStore(token, selectedRemovalStaff.id, selectedRemovalStaff.storeName);
                    setPickedRemovalStaffId(null);
                  }}
                >
                  Убрать из магазина
                </button>
                <p className="inlineStatus">
                  {removableSalesStaff.length === 0 ? 'Нет продавцов для удаления из точки' : ''}
                </p>
              </div>
            </>
          )}
        </>
      )}
      {shouldRenderCards && (
        <div className="opsList teamRoster">
          {staff.map((member) => {
            const seller = sellers.find((item) => item.id === member.id);
            return (
              <TeamMemberCard
                key={
                  member.staffPosition === 'RETOUCHER'
                    ? `reto-${member.id}`
                    : seller
                      ? `${member.id}-${seller.ratePercent}`
                      : String(member.id)
                }
                token={token}
                member={member}
                seller={seller}
                role={role}
                openShiftId={openShift?.id}
                onDirectorSetPercent={onDirectorSetPercent}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function DirectorWarehousePanel({
  token,
  overview,
  onReload,
  onReplenish,
}: {
  token: string;
  overview: InventoryOverviewResponse | null;
  onReload: () => Promise<void>;
  onReplenish: (token: string, name: string, qtyStr: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busyName, setBusyName] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const rows = overview?.products ?? [];

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await onReload();
    } catch {
      setError('Не удалось обновить данные');
    } finally {
      setRefreshing(false);
    }
  };

  const handleReplenish = async (name: string) => {
    setBusyName(name);
    setError('');
    setStatus('');
    try {
      await onReplenish(token, name, draft[name] ?? '0');
      setDraft((current) => ({ ...current, [name]: '' }));
      setStatus(`Склад пополнен: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось пополнить склад');
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="invGlassRoot directorWarehouseRoot">
      <div className="invGlassShell directorWarehouseShell">
        <header className="invGlassHeader directorWarehouseHeader">
          <h3 className="invGlassTitle directorWarehouseTitle">Склад и остатки</h3>
          <button
            type="button"
            className="invGhostBtn directorWarehouseRefreshBtn"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Обновить"
            title="Обновить"
          >
            {refreshing ? '…' : '↻'}
          </button>
        </header>

        {error ? (
          <p className="invInlineError" role="alert">
            {error}
          </p>
        ) : null}
        {status ? <p className="invInlineOk">{status}</p> : null}

        <div className="invTableScroll invTableScrollFit directorWarehouseTableWrap">
          <table className="invTable invTableWarehouse">
            <thead>
              <tr>
                <th scope="col">Товар</th>
                <th className="invThNum dwThNum" scope="col" title="Центральный склад">
                  Склад
                </th>
                <th className="invThNum dwThNum" scope="col" title="Сумма по всем точкам">
                  Точки
                </th>
                <th className="invThNum dwThNum" scope="col">
                  Всего
                </th>
                <th className="invThAction dwThAction" scope="col" title="Количество и подтверждение пополнения">
                  Кол-во
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="invTableEmpty">
                    {overview ? 'Нет позиций в каталоге' : 'Загрузка остатков…'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.name}>
                    <td className="invTdName">{row.name}</td>
                    <td className="invTdNum dwTdNum">
                      <span className="dwQty">{row.qtyWarehouse}</span>
                    </td>
                    <td className="invTdNum dwTdNum">
                      <span className="dwQty dwQtyMuted">{row.qtyInStores}</span>
                    </td>
                    <td className="invTdNum dwTdNum">
                      <span className="dwQty dwQtyTotal">{row.qtyGrandTotal}</span>
                    </td>
                    <td className="invTdAction dwTdAction">
                      <div className="dwReplenish" role="group" aria-label={`Пополнить склад: ${row.name}`}>
                        <input
                          className="dwReplenishInput"
                          inputMode="numeric"
                          placeholder="0"
                          value={draft[row.name] ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [row.name]: event.target.value }))
                          }
                          aria-label={`Штук для пополнения: ${row.name}`}
                        />
                        <button
                          type="button"
                          className="dwReplenishBtn"
                          disabled={busyName === row.name}
                          title="Пополнить склад"
                          aria-label="Подтвердить пополнение"
                          onClick={() => void handleReplenish(row.name)}
                        >
                          {busyName === row.name ? '…' : '✓'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StoreInventoryControlPanel({
  token,
  detail,
  storeName,
  onReload,
  onReceiveFromWarehouse,
}: {
  token: string;
  detail: StoreInventoryDetailResponse | null;
  storeName: string;
  onReload: () => Promise<void>;
  onReceiveFromWarehouse: (token: string, storeName: string, name: string, qtyStr: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busyName, setBusyName] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const rows = detail?.products ?? [];

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await onReload();
    } catch {
      setError('Не удалось обновить данные');
    } finally {
      setRefreshing(false);
    }
  };

  const handleReceive = async (name: string) => {
    setBusyName(name);
    setError('');
    setStatus('');
    try {
      await onReceiveFromWarehouse(token, storeName, name, draft[name] ?? '0');
      setDraft((current) => ({ ...current, [name]: '' }));
      setStatus(`Принято на точку: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять товар');
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="invGlassRoot storeInventoryRoot storeInventoryPanel">
      <div className="invGlassShell storeInventoryShell">
        <header className="invGlassHeader storeInventoryHeader">
          <div className="invGlassHeaderText storeInventoryHeaderText">
            <h3 className="invGlassTitle">Учёт на точке</h3>
            <p className="storeInvMetaLine" title={storeName}>
              <strong>{storeName}</strong>
            </p>
          </div>
          <button
            type="button"
            className="invGhostBtn storeInventoryRefreshBtn"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Обновить остатки"
            title="Обновить"
          >
            {refreshing ? '…' : '↻'}
          </button>
        </header>

        {error ? (
          <p className="invInlineError storeInvMessage" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="invInlineOk storeInvMessage" title={status}>
            {status}
          </p>
        ) : null}

        <div className="invTableScroll invTableScrollFit storeInventoryTableWrap">
          <table className="invTable invTableStore">
            <thead>
              <tr>
                <th scope="col">Товар</th>
                <th className="invThNum" scope="col" title="Остаток в магазине">
                  У вас
                </th>
                <th className="invThNum" scope="col" title="На центральном складе">
                  Склад
                </th>
                <th className="invThAction" scope="col" title="Принять со склада на точку" aria-label="Принять">
                  <span className="invThGlyph" aria-hidden>
                    +
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="invTableEmpty">
                    {detail ? 'Нет позиций' : 'Загрузка…'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.name}>
                    <td className="invTdName">{row.name}</td>
                    <td className="invTdNum">
                      <span className="siQty">{row.qtyInStore}</span>
                    </td>
                    <td className="invTdNum">
                      <span className="siQty siQtyMuted">{row.qtyOnWarehouse}</span>
                    </td>
                    <td className="invTdAction">
                      <div className="invActionRow invActionRowTight storeInvActions">
                        <input
                          className="invQtyInput invQtyInputTight siQtyInput"
                          inputMode="numeric"
                          placeholder="шт"
                          value={draft[row.name] ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [row.name]: event.target.value }))
                          }
                          aria-label={`Принять на точку ${row.name}`}
                        />
                        <button
                          type="button"
                          className="invPrimaryMini invPrimaryMiniTight siApplyBtn"
                          disabled={busyName === row.name || row.qtyOnWarehouse <= 0}
                          title="Принять на точку"
                          onClick={() => void handleReceive(row.name)}
                        >
                          {busyName === row.name ? '…' : 'Ок'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
  acquiringPercentPutintsevSber,
  onAcquiringPercentChange,
  onAcquiringPercentDetkovChange,
  onAcquiringPercentPutintsevSberChange,
  onSaveAcquiringPercent,
  onSaveAcquiringPercentDetkov,
  onSaveAcquiringPercentPutintsevSber,
  onSave,
}: {
  token: string;
  products: ProductItem[];
  procurementCosts: ProductProcurementCost[];
  acquiringPercent: string;
  acquiringPercentDetkov: string;
  acquiringPercentPutintsevSber: string;
  onAcquiringPercentChange: (value: string) => void;
  onAcquiringPercentDetkovChange: (value: string) => void;
  onAcquiringPercentPutintsevSberChange: (value: string) => void;
  onSaveAcquiringPercent: (token: string, value: string) => Promise<void>;
  onSaveAcquiringPercentDetkov: (token: string, value: string) => Promise<void>;
  onSaveAcquiringPercentPutintsevSber: (token: string, value: string) => Promise<void>;
  onSave: (token: string, items: Array<{ name: string; cost: number }>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [acquiringSaveError, setAcquiringSaveError] = useState('');
  const [acquiringDetkovSaveError, setAcquiringDetkovSaveError] = useState('');
  const [acquiringPutintsevSberSaveError, setAcquiringPutintsevSberSaveError] = useState('');
  const [acquiringAccordionOpen, setAcquiringAccordionOpen] = useState(false);
  const [costsAccordionOpen, setCostsAccordionOpen] = useState(false);

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
    <div className="accountantProcurementRoot">
      <section
        className={`procurementAccordion ${acquiringAccordionOpen ? '' : 'procurementAccordion--collapsed'}`}
      >
        <button
          type="button"
          className="procurementAccordionTrigger"
          aria-expanded={acquiringAccordionOpen}
          onClick={() => setAcquiringAccordionOpen((open) => !open)}
        >
          <span className="procurementAccordionTriggerTitle">Эквайринг</span>
          <span className="procurementAccordionChevron" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </span>
        </button>
        <div className="procurementAccordionPanel">
          <div className="procurementAccordionPanelInner">
            <div className="procurementAccordionBody">
              <div className="procurementAcquiringGrid">
                <label className="procurementAcquiringField">
                  <span className="procurementAcquiringLabel">Путинцев ВТБ</span>
                  <input
                    className="procurementAcquiringInput"
                    inputMode="decimal"
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
                          setAcquiringSaveError('Не удалось сохранить ставку');
                        }
                      })();
                    }}
                    placeholder="1.94"
                  />
                </label>
                <label className="procurementAcquiringField">
                  <span className="procurementAcquiringLabel">Детков ВТБ</span>
                  <input
                    className="procurementAcquiringInput"
                    inputMode="decimal"
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
                          setAcquiringDetkovSaveError('Не удалось сохранить ставку');
                        }
                      })();
                    }}
                    placeholder="2"
                  />
                </label>
                <label className="procurementAcquiringField">
                  <span className="procurementAcquiringLabel">Путинцев Сбербанк</span>
                  <input
                    className="procurementAcquiringInput"
                    inputMode="decimal"
                    value={acquiringPercentPutintsevSber}
                    onChange={(event) => {
                      setAcquiringPutintsevSberSaveError('');
                      onAcquiringPercentPutintsevSberChange(event.target.value);
                    }}
                    onBlur={(event) => {
                      const value = event.currentTarget.value;
                      void (async () => {
                        try {
                          await onSaveAcquiringPercentPutintsevSber(token, value);
                        } catch {
                          setAcquiringPutintsevSberSaveError('Не удалось сохранить ставку');
                        }
                      })();
                    }}
                    placeholder="1.8"
                  />
                </label>
              </div>
              {(acquiringSaveError || acquiringDetkovSaveError || acquiringPutintsevSberSaveError) && (
                <div className="procurementAcquiringErrors">
                  {acquiringSaveError && (
                    <p className="error procurementInlineError">{acquiringSaveError}</p>
                  )}
                  {acquiringDetkovSaveError && (
                    <p className="error procurementInlineError">{acquiringDetkovSaveError}</p>
                  )}
                  {acquiringPutintsevSberSaveError && (
                    <p className="error procurementInlineError">{acquiringPutintsevSberSaveError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={`procurementAccordion ${costsAccordionOpen ? '' : 'procurementAccordion--collapsed'}`}>
        <button
          type="button"
          className="procurementAccordionTrigger"
          aria-expanded={costsAccordionOpen}
          onClick={() => setCostsAccordionOpen((open) => !open)}
        >
          <span className="procurementAccordionTriggerTitle">Закупочные цены товаров</span>
          <span className="procurementAccordionChevron" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </span>
        </button>
        <div className="procurementAccordionPanel">
          <div className="procurementAccordionPanelInner">
            <div className="procurementAccordionBody">
              <div className="tableWrap procurementTableWrap">
                <table className="procurementCostsTable">
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
                            className="procurementCostInput"
                            inputMode="decimal"
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
              <div className="procurementSaveRow">
                <button type="button" className="primaryAction procurementSaveBtn" onClick={save} disabled={busy}>
                  {busy ? 'Сохраняем...' : 'Сохранить закупочные цены'}
                </button>
              </div>
              {status && <p className="success procurementStatusMsg">{status}</p>}
              {error && <p className="error procurementStatusMsg">{error}</p>}
            </div>
          </div>
        </div>
      </section>
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
  acquiringPercentPutintsevSber,
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
  acquiringPercentPutintsevSber: string;
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
  const acquiringRatePutintsevSber = Math.max(0, Number(acquiringPercentPutintsevSber) || 0);
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
      : isPutintsevSberAcquiringStore(storeName)
        ? acquiringRatePutintsevSber
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

  const applyYesterday = () => {
    const today = todayKeyMoscow();
    const y = shiftDayKey(today, -1);
    setRangeFrom(y);
    setRangeTo(y);
  };

  return (
    <div className="opsCard financeReportCard">
      <h4 className="financeReportCardTitle">
        {role === 'DIRECTOR' ? 'Финансовый отчёт директора' : 'Полный отчёт по магазинам'}
      </h4>
      <div className="financeRangeToolbar">
        <div className="financeRangeDates">
          <input
            type="date"
            className="financeRangeDateInput"
            aria-label="Дата начала периода (МСК)"
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
          />
          <input
            type="date"
            className="financeRangeDateInput"
            aria-label="Дата конца периода (МСК)"
            value={rangeTo}
            onChange={(event) => setRangeTo(event.target.value)}
          />
        </div>
        <div className="financeRangePresets">
          <div className="financeRangePresetGrid">
            <button type="button" className="ghost financeRangePresetBtn" onClick={applyYesterday}>
              Вчера
            </button>
            <button type="button" className="ghost financeRangePresetBtn" onClick={() => applyRangePreset(1)}>
              Сегодня
            </button>
          </div>
          <span className="financeRangeSummary">
            {fromDay} — {toDay}
          </span>
        </div>
      </div>
      <div className="financeReportActionsBar">
        <button
          type="button"
          className="primaryAction financeReportSaveBtn"
          onClick={savePlans}
          disabled={plansBusy}
        >
          {plansBusy ? 'Сохраняем план...' : 'Сохранить план выручки'}
        </button>
        <button type="button" className="ghost financeReportExportBtn" onClick={exportXlsx}>
          Экспорт XLSX
        </button>
      </div>
      {plansStatus && <p className="success">{plansStatus}</p>}
      {plansError && <p className="error">{plansError}</p>}
      <div className="tableWrap financeReportTable">
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
