import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, TouchEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import { scheduleIosVisualViewportBumps } from './iosVisualViewportHeight';
import { ChatOfflineNotice } from './desktop/ChatOfflineNotice';
import { ConnectionBanner } from './desktop/ConnectionBanner';
import { DesktopAppLayout } from './desktop/DesktopAppLayout';
import { DirectorAccountSwitcher } from './desktop/DirectorAccountSwitcher';
import { isTauriRuntime } from './desktop/tauri';
import {
  applyDesktopTheme,
  getStoredDesktopTheme,
  storeDesktopTheme,
  type DesktopTheme,
} from './desktop/desktopTheme';
import { DesktopThemeToggle } from './desktop/DesktopThemeToggle';

if (isTauriRuntime()) {
  applyDesktopTheme(getStoredDesktopTheme());
}
import { useDesktopConnection } from './desktop/useDesktopConnection';
import { fetchWithTimeout } from './sync/fetchTimeout';
import {
  appendOfflineSale,
  readOfflineQueue,
  writeOfflineQueue,
  type OfflineQueuedSale,
} from './offlineSalesQueue';
import {
  isLikelyOfflineFetchError as isOfflineFetchError,
  listAdminSalesQueue,
  loadAdminCache,
  loadAdminResource,
  loadSyncCache,
  loadSyncResource,
  newClientId,
  runAdminMutation,
  startSyncEngine,
} from './sync';
import {
  loadRevenuePlansWithCache,
  patchRevenuePlansCache,
  type StoreRevenuePlanRow,
} from './sync/admin/revenuePlans';

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
 * «Кассы сотрудников» — сумма продаж за сегодня (все виды оплаты), не комиссия.
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

  const sellerRegisterToday = (sellerId: number) => {
    let total = 0;
    for (const sale of sales) {
      if (sale.sellerId !== sellerId) {
        continue;
      }
      if (calendarDayKeyMoscow(sale.createdAt) !== today) {
        continue;
      }
      total += sale.totalAmount;
    }
    return total;
  };

  const sellerRegister = [...storeSellers]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'))
    .map((s) => ({
      fullName: s.fullName,
      cash: formatRub(sellerRegisterToday(s.id)),
    }));
  for (const r of retoucherStaff) {
    sellerRegister.push({
      fullName: r.fullName,
      cash: formatRub(0),
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
  /** Сводка по планам выручки (день = бизнес-ключ Москвы), только для роли MANAGER. */
  managerRevenuePlanCompliance?: {
    dayKey: string;
    items: Array<{
      storeName: string;
      planRub: number;
      actualRub: number;
      hasPlan: boolean;
      met: boolean;
      progressPct: number;
    }>;
  };
  writeOffs?: Array<{
    id: string;
    createdAt: string;
    name: string;
    qty: number;
    reason: 'Брак' | 'Поломка';
  }>;
  sellerRegister?: Array<{ fullName: string; cash: string }>;
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

type StoreEquipmentBuiltinKey =
  | 'pc'
  | 'camera'
  | 'printer'
  | 'sdCard'
  | 'monitor'
  | 'mouse'
  | 'keyboard'
  | 'cardReader';

type StoreEquipmentCounts = {
  pc: number;
  camera: number;
  printer: number;
  sdCard: number;
  monitor: number;
  mouse: number;
  keyboard: number;
  cardReader: number;
  extra: Record<string, number>;
};

type StoreEquipmentCustomType = { id: string; label: string };

type StoreEquipmentField =
  | { kind: 'builtin'; key: StoreEquipmentBuiltinKey; label: string }
  | { kind: 'custom'; id: string; label: string };

const STORE_EQUIPMENT_ROWS: Array<{ key: StoreEquipmentBuiltinKey; label: string }> = [
  { key: 'pc', label: 'ПК' },
  { key: 'camera', label: 'Фотоаппарат' },
  { key: 'printer', label: 'Принтер' },
  { key: 'sdCard', label: 'SDcard' },
  { key: 'monitor', label: 'Монитор' },
  { key: 'mouse', label: 'Мышь' },
  { key: 'keyboard', label: 'Клавиатура' },
  { key: 'cardReader', label: 'Картридер' },
];

function buildStoreEquipmentFields(customTypes: StoreEquipmentCustomType[]): StoreEquipmentField[] {
  return [
    ...STORE_EQUIPMENT_ROWS.map((row) => ({ kind: 'builtin' as const, key: row.key, label: row.label })),
    ...customTypes.map((t) => ({ kind: 'custom' as const, id: t.id, label: t.label })),
  ];
}

function storeEquipmentQty(counts: StoreEquipmentCounts, field: StoreEquipmentField): number {
  if (field.kind === 'builtin') {
    return counts[field.key] ?? 0;
  }
  return counts.extra?.[field.id] ?? 0;
}

function storeEquipmentTotal(counts: StoreEquipmentCounts, fields: StoreEquipmentField[]): number {
  return fields.reduce((sum, field) => sum + storeEquipmentQty(counts, field), 0);
}

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
  return isOfflineFetchError(error);
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

function describeLoginFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Сервер не ответил за 15 секунд. На Render сервис мог «засыпать» — подождите 30 секунд и войдите снова.';
    }
    const msg = error.message.trim().toLowerCase();
    if (
      msg === 'load failed' ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed')
    ) {
      if (import.meta.env.DEV) {
        return 'Приложение не достучалось до сервера (это не ошибка пароля). В dev-режиме нужен CORS для http://localhost:5173 на Render — см. docs/DESKTOP_START_HERE.md или соберите .dmg.';
      }
      return 'Приложение не достучалось до сервера (это не ошибка пароля). Обновите backend на Render или добавьте в CORS_ORIGIN: tauri://localhost,https://tauri.localhost';
    }
    return error.message;
  }
  return 'Не удалось войти. Проверьте интернет и доступность сервера.';
}

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
const SESSION_DIRECTOR_ROOT_KEY = 'sales-platform-director-root-v1';

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

function readDirectorRootSession(): LoginResponse | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_DIRECTOR_ROOT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LoginResponse;
    if (!parsed?.token || parsed.user?.role !== 'DIRECTOR') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDirectorRootSession(data: LoginResponse | null) {
  if (typeof window === 'undefined') {
    return;
  }
  if (!data) {
    window.sessionStorage.removeItem(SESSION_DIRECTOR_ROOT_KEY);
    return;
  }
  window.sessionStorage.setItem(SESSION_DIRECTOR_ROOT_KEY, JSON.stringify(data));
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

function EquipmentIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg" aria-hidden>
        <rect x="4" y="5" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 19h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.5 9h5M9.5 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </DockIcon>
  );
}

function ProcurementIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg" aria-hidden>
        <path
          d="M5 8.5h14v10H5z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M8 8.5V6.8c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8.8 1.8 1.8V8.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 13h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </DockIcon>
  );
}

function WarehouseIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg" aria-hidden>
        <path
          d="M4.5 9.2 12 5l7.5 4.2v9.1L12 22l-7.5-3.7V9.2z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 5v17M4.5 9.2 12 13l7.5-3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 11.8h6v4.2H9z"
          stroke="currentColor"
          strokeWidth="1.8"
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
  const [directorRootSession, setDirectorRootSession] = useState<LoginResponse | null>(() =>
    readDirectorRootSession(),
  );
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [sellers, setSellers] = useState<SellerProfile[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productProcurementCosts, setProductProcurementCosts] = useState<ProductProcurementCost[]>([]);
  const [sales, setSales] = useState<AdminSale[]>([]);
  const [offlineQueueTick, setOfflineQueueTick] = useState(0);
  const [offlinePendingSales, setOfflinePendingSales] = useState<OfflineQueuedSale[]>([]);
  const [outboxSyncing, setOutboxSyncing] = useState(false);
  const [apiReachable, setApiReachable] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine,
  );
  const isDesktopShell = isTauriRuntime();
  const [desktopTheme, setDesktopTheme] = useState<DesktopTheme>(() =>
    isTauriRuntime() ? getStoredDesktopTheme() : 'dark',
  );

  useEffect(() => {
    if (!isDesktopShell) {
      return;
    }
    applyDesktopTheme(desktopTheme);
  }, [isDesktopShell, desktopTheme]);

  const handleDesktopThemeChange = useCallback((theme: DesktopTheme) => {
    setDesktopTheme(theme);
    storeDesktopTheme(theme);
    applyDesktopTheme(theme);
  }, []);

  useEffect(() => {
    if (!isDesktopShell) {
      return;
    }
    void import('./desktop/desktopShell.css');
    void import('./desktop/desktopPages.css');
    void import('./desktop/desktopNative.css');
    void import('./desktop/desktopLuxury.css');
    void import('./desktop/desktopDirectorHome.css');
    void import('./desktop/desktopFinanceOps.css');
    void import('./desktop/desktopFinanceReport.css');
    void import('./desktop/desktopTeamWarehouse.css');
    void import('./desktop/desktopMessenger.css');
    void import('./desktop/desktopDirectorAccountSwitcher.css');
    void import('./desktop/desktopThemes.css');
    void import('./desktop/desktopHermesLight.css');
    void import('./desktop/desktopThemeToggle.css');
    void import('./desktop/desktopStoreEquipment.css');
    void import('./desktop/desktopAcquiring.css');
  }, [isDesktopShell]);

  const desktopConnection = useDesktopConnection(
    outboxSyncing,
    isDesktopShell ? apiReachable : undefined,
  );
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequest[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployee[]>([]);
  const [adminError, setAdminError] = useState('');
  const [salesNotice, setSalesNotice] = useState('');
  const [teamDayKey, setTeamDayKey] = useState(todayKeyMoscow());
  const [acquiringPercent, setAcquiringPercent] = useState('1.8');
  const [acquiringPercentDetkov, setAcquiringPercentDetkov] = useState('1.8');
  const [acquiringPercentPutintsevSber, setAcquiringPercentPutintsevSber] = useState('1.8');
  const [salesExpanded, setSalesExpanded] = useState(() => isTauriRuntime());
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
  /** Пока открыта клавиатура в переписке — прячем нижний док и поджимаем отступы */
  const [chatComposerSurfaceActive, setChatComposerSurfaceActive] = useState(false);
  const refreshMessengerInbox = useCallback(async () => {
    const token = session?.token;
    const r = session?.user?.role;
    if (!token || (r !== 'ADMIN' && r !== 'DIRECTOR' && r !== 'MANAGER')) {
      return;
    }
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/admin/chat/inbox`, {
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

  useEffect(() => {
    if (location.pathname !== '/control') {
      setChatComposerSurfaceActive(false);
    }
  }, [location.pathname]);

  const refreshOfflinePending = useCallback(async () => {
    const userId = session?.user?.id;
    if (userId === undefined) {
      setOfflinePendingSales([]);
      return;
    }
    if (isDesktopShell) {
      setOfflinePendingSales(await listAdminSalesQueue(userId));
      return;
    }
    setOfflinePendingSales(readOfflineQueue(userId));
  }, [session?.user?.id, isDesktopShell]);

  const refreshAdminFromCache = useCallback(async () => {
    const userId = session?.user?.id;
    if (!isDesktopShell || session?.user?.role !== 'ADMIN' || userId === undefined) {
      return;
    }
    const [cachedSellers, cachedProducts, cachedStaff, cachedShifts, cachedSales, cachedInv, cachedGlobal] =
      await Promise.all([
        loadAdminCache<SellerProfile[]>(userId, 'sellers'),
        loadAdminCache<ProductItem[]>(userId, 'products'),
        loadAdminCache<StaffMember[]>(userId, 'staff'),
        loadAdminCache<ShiftInfo[]>(userId, 'shifts'),
        loadAdminCache<AdminSale[]>(userId, 'sales'),
        loadAdminCache<StoreInventoryDetailResponse | null>(userId, 'storeInventory'),
        loadAdminCache<GlobalEmployee[]>(userId, 'globalEmployees'),
      ]);
    if (cachedSellers) {
      setSellers(cachedSellers);
    }
    if (cachedProducts) {
      setProducts(cachedProducts);
    }
    if (cachedStaff) {
      setStaff(cachedStaff);
    }
    if (cachedShifts) {
      setShifts(cachedShifts);
    }
    if (cachedSales) {
      setSales(cachedSales);
    }
    if (cachedInv !== null) {
      setStoreInventory(cachedInv);
    }
    if (cachedGlobal) {
      setGlobalEmployees(cachedGlobal);
    }
  }, [isDesktopShell, session?.user?.id, session?.user?.role]);

  const refreshFinanceFromCache = useCallback(async () => {
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (!isDesktopShell || userId === undefined) {
      return;
    }
    if (role === 'MANAGER') {
      const cachedDashboard = await loadSyncCache<DashboardResponse>(userId, 'dashboard');
      if (cachedDashboard) {
        setDashboard(cachedDashboard);
      }
      return;
    }
    if (role !== 'DIRECTOR' && role !== 'ACCOUNTANT') {
      return;
    }
    const [cachedDashboard, cachedFinance, cachedInventory, cachedCommission, cachedSellers] =
      await Promise.all([
        loadSyncCache<DashboardResponse>(userId, 'dashboard'),
        loadSyncCache<FinanceOpsSnapshot>(userId, 'financeOps'),
        loadSyncCache<InventoryOverviewResponse>(userId, 'inventoryOverview'),
        role === 'DIRECTOR'
          ? loadSyncCache<CommissionRequest[]>(userId, 'commissionRequests')
          : Promise.resolve(null),
        loadSyncCache<SellerProfile[]>(userId, 'sellers'),
      ]);
    if (cachedDashboard) {
      setDashboard(cachedDashboard);
    }
    if (cachedFinance) {
      setFinanceOps(cachedFinance);
    }
    if (cachedInventory) {
      setInventoryOverview(cachedInventory);
    }
    if (cachedCommission) {
      setCommissionRequests(cachedCommission);
    }
    if (cachedSellers) {
      setSellers(cachedSellers);
    }
  }, [isDesktopShell, session?.user?.id, session?.user?.role]);

  useEffect(() => {
    void refreshOfflinePending();
    void refreshAdminFromCache();
    void refreshFinanceFromCache();
  }, [refreshOfflinePending, refreshAdminFromCache, refreshFinanceFromCache, offlineQueueTick]);

  const pendingOfflineSales = useMemo(
    () => offlineQueueToAdminSales(offlinePendingSales, sellers),
    [offlinePendingSales, sellers],
  );

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
    const fetcher = async () => {
      const response = await fetchWithTimeout(`${API_BASE_URL}/dashboard/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Dashboard error');
      }
      return (await response.json()) as DashboardResponse;
    };
    const role = session?.user?.role;
    const desktopDashboardCache =
      isDesktopShell &&
      (role === 'DIRECTOR' || role === 'ACCOUNTANT' || role === 'MANAGER') &&
      session?.user?.id != null;
    try {
      if (desktopDashboardCache) {
        const result = await loadSyncResource(
          API_BASE_URL,
          session.user.id,
          'dashboard',
          fetcher,
          null as unknown as DashboardResponse,
        );
        setDashboard(result.data);
      } else {
        setDashboard(await fetcher());
      }
    } catch {
      setDashboard(null);
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadSellers = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/sellers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('sellers error');
      }
      return (await response.json()) as SellerProfile[];
    };
    const role = session?.user?.role;
    if (
      isDesktopShell &&
      (role === 'ADMIN' || role === 'DIRECTOR' || role === 'ACCOUNTANT') &&
      session?.user?.id != null
    ) {
      const result = await loadSyncResource(API_BASE_URL, session.user.id, 'sellers', fetcher, []);
      setSellers(result.data);
      if (role === 'ADMIN') {
        setAdminError(
          result.fromCache && result.data.length === 0 ? 'Нет сети — продавцы из кэша недоступны.' : '',
        );
      }
      return;
    }
    try {
      setSellers(await fetcher());
      setAdminError('');
    } catch {
      setSellers([]);
      setAdminError('Не удалось загрузить продавцов.');
    }
  };

  const loadProducts = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/products`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('products error');
      }
      return (await response.json()) as ProductItem[];
    };
    if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
      const result = await loadAdminResource(API_BASE_URL, session.user.id, 'products', fetcher, []);
      setProducts(result.data);
      return;
    }
    setProducts(await fetcher());
  };

  const loadInventoryOverview = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/inventory/overview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error('inventory overview error');
        }
        return (await response.json()) as InventoryOverviewResponse;
      };
      const role = session?.user?.role;
      if (
        isDesktopShell &&
        (role === 'DIRECTOR' || role === 'ACCOUNTANT') &&
        session?.user?.id != null
      ) {
        const result = await loadSyncResource(
          API_BASE_URL,
          session.user.id,
          'inventoryOverview',
          fetcher,
          null as unknown as InventoryOverviewResponse,
        );
        setInventoryOverview(result.data);
        return;
      }
      try {
        setInventoryOverview(await fetcher());
      } catch {
        setInventoryOverview(null);
      }
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const loadStoreInventory = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/inventory/my-store`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error('store inventory error');
        }
        return (await response.json()) as StoreInventoryDetailResponse;
      };
      if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
        const result = await loadAdminResource(
          API_BASE_URL,
          session.user.id,
          'storeInventory',
          fetcher,
          null,
        );
        setStoreInventory(result.data);
        return;
      }
      try {
        setStoreInventory(await fetcher());
      } catch {
        setStoreInventory(null);
      }
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const addCatalogProduct = async (token: string, name: string, priceStr: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        price: Math.max(0, Number(priceStr.replace(',', '.')) || 0),
      }),
    });
    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
      const msg = Array.isArray(errBody?.message) ? errBody.message[0] : errBody?.message;
      throw new Error(typeof msg === 'string' ? msg : 'Не удалось добавить товар');
    }
    const data = (await response.json()) as {
      catalog: ProductItem[];
      overview: InventoryOverviewResponse;
    };
    setProducts(data.catalog);
    setInventoryOverview(data.overview);
    const costsResponse = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (costsResponse.ok) {
      setProductProcurementCosts((await costsResponse.json()) as ProductProcurementCost[]);
    }
  };

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
    const fetcher = async () => {
      const response = await fetch(
        `${API_BASE_URL}/admin/revenue-plans?dayKey=${encodeURIComponent(dayKey)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new Error('load revenue plans error');
      }
      return (await response.json()) as StoreRevenuePlan[];
    };
    const uid = session?.user?.id;
    const role = session?.user?.role;
    if (
      isDesktopShell &&
      uid != null &&
      (role === 'DIRECTOR' || role === 'ACCOUNTANT')
    ) {
      const result = await loadRevenuePlansWithCache(API_BASE_URL, uid, dayKey, fetcher);
      return result.data as StoreRevenuePlan[];
    }
    return fetcher();
  };

  const saveRevenuePlans = async (
    token: string,
    dayKey: string,
    items: Array<{ storeName: string; planRevenue: number }>,
  ) => {
    const putOnline = async () => {
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
    const uid = session?.user?.id;
    const role = session?.user?.role;
    if (
      isDesktopShell &&
      uid != null &&
      (role === 'DIRECTOR' || role === 'ACCOUNTANT')
    ) {
      const patchId = newClientId('rev-plan');
      const payload = {
        patchId,
        dayKey,
        items,
        createdAt: new Date().toISOString(),
      };
      const mode = await runAdminMutation(uid, patchId, 'MANAGER_REVENUE_PLANS', payload, async () => {
        await putOnline();
      });
      if (mode === 'queued') {
        const rows: StoreRevenuePlanRow[] = items.map((item) => ({
          dayKey,
          storeName: item.storeName,
          planRevenue: item.planRevenue,
        }));
        await patchRevenuePlansCache(uid, dayKey, rows);
        return rows;
      }
    }
    return putOnline();
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

  const normalizeFinanceOps = (raw: Partial<FinanceOpsSnapshot>): FinanceOpsSnapshot => ({
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

  const loadFinanceOps = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/ops`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('finance ops error');
      }
      return normalizeFinanceOps((await response.json()) as Partial<FinanceOpsSnapshot>);
    };
    const role = session?.user?.role;
    const empty = normalizeFinanceOps({});
    if (
      isDesktopShell &&
      (role === 'DIRECTOR' || role === 'ACCOUNTANT') &&
      session?.user?.id != null
    ) {
      const result = await loadSyncResource(API_BASE_URL, session.user.id, 'financeOps', fetcher, empty);
      setFinanceOps(result.data);
      return;
    }
    setFinanceOps(await fetcher());
  };

  const addFinanceIncome = async (
    token: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => {
    const num = Number(String(payload.amount).replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      return;
    }
    const uid = session?.user?.id;
    const financeOffline =
      isDesktopShell &&
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const incomeId = newClientId('finc');
    const createdAt = new Date().toISOString();
    const body = {
      accountId: payload.accountId,
      amount: num,
      workDay: payload.workDay,
      comment: payload.comment,
      incomeId,
      createdAt,
    };

    const post = async () => {
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
          incomeId,
        }),
      });
      if (!response.ok) {
        throw new Error('add finance income error');
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, incomeId, 'FINANCE_INCOME', body, post);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await post();
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
    const uid = session?.user?.id;
    const financeOffline =
      isDesktopShell &&
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const expenseId = newClientId('fexp');
    const createdAt = new Date().toISOString();
    const body = {
      expenseId,
      accountId: payload.accountId,
      title: payload.title,
      amount,
      comment: payload.comment,
      createdAt,
    };

    const post = async () => {
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
          expenseId,
        }),
      });
      if (!response.ok) {
        throw new Error('add finance expense error');
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, expenseId, 'FINANCE_EXPENSE', body, post);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await post();
    }
    await loadFinanceOps(token);
  };

  const setFinanceAccountBalance = async (token: string, accountId: string, balanceStr: string) => {
    const num = Number(String(balanceStr).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      return;
    }
    const uid = session?.user?.id;
    const directorOffline = isDesktopShell && session?.user?.role === 'DIRECTOR' && uid !== undefined;
    const patchId = newClientId('fbal');
    const createdAt = new Date().toISOString();
    const body = { patchId, accountId, balance: num, createdAt };

    const put = async () => {
      const response = await fetch(
        `${API_BASE_URL}/admin/finance/accounts/${encodeURIComponent(accountId)}/balance`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ balance: num }),
        },
      );
      if (!response.ok) {
        throw new Error('set finance account balance error');
      }
    };

    if (directorOffline) {
      const mode = await runAdminMutation(uid, patchId, 'FINANCE_ACCOUNT_BALANCE', body, put);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await put();
    }
    await loadFinanceOps(token);
  };

  const loadSales = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/sales?ts=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('sales error');
        }
        return (await response.json()) as AdminSale[];
      };
      if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
        const result = await loadAdminResource(API_BASE_URL, session.user.id, 'sales', fetcher, []);
        setSales(result.data);
        return;
      }
      setSales(await fetcher());
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const refreshFinanceInputs = useCallback(async () => {
    if (!session?.token) {
      return;
    }
    await Promise.all([loadSales(session.token), loadProductProcurementCosts(session.token)]);
  }, [session?.token, loadSales, loadProductProcurementCosts]);

  const loadCommissionRequests = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/commission-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('requests error');
      }
      return (await response.json()) as CommissionRequest[];
    };
    if (isDesktopShell && session?.user?.role === 'DIRECTOR' && session.user.id != null) {
      const result = await loadSyncResource(API_BASE_URL, session.user.id, 'commissionRequests', fetcher, []);
      setCommissionRequests(result.data);
      return;
    }
    setCommissionRequests(await fetcher());
  };

  const loadShifts = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/shifts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('shifts error');
      }
      return (await response.json()) as ShiftInfo[];
    };
    if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
      const result = await loadAdminResource(API_BASE_URL, session.user.id, 'shifts', fetcher, []);
      setShifts(result.data);
      return;
    }
    setShifts(await fetcher());
  };

  const loadStaff = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/staff`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('staff error');
      }
      return (await response.json()) as StaffMember[];
    };
    if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
      const result = await loadAdminResource(API_BASE_URL, session.user.id, 'staff', fetcher, []);
      setStaff(result.data);
      return;
    }
    setStaff(await fetcher());
  };

  const loadGlobalEmployees = async (token: string) => {
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/employees/global`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('global employees error');
      }
      return (await response.json()) as GlobalEmployee[];
    };
    if (isDesktopShell && session?.user?.role === 'ADMIN' && session.user.id != null) {
      const result = await loadAdminResource(
        API_BASE_URL,
        session.user.id,
        'globalEmployees',
        fetcher,
        [],
      );
      setGlobalEmployees(result.data);
      return;
    }
    setGlobalEmployees(await fetcher());
  };

  const setDirectorPercent = async (token: string, sellerId: number, ratePercent: number) => {
    const uid = session?.user?.id;
    const directorOffline = isDesktopShell && session?.user?.role === 'DIRECTOR' && uid !== undefined;
    const clientId = newClientId('pct');
    const createdAt = new Date().toISOString();
    const body = { clientId, sellerId, ratePercent, createdAt };

    const put = async () => {
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
    };

    if (directorOffline) {
      const mode = await runAdminMutation(uid, clientId, 'DIRECTOR_SET_PERCENT', body, put);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await put();
    }
    await loadSellers(token);
    await loadStaff(token);
    await loadCommissionRequests(token);
  };

  const decideRequest = async (token: string, requestId: string, decision: 'APPROVE' | 'REJECT') => {
    const uid = session?.user?.id;
    const directorOffline = isDesktopShell && session?.user?.role === 'DIRECTOR' && uid !== undefined;
    const clientId = `${requestId}-${decision}`;
    const createdAt = new Date().toISOString();
    const body = { requestId, decision, createdAt };

    const post = async () => {
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
    };

    if (directorOffline) {
      const mode = await runAdminMutation(uid, clientId, 'DIRECTOR_COMMISSION_DECISION', body, post);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await post();
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
    const saleId = newClientId('sale');
    const entry: OfflineQueuedSale = {
      saleId,
      sellerId,
      items,
      totalAmount,
      paymentType,
      createdAt: new Date().toISOString(),
    };
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;

    const postSale = async () => {
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
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, saleId, 'ADMIN_SALE', entry, postSale);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      try {
        await postSale();
      } catch (error) {
        if (uid !== undefined && isLikelyOfflineFetchError(error)) {
          appendOfflineSale(uid, entry);
          setOfflineQueueTick((x) => x + 1);
          return;
        }
        throw error instanceof Error ? error : new Error('Не удалось сохранить продажу');
      }
    }

    try {
      await loadSellers(token);
      await loadSales(token);
      if (session?.user.role === 'ADMIN') {
        await loadStoreInventory(token);
      }
    } catch {
      // продажа уже на сервере
    }
  };

  const addWriteOff = async (
    token: string,
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
  ) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const requestId = newClientId('wo');
    const createdAt = new Date().toISOString();
    const payload = { requestId, name, qty, reason, createdAt };

    const postWriteOff = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/write-offs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, qty, reason, requestId }),
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
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, requestId, 'ADMIN_WRITE_OFF', payload, postWriteOff);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postWriteOff();
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
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const clientShiftId = newClientId('shift');
    const createdAt = new Date().toISOString();
    const payload = { clientShiftId, assignedSellerIds, createdAt };

    const postOpen = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/shifts/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignedSellerIds, clientShiftId }),
      });
      if (!response.ok) {
        throw new Error('open shift error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, clientShiftId, 'ADMIN_SHIFT_OPEN', payload, postOpen);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postOpen();
    }
    await Promise.all([loadShifts(token), loadStaff(token)]);
  };

  const closeShift = async (token: string, assignedSellerIds: number[] = []) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const closeId = newClientId('shift-close');
    const createdAt = new Date().toISOString();
    const payload = { assignedSellerIds, createdAt };

    const postClose = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/shifts/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignedSellerIds }),
      });
      if (!response.ok) {
        throw new Error('close shift error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, closeId, 'ADMIN_SHIFT_CLOSE', payload, postClose);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postClose();
    }
    await Promise.all([loadShifts(token), loadStaff(token)]);
  };

  const addStaffMember = async (token: string, fullName: string, nickname: string) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const clientMemberId = newClientId('staff');
    const createdAt = new Date().toISOString();
    const payload = { clientMemberId, fullName, nickname, createdAt };

    const postStaff = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName, nickname }),
      });
      if (!response.ok) {
        throw new Error('add staff error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, clientMemberId, 'ADMIN_STAFF_ADD', payload, postStaff);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postStaff();
    }
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const addStaffFromBase = async (token: string, employeeId: number) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const clientId = newClientId('staff-base');
    const createdAt = new Date().toISOString();
    const payload = { employeeId, createdAt };

    const postFromBase = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/staff/from-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ employeeId }),
      });
      if (!response.ok) {
        throw new Error('add from base error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, clientId, 'ADMIN_STAFF_FROM_BASE', payload, postFromBase);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postFromBase();
    }
    await loadStaff(token);
    await loadSellers(token);
  };

  const removeStaffFromStore = async (token: string, id: number, storeName?: string) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const clientId = newClientId('staff-remove');
    const createdAt = new Date().toISOString();
    const payload = { staffId: id, storeName, createdAt };

    const postRemove = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/remove-from-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeName }),
      });
      if (!response.ok) {
        throw new Error('remove staff from store error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, clientId, 'ADMIN_STAFF_REMOVE', payload, postRemove);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postRemove();
    }
    await Promise.all([loadStaff(token), loadSellers(token), loadShifts(token), loadGlobalEmployees(token)]);
  };

  const restoreStaffToStore = async (token: string, staffId: number, storeName: string) => {
    const uid = session?.user?.id;
    const adminDesktop = isDesktopShell && session?.user?.role === 'ADMIN' && uid !== undefined;
    const clientId = newClientId('staff-restore');
    const createdAt = new Date().toISOString();
    const payload = { staffId, storeName, createdAt };

    const postRestore = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/staff/${staffId}/restore-to-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeName }),
      });
      if (!response.ok) {
        throw new Error('restore staff to store error');
      }
    };

    if (adminDesktop) {
      const mode = await runAdminMutation(uid, clientId, 'ADMIN_STAFF_RESTORE', payload, postRestore);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        return;
      }
    } else {
      await postRestore();
    }
    await Promise.all([loadStaff(token), loadSellers(token), loadShifts(token), loadGlobalEmployees(token)]);
  };

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

  const bootstrapLoggedInUser = async (data: LoginResponse) => {
    setSession(data);
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
  };

  const loginWithNicknamePassword = async (loginNick: string, loginPwd: string) => {
    if (!API_BASE_URL) {
      throw new Error(API_CONFIG_ERROR || 'Адрес сервера не задан.');
    }

    const loginRequest = async (path = '/auth/login') => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);
      try {
        return await fetch(`${API_BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nickname: loginNick, password: loginPwd }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    let response: Response;
    try {
      response = await loginRequest();
    } catch (firstError) {
      try {
        response = await loginRequest();
      } catch (secondError) {
        throw secondError instanceof Error ? secondError : firstError;
      }
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

    return (await response.json()) as LoginResponse;
  };

  const handleDirectorSwitchAccount = async (targetNickname: string, targetPassword: string) => {
    if (!session) {
      return;
    }
    if (session.user.role === 'DIRECTOR') {
      writeDirectorRootSession(session);
      setDirectorRootSession(session);
    }
    const data = await loginWithNicknamePassword(targetNickname, targetPassword);
    await bootstrapLoggedInUser(data);
    navigate('/home', { replace: true });
  };

  const handleDirectorReturnToDirector = async () => {
    const root = directorRootSession ?? readDirectorRootSession();
    if (!root) {
      return;
    }
    await bootstrapLoggedInUser(root);
    writeDirectorRootSession(null);
    setDirectorRootSession(null);
    navigate('/home', { replace: true });
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
      const data = await loginWithNicknamePassword(nickname, password);
      writeDirectorRootSession(null);
      setDirectorRootSession(null);
      setPassword('');
      navigate('/home', { replace: true });
      await bootstrapLoggedInUser(data);
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
      setError(describeLoginFetchError(e));
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_PERSISTENCE_KEY);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setSalesNotice('');
    writeDirectorRootSession(null);
    setDirectorRootSession(null);
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
    if (!isDesktopShell || !session?.token || session.user.id == null) {
      return;
    }
    const token = session.token;
    const userId = session.user.id;
    const stop = startSyncEngine({
      apiBaseUrl: API_BASE_URL,
      token,
      userId,
      onSyncingChange: setOutboxSyncing,
      onReachableChange: setApiReachable,
      onFlushed: () => {
        setOfflineQueueTick((x) => x + 1);
        if (session.user.role === 'ADMIN') {
          void Promise.allSettled([
            loadSales(token),
            loadSellers(token),
            loadProducts(token),
            loadShifts(token),
            loadStaff(token),
            loadStoreInventory(token),
            loadGlobalEmployees(token),
          ]);
        } else if (session.user.role === 'MANAGER') {
          void loadDashboard(token).catch(() => undefined);
        } else if (session.user.role === 'DIRECTOR' || session.user.role === 'ACCOUNTANT') {
          void Promise.allSettled([
            loadDashboard(token),
            loadFinanceOps(token),
            loadInventoryOverview(token),
            loadSellers(token),
            ...(session.user.role === 'DIRECTOR'
              ? [loadCommissionRequests(token)]
              : []),
          ]);
        } else {
          void loadSales(token).catch(() => undefined);
          void loadSellers(token).catch(() => undefined);
        }
      },
    });
    return stop;
  }, [isDesktopShell, session?.token, session?.user?.id, session?.user?.role]);

  useEffect(() => {
    if (isDesktopShell || !session?.token || session.user.id == null) {
      return;
    }
    const token = session.token;
    const userId = session.user.id;
    const run = async () => {
      const queueBefore = readOfflineQueue(userId);
      if (
        queueBefore.length === 0 ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
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
      setOfflineQueueTick((x) => x + 1);
      try {
        await loadSales(token);
        await loadSellers(token);
      } catch {
        // offline
      }
    };
    void run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [isDesktopShell, session?.token, session?.user?.id, loadSales, loadSellers]);

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
    if (
      (r === 'DIRECTOR' || r === 'ACCOUNTANT') &&
      (location.pathname === '/sales' || location.pathname === '/accounting/procurement')
    ) {
      void loadInventoryOverview(session.token);
    }
  }, [loadInventoryOverview, location.pathname, session]);

  useEffect(() => {
    if (!isDesktopShell || !session?.token) {
      return;
    }
    const token = session.token;
    const role = session.user.role;
    void (async () => {
      const loads: Promise<unknown>[] = [loadDashboard(token)];
      if (role === 'DIRECTOR' || role === 'ACCOUNTANT') {
        loads.push(
          loadFinanceOps(token),
          loadSellers(token),
          loadSales(token),
          loadProductProcurementCosts(token),
          loadInventoryOverview(token),
          loadAcquiringPercent(token),
          loadProducts(token),
        );
      } else if (role === 'ADMIN') {
        loads.push(
          loadSellers(token),
          loadProducts(token),
          loadSales(token),
          loadShifts(token),
          loadStaff(token),
          loadStoreInventory(token),
          loadGlobalEmployees(token),
        );
      } else if (role === 'MANAGER') {
        loads.push(loadSellers(token), loadSales(token));
      }
      if (role === 'ADMIN' || role === 'DIRECTOR' || role === 'MANAGER') {
        loads.push(refreshMessengerInbox());
      }
      await Promise.allSettled(loads);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один прогон при входе / смене роли
  }, [isDesktopShell, session?.token, session?.user?.role]);

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
    const base: MobileNavItem[] = [
      { to: '/home', label: 'Главная', icon: <HomeIcon />, end: true },
      { to: '/shift', label: shiftL, icon: <ShiftIcon /> },
      { to: '/sales', label: 'Продажи', icon: <SalesIcon /> },
    ];
    if (r === 'DIRECTOR') {
      base.push(
        { to: '/accounting/equipment', label: 'Спецтехника', icon: <EquipmentIcon /> },
        { to: '/accounting/procurement', label: 'Закупки и склад', icon: <ProcurementIcon /> },
      );
    }
    base.push(
      { to: '/team', label: 'Склад', icon: <WarehouseIcon /> },
      {
        to: '/control',
        label: controlL,
        icon: usesOrgChat ? <OrgChatDockIcon /> : <ControlIcon />,
        badge: chatBadge,
      },
    );
    return base;
  }, [session, messengerUnreadTotal]);

  if (!session) {
    return (
      <main className={`app loginScreen${isDesktopShell ? ' app--desktop' : ''}`}>
        {isDesktopShell ? (
          <div className="desktopLoginStatus">
            <ConnectionBanner {...desktopConnection} variant="pill" />
          </div>
        ) : null}
        {isDesktopShell ? (
          <div className="desktopLoginTheme">
            <DesktopThemeToggle theme={desktopTheme} onChange={handleDesktopThemeChange} />
          </div>
        ) : null}
        <section className="loginScreenPanel">
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
  const messengerChromeLayout =
    !isDesktopShell && usesOrgChat && location.pathname === '/control';

  const routesOutlet = (
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
                    ) : !homeDashboard ? (
                      <p className="muted">
                        Не удалось загрузить сводку. Проверьте интернет и нажмите «Выйти», затем войдите снова.
                      </p>
                    ) : (
                        <>
                          {homeDashboard.sellerDataManagedByAdmin && homeDashboard.role === 'SELLER' && (
                            <p className="notice">Данные продавца заполняет администратор точки.</p>
                          )}
                          <h3 className="homePanelTitle">{homeDashboard.title}</h3>
                          {homeDashboard.role === 'DIRECTOR' && session ? (
                            <DirectorHomeApprovalsCarousel
                              token={session.token}
                              userId={session.user.id}
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

                          {homeDashboard.role === 'MANAGER' && homeDashboard.managerRevenuePlanCompliance ? (
                            <ManagerRevenuePlanComplianceCard data={homeDashboard.managerRevenuePlanCompliance} />
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
                          ) : homeDashboard.role === 'ACCOUNTANT' ? (
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
                          ) : homeDashboard.role === 'DIRECTOR' ? (
                            isDesktopShell ? (
                              <div className="directorHomeMidRow">
                                <div className="homeStoresAggregateCard directorHomeZone">
                                  <h4 className="directorHomeSectionTitle">Выручка по точкам</h4>
                                  <ul className="homeStoresMiniList">
                                    {homeDashboard.stores.map((store) => (
                                      <li key={store.name} className="homeStoresMiniRow">
                                        <span className="homeStoresMiniName">{store.name}</span>
                                        <span className="homeStoresMiniValue">{store.revenue}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <DirectorCashflowPanel pages={directorCashflowPages} />
                              </div>
                            ) : (
                              <>
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
                                <DirectorCashflowPanel pages={directorCashflowPages} />
                              </>
                            )
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

                          {homeDashboard.role === 'DIRECTOR' && session && !isDesktopShell ? (
                            <DirectorDemoAccountsPanel token={session.token} userId={session.user.id} />
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
                                        <span className="adminSellerRegisterAmount">{row.cash}</span>
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
                            </>
                          ) : null}
                        </>
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
                <div
                  className={`dashboard${
                    isDesktopShell && role === 'ADMIN'
                      ? ' dashboard--shiftDesktop'
                      : isDesktopShell && role === 'ACCOUNTANT'
                        ? ' dashboard--financeDesktop dashboard--accountantEquip'
                        : isDesktopShell && isFinanceViewer
                          ? ' dashboard--financeDesktop'
                          : ''
                  }`}
                >
                  <section className="sectionCard">
                    {isManager ? null : role === 'ACCOUNTANT' ? (
                      <AccountantStoreEquipmentStoresPanel token={session.token} />
                    ) : isFinanceViewer ? (
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
                  <div
                    className={`dashboard${
                      isDesktopShell && !isFinanceViewer && !isReadOnlyObserver ? ' dashboard--salesDesktop' : ''
                    }${isDesktopShell && isFinanceViewer ? ' dashboard--financeReportDesktop' : ''}`}
                  >
                    {!isReadOnlyObserver && (
                      <>
                        {!isFinanceViewer && (
                          <>
                            <section className="sectionCard sectionCard--addSale">
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
                    {isManager ? null : isFinanceViewer ? (
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
                              products={products}
                              procurementCosts={productProcurementCosts}
                              onReload={async () => {
                                await loadInventoryOverview(session.token);
                                await loadProducts(session.token);
                              }}
                              onReplenish={replenishWarehouse}
                              onSaveProcurementCosts={saveProductProcurementCosts}
                              onAddProduct={addCatalogProduct}
                            />
                          </section>
                          <section className="sectionCard sectionCard--acquiring">
                            <AccountantProcurementPanel
                              token={session.token}
                              acquiringPercent={acquiringPercent}
                              acquiringPercentDetkov={acquiringPercentDetkov}
                              acquiringPercentPutintsevSber={acquiringPercentPutintsevSber}
                              onAcquiringPercentChange={setAcquiringPercent}
                              onAcquiringPercentDetkovChange={setAcquiringPercentDetkov}
                              onAcquiringPercentPutintsevSberChange={setAcquiringPercentPutintsevSber}
                              onSaveAcquiringPercent={saveAcquiringPercent}
                              onSaveAcquiringPercentDetkov={saveAcquiringPercentDetkov}
                              onSaveAcquiringPercentPutintsevSber={saveAcquiringPercentPutintsevSber}
                            />
                          </section>
                        </>
                      )
                    ) : (
                      <>
                        <section className="sectionCard sectionCard--salesLog">
                          <div className={`salesLog${isDesktopShell ? ' salesLog--desktop' : ''}`}>
                            {salesNotice ? <p className="notice saleRequestNotice">{salesNotice}</p> : null}
                            {isDesktopShell ? (
                              <h4 className="dtSectionTitle">
                                Продажи за сегодня · {session.user.storeName}
                              </h4>
                            ) : (
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
                            )}
                            <div
                              className={
                                isDesktopShell
                                  ? 'salesLogBody'
                                  : `salesAccordion ${salesExpanded ? 'salesAccordionOpen' : ''}`
                              }
                            >
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
                                              className="saleDeleteBtn"
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
                                                className="saleDeleteBtnIcon"
                                                viewBox="0 0 24 24"
                                                width="16"
                                                height="16"
                                                aria-hidden
                                              >
                                                <path
                                                  fill="currentColor"
                                                  d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 5h2v10h-2V8zm4 0h2v10h-2V8zM6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8z"
                                                />
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
              path="/accounting/equipment"
              element={
                role !== 'DIRECTOR' ? (
                  <Navigate to="/home" replace />
                ) : (
                  <div
                    className={`dashboard${
                      isDesktopShell ? ' dashboard--financeDesktop dashboard--accountantEquip' : ''
                    }`}
                  >
                    <section className="sectionCard">
                      <AccountantStoreEquipmentStoresPanel token={session.token} />
                    </section>
                  </div>
                )
              }
            />
            <Route
              path="/accounting/procurement"
              element={
                role !== 'DIRECTOR' ? (
                  <Navigate to="/home" replace />
                ) : (
                  <div className={`dashboard${isDesktopShell ? ' dashboard--financeDesktop' : ''}`}>
                    <section className="sectionCard inventorySectionCard">
                      <DirectorWarehousePanel
                        token={session.token}
                        overview={inventoryOverview}
                        products={products}
                        procurementCosts={productProcurementCosts}
                        onReload={async () => {
                          await loadInventoryOverview(session.token);
                          await loadProducts(session.token);
                        }}
                        onReplenish={replenishWarehouse}
                        onSaveProcurementCosts={saveProductProcurementCosts}
                        onAddProduct={addCatalogProduct}
                      />
                    </section>
                    <section className="sectionCard sectionCard--acquiring">
                      <AccountantProcurementPanel
                        token={session.token}
                        acquiringPercent={acquiringPercent}
                        acquiringPercentDetkov={acquiringPercentDetkov}
                        acquiringPercentPutintsevSber={acquiringPercentPutintsevSber}
                        onAcquiringPercentChange={setAcquiringPercent}
                        onAcquiringPercentDetkovChange={setAcquiringPercentDetkov}
                        onAcquiringPercentPutintsevSberChange={setAcquiringPercentPutintsevSber}
                        onSaveAcquiringPercent={saveAcquiringPercent}
                        onSaveAcquiringPercentDetkov={saveAcquiringPercentDetkov}
                        onSaveAcquiringPercentPutintsevSber={saveAcquiringPercentPutintsevSber}
                      />
                    </section>
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
                  <div
                    className={`dashboard teamPage${
                      isDesktopShell && role === 'ADMIN' ? ' dashboard--teamDesktop' : ''
                    }${
                      isDesktopShell && (isFinanceViewer || isManager)
                        ? ' dashboard--warehouseDesktop'
                        : ''
                    }`}
                  >
                    <section
                      className={
                        isDesktopShell && (isFinanceViewer || isManager)
                          ? 'teamPanelCard teamPanelCard--warehouseDesktop'
                          : 'sectionCard teamPanelCard'
                      }
                    >
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
                            <div className="inventorySectionCard teamPanelZone teamPanelZone--inventory">
                              <StoreInventoryControlPanel
                                token={session.token}
                                detail={storeInventory}
                                storeName={session.user.storeName}
                                onReload={() => loadStoreInventory(session.token)}
                                onReceiveFromWarehouse={transferFromWarehouseToStore}
                              />
                            </div>
                            <div className="inventorySectionCard storeEquipReadWrap teamPanelZone teamPanelZone--equipment">
                              <StoreEquipmentReadAccordion token={session.token} />
                            </div>
                            <div className="teamPanelZone teamPanelZone--writeoff">
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
                        messagingOnline={!isDesktopShell || desktopConnection.online}
                        onComposerFocusChange={setChatComposerSurfaceActive}
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
  );

  const desktopRoleLabel =
    session.user.role === 'ADMIN'
      ? 'Администратор точки'
      : session.user.role === 'DIRECTOR'
        ? 'Директор'
        : session.user.role === 'ACCOUNTANT'
          ? 'Бухгалтер'
          : session.user.role === 'MANAGER'
            ? 'Управляющий'
            : session.user.role === 'SELLER'
              ? 'Продавец'
              : session.user.role === 'RETOUCHER'
                ? 'Ретушёр'
                : session.user.role;

  const directorSwitcherToken =
    directorRootSession?.token ?? (session.user.role === 'DIRECTOR' ? session.token : null);
  const showDirectorAccountSwitcher =
    isDesktopShell && (session.user.role === 'DIRECTOR' || Boolean(directorRootSession));

  if (isDesktopShell) {
    return (
      <main className="app appWorkspace app--desktop">
        <section className="card cardWorkspace cardWorkspace--desktop">
          <DesktopAppLayout
            connection={desktopConnection}
            adminError={adminError || undefined}
            navItems={mobileNavItems}
            userLabel={session.user.nickname}
            roleLabel={desktopRoleLabel}
            onLogout={handleLogout}
            desktopTheme={desktopTheme}
            onDesktopThemeChange={handleDesktopThemeChange}
            directorAccountSwitcher={
              showDirectorAccountSwitcher && directorSwitcherToken ? (
                <DirectorAccountSwitcher
                  apiBaseUrl={API_BASE_URL}
                  directorToken={directorSwitcherToken}
                  activeNickname={session.user.nickname}
                  activeRole={session.user.role}
                  isImpersonating={Boolean(directorRootSession)}
                  userId={directorRootSession?.user.id ?? session.user.id}
                  onSwitchAccount={handleDirectorSwitchAccount}
                  onReturnToDirector={() => void handleDirectorReturnToDirector()}
                />
              ) : undefined
            }
          >
            {routesOutlet}
          </DesktopAppLayout>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app appWorkspace${messengerChromeLayout ? ' appWorkspace--messengerChrome' : ''}${
        messengerChromeLayout && chatComposerSurfaceActive ? ' appWorkspace--messengerComposerGrip' : ''
      }`}
    >
      <section
        className={`card cardWorkspace${messengerChromeLayout ? ' cardWorkspace--messengerChrome' : ''}`}
      >
        {!messengerChromeLayout ? (
          <header className="desktopAppHeader">
            <div className="brandHeader">
              <h1>Фотографы</h1>
            </div>
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
                  {role === 'DIRECTOR' ? (
                    <>
                      <NavLink to="/accounting/equipment" className={navTabClass}>
                        Спецтехника
                      </NavLink>
                      <NavLink to="/accounting/procurement" className={navTabClass}>
                        Закупки и склад
                      </NavLink>
                    </>
                  ) : null}
                  <NavLink to="/team" className={navTabClass}>
                    Склад
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
          </header>
        ) : null}

        {adminError ? <p className="error">{adminError}</p> : null}

        {routesOutlet}
      </section>
      <nav
        className={`mobileDock${chatComposerSurfaceActive ? ' mobileDock--hiddenForChat' : ''}`}
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

function AddSaleProductStepper({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = Math.max(0, Math.floor(Number(value) || 0));

  const setQty = (next: number) => {
    onChange(next > 0 ? String(next) : '');
  };

  const hasQty = parsed > 0;

  return (
    <div className={`addSaleProductCard${hasQty ? ' addSaleProductCard--hasQty' : ''}`}>
      <span className="addSaleProductName" title={name}>
        {name}
      </span>
      <div className="addSaleQtyStepper" role="group" aria-label={`Количество: ${name}`}>
        <button
          type="button"
          className="ghost addSaleQtyBtn addSaleQtyBtn--minus"
          aria-label={`Меньше: ${name}`}
          onClick={() => setQty(parsed - 1)}
        >
          −
        </button>
        <input
          className="addSaleQtyInput"
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '' || /^\d+$/.test(next)) {
              onChange(next);
            }
          }}
          placeholder="0"
          aria-label={`Количество: ${name}`}
        />
        <button
          type="button"
          className="ghost addSaleQtyBtn addSaleQtyBtn--plus"
          aria-label={`Больше: ${name}`}
          onClick={() => setQty(parsed + 1)}
        >
          +
        </button>
      </div>
    </div>
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

  const desktopSale = isTauriRuntime();

  const paymentButtons = (
    <div className={`paymentTypeRow${desktopSale ? ' paymentTypeRow--desktop' : ''}`} role="group" aria-label="Вид оплаты">
      <button
        type="button"
        className={`ghost paymentTypeBtn ${desktopSale ? 'paymentTypeBtn--desktop' : ''} ${paymentType === 'CASH' ? 'paymentTypeBtnActive' : ''}`}
        onClick={() => setPaymentType('CASH')}
      >
        {desktopSale ? 'Наличные' : 'Нал'}
      </button>
      <button
        type="button"
        className={`ghost paymentTypeBtn ${desktopSale ? 'paymentTypeBtn--desktop' : ''} ${paymentType === 'NON_CASH' ? 'paymentTypeBtnActive' : ''}`}
        onClick={() => setPaymentType('NON_CASH')}
      >
        Безнал
      </button>
      <button
        type="button"
        className={`ghost paymentTypeBtn ${desktopSale ? 'paymentTypeBtn--desktop' : ''} ${paymentType === 'TRANSFER' ? 'paymentTypeBtnActive' : ''}`}
        onClick={() => setPaymentType('TRANSFER')}
      >
        Перевод
      </button>
    </div>
  );

  const shiftAlerts = (
    <>
      {!hasOpenShift && (
        <p className="error addSaleAlert" role="alert">
          Нет открытой смены — откройте её в разделе «Смена».
        </p>
      )}
      {hasOpenShift && sellers.length === 0 && (
        <p className="error addSaleAlert" role="alert">
          В смене пока никого нет. В «Смене» нажмите «Добавить в смену» и отметьте продавцов.
        </p>
      )}
    </>
  );

  return (
    <div className={`addSaleForm${desktopSale ? ' addSaleForm--desktop addSaleForm--hero' : ''}`}>
      {desktopSale ? (
        <>
          {shiftAlerts}
          <div className="addSaleHeroRow addSaleHeroRow--who">
            <label className="addSaleField addSaleField--seller" htmlFor="add-sale-seller">
              <span className="addSaleFieldLabel">Кто продал</span>
              <div className="addSaleFieldControl addSaleFieldControl--select">
                <select
                  id="add-sale-seller"
                  className="addSaleFieldSelect"
                  value={selectSellerId}
                  onChange={(event) => setSellerId(Number(event.target.value))}
                  disabled={sellers.length === 0}
                >
                  {sellers.length === 0 ? (
                    <option value="">Нет в смене</option>
                  ) : (
                    sellers.map((seller) => (
                      <option key={seller.id} value={seller.id}>
                        {seller.fullName}
                        {seller.nickname ? ` · ${seller.nickname}` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </label>
            <div className="addSaleField addSaleField--payment">
              <span className="addSaleFieldLabel">Как оплатили</span>
              {paymentButtons}
            </div>
          </div>
          <label className="addSaleAmountBlock" htmlFor="add-sale-total">
            <span className="addSaleAmountLabel">Сколько заплатил клиент</span>
            <div className="addSaleAmountField">
              <input
                id="add-sale-total"
                className="addSaleAmountInput"
                inputMode="decimal"
                value={totalAmount}
                onChange={(event) => setTotalAmount(event.target.value)}
                placeholder="0"
                autoComplete="off"
              />
              <span className="addSaleAmountCurrency" aria-hidden>
                ₽
              </span>
            </div>
          </label>
          <section className="addSaleProductsSection" aria-label="Что продали">
            <div className="addSaleProductsGrid">
              {products.map((item) => (
                <AddSaleProductStepper
                  key={item.name}
                  name={item.name}
                  value={qty[item.name] ?? ''}
                  onChange={(next) => updateQty(item.name, next)}
                />
              ))}
            </div>
          </section>
          {formError ? (
            <p className="error addSaleAlert" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="addSaleSaveWrap">
            <button
              className="primaryAction addSaleSaveBtn"
              type="button"
              onClick={submit}
              disabled={busy || !hasOpenShift || sellers.length === 0}
            >
              {busy ? 'Сохраняем…' : 'Сохранить продажу'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h4>Добавить продажу</h4>
          {shiftAlerts}
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
              {paymentButtons}
            </label>
            <label>
              Итоговая сумма (₽)
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
            {busy ? 'Сохраняем…' : 'Сохранить продажу'}
          </button>
        </>
      )}
    </div>
  );
}

function formatManagerPlanDayTitle(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return dayKey;
  }
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function ManagerRevenuePlanComplianceCard({
  data,
}: {
  data: NonNullable<DashboardResponse['managerRevenuePlanCompliance']>;
}) {
  const summary = (() => {
    const withPlan = data.items.filter((i) => i.hasPlan);
    if (withPlan.length === 0) {
      return {
        tone: 'neutral' as const,
        text: 'На сегодня планы не заданы — при необходимости уточните у директора.',
      };
    }
    if (withPlan.every((i) => i.met)) {
      return { tone: 'ok' as const, text: 'Все заданные планы по точкам выполнены.' };
    }
    return { tone: 'warn' as const, text: 'Есть точки ниже плана на сегодня.' };
  })();

  return (
    <section className="homeManagerPlanCard" aria-label="Планы выручки по точкам">
      <h4 className="homeManagerPlanTitle">План выручки по точкам</h4>
      <p className="homeManagerPlanSub">
        {formatManagerPlanDayTitle(data.dayKey)} · бизнес-день (МСК)
      </p>
      <div className={`homeManagerPlanSummary homeManagerPlanSummary--${summary.tone}`} role="status">
        {summary.text}
      </div>
      <ul className="homeManagerPlanList">
        {data.items.map((row) => (
          <li key={row.storeName} className="homeManagerPlanRow">
            <div className="homeManagerPlanRowTop">
              <span className="homeManagerPlanStore" title={row.storeName}>
                {row.storeName}
              </span>
              <span
                className={`homeManagerPlanBadge homeManagerPlanBadge--${
                  !row.hasPlan ? 'empty' : row.met ? 'ok' : 'bad'
                }`}
              >
                {!row.hasPlan ? 'Без плана' : row.met ? 'Выполнен' : 'Ниже плана'}
              </span>
            </div>
            {row.hasPlan ? (
              <>
                <div className="homeManagerPlanNums">
                  <span>Факт {formatRub(row.actualRub)}</span>
                  <span className="homeManagerPlanSep">·</span>
                  <span>План {formatRub(row.planRub)}</span>
                </div>
                <div className="homeManagerPlanBar" aria-hidden>
                  <span className="homeManagerPlanBarFill" style={{ width: `${row.progressPct}%` }} />
                </div>
              </>
            ) : (
              <p className="homeManagerPlanMuted">Факт {formatRub(row.actualRub)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DirectorHomeApprovalsCarousel({
  token,
  userId,
  onDecided,
}: {
  token: string;
  userId?: number;
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
      const createdAt = new Date().toISOString();
      const clientId = `${id}-${decision}`;
      const body = { requestId: id, decision, createdAt };
      const post = async () => {
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
      };
      if (isTauriRuntime() && userId !== undefined) {
        const mode = await runAdminMutation(
          userId,
          clientId,
          'DIRECTOR_CONTROL_DECISION',
          body,
          post,
        );
        if (mode === 'queued') {
          setItems((prev) => prev.filter((row) => row.id !== id));
          onDecided();
          setBanner('Сохранено офлайн — отправится при подключении');
          window.setTimeout(() => setBanner(''), 4000);
          return;
        }
      } else {
        await post();
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

  const formatApprovalTime = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const renderApprovalCard = (item: DirectorControlRequest) => (
    <article className="directorApprovalsCarouselCard" key={item.id}>
      <p className="directorApprovalsCarouselKind">
        {item.kind === 'SALE_DELETE' ? 'Отмена продажи' : 'Списание товара'}
      </p>
      <p className="directorApprovalsCarouselSummary">{item.summary}</p>
      <p className="directorApprovalsCarouselMeta">{formatApprovalTime(item.createdAt)}</p>
      <div className="directorApprovalsCarouselActions">
        <button
          type="button"
          className="directorApprovalsCarouselBtn directorApprovalsCarouselBtnReject"
          disabled={busyId === item.id}
          onClick={() => void decide(item.id, 'REJECT')}
        >
          Отклонить
        </button>
        <button
          type="button"
          className="directorApprovalsCarouselBtn directorApprovalsCarouselBtnApprove"
          disabled={busyId === item.id}
          onClick={() => void decide(item.id, 'APPROVE')}
        >
          {busyId === item.id ? '…' : 'Согласовать'}
        </button>
      </div>
    </article>
  );

  if (isTauriRuntime()) {
    return (
      <section className="directorApprovalsPanel directorHomeZone" aria-label="Запросы на согласование">
        <div className="directorApprovalsPanelHead">
          <h4 className="directorHomeSectionTitle">Согласования</h4>
          <span className="directorApprovalsPanelBadge">{items.length}</span>
        </div>
        {banner ? <p className="notice directorApprovalsCarouselBanner">{banner}</p> : null}
        <div className="directorApprovalsGrid">{items.map((item) => renderApprovalCard(item))}</div>
      </section>
    );
  }

  const current = items[index] ?? items[0];

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
        {renderApprovalCard(current)}
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
  messagingOnline = true,
  onPersistThreadOpen,
  onPersistThreadClose,
  onComposerFocusChange,
}: {
  token: string;
  inbox: MessengerInboxResponse | null;
  refreshInbox: () => Promise<void>;
  persistedThreadKey: string | null;
  persistedThreadTitle: string;
  /** В десктопе false при отсутствии сети — чат только онлайн. */
  messagingOnline?: boolean;
  onPersistThreadOpen: (threadKey: string, title: string) => void;
  onPersistThreadClose: () => void;
  onComposerFocusChange?: (surfaceActive: boolean) => void;
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
  const composerBlurTimerRef = useRef<number | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);

  const threads = inbox?.threads ?? [];

  const clearComposerBlurTimer = () => {
    if (composerBlurTimerRef.current != null) {
      window.clearTimeout(composerBlurTimerRef.current);
      composerBlurTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearComposerBlurTimer();
      onComposerFocusChange?.(false);
      document.documentElement.style.removeProperty('--chat-keyboard-inset');
    };
  }, [onComposerFocusChange]);

  useEffect(() => {
    if (!threadKey || !composerFocused) {
      return;
    }
    const root = document.documentElement;
    const syncViewport = () => {
      const vv = window.visualViewport;
      if (!vv) {
        return;
      }
      const inset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      root.style.setProperty('--chat-keyboard-inset', `${inset}px`);
      root.style.setProperty('--app-visual-vh', `${Math.max(0, Math.round(vv.height))}px`);
    };
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
    };
  }, [threadKey, composerFocused]);

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
    if (!threadKey || !messagingOnline) {
      return;
    }
    try {
      const response = await fetchWithTimeout(
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
  }, [token, threadKey, messagingOnline]);

  useEffect(() => {
    if (!threadKey) {
      setMessages([]);
      setThreadError('');
      setLoadingThread(false);
      return;
    }
    if (!messagingOnline) {
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
  }, [threadKey, loadThreadMessages, refreshInbox, token, messagingOnline]);

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
    if (!text || sendBusy || !threadKey || !messagingOnline) {
      return;
    }
    setSendBusy(true);
    setThreadError('');
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/admin/chat/messages`, {
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

  const desktopMessenger = isTauriRuntime();

  const threadListHeader = (
    <header className="messengerHubHeader">
      <div className="messengerHubHeaderInner">
        <h3 className="messengerHubTitle messengerHubTitle--chatMark">Чат</h3>
      </div>
    </header>
  );

  const threadListMarkup = (
    <ul className="messengerThreadList" aria-label="Чаты">
      {threads.map((t) => {
        const initial = (t.title.trim()[0] ?? '?').toUpperCase();
        const unread = t.unreadCount > 0;
        const senderLine = messengerListSenderLine(t);
        const previewLine = messengerPreviewBodyLine(t);
        const hasMsg = Boolean((t.lastMessageBody ?? '').trim());
        const isActive = threadKey === t.threadKey;
        return (
          <li key={t.threadKey}>
            <button
              type="button"
              className={`messengerThreadRow${isActive ? ' messengerThreadRow--active' : ''}`}
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
  );

  const placeholder =
    threadKey === 'general'
      ? 'Сообщение для всех точек и руководства…'
      : 'Личное сообщение…';

  const threadSubtitle =
    threadKey === 'general' ? 'Общий чат сети' : 'Личные сообщения';
  const navAvatarLetter = (threadTitleResolved.trim()[0] ?? '?').toUpperCase();

  const threadConversationPane = !threadKey ? null : (
    <>
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
            onFocus={() => {
              clearComposerBlurTimer();
              setComposerFocused(true);
              onComposerFocusChange?.(true);
              scheduleIosVisualViewportBumps();
              requestAnimationFrame(() => {
                const vv = window.visualViewport as unknown as { scrollTo?: (x: number, y: number) => void } | null;
                vv?.scrollTo?.(0, 0);
                document.scrollingElement?.scrollTo(0, 0);
              });
            }}
            onBlur={() => {
              clearComposerBlurTimer();
              composerBlurTimerRef.current = window.setTimeout(() => {
                composerBlurTimerRef.current = null;
                setComposerFocused(false);
                onComposerFocusChange?.(false);
                document.documentElement.style.removeProperty('--chat-keyboard-inset');
                scheduleIosVisualViewportBumps();
              }, 320);
            }}
            disabled={sendBusy || !messagingOnline}
            aria-label="Текст сообщения"
          />
          <button
            type="submit"
            className="orgChatSendFab"
            disabled={sendBusy || !draft.trim() || !messagingOnline}
            aria-label={sendBusy ? 'Отправка' : 'Отправить'}
            onMouseDown={(event) => {
              if (!sendBusy && draft.trim()) {
                event.preventDefault();
              }
            }}
          >
            <svg
              className="orgChatSendFabSvg"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden
              focusable="false"
            >
              <path
                fill="currentColor"
                d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
              />
            </svg>
          </button>
        </div>
      </form>
    </>
  );

  if (desktopMessenger) {
    return (
      <section className="sectionCard messengerHub messengerHub--desktop" aria-label="Чат">
        {!messagingOnline ? <ChatOfflineNotice /> : null}
        <div className="messengerHubDesktopSplit">
          <aside className="messengerHubDesktopRail">
            {threadListHeader}
            {threadListMarkup}
          </aside>
          <div
            className="messengerHubDesktopMain"
            aria-label={threadKey ? threadTitleResolved : 'Переписка'}
          >
            {threadKey ? (
              <>
                <header className="messengerHubDesktopThreadHead">
                  <div className="messengerHubDesktopThreadHeadText">
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
                {threadConversationPane}
              </>
            ) : (
              <div className="messengerHubDesktopPlaceholder">
                <span className="messengerHubDesktopPlaceholderIcon" aria-hidden>
                  Ч
                </span>
                <h4 className="messengerHubDesktopPlaceholderTitle">Выберите чат</h4>
                <p className="messengerHubDesktopPlaceholderHint">
                  Общий канал сети или переписка с точкой — выберите диалог в списке слева.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (!threadKey) {
    return (
      <section className="sectionCard messengerHub" aria-label="Чат">
        {!messagingOnline ? <ChatOfflineNotice /> : null}
        {threadListHeader}
        {threadListMarkup}
      </section>
    );
  }

  return (
    <section
      className={`sectionCard messengerHub messengerHubThread${
        composerFocused ? ' messengerHubThread--composerFocused' : ''
      }`}
      aria-label={threadTitleResolved}
    >
      {!messagingOnline ? <ChatOfflineNotice /> : null}
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
      {threadConversationPane}
    </section>
  );
}

function directorDemoRoleLabel(role: string): string {
  switch (role) {
    case 'DIRECTOR':
      return 'Директор';
    case 'MANAGER':
      return 'Управляющий';
    case 'ACCOUNTANT':
      return 'Бухгалтер';
    case 'ADMIN':
      return 'Админ точки';
    case 'SELLER':
      return 'Продавец';
    case 'RETOUCHER':
      return 'Ретушёр';
    default:
      return role;
  }
}

function DirectorDemoAccountsPanel({ token, userId }: { token: string; userId?: number }) {
  type Row = { nickname: string; fullName: string; role: string; storeName: string; password: string };
  const desktopDirectorHome = isTauriRuntime();
  const [open, setOpen] = useState(desktopDirectorHome);
  const [rows, setRows] = useState<Row[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const [draftPwd, setDraftPwd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${API_BASE_URL}/director/demo-accounts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('http');
      }
      const data = (await res.json()) as Row[];
      setRows(data);
      setIdx((i) => (data.length === 0 ? 0 : Math.min(i, data.length - 1)));
    } catch {
      setErr('Не удалось загрузить учётные записи');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const current = rows.length > 0 ? rows[idx] : undefined;
  const total = rows.length;

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => setIdx((i) => Math.min(total - 1, i + 1));

  const copyPassword = async () => {
    if (!current) {
      return;
    }
    setHint('');
    try {
      await navigator.clipboard.writeText(current.password);
      setHint('Пароль скопирован');
    } catch {
      setErr('Не удалось скопировать');
    }
  };

  const applyPassword = async () => {
    if (!current) {
      return;
    }
    const pwd = draftPwd.trim();
    if (pwd.length < 10) {
      setErr('Новый пароль: минимум 10 символов');
      return;
    }
    setErr('');
    setHint('');
    try {
      const patchId = newClientId('dpwd');
      const createdAt = new Date().toISOString();
      const body = { patchId, nickname: current.nickname, password: pwd, createdAt };
      const patch = async () => {
        const res = await fetch(
          `${API_BASE_URL}/director/demo-accounts/${encodeURIComponent(current.nickname)}/password`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password: pwd }),
          },
        );
        if (!res.ok) {
          let msg = 'Не удалось сохранить пароль';
          try {
            const j = (await res.json()) as { message?: string | string[] };
            if (j.message) {
              msg = Array.isArray(j.message) ? j.message[0] : j.message;
            }
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
      };
      if (isTauriRuntime() && userId !== undefined) {
        const mode = await runAdminMutation(userId, patchId, 'DIRECTOR_DEMO_PASSWORD', body, patch);
        if (mode === 'queued') {
          setDraftPwd('');
          setHint('Сохранено офлайн — отправится при подключении');
          return;
        }
      } else {
        await patch();
      }
      setDraftPwd('');
      setHint('Пароль обновлён');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить пароль');
    }
  };

  const messages = (
    <>
      {err ? (
        <p className="error directorDemoAccountsMsg" role="alert">
          {err}
        </p>
      ) : null}
      {hint ? (
        <p className="notice directorDemoAccountsMsg" role="status">
          {hint}
        </p>
      ) : null}
      {loading ? <p className="muted directorDemoAccountsMsg">Загрузка…</p> : null}
    </>
  );

  const passwordEditor = current ? (
    <>
      <div className="directorDemoAccountsPwdRow">
        <code className="directorDemoAccountsPwd">{current.password}</code>
        <button type="button" className="ghost directorDemoAccountsCopyBtn" onClick={() => void copyPassword()}>
          Копировать
        </button>
      </div>
      <label className="directorDemoAccountsNewLabel">
        <span className="directorDemoAccountsNewLabelText">Новый пароль</span>
        <input
          type="password"
          autoComplete="new-password"
          value={draftPwd}
          onChange={(e) => setDraftPwd(e.target.value)}
          placeholder="Минимум 10 символов"
        />
      </label>
      <button
        type="button"
        className="primaryAction directorDemoAccountsSaveBtn"
        onClick={() => void applyPassword()}
      >
        Сохранить
      </button>
    </>
  ) : null;

  if (desktopDirectorHome) {
    return (
      <section className="directorDemoAccountsPanel directorDemoAccountsPanel--desktop directorHomeZone">
        <header className="directorDemoAccountsPanelHead">
          <div>
            <h4 className="directorHomeSectionTitle">Пароли доступа</h4>
            <p className="directorDemoAccountsPanelSub">
              Директор · бухгалтер · управляющий · админы точек
            </p>
          </div>
        </header>
        {messages}
        {!loading && rows.length === 0 ? <p className="muted directorDemoAccountsMsg">Записей нет</p> : null}
        {rows.length > 0 && !loading ? (
          <div className="directorDemoAccountsSplit">
            <ul className="directorDemoAccountsList" aria-label="Учётные записи">
              {rows.map((row, i) => (
                <li key={row.nickname}>
                  <button
                    type="button"
                    className={`directorDemoAccountsListBtn${i === idx ? ' directorDemoAccountsListBtn--active' : ''}`}
                    onClick={() => {
                      setIdx(i);
                      setErr('');
                      setHint('');
                      setDraftPwd('');
                    }}
                  >
                    <span className="directorDemoAccountsListNick">{row.nickname}</span>
                    <span className="directorDemoAccountsRolePill">{directorDemoRoleLabel(row.role)}</span>
                    <span className="directorDemoAccountsListStore">{row.storeName}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="directorDemoAccountsDetail">
              {current ? (
                <>
                  <div className="directorDemoAccountsDetailHead">
                    <p className="directorDemoAccountsNick">{current.nickname}</p>
                    <p className="directorDemoAccountsFull">{current.fullName}</p>
                    <p className="directorDemoAccountsRole">
                      <span className="directorDemoAccountsRolePill">{directorDemoRoleLabel(current.role)}</span>
                      <span className="directorDemoAccountsStoreSep" aria-hidden>
                        ·
                      </span>
                      <span className="directorDemoAccountsStore">{current.storeName}</span>
                    </p>
                  </div>
                  {passwordEditor}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="directorDemoAccountsScopeHint">
          Продавцы и ретушёры здесь не показываются.
        </p>
      </section>
    );
  }

  return (
    <div className="directorDemoAccountsStrip">
      <button
        type="button"
        className="directorDemoAccountsToggle"
        onClick={() => {
          setOpen((v) => !v);
          setErr('');
          setHint('');
        }}
        aria-expanded={open}
      >
        <span className="directorDemoAccountsToggleText">
          <span className="directorDemoAccountsToggleTitle">Пароли доступа</span>
          <span className="directorDemoAccountsToggleSub">Директор · Бухгалтер · Управляющий · Админы точек</span>
        </span>
        <span className="directorDemoAccountsToggleChevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="directorDemoAccountsBody">
          {messages}
          {current && !loading ? (
            <p className="muted directorDemoAccountsScopeHint">
              Только директор, бухгалтер, управляющий и админы точек; продавцы и ретушёры здесь не показываются.
            </p>
          ) : null}
          {current ? (
            <div className="directorDemoAccountsCarousel">
              <div className="directorDemoAccountsNav">
                <button
                  type="button"
                  className="directorDemoAccountsNavBtn"
                  onClick={goPrev}
                  disabled={total <= 1 || idx <= 0}
                  aria-label="Предыдущая учётная запись"
                >
                  ‹
                </button>
                <div className="directorDemoAccountsCard">
                  <div className="directorDemoAccountsCardHead">
                    <p className="directorDemoAccountsNick">{current.nickname}</p>
                    <p className="directorDemoAccountsRole">
                      <span className="directorDemoAccountsRolePill">{directorDemoRoleLabel(current.role)}</span>
                      <span className="directorDemoAccountsStoreSep" aria-hidden>
                        ·
                      </span>
                      <span className="directorDemoAccountsStore">{current.storeName}</span>
                    </p>
                    <p className="directorDemoAccountsFull muted">{current.fullName}</p>
                  </div>
                  {passwordEditor}
                  {total > 1 ? (
                    <div className="directorDemoAccountsDots" role="tablist" aria-label="Учётные записи">
                      {Array.from({ length: total }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          role="tab"
                          aria-selected={i === idx}
                          aria-label={`${i + 1} из ${total}`}
                          className={`directorDemoAccountsDot${i === idx ? ' directorDemoAccountsDotActive' : ''}`}
                          onClick={() => setIdx(i)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="directorDemoAccountsNavBtn"
                  onClick={goNext}
                  disabled={total <= 1 || idx >= total - 1}
                  aria-label="Следующая учётная запись"
                >
                  ›
                </button>
              </div>
            </div>
          ) : !loading ? (
            <p className="muted directorDemoAccountsMsg">Записей нет</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DirectorCashflowPanel({
  pages,
}: {
  pages: Array<{ key: string; title: string; amount: number }>;
}) {
  if (pages.length === 0) {
    return null;
  }

  if (isTauriRuntime()) {
    return (
      <section className="directorCashflowStrip directorHomeZone" aria-label="Итоги по всем точкам">
        <h4 className="directorHomeSectionTitle">Итоги по всем точкам</h4>
        <div className="directorCashflowChips">
          {pages.map((page) => (
            <article key={page.key} className="directorCashflowChip">
              <span className="directorCashflowChipLabel">{page.title}</span>
              <strong className="directorCashflowChipValue">{formatRub(page.amount)}</strong>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return <DirectorCashflowCarousel pages={pages} />;
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

  const desktopTeam = isTauriRuntime();

  const writeOffFields = desktopTeam ? (
    <>
      {formOk ? <p className="notice writeOffOk">{formOk}</p> : null}
      <div className="writeOffRow writeOffRow--desktop">
        <div className="writeOffCluster writeOffCluster--product">
          <span className="writeOffClusterLabel">Товар</span>
          <div className="writeOffSelectWrap">
            <select
              className="writeOffControl writeOffSelect"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Товар для списания"
            >
              {products.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="writeOffCluster writeOffCluster--qty">
          <span className="writeOffClusterLabel">Кол-во</span>
          <input
            className="writeOffControl writeOffInput"
            inputMode="numeric"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            aria-label="Количество для списания, штук"
          />
        </div>
        <div className="writeOffCluster writeOffCluster--reason">
          <span className="writeOffClusterLabel">Причина</span>
          <div className="writeOffSelectWrap">
            <select
              className="writeOffControl writeOffSelect"
              value={reason}
              onChange={(event) => setReason(event.target.value as 'Брак' | 'Поломка')}
              aria-label="Причина списания"
            >
              <option value="Брак">Брак</option>
              <option value="Поломка">Поломка</option>
            </select>
          </div>
        </div>
        <button
          className="primaryAction writeOffSubmitBtn"
          type="button"
          onClick={submit}
          disabled={busy}
        >
          {busy ? '…' : 'Списать'}
        </button>
      </div>
      {formError ? <p className="error writeOffError">{formError}</p> : null}
    </>
  ) : (
    <>
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
    </>
  );

  if (desktopTeam) {
    return (
      <div className="writeOffForm writeOffForm--desktop">
        <div className="writeOffFormHead">
          <h4 className="dtSectionTitle">Списание товара</h4>
          <p className="writeOffPolicyHint">
            Списание со склада точки возможно только после согласования директора.
          </p>
        </div>
        {writeOffFields}
      </div>
    );
  }

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
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>
      <div
        id="write-off-carousel-body"
        className={`writeOffCarouselBody ${expanded ? 'writeOffCarouselBodyOpen' : ''}`}
      >
        {writeOffFields}
      </div>
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
  'Ремонт',
  'Техника',
  'Хоз-товары',
  'Попилили',
  'Прочие траты',
] as const;

function formatFinanceWorkDay(workDay: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDay.trim());
  if (match) {
    return `${match[3]}.${match[2]}`;
  }
  return workDay;
}

function FinanceOpsHistoryStrip({
  title,
  emptyLabel,
  items,
}: {
  title: string;
  emptyLabel: string;
  items: Array<{ key: string; meta: string; value: string }>;
}) {
  return (
    <div className="financeOpsHistoryMini">
      <p className="financeOpsHistoryMiniTitle">{title}</p>
      <div className="financeOpsHistoryMiniTrack" role="list" aria-label={title}>
        {items.length === 0 ? (
          <p className="financeOpsHistoryMiniEmpty">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <article key={item.key} className="financeOpsHistoryMiniChip" role="listitem">
              <span className="financeOpsHistoryMiniChipMeta">{item.meta}</span>
              <strong className="financeOpsHistoryMiniChipValue">{item.value}</strong>
            </article>
          ))
        )}
      </div>
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
  const [selectedFlowAccountId, setSelectedFlowAccountId] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [expenseTitle, setExpenseTitle] = useState<
    (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number]
  >(FINANCE_EXPENSE_CATEGORY_LABELS[0]);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [adjustingAccountId, setAdjustingAccountId] = useState<string | null>(null);
  const [adjustNewBalance, setAdjustNewBalance] = useState('');
  const [adjustConfirmPending, setAdjustConfirmPending] = useState(false);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [incomesHistoryOpen, setIncomesHistoryOpen] = useState(false);
  const [expensesHistoryOpen, setExpensesHistoryOpen] = useState(false);
  const desktopFinance = isTauriRuntime();
  const [expenseArticlesSheetOpen, setExpenseArticlesSheetOpen] = useState(desktopFinance);

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
    setSelectedFlowAccountId((cur) =>
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

  const recentIncomeHistoryItems = useMemo(() => {
    const accountNames = new Map(snapshot.accounts.map((a) => [a.id, a.name?.trim() || 'Счёт']));
    return [...(snapshot.incomes ?? [])]
      .sort((a, b) => b.workDay.localeCompare(a.workDay) || b.id.localeCompare(a.id))
      .slice(0, 24)
      .map((item) => ({
        key: item.id,
        meta: `${accountNames.get(item.accountId) ?? 'Счёт'} · ${formatFinanceWorkDay(item.workDay)}`,
        value: fmt(item.amount),
      }));
  }, [snapshot.incomes, snapshot.accounts]);

  const recentExpenseHistoryItems = useMemo(() => {
    return [...snapshot.expenses]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 24)
      .map((item) => {
        const when = new Date(item.createdAt).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        return {
          key: item.id,
          meta: `${item.title} · ${when}`,
          value: fmt(item.amount),
        };
      });
  }, [snapshot.expenses]);

  const startBalanceAdjust = (acc: FinanceAccount) => {
    setAdjustError('');
    setAdjustConfirmPending(false);
    setAdjustingAccountId(acc.id);
    setAdjustNewBalance(String(acc.balance));
  };

  const cancelBalanceAdjust = () => {
    setAdjustingAccountId(null);
    setAdjustConfirmPending(false);
    setAdjustNewBalance('');
    setAdjustError('');
  };

  const prepareBalanceAdjust = () => {
    setAdjustError('');
    const n = Number(String(adjustNewBalance).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      setAdjustError('Укажите корректный остаток');
      return;
    }
    setAdjustConfirmPending(true);
  };

  const confirmBalanceAdjust = async () => {
    if (!adjustingAccountId) {
      return;
    }
    setAdjustBusy(true);
    setAdjustError('');
    setStatus('');
    try {
      await onSetAccountBalance(token, adjustingAccountId, adjustNewBalance);
      const acc = snapshot.accounts.find((a) => a.id === adjustingAccountId);
      setStatus(acc ? `Остаток «${acc.name}» обновлён.` : 'Остаток обновлён.');
      cancelBalanceAdjust();
    } catch {
      setAdjustError('Не удалось сохранить остаток. Нужны права директора.');
      setAdjustConfirmPending(false);
    } finally {
      setAdjustBusy(false);
    }
  };

  const activeFlowAccountId = desktopFinance ? selectedFlowAccountId : selectedIncomeAccountId;

  const submitIncomeForSelectedAccount = async () => {
    setError('');
    setStatus('');
    if (!activeFlowAccountId) {
      setError('Выберите счёт');
      return;
    }
    const amountStr = incomeDraftsByAccount[activeFlowAccountId] ?? '';
    const n = Number(String(amountStr).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError('Укажите сумму прихода');
      return;
    }
    setBusyId(`income-${activeFlowAccountId}`);
    try {
      await onAddIncome(token, {
        accountId: activeFlowAccountId,
        amount: amountStr,
        workDay: todayKeyMoscow(),
      });
      setIncomeDraftsByAccount((prev) => ({
        ...prev,
        [activeFlowAccountId]: '',
      }));
      const acc = snapshot.accounts.find((a) => a.id === activeFlowAccountId);
      setStatus(acc ? `Приход на «${acc.name}» записан, баланс обновлён.` : 'Приход записан.');
    } catch {
      setError('Не удалось записать приход');
    } finally {
      setBusyId('');
    }
  };

  const submitExpense = async () => {
    const accountId = desktopFinance ? selectedFlowAccountId : expenseAccountId;
    if (!accountId) {
      setError('Выберите счёт');
      return;
    }
    setBusyId('expense');
    setError('');
    setStatus('');
    try {
      await onAddExpense(token, {
        accountId,
        title: expenseTitle,
        amount: expenseAmount,
      });
      setExpenseTitle(FINANCE_EXPENSE_CATEGORY_LABELS[0]);
      setExpenseAmount('');
      const acc = snapshot.accounts.find((a) => a.id === accountId);
      setStatus(acc ? `Расход со счёта «${acc.name}» добавлен.` : 'Расход добавлен.');
    } catch {
      setError('Не удалось добавить расход');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div
      className={`opsCard financeOpsCard ${isDirector ? 'financeOpsCardDirector' : ''}${
        desktopFinance ? ' financeOpsCard--desktop' : ''
      }`}
    >
      <div className={`financeOpsShell${desktopFinance ? ' financeOpsShell--desktop' : ''}`}>
      <header className="financeOpsHero">
        <h4 className="financeOpsPageTitle">Оперативные финансы</h4>
        <div className="financeOpsHeroMain">
          <div className="financeOpsBankTotalCallout" role="note">
            <span className="financeOpsBankTotalCalloutLabel">Общий остаток</span>
            <span className="financeOpsBankTotalCalloutValue">{fmt(snapshot.totals.balance)}</span>
          </div>
          <div className="financeOpsBalancesGrid">
            {primaryFinanceAccounts.map((acc) => {
              const isAdjusting = isDirector && adjustingAccountId === acc.id;
              return (
                <article
                  key={acc.id}
                  className={`metricCard financeOpsBalanceCard${
                    isAdjusting ? ' financeOpsBalanceCard--adjusting' : ''
                  }`}
                >
                  <p>{acc.name?.trim() || 'Счёт'}</p>
                  {isAdjusting ? (
                    <div className="financeOpsBalanceAdjust">
                      {!adjustConfirmPending ? (
                        <>
                          <input
                            className="financeOpsBalanceAdjustInput"
                            inputMode="decimal"
                            aria-label="Новый остаток"
                            value={adjustNewBalance}
                            onChange={(event) => setAdjustNewBalance(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                prepareBalanceAdjust();
                              }
                            }}
                          />
                          <div className="financeOpsBalanceAdjustActions">
                            <button
                              type="button"
                              className="primaryAction financeOpsBalanceAdjustPrimary"
                              disabled={adjustBusy}
                              onClick={prepareBalanceAdjust}
                            >
                              Сохранить остаток
                            </button>
                            <button
                              type="button"
                              className="ghost financeOpsBalanceAdjustCancel"
                              disabled={adjustBusy}
                              onClick={cancelBalanceAdjust}
                            >
                              Отмена
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="financeOpsBalanceAdjustConfirm">
                            Точно скорректировать остаток?
                          </p>
                          <p className="financeOpsBalanceAdjustPreview">
                            {fmt(Number(String(adjustNewBalance).replace(',', '.')) || 0)}
                          </p>
                          <div className="financeOpsBalanceAdjustActions">
                            <button
                              type="button"
                              className="primaryAction financeOpsBalanceAdjustPrimary"
                              disabled={adjustBusy}
                              onClick={() => void confirmBalanceAdjust()}
                            >
                              Точно скорректировать
                            </button>
                            <button
                              type="button"
                              className="ghost financeOpsBalanceAdjustCancel"
                              disabled={adjustBusy}
                              onClick={() => setAdjustConfirmPending(false)}
                            >
                              Назад
                            </button>
                          </div>
                        </>
                      )}
                      {adjustError ? <p className="error financeOpsBalanceAdjustError">{adjustError}</p> : null}
                    </div>
                  ) : (
                    <div className="financeOpsBalanceCardTail">
                      <strong>{fmt(acc.balance)}</strong>
                      {isDirector ? (
                        <button
                          type="button"
                          className="ghost financeOpsBalanceAdjustBtn"
                          aria-label={`Корректировка остатка: ${acc.name}`}
                          title="Корректировка остатка"
                          onClick={() => startBalanceAdjust(acc)}
                        >
                          ✎
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </header>

      {desktopFinance ? (
        <section className="financeOpsZone financeOpsZone--flows addSaleForm">
          <h4 className="financeOpsZoneTitle">Приход и расход</h4>
          <div className="financeOpsFlowsMain">
            <div className="financeOpsExpenseEntryCallout">
              <span className="financeOpsEntryCalloutLabel">Расход</span>
              <label className="financeOpsFlowSideField">
                <span className="financeOpsFlowSideFieldLabel">Статья расхода</span>
                <select
                  className="financeOpsExpenseCategoryInline"
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
              <label className="financeOpsFlowSideField financeOpsFlowSideField--amount">
                <span className="financeOpsFlowSideFieldLabel">Сумма, ₽</span>
                <input
                  className="financeOpsExpenseEntryInput"
                inputMode="decimal"
                aria-label="Сумма расхода"
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
                placeholder="0"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitExpense();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="primaryAction financeOpsExpenseSubmit"
                disabled={!selectedFlowAccountId || busyId === 'expense'}
                onClick={() => void submitExpense()}
              >
                Добавить расход
              </button>
            </div>
            <div
              className="financeOpsFlowAccountsGrid"
              role="group"
              aria-label="Счёт для прихода и расхода"
            >
              {primaryFinanceAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  className={`ghost financeOpsFlowAccountChip${
                    selectedFlowAccountId === acc.id ? ' financeOpsFlowAccountChip--active' : ''
                  }`}
                  onClick={() => setSelectedFlowAccountId(acc.id)}
                >
                  {acc.name?.trim() || 'Счёт'}
                </button>
              ))}
            </div>
            <div className="financeOpsIncomeEntryCallout">
              <label className="financeOpsFlowSideField financeOpsFlowSideField--amount financeOpsFlowSideField--income">
                <span className="financeOpsEntryCalloutLabel">Сумма прихода</span>
                <input
                  className="financeOpsIncomeEntryInput"
                  inputMode="decimal"
                  aria-label="Сумма прихода за день"
                  value={incomeDraftsByAccount[selectedFlowAccountId] ?? ''}
                  onChange={(event) =>
                    setIncomeDraftsByAccount((prev) => ({
                      ...prev,
                      [selectedFlowAccountId]: event.target.value,
                    }))
                  }
                  placeholder="0"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitIncomeForSelectedAccount();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="primaryAction financeOpsIncomeSubmit"
                disabled={
                  !selectedFlowAccountId ||
                  busyId === `income-${selectedFlowAccountId}` ||
                  primaryFinanceAccounts.length === 0
                }
                onClick={submitIncomeForSelectedAccount}
              >
                Записать приход
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="financeOpsZone financeOpsZone--income financeOpsIncomeBlock addSaleForm">
            <h4 className="financeOpsZoneTitle">Приход за день</h4>
            <label className="financeOpsAccountsPick">
              <span className="financeOpsFieldLabel">Счёт прихода</span>
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
              <label className="financeOpsAmountField">
                <span className="financeOpsFieldLabel">Сумма, ₽</span>
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
          </section>

          <section className="financeOpsZone financeOpsZone--expense addSaleForm">
            <h4 className="financeOpsZoneTitle">Расход</h4>
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
              <label className="financeOpsAmountField">
                <span className="financeOpsFieldLabel">Сумма, ₽</span>
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
                onClick={() => void submitExpense()}
              >
                Добавить расход
              </button>
            </div>
          </section>
        </>
      )}

      {status || error ? (
        <div className="financeOpsStatusBar" role="status">
          {status ? <p className="success financeOpsStatusMsg">{status}</p> : null}
          {error ? <p className="error financeOpsStatusMsg">{error}</p> : null}
        </div>
      ) : null}

      <section
        className={`financeOpsZone financeOpsZone--articles financeOpsExpenseArticlesSheet${
          desktopFinance ? ' financeOpsExpenseArticlesSheet--desktop' : ''
        }${expenseArticlesSheetOpen ? ' financeOpsExpenseArticlesSheet--open' : ''}`}
      >
        {desktopFinance ? (
          <>
            <div className="financeOpsArticlesHead">
              <h4 className="financeOpsZoneTitle">Расходы по статьям</h4>
              <span className="financeOpsArticlesTotal">{fmt(expensesGrandTotal)}</span>
            </div>
            <div
              className="financeOpsExpenseArticlesCarousel financeOpsExpenseArticlesCarousel--desktop"
              role="list"
              aria-label="Суммы расходов по статьям"
            >
              {expenseTotalsByArticle.map((row) => (
                <article key={row.title} className="financeOpsExpenseArticlesChip" role="listitem">
                  <span className="financeOpsExpenseArticlesChipTitle">{row.title}</span>
                  <strong className="financeOpsExpenseArticlesChipAmount">{fmt(row.total)}</strong>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </section>

      {desktopFinance ? (
        <section className="financeOpsZone financeOpsZone--historyMini">
          <div className="financeOpsHistoryMiniRow">
            <FinanceOpsHistoryStrip
              title="Последние приходы по счетам"
              emptyLabel="Приходов пока нет"
              items={recentIncomeHistoryItems}
            />
            <FinanceOpsHistoryStrip
              title="Последние расходы"
              emptyLabel="Расходов пока нет"
              items={recentExpenseHistoryItems}
            />
          </div>
        </section>
      ) : (
        <section className="financeOpsZone financeOpsZone--history financeHistoryAccordions">
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
        </section>
      )}
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

  const desktopShift = isTauriRuntime();

  return (
    <div className={`opsCard shiftPanelCard${desktopShift ? ' shiftPanelCard--desktop' : ''}`}>
      <h4 className={desktopShift ? 'dtSectionTitle shiftColTitle' : 'shiftPanelHeading'}>
        Открытие/закрытие смены
      </h4>
      {readOnly && (
        <p className="notice">Роль «Бухгалтер»: только просмотр, без открытия и закрытия смен.</p>
      )}
      {openShift && !readOnly && !desktopShift && (
        <p className="notice shiftNotice">
          Смена уже идёт. Отметьте ещё сотрудников и нажмите «Добавить в смену» — все выбранные
          останутся на одной смене.
        </p>
      )}
      <div className="shiftSellerList shiftSellerListGrouped" role="list" aria-label="Сотрудники для смены">
        {shiftAssignableStaff.map((member) => (
          <label
            key={member.id}
            className="shiftSellerRow"
            title={`${member.fullName} (${member.storeName})`}
          >
            <span className="shiftSellerControl">
              <input
                type="checkbox"
                className="shiftSellerCheckbox"
                checked={selectedStaffIds.includes(member.id)}
                onChange={() => toggleStaff(member.id)}
                disabled={readOnly}
              />
            </span>
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

  const desktopCard = isTauriRuntime();

  return (
    <article
      className={`teamMemberCard${desktopCard ? ' teamMemberCard--desktop' : ''} ${isShiftOpen ? 'teamMemberCardShiftOpen' : 'teamMemberCardShiftClosed'}`}
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
  const desktopWarehouse = isTauriRuntime();
  const [selectedStoreName, setSelectedStoreName] = useState('');

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

  useEffect(() => {
    if (storesSorted.length === 0) {
      setSelectedStoreName('');
      return;
    }
    setSelectedStoreName((cur) => (storesSorted.includes(cur) ? cur : storesSorted[0]!));
  }, [storesSorted]);

  const membersForStore = (storeName: string) =>
    staff
      .filter((member) => member.isActive && staffAssignedStores(member).includes(storeName))
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

  const removedStaffRows = staff.filter((member) => {
    const assigns = staffAssignedStores(member);
    return !member.isActive || assigns.length === 0;
  });
  removedStaffRows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

  const reportDateBar = onReportDayKeyChange ? (
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
  ) : null;

  const renderWarehouseMember = (member: StaffMember, storeName: string) => {
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
        : Math.round(((todaySalesBySellerId.get(member.id) ?? 0) * (seller?.ratePercent ?? 0)) / 100);
      const compactName = member.fullName
        .replace(` — ${storeName}`, '')
        .replace(` - ${storeName}`, '')
        .trim();
      return (
        <div key={`${storeName}-${member.id}`} className="teamManagerPayrollRow">
          <span className="teamManagerPayrollName">{compactName || member.fullName}</span>
          <span className="teamManagerPayrollSalary">{salaryDayRub.toLocaleString('ru-RU')} ₽</span>
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
    const cardDesktopClass = desktopWarehouse ? ' teamMemberCard--desktop' : '';

    return (
      <article
        key={`${storeName}-${member.id}`}
        className={`teamMemberCard storeTeamMemberCard${cardDesktopClass} ${isShiftOpen ? 'teamMemberCardShiftOpen' : 'teamMemberCardShiftClosed'}`}
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
                  const ok = window.confirm(`Убрать «${member.fullName}» из точки «${storeName}»?`);
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
  };

  const renderRemovedStaffSection = () => {
    if (hideRemovedStaff) {
      return null;
    }
    return (
      <section
        className={`teamWarehouseRemoved${desktopWarehouse ? '' : ` teamStoresRemovedWrap ${removedStaffAccordionOpen ? '' : 'teamStoresRemovedWrap--collapsed'}`}`}
      >
        {desktopWarehouse ? (
          <>
            <div className="teamWarehouseRemovedHead">
              <h5 className="teamWarehouseRemovedTitle">Удалённые сотрудники</h5>
              <span className="teamWarehouseRemovedCount">{removedStaffRows.length}</span>
            </div>
            <p className="teamStoresRemovedIntro">
              Отключённые учётные записи и те, у кого не осталось привязки ни к одной точке.
            </p>
          </>
        ) : (
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
        )}
        <div
          id="team-stores-removed-panel"
          className={desktopWarehouse ? 'teamWarehouseRemovedBody' : 'teamStoresRemovedAccordionPanel'}
          role="region"
          aria-labelledby="team-stores-removed-heading"
        >
          <div
            className={
              desktopWarehouse ? 'teamWarehouseRemovedBodyInner' : 'teamStoresRemovedAccordionPanelInner'
            }
          >
            {!desktopWarehouse ? (
              <p className="teamStoresRemovedIntro">
                Отключённые учётные записи и те, у кого не осталось привязки ни к одной точке после
                исключения из состава.
              </p>
            ) : null}
            {removedStaffRows.length === 0 ? (
              <p className="teamStoresRemovedEmpty">Записей пока нет.</p>
            ) : (
              <ul
                className={
                  desktopWarehouse ? 'teamWarehouseRemovedGrid' : 'teamStoresRemovedList'
                }
              >
                {removedStaffRows.map((member) => {
                  const isRetoucher = member.staffPosition === 'RETOUCHER';
                  const reasonLabel = !member.isActive ? 'Отключён' : 'Не привязан к точкам';
                  const chosenStore = restorePickStore[member.id] ?? restoreStoreChoices[0] ?? '';
                  if (desktopWarehouse) {
                    return (
                      <li key={`removed-${member.id}`} className="teamWarehouseRemovedCard">
                        <div className="teamWarehouseRemovedCardMain">
                          <p className="teamWarehouseRemovedName">
                            <strong>{member.fullName}</strong>
                            <span className="teamMemberNick">({member.nickname})</span>
                          </p>
                          <div className="teamWarehouseRemovedMeta">
                            <span
                              className={`teamWarehouseRemovedTag${
                                isRetoucher ? ' teamWarehouseRemovedTag--retoucher' : ''
                              }`}
                            >
                              {isRetoucher ? 'Ретушёр' : 'Продавец'}
                            </span>
                            <span
                              className={`teamWarehouseRemovedReason${
                                !member.isActive ? ' teamWarehouseRemovedReason--off' : ''
                              }`}
                            >
                              {reasonLabel}
                            </span>
                          </div>
                        </div>
                        <div className="teamWarehouseRemovedActions">
                          <select
                            className="teamWarehouseRestoreSelect"
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
                              <option value="">Нет точек</option>
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
                            className="ghost teamWarehouseRestoreBtn"
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
                        </div>
                      </li>
                    );
                  }
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
    );
  };

  if (desktopWarehouse) {
    const activeStore = selectedStoreName || storesSorted[0] || '';
    const activeMembers = activeStore ? membersForStore(activeStore) : [];
    const openShiftsInStore = activeMembers.filter(
      (m) => openShiftId && m.assignedShiftId === openShiftId,
    ).length;

    return (
      <div className="teamWarehouseShell teamWarehouseShell--desktop staffPanelRoot staffPanelStoresOverview">
        <header className="teamWarehouseHead">
          <h4 className="teamWarehouseTitle">Команда по магазинам</h4>
          {reportDateBar}
        </header>
        <div className="teamWarehouseWorkspace">
          <aside className="teamWarehouseStoresRail" role="tablist" aria-label="Точки продаж">
            {storesSorted.map((storeName) => {
              const count = membersForStore(storeName).length;
              const isActive = storeName === activeStore;
              return (
                <button
                  key={storeName}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`teamWarehouseStoreBtn${isActive ? ' teamWarehouseStoreBtn--active' : ''}`}
                  onClick={() => setSelectedStoreName(storeName)}
                >
                  <span className="teamWarehouseStoreBtnName">{storeName}</span>
                  <span className="teamWarehouseStoreBtnMeta">{count} чел.</span>
                </button>
              );
            })}
          </aside>
          <main className="teamWarehouseDetail" role="tabpanel">
            {activeStore ? (
              <>
                <div className="teamWarehouseDetailHead">
                  <h5 className="teamWarehouseDetailTitle">{activeStore}</h5>
                  <div className="teamWarehouseDetailBadges">
                    <span className="teamWarehouseDetailBadge">{activeMembers.length} сотрудников</span>
                    {openShiftsInStore > 0 ? (
                      <span className="teamWarehouseDetailBadge teamWarehouseDetailBadge--open">
                        {openShiftsInStore} в смене
                      </span>
                    ) : null}
                  </div>
                </div>
                <div
                  className={
                    managerPayrollView ? 'teamManagerPayrollList teamWarehousePayroll' : 'teamWarehouseMemberGrid'
                  }
                >
                  {managerPayrollView ? (
                    <div className="teamManagerPayrollHeader">
                      <span>Имя</span>
                      <span>Зарплата за день</span>
                    </div>
                  ) : null}
                  {activeMembers.length === 0 ? (
                    <p className="teamWarehouseEmpty">В этой точке нет активных сотрудников.</p>
                  ) : (
                    activeMembers.map((member) => renderWarehouseMember(member, activeStore))
                  )}
                </div>
              </>
            ) : (
              <p className="teamWarehouseEmpty">Нет привязанных точек.</p>
            )}
          </main>
        </div>
        {renderRemovedStaffSection()}
      </div>
    );
  }

  return (
    <div className="staffPanelRoot staffPanelStoresOverview">
      <h4 className="staffPanelTitle">Команда по магазинам</h4>
      {reportDateBar}
      <div className="teamStoresBoard">
        {storesSorted.map((storeName) => {
          const members = membersForStore(storeName);
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
              {members.map((member) => renderWarehouseMember(member, storeName))}
                </div>
              </div>
            </div>
          </section>
          );
        })}
      </div>

      {renderRemovedStaffSection()}
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
  const desktopFlat = isTauriRuntime();

  const staffRosterCards = staff.map((member) => {
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
  });

  const staffManagementForms = readOnly ? (
    <p className="staffPanelIntro">Просмотр персонала (бухгалтер).</p>
  ) : desktopFlat ? (
    <div className="staffMgmtStrip staffMgmtStrip--centered" role="group" aria-label="Управление персоналом">
      <div className="staffMgmtStripInner">
        <div className="staffMgmtGroup staffMgmtGroup--add">
          <span className="staffMgmtGroupLabel">Новый</span>
          <input
            className="staffMgmtInput staffMgmtInput--name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="ФИО"
            aria-label="ФИО нового сотрудника"
          />
          <input
            className="staffMgmtInput staffMgmtInput--nick"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Ник"
            aria-label="Ник нового сотрудника"
          />
          <button
            className="primaryAction staffMgmtBtn"
            type="button"
            onClick={async () => {
              await onAdd(token, fullName, nickname);
              setFullName('');
              setNickname('');
            }}
          >
            Добавить
          </button>
        </div>
        <div className="staffMgmtGroup staffMgmtGroup--base">
          <span className="staffMgmtGroupLabel">Из базы</span>
          <div className="staffMgmtSelectWrap">
            <select
              className="staffMgmtSelect"
              value={selectedEmployeeId}
              onChange={(event) => setPickedEmployeeId(Number(event.target.value))}
              aria-label="Сотрудник из общей базы"
            >
              {baseCandidates.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} ({employee.nickname})
                  {staffIds.has(employee.id) ? ' · на точке' : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            className="primaryAction staffMgmtBtn"
            type="button"
            disabled={!selectedEmployeeId || alreadyInStore}
            title={
              baseCandidates.length === 0
                ? 'В общей базе нет доступных продавцов'
                : alreadyInStore
                  ? 'Уже на этой точке'
                  : undefined
            }
            onClick={() => selectedEmployeeId && onAddFromBase(token, selectedEmployeeId)}
          >
            На точку
          </button>
        </div>
        <div className="staffMgmtGroup staffMgmtGroup--remove">
          <span className="staffMgmtGroupLabel">Убрать</span>
          <div className="staffMgmtSelectWrap">
            <select
              className="staffMgmtSelect"
              value={selectedRemovalStaffId}
              onChange={(event) => setPickedRemovalStaffId(Number(event.target.value))}
              aria-label="Продавец для удаления с точки"
            >
              {removableSalesStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} ({member.nickname})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="primaryAction staffMgmtBtn"
            disabled={!selectedRemovalStaffId}
            title={removableSalesStaff.length === 0 ? 'Нет продавцов для удаления' : undefined}
            onClick={async () => {
              if (!selectedRemovalStaff) {
                return;
              }
              await onRemoveFromStore(token, selectedRemovalStaff.id, selectedRemovalStaff.storeName);
              setPickedRemovalStaffId(null);
            }}
          >
            Убрать
          </button>
        </div>
      </div>
    </div>
  ) : (
    <>
      <div className="inlineGrid staffPanelAddRow dtMgmtBlock">
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
      <div className="staffMgmtGrid">
        <div className="inlineGrid inlineGridStaffBase staffBaseBlock dtMgmtBlock">
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
        <div className="inlineGrid inlineGridStaffBase staffBaseBlock dtMgmtBlock">
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
            type="button"
            className="ghost"
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
      </div>
    </>
  );

  if (showOnlyCards) {
    if (desktopFlat) {
      return (
        <div className="opsCard staffPanelRoot staffPanel--desktopSection staffPanel--cards">
          <h4 className="dtSectionTitle shiftColTitle">Сотрудники</h4>
          <div className="teamRoster dtTeamRosterGrid">{staffRosterCards}</div>
        </div>
      );
    }

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
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="staffCardsBlockAccordionPanel">
            <div className="staffCardsBlockAccordionPanelInner">
              <div className="opsList teamRoster">{staffRosterCards}</div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="opsCard staffPanelRoot">
      {managementAccordion ? (
        desktopFlat ? (
          <div className="staffPanel--desktopSection staffPanel--management">
            <h4 className="dtSectionTitle dtShiftSectionTitle shiftMgmtTitle">Управление персоналом</h4>
            {staffManagementForms}
          </div>
        ) : (
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
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </button>
          <div className="staffManagementAccordionPanel">
            <div className="staffManagementAccordionPanelInner">{staffManagementForms}</div>
          </div>
        </section>
        )
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
  products = [],
  procurementCosts = [],
  onReload,
  onReplenish,
  onSaveProcurementCosts,
  onAddProduct,
}: {
  token: string;
  overview: InventoryOverviewResponse | null;
  products?: ProductItem[];
  procurementCosts?: ProductProcurementCost[];
  onReload: () => Promise<void>;
  onReplenish: (token: string, name: string, qtyStr: string) => Promise<void>;
  onSaveProcurementCosts?: (
    token: string,
    items: Array<{ name: string; cost: number }>,
  ) => Promise<void>;
  onAddProduct?: (token: string, name: string, priceStr: string) => Promise<void>;
}) {
  const [replenishDraft, setReplenishDraft] = useState<Record<string, string>>({});
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  const [busyName, setBusyName] = useState<string | null>(null);
  const [costSaving, setCostSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [costStatus, setCostStatus] = useState('');
  const [costError, setCostError] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [busyAddProduct, setBusyAddProduct] = useState(false);

  const showProcurement = Boolean(onSaveProcurementCosts);
  const canAddProduct = Boolean(onAddProduct);
  const warehouseRows = overview?.products ?? [];
  const warehouseByName = new Map(warehouseRows.map((row) => [row.name.trim(), row]));
  const costByName = new Map(procurementCosts.map((item) => [item.name.trim(), item.cost]));
  const orderedNames = [
    ...new Set([
      ...warehouseRows.map((row) => row.name.trim()),
      ...products.map((item) => item.name.trim()),
    ]),
  ].filter(Boolean);
  const rows = orderedNames.map((name) => {
    const warehouse = warehouseByName.get(name);
    return {
      name,
      qtyWarehouse: warehouse?.qtyWarehouse ?? 0,
      qtyInStores: warehouse?.qtyInStores ?? 0,
      qtyGrandTotal: warehouse?.qtyGrandTotal ?? 0,
      currentCost: costByName.get(name) ?? 0,
    };
  });
  const colCount = showProcurement ? 6 : 5;

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
      await onReplenish(token, name, replenishDraft[name] ?? '0');
      setReplenishDraft((current) => ({ ...current, [name]: '' }));
      setStatus(`Склад пополнен: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось пополнить склад');
    } finally {
      setBusyName(null);
    }
  };

  const handleAddProduct = async () => {
    if (!onAddProduct) {
      return;
    }
    const name = newProductName.trim();
    if (!name) {
      setError('Укажите название товара');
      return;
    }
    setBusyAddProduct(true);
    setError('');
    setStatus('');
    try {
      await onAddProduct(token, name, newProductPrice);
      setNewProductName('');
      setNewProductPrice('');
      setAddingProduct(false);
      setStatus(`Товар «${name}» добавлен во все точки`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось добавить товар');
    } finally {
      setBusyAddProduct(false);
    }
  };

  const saveProcurementCosts = async () => {
    if (!onSaveProcurementCosts) {
      return;
    }
    setCostSaving(true);
    setCostError('');
    setCostStatus('');
    try {
      const payload = rows.map((row) => ({
        name: row.name,
        cost: Math.max(0, Number(costDraft[row.name] ?? row.currentCost) || 0),
      }));
      await onSaveProcurementCosts(token, payload);
      setCostDraft({});
      setCostStatus('Закупочные цены сохранены.');
    } catch (e) {
      setCostError(e instanceof Error ? e.message : 'Не удалось сохранить закупочные цены');
    } finally {
      setCostSaving(false);
    }
  };

  return (
    <div
      className={`invGlassRoot directorWarehouseRoot${showProcurement ? ' directorWarehouseRoot--withCosts' : ''}`}
    >
      <div className="invGlassShell directorWarehouseShell">
        <header className="invGlassHeader directorWarehouseHeader">
          <div className="directorWarehouseHeaderMain">
            <h3 className="invGlassTitle directorWarehouseTitle">Склад и остатки</h3>
            <p className="directorWarehouseSubtitle">Каталог общий для склада и всех точек</p>
          </div>
          <div className="directorWarehouseHeaderActions">
            {canAddProduct ? (
              <button
                type="button"
                className="ghost directorWarehouseAddProductBtn"
                onClick={() => {
                  setAddingProduct((open) => !open);
                  setError('');
                }}
              >
                {addingProduct ? 'Скрыть' : '+ Товар'}
              </button>
            ) : null}
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
          </div>
        </header>

        {canAddProduct && addingProduct ? (
          <div className="directorWarehouseAddProductForm">
            <input
              type="text"
              className="directorWarehouseAddProductInput"
              value={newProductName}
              onChange={(event) => setNewProductName(event.target.value)}
              placeholder="Название товара"
              maxLength={120}
              aria-label="Название нового товара"
            />
            <input
              type="text"
              className="directorWarehouseAddProductInput directorWarehouseAddProductInput--price"
              inputMode="decimal"
              value={newProductPrice}
              onChange={(event) => setNewProductPrice(event.target.value)}
              placeholder="Цена продажи"
              aria-label="Цена продажи"
            />
            <button
              type="button"
              className="invPrimaryMini directorWarehouseAddProductConfirm"
              disabled={busyAddProduct}
              onClick={() => void handleAddProduct()}
            >
              {busyAddProduct ? '…' : 'Добавить'}
            </button>
            <button
              type="button"
              className="ghost directorWarehouseAddProductCancel"
              disabled={busyAddProduct}
              onClick={() => {
                setAddingProduct(false);
                setNewProductName('');
                setNewProductPrice('');
              }}
            >
              Отмена
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="invInlineError" role="alert">
            {error}
          </p>
        ) : null}
        {status ? <p className="invInlineOk">{status}</p> : null}
        {costStatus ? <p className="invInlineOk">{costStatus}</p> : null}
        {costError ? (
          <p className="invInlineError" role="alert">
            {costError}
          </p>
        ) : null}

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
                {showProcurement ? (
                  <th className="invThNum dwThCost" scope="col" title="Закупочная цена, ₽">
                    Закуп. цена
                  </th>
                ) : null}
                <th className="invThAction dwThAction" scope="col" title="Количество и подтверждение пополнения">
                  Кол-во
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="invTableEmpty">
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
                    {showProcurement ? (
                      <td className="invTdNum dwTdCost">
                        <input
                          className="dwCostInput procurementCostInput"
                          inputMode="decimal"
                          value={costDraft[row.name] ?? String(row.currentCost)}
                          onChange={(event) =>
                            setCostDraft((current) => ({
                              ...current,
                              [row.name]: event.target.value,
                            }))
                          }
                          aria-label={`Закупочная цена: ${row.name}`}
                        />
                      </td>
                    ) : null}
                    <td className="invTdAction dwTdAction">
                      <div className="dwReplenish" role="group" aria-label={`Пополнить склад: ${row.name}`}>
                        <input
                          className="dwReplenishInput"
                          inputMode="numeric"
                          placeholder="0"
                          value={replenishDraft[row.name] ?? ''}
                          onChange={(event) =>
                            setReplenishDraft((current) => ({
                              ...current,
                              [row.name]: event.target.value,
                            }))
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

        {showProcurement ? (
          <div className="directorWarehouseProcurementFooter">
            <button
              type="button"
              className="primaryAction directorWarehouseProcurementSaveBtn"
              disabled={costSaving}
              onClick={() => void saveProcurementCosts()}
            >
              {costSaving ? 'Сохраняем…' : 'Сохранить закупочные цены'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function draftEmptyCounts(): StoreEquipmentCounts {
  return {
    pc: 0,
    camera: 0,
    printer: 0,
    sdCard: 0,
    monitor: 0,
    mouse: 0,
    keyboard: 0,
    cardReader: 0,
    extra: {},
  };
}

function normalizeStoreEquipmentCounts(raw: Partial<StoreEquipmentCounts>): StoreEquipmentCounts {
  const base = draftEmptyCounts();
  return {
    ...base,
    ...raw,
    extra: { ...base.extra, ...(raw.extra ?? {}) },
  };
}

function StoreEquipmentReadAccordion({ token }: { token: string }) {
  const desktopTeam = isTauriRuntime();
  const [expanded, setExpanded] = useState(false);
  const [equipment, setEquipment] = useState<StoreEquipmentCounts | null>(null);
  const [customTypes, setCustomTypes] = useState<StoreEquipmentCustomType[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/admin/store-equipment/my-store`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('load');
      }
      const data = (await response.json()) as {
        equipment: StoreEquipmentCounts;
        customTypes?: StoreEquipmentCustomType[];
      };
      setEquipment(normalizeStoreEquipmentCounts(data.equipment));
      setCustomTypes(data.customTypes ?? []);
    } catch {
      setEquipment(null);
      setCustomTypes([]);
      setError('Не удалось загрузить данные');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const readFields = useMemo(() => buildStoreEquipmentFields(customTypes), [customTypes]);

  const equipmentBody = (
    <>
      {error ? (
        <p className="invInlineError storeInvMessage" role="alert">
          {error}
        </p>
      ) : null}
      <div className={`storeEquipGrid${desktopTeam ? ' storeEquipGrid--desktop' : ''}`}>
        {readFields.map((field) => (
          <div
            className="storeEquipGridRow"
            key={field.kind === 'builtin' ? field.key : field.id}
          >
            <span className="storeEquipLabel">{field.label}</span>
            <span className="storeEquipVal">
              {equipment !== null ? storeEquipmentQty(equipment, field) : '…'}
            </span>
          </div>
        ))}
      </div>
    </>
  );

  if (desktopTeam) {
    return (
      <div className="storeEquipRead storeEquipRead--desktop">
        <h4 className="dtSectionTitle">Спецтехника на точке</h4>
        {equipmentBody}
      </div>
    );
  }

  return (
    <div
      className={`writeOffForm writeOffFormCarousel storeEquipRead ${expanded ? 'writeOffFormCarouselOpen' : ''}`}
    >
      <button
        type="button"
        className={`writeOffCarouselToggle ${expanded ? 'writeOffCarouselToggleOpen' : ''}`}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="store-equipment-read-body"
      >
        <span className="writeOffCarouselToggleTitle">Спецтехника на точке</span>
        <span className="writeOffCarouselToggleIcon" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>
      <div
        id="store-equipment-read-body"
        className={`writeOffCarouselBody ${expanded ? 'writeOffCarouselBodyOpen' : ''}`}
      >
        {equipmentBody}
      </div>
    </div>
  );
}

function AccountantStoreEquipmentStoresPanel({ token }: { token: string }) {
  type StoreRow = { storeName: string } & StoreEquipmentCounts;
  const isDesktop = isTauriRuntime();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [customTypes, setCustomTypes] = useState<StoreEquipmentCustomType[]>([]);
  const [draftByStore, setDraftByStore] = useState<Record<string, StoreEquipmentCounts>>({});
  const [selectedStore, setSelectedStore] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busyStore, setBusyStore] = useState<string | null>(null);
  const [addingType, setAddingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [busyAddType, setBusyAddType] = useState(false);
  const swipeStartX = useRef<number | null>(null);

  const equipmentFields = useMemo(() => buildStoreEquipmentFields(customTypes), [customTypes]);

  const sortedStores = useMemo(() => {
    if (!stores?.length) {
      return [];
    }
    return [...stores].sort((a, b) => a.storeName.localeCompare(b.storeName, 'ru-RU'));
  }, [stores]);

  const load = useCallback(async () => {
    setError('');
    setStatus('');
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/admin/store-equipment`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const msg = Array.isArray(errBody?.message)
          ? errBody.message[0]
          : errBody?.message;
        if (response.status === 403) {
          setError(
            typeof msg === 'string' && msg.includes('бухгалтер')
              ? 'Сервер ещё не обновлён: директору нужен деплой backend с доступом к спецтехнике. Бухгалтер видит этот раздел.'
              : 'Нет доступа к своду по точкам',
          );
        } else if (response.status === 401) {
          setError('Сессия истекла — выйдите и войдите снова');
        } else {
          setError(
            typeof msg === 'string' && msg.length > 0
              ? msg
              : `Не удалось загрузить свод (${response.status})`,
          );
        }
        setStores(null);
        return;
      }
      const data = (await response.json()) as {
        stores?: StoreRow[];
        customTypes?: StoreEquipmentCustomType[];
      };
      const rows = Array.isArray(data.stores) ? data.stores : [];
      setStores(rows);
      setCustomTypes(data.customTypes ?? []);
      const nextDraft: Record<string, StoreEquipmentCounts> = {};
      for (const row of rows) {
        const { storeName, ...counts } = row;
        nextDraft[storeName] = normalizeStoreEquipmentCounts(counts);
      }
      setDraftByStore(nextDraft);
    } catch {
      setStores(null);
      setError('Не удалось загрузить свод по точкам — проверьте сеть и адрес API');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sortedStores.length) {
      setSelectedStore('');
      return;
    }
    setSelectedStore((current) => {
      if (current && sortedStores.some((row) => row.storeName === current)) {
        return current;
      }
      return sortedStores[0].storeName;
    });
  }, [sortedStores]);

  const updateDraft = (storeName: string, field: StoreEquipmentField, raw: string) => {
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? 0 : Math.floor(Number(trimmed.replace(',', '.')));
    const n = Number.isFinite(parsed) ? Math.max(0, Math.min(9999, parsed)) : 0;
    setDraftByStore((current) => {
      const prev = current[storeName] ?? draftEmptyCounts();
      if (field.kind === 'builtin') {
        return { ...current, [storeName]: { ...prev, [field.key]: n } };
      }
      return {
        ...current,
        [storeName]: { ...prev, extra: { ...prev.extra, [field.id]: n } },
      };
    });
  };

  const addCustomType = async () => {
    const label = newTypeLabel.trim();
    if (!label) {
      setError('Укажите название вида техники');
      return;
    }
    setBusyAddType(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch(`${API_BASE_URL}/admin/store-equipment/types`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(errBody?.message)
          ? errBody.message[0]
          : errBody?.message;
        throw new Error(typeof msg === 'string' ? msg : 'add');
      }
      const data = (await response.json()) as { customTypes: StoreEquipmentCustomType[] };
      setCustomTypes(data.customTypes);
      setDraftByStore((current) => {
        const next = { ...current };
        const newId = data.customTypes[data.customTypes.length - 1]?.id;
        if (!newId) {
          return next;
        }
        for (const sn of Object.keys(next)) {
          next[sn] = {
            ...next[sn],
            extra: { ...next[sn].extra, [newId]: next[sn].extra[newId] ?? 0 },
          };
        }
        return next;
      });
      setNewTypeLabel('');
      setAddingType(false);
      setStatus(`Добавлен вид: ${label}`);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'add' ? e.message : 'Не удалось добавить вид техники');
    } finally {
      setBusyAddType(false);
    }
  };

  const saveStore = async (storeName: string) => {
    const row = draftByStore[storeName];
    if (!row) {
      return;
    }
    setBusyStore(storeName);
    setStatus('');
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/admin/store-equipment`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeName,
          ...row,
        }),
      });
      if (!response.ok) {
        throw new Error('save');
      }
      const data = (await response.json()) as { storeName: string; equipment: StoreEquipmentCounts };
      setDraftByStore((current) => ({
        ...current,
        [data.storeName]: normalizeStoreEquipmentCounts(data.equipment),
      }));
      setStatus(`Сохранено: ${data.storeName}`);
    } catch {
      setError('Не удалось сохранить');
    } finally {
      setBusyStore(null);
    }
  };

  const storeIndex = sortedStores.findIndex((row) => row.storeName === selectedStore);
  const goPrev = () => {
    if (storeIndex > 0) {
      setSelectedStore(sortedStores[storeIndex - 1].storeName);
    }
  };
  const goNext = () => {
    if (storeIndex >= 0 && storeIndex < sortedStores.length - 1) {
      setSelectedStore(sortedStores[storeIndex + 1].storeName);
    }
  };

  const onSwipeTouchStart = (event: TouchEvent) => {
    swipeStartX.current = event.touches[0].clientX;
  };

  const onSwipeTouchEnd = (event: TouchEvent) => {
    if (swipeStartX.current === null || sortedStores.length < 2) {
      swipeStartX.current = null;
      return;
    }
    const dx = event.changedTouches[0].clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (dx > 48) {
      goPrev();
    } else if (dx < -48) {
      goNext();
    }
  };

  if (stores === null && !error) {
    return <p className="muted financeOpsHint">Загрузка учёта техники…</p>;
  }

  const activeRow = sortedStores.find((row) => row.storeName === selectedStore);
  const draft = activeRow ? (draftByStore[activeRow.storeName] ?? activeRow) : null;
  const totalStores = sortedStores.length;
  const canNav = totalStores > 1;
  const activeTotal = draft ? storeEquipmentTotal(draft, equipmentFields) : 0;

  const equipmentEditor = activeRow && draft ? (
    <div className="storeEquipEditorPanel">
      <div className="storeEquipEditorHead">
        <div className="storeEquipEditorTitleWrap">
          <h3 className="storeEquipEditorTitle">{activeRow.storeName}</h3>
          <p className="storeEquipEditorMeta">
            {isDesktop
              ? `Всего единиц на точке: ${activeTotal}`
              : `${storeIndex + 1} из ${totalStores} · всего ${activeTotal}`}
          </p>
        </div>
        {!isDesktop && canNav ? (
          <div className="storeEquipCarouselNav storeEquipCarouselNav--compact" role="group" aria-label="Выбор точки">
            <button
              type="button"
              className="storeEquipCarouselNavBtn"
              onClick={goPrev}
              disabled={storeIndex <= 0}
              aria-label="Предыдущая точка"
            >
              ‹
            </button>
            <button
              type="button"
              className="storeEquipCarouselNavBtn"
              onClick={goNext}
              disabled={storeIndex >= totalStores - 1}
              aria-label="Следующая точка"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
      <div
        className={`storeEquipGrid storeEquipGrid--accountant${isDesktop ? ' storeEquipGrid--desktop' : ''}`}
        onTouchStart={isDesktop ? undefined : onSwipeTouchStart}
        onTouchEnd={isDesktop ? undefined : onSwipeTouchEnd}
      >
        {equipmentFields.map((field) => (
          <label
            className="storeEquipGridRow storeEquipGridRow--field"
            key={field.kind === 'builtin' ? field.key : field.id}
          >
            <span className="storeEquipLabel">{field.label}</span>
            <input
              className="invQtyInput invQtyInputTight storeEquipQtyInput"
              inputMode="numeric"
              aria-label={`${field.label}, ${activeRow.storeName}`}
              value={String(storeEquipmentQty(draft, field))}
              onChange={(event) => updateDraft(activeRow.storeName, field, event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="storeEquipActionsRow">
        {addingType ? (
          <div className="storeEquipAddTypeForm">
            <input
              type="text"
              className="storeEquipAddTypeInput"
              value={newTypeLabel}
              onChange={(event) => setNewTypeLabel(event.target.value)}
              placeholder="Название, например Штатив"
              maxLength={64}
              aria-label="Название нового вида техники"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addCustomType();
                }
                if (event.key === 'Escape') {
                  setAddingType(false);
                  setNewTypeLabel('');
                }
              }}
            />
            <button
              type="button"
              className="invPrimaryMini storeEquipAddTypeConfirm"
              disabled={busyAddType}
              onClick={() => void addCustomType()}
            >
              {busyAddType ? '…' : 'Добавить'}
            </button>
            <button
              type="button"
              className="ghost storeEquipAddTypeCancel"
              disabled={busyAddType}
              onClick={() => {
                setAddingType(false);
                setNewTypeLabel('');
              }}
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ghost storeEquipAddTypeBtn"
            onClick={() => {
              setAddingType(true);
              setError('');
            }}
          >
            + Вид техники
          </button>
        )}
        <button
          type="button"
          className="invPrimaryMini storeEquipSaveBtn"
          disabled={busyStore === activeRow.storeName}
          onClick={() => void saveStore(activeRow.storeName)}
        >
          {busyStore === activeRow.storeName ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`storeEquipAccountantRoot${
        isDesktop ? ' storeEquipAccountantRoot--desktop' : ' storeEquipAccountantCarousel'
      }`}
    >
      <header className="storeEquipAccountantHead">
        <div>
          <p className="storeEquipAccountantLead">Спецтехника по точкам</p>
          {isDesktop && totalStores > 0 ? (
            <p className="storeEquipAccountantSub">
              {totalStores} {totalStores === 1 ? 'точка' : totalStores < 5 ? 'точки' : 'точек'} · выберите точку слева
            </p>
          ) : null}
        </div>
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
      </header>

      {stores && stores.length === 0 ? (
        <p className="muted financeOpsHint">Точек для учёта пока нет.</p>
      ) : isDesktop ? (
        <div className="storeEquipAccountantWorkspace">
          <aside className="storeEquipStoreRail" aria-label="Список точек">
            <ul className="storeEquipStoreList">
              {sortedStores.map((row) => {
                const counts = draftByStore[row.storeName] ?? row;
                const isActive = row.storeName === selectedStore;
                return (
                  <li key={row.storeName}>
                    <button
                      type="button"
                      className={`storeEquipStoreBtn${isActive ? ' storeEquipStoreBtn--active' : ''}`}
                      onClick={() => setSelectedStore(row.storeName)}
                    >
                      <span className="storeEquipStoreBtnName">{row.storeName}</span>
                      <span className="storeEquipStoreBtnMeta">
                        {storeEquipmentTotal(counts, equipmentFields)} ед.
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="storeEquipEditorMain">{equipmentEditor}</div>
        </div>
      ) : activeRow && draft ? (
        <div className="storeEquipCarouselShell">
          <div className="storeEquipCarouselNav" role="group" aria-label="Выбор точки">
            <button
              type="button"
              className="storeEquipCarouselNavBtn"
              onClick={goPrev}
              disabled={!canNav || storeIndex <= 0}
              aria-label="Предыдущая точка"
            >
              ‹
            </button>
            <div className="storeEquipCarouselTitleWrap" aria-live="polite">
              <p className="storeEquipCarouselStoreName">{activeRow.storeName}</p>
              <p className="storeEquipCarouselCounter">
                {storeIndex + 1} из {totalStores}
              </p>
            </div>
            <button
              type="button"
              className="storeEquipCarouselNavBtn"
              onClick={goNext}
              disabled={!canNav || storeIndex >= totalStores - 1}
              aria-label="Следующая точка"
            >
              ›
            </button>
          </div>
          {equipmentEditor}
        </div>
      ) : null}
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

  const desktopTeam = isTauriRuntime();

  return (
    <div
      className={`invGlassRoot storeInventoryRoot storeInventoryPanel${
        desktopTeam ? ' storeInventoryPanel--desktop' : ''
      }`}
    >
      <div className="invGlassShell storeInventoryShell">
        <header className="invGlassHeader storeInventoryHeader">
          <div className="invGlassHeaderText storeInventoryHeaderText">
            {desktopTeam ? (
              <h4 className="dtSectionTitle storeInventoryTitleDesktop">
                Учёт на точке
                <span className="storeInventoryStoreName">{storeName}</span>
              </h4>
            ) : (
              <>
                <h3 className="invGlassTitle">Учёт на точке</h3>
                <p className="storeInvMetaLine" title={storeName}>
                  <strong>{storeName}</strong>
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            className={`invGhostBtn storeInventoryRefreshBtn${desktopTeam ? ' ghost' : ''}`}
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

const ACQUIRING_RATE_ROWS = [
  {
    id: 'putintsev-vtb',
    label: 'Путинцев ВТБ',
    placeholder: '1.94',
  },
  {
    id: 'detkov-vtb',
    label: 'Детков ВТБ',
    placeholder: '2',
  },
  {
    id: 'putintsev-sber',
    label: 'Путинцев Сбербанк',
    placeholder: '1.8',
  },
] as const;

function AccountantProcurementPanel({
  token,
  acquiringPercent,
  acquiringPercentDetkov,
  acquiringPercentPutintsevSber,
  onAcquiringPercentChange,
  onAcquiringPercentDetkovChange,
  onAcquiringPercentPutintsevSberChange,
  onSaveAcquiringPercent,
  onSaveAcquiringPercentDetkov,
  onSaveAcquiringPercentPutintsevSber,
}: {
  token: string;
  acquiringPercent: string;
  acquiringPercentDetkov: string;
  acquiringPercentPutintsevSber: string;
  onAcquiringPercentChange: (value: string) => void;
  onAcquiringPercentDetkovChange: (value: string) => void;
  onAcquiringPercentPutintsevSberChange: (value: string) => void;
  onSaveAcquiringPercent: (token: string, value: string) => Promise<void>;
  onSaveAcquiringPercentDetkov: (token: string, value: string) => Promise<void>;
  onSaveAcquiringPercentPutintsevSber: (token: string, value: string) => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const values: Record<(typeof ACQUIRING_RATE_ROWS)[number]['id'], string> = {
    'putintsev-vtb': acquiringPercent,
    'detkov-vtb': acquiringPercentDetkov,
    'putintsev-sber': acquiringPercentPutintsevSber,
  };

  const setters: Record<(typeof ACQUIRING_RATE_ROWS)[number]['id'], (value: string) => void> = {
    'putintsev-vtb': onAcquiringPercentChange,
    'detkov-vtb': onAcquiringPercentDetkovChange,
    'putintsev-sber': onAcquiringPercentPutintsevSberChange,
  };

  const savers: Record<(typeof ACQUIRING_RATE_ROWS)[number]['id'], (token: string, value: string) => Promise<void>> = {
    'putintsev-vtb': onSaveAcquiringPercent,
    'detkov-vtb': onSaveAcquiringPercentDetkov,
    'putintsev-sber': onSaveAcquiringPercentPutintsevSber,
  };

  const persistRate = async (id: (typeof ACQUIRING_RATE_ROWS)[number]['id'], value: string) => {
    setErrors((current) => ({ ...current, [id]: '' }));
    try {
      await savers[id](token, value);
      setSaved((current) => ({ ...current, [id]: true }));
      window.setTimeout(() => {
        setSaved((current) => ({ ...current, [id]: false }));
      }, 1200);
    } catch {
      setErrors((current) => ({ ...current, [id]: 'Не удалось сохранить' }));
    }
  };

  return (
    <div className="acquiringPanelRoot">
      <div className="acquiringPanelShell">
        <header className="acquiringPanelHead">
          <div>
            <h3 className="acquiringPanelTitle">Эквайринг</h3>
            <p className="acquiringPanelLead">Комиссия банка, % от безналичной выручки</p>
          </div>
        </header>

        <div className="acquiringPanelGrid">
          {ACQUIRING_RATE_ROWS.map((row) => (
            <div className="acquiringPanelCard" key={row.id}>
              <span className="acquiringPanelCardLabel">{row.label}</span>
              <div className="acquiringPanelCardField">
                <input
                  className="acquiringPanelInput"
                  inputMode="decimal"
                  value={values[row.id]}
                  onChange={(event) => {
                    setErrors((current) => ({ ...current, [row.id]: '' }));
                    setters[row.id](event.target.value);
                  }}
                  onBlur={(event) => void persistRate(row.id, event.currentTarget.value)}
                  placeholder={row.placeholder}
                  aria-label={`${row.label}, процент`}
                />
                <span className="acquiringPanelUnit" aria-hidden>
                  %
                </span>
              </div>
              {errors[row.id] ? (
                <p className="acquiringPanelError" role="alert">
                  {errors[row.id]}
                </p>
              ) : saved[row.id] ? (
                <p className="acquiringPanelSaved">Сохранено</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
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

  const [exportBusy, setExportBusy] = useState(false);

  const exportXlsx = async () => {
    setExportBusy(true);
    try {
      const { downloadFinanceReportXlsx } = await import('./export/financeReportXlsx');
      await downloadFinanceReportXlsx({
        fromDay,
        toDay,
        rows,
        totals,
        role,
      });
    } catch {
      setPlansError('Не удалось сформировать Excel-файл');
    } finally {
      setExportBusy(false);
    }
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

  const desktopFinanceReport = isTauriRuntime();

  return (
    <div
      className={`opsCard financeReportCard${desktopFinanceReport ? ' financeReportCard--desktop' : ''}`}
    >
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
        <button
          type="button"
          className="ghost financeReportExportBtn"
          disabled={exportBusy || rows.length === 0}
          onClick={() => void exportXlsx()}
        >
          {exportBusy ? 'Формируем…' : 'Экспорт XLSX'}
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
            <tr className="financeReportTableRowTotal">
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
