import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, TouchEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import { ConnectionBanner } from './desktop/ConnectionBanner';
import { DesktopAppLayout } from './desktop/DesktopAppLayout';
import { DirectorAccountSwitcher } from './desktop/DirectorAccountSwitcher';
import { appVersionLabel } from './appVersion';
import { isTauriRuntime } from './desktop/tauri';
import {
  applyDesktopTheme,
  getStoredDesktopTheme,
  storeDesktopTheme,
  type DesktopTheme,
} from './desktop/desktopTheme';
import { DesktopThemeToggle } from './desktop/DesktopThemeToggle';
import { DesktopSyncToolbar } from './desktop/DesktopSyncToolbar';
import {
  ACQUIRING_DEFAULT_PROFILE_ID,
  type AcquiringProfile,
  type AcquiringProfileId,
  acquiringStoreChipLabel,
  canUnassignStoreFromProfile,
  defaultAcquiringProfiles,
  isStoreOnProfile,
  normalizeAcquiringProfiles,
  percentForStore,
  profileIdForStore,
  setProfilePercent,
  storesForProfile,
  toggleStoreOnProfile,
} from './acquiring/acquiringConfig';
import {
  ALL_DEMO_STORE_NAMES,
  DEFAULT_INVENTORY_WAREHOUSES,
  normalizeInventoryOverview,
  WAREHOUSE_CENTER_KEY,
  WAREHOUSE_SADY_KEY,
  DEFAULT_MANAGER_STORE_COMMISSIONS,
  type InventoryOverviewResponse,
} from './inventory/normalizeInventoryOverview';

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
import { appendSaleDeleteJournal, listSaleDeleteJournal } from './saleDeleteJournal';
import {
  isOfflineLoginFetchError,
  isOfflineLoginMode,
  OFFLINE_ADMIN_LOGIN_HINT,
  readLastOfflineNickname,
  saveOfflineLoginCred,
  tryOfflineAdminLogin,
} from './offlineLogin';
import {
  readOpsDayUnlock,
  verifyOpsDayUnlockPin,
  writeOpsDayUnlock,
  clearOpsDayUnlock,
} from './opsDayUnlock';
import { isOfflineStoreApp } from './offlineStore';
import { ensureOfflineStoreDefaults, ensureOfflineStoreProducts, pullOfflineAdminSnapshot, renameOfflineStoreAssignments, saveOfflineManagerCommission } from './offlineStoreSeed';
import {
  effectiveStoreName,
  persistOfflineStoreSession,
  resolveOfflineStoreSession,
} from './offlineStoreSession';
import {
  offlineAcquiringPercentForStore,
  readOfflineStoreSettings,
  setOfflineStoreName,
} from './offlineStoreSettings';
import { StoreDirectorConsole } from './offlineStore/StoreDirectorConsole';
import {
  isLikelyOfflineFetchError as isOfflineFetchError,
  listAdminSalesQueue,
  removeAdminSaleFromOutbox,
  revertSaleStock,
  updateAdminSalePaymentInOutbox,
  loadAdminCache,
  loadAdminResource,
  saveAdminCache,
  loadSyncCache,
  loadSyncResource,
  newClientId,
  runAdminMutation,
  startSyncEngine,
  flushOutbox,
  listOutboxForUser,
  installApiReachabilityHook,
  markApiReachableSuccess,
  bootstrapReachability,
  subscribeNetwork,
  roleUsesSyncCache,
  roleUsesSyncEngine,
  roleUsesAdminDesktopOutbox,
  useLiveSessionRefresh,
} from './sync';
import { fetchRouteDataIfStale } from './web/routeFetchGuard';
import {
  loadStoreEquipmentCache,
  readDirectorDemoAccountsCache,
  saveStoreEquipmentCache,
  writeDirectorDemoAccountsCache,
  type StoreEquipmentCachePayload,
} from './sync/equipmentCache';
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

function salePaymentLabel(paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER'): string {
  if (paymentType === 'NON_CASH') {
    return 'Безнал';
  }
  if (paymentType === 'TRANSFER') {
    return 'Перевод';
  }
  return 'Наличные';
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

type StaffPositionKind = 'SALES' | 'RETOUCHER' | 'MANAGER';

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

/** Точки сотрудника из API (источник истины — привязки на сервере). */
function staffAssignedStores(member: StaffMember): string[] {
  const fromApi = Array.isArray(member.assignedStores) ? member.assignedStores : [];
  return fromApi.filter((name) => typeof name === 'string' && name.trim().length > 0);
}

/** Сотрудники, привязанные к торговой точке (для экрана «Смена» у админа). */
function staffAtStore(staff: StaffMember[], storeName: string): StaffMember[] {
  const store = storeName.trim();
  if (!store) {
    return [];
  }
  return staff.filter((member) => {
    if (!member.isActive) {
      return false;
    }
    const assigned = staffAssignedStores(member);
    if (assigned.length > 0) {
      return assigned.includes(store);
    }
    return member.storeName?.trim() === store;
  });
}

/** Продавцы в открытой смене — по assignedShiftId (как на экране «Смена»), не только assignedSellerIds. */
function sellersOnOpenShift(
  staff: StaffMember[],
  sellers: SellerProfile[],
  shifts: ShiftInfo[],
): SellerProfile[] {
  const open = shifts.find((shift) => shift.status === 'OPEN');
  if (!open) {
    return [];
  }
  const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
  const picked: SellerProfile[] = [];
  for (const member of staff) {
    if (!member.isActive || member.assignedShiftId !== open.id || member.staffPosition !== 'SALES') {
      continue;
    }
    const profile = sellerById.get(member.id);
    picked.push(
      profile ?? {
        id: member.id,
        fullName: member.fullName,
        nickname: member.nickname,
        storeName: member.storeName,
        ratePercent: 30,
        salesAmount: 0,
        checksCount: 0,
        commissionAmount: 0,
      },
    );
  }
  picked.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));
  return picked;
}

function storeRevenueForReportDay(
  storeName: string,
  sales: AdminSale[],
  sellers: SellerProfile[],
  reportDayKey: string,
): number {
  const sellerIdsAtStore = new Set(
    sellers.filter((seller) => seller.storeName === storeName).map((seller) => seller.id),
  );
  let total = 0;
  for (const sale of sales) {
    if (calendarDayKeyMoscow(sale.createdAt) !== reportDayKey) {
      continue;
    }
    if (sellerIdsAtStore.has(sale.sellerId)) {
      total += sale.totalAmount;
    }
  }
  return total;
}

function managerPercentForStore(
  storeName: string,
  rows: ManagerStoreCommissionRow[],
): number {
  const list = rows.length > 0 ? rows : [...DEFAULT_MANAGER_STORE_COMMISSIONS];
  const row = list.find((item) => item.storeName === storeName);
  const pct = row?.percent ?? 5;
  return Math.max(0, Math.min(100, pct));
}

function managerEarnForStore(
  storeName: string,
  sales: AdminSale[],
  sellers: SellerProfile[],
  reportDayKey: string,
  commissionRows: ManagerStoreCommissionRow[],
): number {
  const pct = managerPercentForStore(storeName, commissionRows);
  if (pct <= 0) {
    return 0;
  }
  const revenue = storeRevenueForReportDay(storeName, sales, sellers, reportDayKey);
  return Math.round((revenue * pct) / 100);
}

function buildEmptyDashboardSkeleton(storeName: string): DashboardResponse {
  return {
    role: 'ADMIN',
    sellerDataManagedByAdmin: true,
    title: storeName,
    metrics: [
      { label: 'Продажи (точка)', value: '0 ₽' },
      { label: 'Открытые смены (точка)', value: '0' },
    ],
    stores: [
      {
        name: storeName,
        revenue: '0 ₽',
        salaries: '0 ₽',
        cash: '0 ₽',
        acquiring: '0 ₽',
        transfer: '0 ₽',
      },
    ],
    sellerRegister: [],
  };
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
  dayKey = todayKeyMoscow(),
): DashboardResponse {
  const storeSellers = sellers.filter((s) => s.storeName === storeName);
  const sellerIds = new Set(storeSellers.map((s) => s.id));
  const staffAtStoreIds = new Set(
    staff
      .filter((m) => m.isActive && staffAssignedStores(m).includes(storeName))
      .map((m) => m.id),
  );
  const today = dayKey;
  const openShift = shifts.find((sh) => sh.status === 'OPEN');
  const inOpenShiftIds = openShift
    ? staff
        .filter(
          (member) =>
            member.isActive &&
            member.assignedShiftId === openShift.id &&
            member.staffPosition === 'SALES' &&
            staffAtStoreIds.has(member.id),
        )
        .map((member) => member.id)
    : [];
  const revenueSellerIds = new Set([...sellerIds, ...inOpenShiftIds]);

  let storeRevenue = 0;
  for (const sale of sales) {
    if (!revenueSellerIds.has(sale.sellerId) && !sale.pendingSync) {
      continue;
    }
    if (calendarDayKeyMoscow(sale.createdAt) !== today) {
      continue;
    }
    storeRevenue += sale.totalAmount;
  }
  let storeSalaries = 0;
  for (const s of storeSellers) {
    storeSalaries += s.commissionAmount;
  }
  const retoucherStaff = staff.filter(
    (m) =>
      m.staffPosition === 'RETOUCHER' &&
      m.isActive &&
      staffAssignedStores(m).includes(storeName),
  );
  for (const r of retoucherStaff) {
    storeSalaries += Math.round(r.earningsAmount);
  }

  let payCash = 0;
  let payAcquiring = 0;
  let payTransfer = 0;
  for (const sale of sales) {
    if (!revenueSellerIds.has(sale.sellerId) && !sale.pendingSync) {
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

  const openShiftsForStore = openShift && inOpenShiftIds.length > 0 ? 1 : 0;

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

  const sellerRegister = inOpenShiftIds
    .map((staffId) => {
      const member = staff.find((m) => m.id === staffId);
      const seller = sellers.find((s) => s.id === staffId);
      const fullName = member?.fullName ?? seller?.fullName ?? `Сотрудник #${staffId}`;
      const nickname = member?.nickname ?? seller?.nickname ?? '';
      const cash =
        member?.staffPosition === 'RETOUCHER'
          ? formatRub(Math.round(member.earningsAmount))
          : formatRub(sellerRegisterToday(staffId));
      return { staffId, fullName, nickname, cash };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

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
  sellerRegister?: Array<{ staffId: number; fullName: string; nickname: string; cash: string }>;
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

type ManagerStoreCommissionRow = { storeName: string; percent: number };

type StoreInventoryDetailResponse = {
  storeName: string;
  warehouseKey: string;
  warehouseLabel: string;
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
  kind: 'WRITE_OFF';
  state: string;
  requestedByNickname: string;
  storeName: string;
  payload: Record<string, unknown>;
  summary: string;
};

/** Новые продажи сверху; офлайн-очередь в общем порядке по времени, не в конце списка. */
function sortSalesByCreatedAtDesc(rows: AdminSale[]): AdminSale[] {
  return [...rows].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/** Имя сотрудника и ник (если есть) для списков продаж и касс. */
function formatPersonWithNickname(fullName: string, nickname?: string | null): string {
  const name = fullName.trim();
  const nick = nickname?.trim();
  if (!name) {
    return nick ?? '';
  }
  return nick ? `${name} · ${nick}` : name;
}

function sellerLabelFromProfiles(
  sellers: SellerProfile[],
  sellerId: number,
  sellerName: string,
): string {
  const seller = sellers.find((item) => item.id === sellerId);
  return formatPersonWithNickname(sellerName, seller?.nickname);
}

function offlineQueueToAdminSales(
  queue: OfflineQueuedSale[],
  sellers: SellerProfile[],
  currentStoreName?: string,
): AdminSale[] {
  const filtered = currentStoreName
    ? queue.filter((q) => {
        const store = q.storeName ?? sellers.find((s) => s.id === q.sellerId)?.storeName;
        return store === currentStoreName;
      })
    : queue;
  return filtered.map((q) => {
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

type FinanceCategoryAmountRow = {
  title: string;
  amount: number;
};

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

/** Backend base URL. VITE_API_URL при сборке; иначе в браузере — тот же origin (Timeweb: сайт + API на одном домене). */
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
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
})();

const API_CONFIG_ERROR =
  !import.meta.env.DEV && !API_BASE_URL && typeof window === 'undefined'
    ? 'Сборка без адреса API: задайте VITE_API_URL при сборке frontend.'
    : '';

const API_DEPLOY_HINT =
  'На сервере старая версия API. Обновите Timeweb (git pull + docker compose up -d --build api) и нажмите ↻.';

const MANAGER_COMMISSIONS_DEPLOY_HINT =
  `На сервере ещё нет API для процентов управляющего. ${API_DEPLOY_HINT}`;

function apiServerLabel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host.includes('onrender.com')) {
      return 'Render (устарело — смените VITE_API_URL на Timeweb)';
    }
    if (host === '77.233.223.48') {
      return 'Timeweb';
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'Локальный сервер';
    }
    return host;
  } catch {
    return baseUrl;
  }
}

async function readApiErrorMessage(
  response: Response,
  fallback: string,
  options?: { notFoundHint?: string },
): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const raw = Array.isArray(body?.message) ? body.message[0] : body?.message;
  if (response.status === 404) {
    return options?.notFoundHint ?? (typeof raw === 'string' && raw.trim() ? raw : fallback);
  }
  return typeof raw === 'string' && raw.trim() ? raw : fallback;
}

function describeLoginFetchError(error: unknown): string {
  const serverHint = API_BASE_URL ? apiServerLabel(API_BASE_URL) : 'Timeweb';
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return `Сервер не ответил за 15 секунд (${serverHint}). Подождите полминуты и войдите снова. Если повторяется — на VPS: docker compose restart api.`;
    }
    const msg = error.message.trim().toLowerCase();
    if (
      msg === 'load failed' ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed')
    ) {
      if (import.meta.env.DEV) {
        return `Нет связи с API (${serverHint}). Проверьте VITE_API_URL и CORS на сервере — см. docs/DESKTOP_START_HERE.md.`;
      }
      return `Нет связи с сервером ${serverHint} (это не ошибка пароля). Проверьте интернет и что API отвечает: ${API_BASE_URL || 'VITE_API_URL не задан'}/health`;
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

function ExpensesIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg" aria-hidden>
        <path
          d="M6 8.5h12v9H6z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function PayrollIcon() {
  return (
    <DockIcon>
      <svg viewBox="0 0 24 24" fill="none" className="dockSvg" aria-hidden>
        <rect x="3.5" y="6.5" width="17" height="11" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M7.5 6.5V5.2a2.2 2.2 0 0 1 2.2-2.2h4.6a2.2 2.2 0 0 1 2.2 2.2v1.3" stroke="currentColor" strokeWidth="1.8" />
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

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const offlineStoreMode = isOfflineStoreApp();
  const restoredSession = useMemo(
    () => (offlineStoreMode ? resolveOfflineStoreSession() : readStoredSession()),
    [offlineStoreMode],
  );
  const restoredPersistence = useMemo(() => readSessionPersistence(), []);
  const [nickname, setNickname] = useState(() => readLastOfflineNickname());
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
  const activeSessionUserIdRef = useRef<number | undefined>(session?.user?.id);
  useEffect(() => {
    activeSessionUserIdRef.current = session?.user?.id;
  }, [session?.user?.id]);
  const syncFreshGuard = useCallback(
    () => ({ getActiveUserId: () => activeSessionUserIdRef.current }),
    [],
  );
  const [outboxSyncing, setOutboxSyncing] = useState(false);
  const [outboxPendingCount, setOutboxPendingCount] = useState(0);
  const [equipmentRefreshKey, setEquipmentRefreshKey] = useState(0);
  const [apiReachable, setApiReachable] = useState(() =>
    offlineStoreMode ? false : typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const isDesktopShell = isTauriRuntime();
  const [desktopTheme, setDesktopTheme] = useState<DesktopTheme>(() =>
    isTauriRuntime() ? getStoredDesktopTheme() : 'dark',
  );

  useEffect(() => {
    applyDesktopTheme(isDesktopShell ? desktopTheme : 'dark');
  }, [isDesktopShell, desktopTheme]);

  useEffect(() => {
    if (!offlineStoreMode) {
      return;
    }
    void import('./desktop/desktopStoreDirectorConsole.css');
  }, [offlineStoreMode]);

  useEffect(() => {
    const role = session?.user?.role;
    if (role !== 'DIRECTOR' && role !== 'ACCOUNTANT') {
      return;
    }
    void import('./desktop/desktopFinanceOps.css');
    void import('./desktop/desktopDirectorHome.css');
  }, [session?.user?.role]);

  const handleDesktopThemeChange = useCallback((theme: DesktopTheme) => {
    setDesktopTheme(theme);
    storeDesktopTheme(theme);
    applyDesktopTheme(theme);
  }, []);

  useEffect(() => {
    void import('./desktop/desktopTypography.css');
    void import('./desktop/desktopShell.css');
    void import('./desktop/desktopPages.css');
    void import('./desktop/desktopLuxury.css');
    void import('./desktop/desktopDirectorHome.css');
    void import('./desktop/desktopFinanceOps.css');
    void import('./desktop/desktopFinanceReport.css');
    void import('./desktop/desktopTeamWarehouse.css');
    void import('./desktop/desktopThemes.css');
    void import('./desktop/desktopStoreEquipment.css');
    void import('./desktop/desktopAcquiring.css');
    if (isDesktopShell) {
      void import('./desktop/desktopNative.css');
      void import('./desktop/desktopDirectorAccountSwitcher.css');
      void import('./desktop/desktopHermesLight.css');
      void import('./desktop/desktopStoneLight.css');
      void import('./desktop/desktopFlat.css');
      void import('./desktop/desktopLightContrast.css');
      void import('./desktop/desktopThemeToggle.css');
      return;
    }
    void import('./web/webDesktopTheme.css');
    void import('./web/webMobileIos.css');
  }, [isDesktopShell]);

  useEffect(() => {
    if (!isDesktopShell) {
      return;
    }
    let backupModule: typeof import('./desktop/desktopLocalBackup') | null = null;
    void import('./desktop/desktopLocalBackup').then((module) => {
      backupModule = module;
    });
    const flush = () => {
      void backupModule?.flushDesktopLocalBackup();
    };
    const timer = window.setInterval(flush, 5 * 60 * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [isDesktopShell]);

  const desktopConnection = useDesktopConnection(outboxSyncing, apiReachable, {
    trustApiOnly: isDesktopShell,
  });

  useEffect(() => {
    if (!API_BASE_URL) {
      return;
    }
    return installApiReachabilityHook(API_BASE_URL);
  }, []);

  useEffect(() => {
    if (!API_BASE_URL || !isDesktopShell || offlineStoreMode) {
      return;
    }
    void bootstrapReachability(API_BASE_URL).then((ok) => setApiReachable(ok));
    const net = subscribeNetwork(API_BASE_URL, setApiReachable, {
      ignoreNavigatorOffline: true,
      pollMs: 120_000,
    });
    return () => net.dispose();
  }, [isDesktopShell, offlineStoreMode]);
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequest[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployee[]>([]);
  const [adminError, setAdminError] = useState('');
  const [salesNotice, setSalesNotice] = useState('');
  const [paymentEditSaleId, setPaymentEditSaleId] = useState<string | null>(null);
  const [saleDeleteTarget, setSaleDeleteTarget] = useState<{
    id: string;
    pendingSync: boolean;
    sellerName: string;
    amount: number;
  } | null>(null);
  const [saleDeleteReason, setSaleDeleteReason] = useState('');
  const [saleDeleteBusy, setSaleDeleteBusy] = useState(false);
  const [opsDayUnlocked, setOpsDayUnlocked] = useState(() => readOpsDayUnlock());
  const [adminViewDayKey, setAdminViewDayKey] = useState(todayKeyMoscow);
  const [opsDayUnlockOpen, setOpsDayUnlockOpen] = useState(false);
  const [opsDayUnlockDraft, setOpsDayUnlockDraft] = useState('');
  const adminMetricTapRef = useRef(0);
  const storeDisplayName = useMemo(
    () => effectiveStoreName(session?.user.storeName),
    [session?.user.storeName, opsDayUnlocked],
  );

  useEffect(() => {
    if (!offlineStoreMode || !session) {
      return;
    }
    const nextName = readOfflineStoreSettings().storeName;
    if (session.user.storeName === nextName) {
      return;
    }
    const nextSession = {
      ...session,
      user: { ...session.user, storeName: nextName },
    };
    setSession(nextSession);
    persistOfflineStoreSession(nextSession);
  }, [offlineStoreMode, session, opsDayUnlocked]);

  const [dayReportBusy, setDayReportBusy] = useState(false);
  const [dayReportNotice, setDayReportNotice] = useState('');
  const [paymentEditBusy, setPaymentEditBusy] = useState(false);
  const [teamDayKey, setTeamDayKey] = useState(todayKeyMoscow());
  const [acquiringProfiles, setAcquiringProfiles] = useState<AcquiringProfile[]>(() =>
    defaultAcquiringProfiles(),
  );
  const [salesExpanded, setSalesExpanded] = useState(() => isTauriRuntime());
  const [financeOps, setFinanceOps] = useState<FinanceOpsSnapshot>({
    accounts: [],
    expenses: [],
    incomes: [],
    totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0, categoryTotal: 0 },
  });
  const [inventoryOverview, setInventoryOverview] = useState<InventoryOverviewResponse | null>(null);
  const [managerStoreCommissions, setManagerStoreCommissions] = useState<ManagerStoreCommissionRow[]>(
    [],
  );
  const [managerCommissionsApiOnline, setManagerCommissionsApiOnline] = useState(true);
  const [storeInventory, setStoreInventory] = useState<StoreInventoryDetailResponse | null>(null);
  const refreshOutboxPendingCount = useCallback(async () => {
    const userId = session?.user?.id;
    if (userId === undefined) {
      setOutboxPendingCount(0);
      return;
    }
    setOutboxPendingCount((await listOutboxForUser(userId)).length);
  }, [session?.user?.id]);

  useEffect(() => {
    void refreshOutboxPendingCount();
  }, [refreshOutboxPendingCount, offlineQueueTick]);

  useEffect(() => {
    if (!isDesktopShell || !session?.token) {
      return;
    }
    if (roleUsesSyncEngine(session.user.role, isDesktopShell)) {
      return;
    }
    const net = subscribeNetwork(API_BASE_URL, setApiReachable, {
      ignoreNavigatorOffline: false,
      pollMs: 90_000,
    });
    return () => net.dispose();
  }, [isDesktopShell, session?.token, session?.user?.role]);

  const refreshOfflinePending = useCallback(async () => {
    const userId = session?.user?.id;
    if (userId === undefined) {
      setOfflinePendingSales([]);
      return;
    }
    if (session?.user?.role === 'ADMIN') {
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
    const [
      cachedSellers,
      cachedProducts,
      cachedStaff,
      cachedShifts,
      cachedSales,
      cachedInv,
      cachedGlobal,
      cachedProcurement,
      cachedAcquiring,
      cachedManagerCommissions,
      cachedDashboard,
    ] = await Promise.all([
      loadAdminCache<SellerProfile[]>(userId, 'sellers'),
      loadAdminCache<ProductItem[]>(userId, 'products'),
      loadAdminCache<StaffMember[]>(userId, 'staff'),
      loadAdminCache<ShiftInfo[]>(userId, 'shifts'),
      loadAdminCache<AdminSale[]>(userId, 'sales'),
      loadAdminCache<StoreInventoryDetailResponse | null>(userId, 'storeInventory'),
      loadAdminCache<GlobalEmployee[]>(userId, 'globalEmployees'),
      loadAdminCache<ProductProcurementCost[]>(userId, 'procurementCosts'),
      loadAdminCache<AcquiringProfile[]>(userId, 'acquiringProfiles'),
      loadAdminCache<ManagerStoreCommissionRow[]>(userId, 'managerStoreCommissions'),
      loadAdminCache<DashboardResponse>(userId, 'dashboard'),
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
    if (cachedProcurement?.length) {
      setProductProcurementCosts(cachedProcurement);
    }
    if (cachedAcquiring?.length) {
      setAcquiringProfiles(cachedAcquiring);
    }
    if (cachedManagerCommissions?.length) {
      setManagerStoreCommissions(cachedManagerCommissions);
    }
    if (cachedDashboard) {
      setDashboard(cachedDashboard);
    } else if (session?.user.storeName) {
      setDashboard(buildEmptyDashboardSkeleton(session.user.storeName));
    }
    setDashboardLoading(false);
  }, [isDesktopShell, session?.user?.id, session?.user?.role, session?.user?.storeName]);

  const applyOfflineAdminSnapshot = useCallback(async () => {
    const userId = session?.user?.id;
    if (!offlineStoreMode || userId === undefined) {
      return;
    }
    const snapshot = await pullOfflineAdminSnapshot(userId);
    setStaff(snapshot.staff as StaffMember[]);
    setSellers(snapshot.sellers);
    setShifts(snapshot.shifts as ShiftInfo[]);
    setSales(snapshot.sales as AdminSale[]);
    setProducts(snapshot.products);
    if (snapshot.managerStoreCommissions.length > 0) {
      setManagerStoreCommissions(snapshot.managerStoreCommissions);
    }
  }, [offlineStoreMode, session?.user?.id]);

  const refreshFinanceFromCache = useCallback(async () => {
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (userId === undefined || !roleUsesSyncCache(role)) {
      return;
    }
    if (role === 'MANAGER') {
      const [cachedDashboard, cachedStaff, cachedSales, cachedShifts] = await Promise.all([
        loadSyncCache<DashboardResponse>(userId, 'dashboard'),
        loadSyncCache<StaffMember[]>(userId, 'staff'),
        loadSyncCache<AdminSale[]>(userId, 'sales'),
        loadSyncCache<ShiftInfo[]>(userId, 'shifts'),
      ]);
      if (cachedDashboard) {
        setDashboard(cachedDashboard);
      }
      if (cachedStaff?.length) {
        setStaff(cachedStaff);
      }
      if (cachedSales?.length) {
        setSales(cachedSales);
      }
      if (cachedShifts?.length) {
        setShifts(cachedShifts);
      }
      return;
    }
    if (role !== 'DIRECTOR' && role !== 'ACCOUNTANT') {
      return;
    }
    const [
      cachedDashboard,
      cachedFinance,
      cachedInventory,
      cachedCommission,
      cachedSellers,
      cachedProducts,
      cachedProcurement,
      cachedAcquiring,
      cachedManagerCommissions,
    ] = await Promise.all([
      loadSyncCache<DashboardResponse>(userId, 'dashboard'),
      loadSyncCache<FinanceOpsSnapshot>(userId, 'financeOps'),
      loadSyncCache<InventoryOverviewResponse>(userId, 'inventoryOverview'),
      role === 'DIRECTOR'
        ? loadSyncCache<CommissionRequest[]>(userId, 'commissionRequests')
        : Promise.resolve(null),
      loadSyncCache<SellerProfile[]>(userId, 'sellers'),
      role === 'DIRECTOR'
        ? loadSyncCache<ProductItem[]>(userId, 'products')
        : Promise.resolve(null),
      role === 'DIRECTOR'
        ? loadSyncCache<ProductProcurementCost[]>(userId, 'procurementCosts')
        : Promise.resolve(null),
      loadSyncCache<AcquiringProfile[]>(userId, 'acquiringProfiles'),
      role === 'DIRECTOR'
        ? loadSyncCache<ManagerStoreCommissionRow[]>(userId, 'managerStoreCommissions')
        : Promise.resolve(null),
    ]);
    if (cachedDashboard) {
      setDashboard(cachedDashboard);
    }
    if (cachedFinance) {
      setFinanceOps(cachedFinance);
    }
    if (cachedInventory) {
      setInventoryOverview(normalizeInventoryOverview(cachedInventory));
    }
    if (cachedCommission) {
      setCommissionRequests(cachedCommission);
    }
    if (cachedSellers) {
      setSellers(cachedSellers);
    }
    if (cachedProducts?.length) {
      setProducts(cachedProducts);
    }
    if (cachedProcurement?.length) {
      setProductProcurementCosts(cachedProcurement);
    }
    if (cachedAcquiring?.length) {
      setAcquiringProfiles(cachedAcquiring);
    }
    if (cachedManagerCommissions?.length) {
      setManagerStoreCommissions(cachedManagerCommissions);
    }
    if (role === 'DIRECTOR') {
      const [cachedStaff, cachedSales, cachedShifts] = await Promise.all([
        loadSyncCache<StaffMember[]>(userId, 'staff'),
        loadSyncCache<AdminSale[]>(userId, 'sales'),
        loadSyncCache<ShiftInfo[]>(userId, 'shifts'),
      ]);
      if (cachedStaff?.length) {
        setStaff(cachedStaff);
      }
      if (cachedSales?.length) {
        setSales(cachedSales);
      }
      if (cachedShifts?.length) {
        setShifts(cachedShifts);
      }
    }
  }, [session?.user?.id, session?.user?.role]);

  useEffect(() => {
    void refreshOfflinePending();
  }, [refreshOfflinePending, offlineQueueTick]);

  useEffect(() => {
    if (!isDesktopShell || !session?.token) {
      return;
    }
    void refreshFinanceFromCache();
    void refreshAdminFromCache();
  }, [
    isDesktopShell,
    session?.token,
    session?.user?.role,
    refreshFinanceFromCache,
    refreshAdminFromCache,
  ]);

  useEffect(() => {
    if (!session?.token || apiReachable) {
      return;
    }
    if (session.user.role === 'ADMIN') {
      void refreshAdminFromCache();
    }
    void refreshFinanceFromCache();
  }, [apiReachable, session?.token, session?.user?.role, refreshAdminFromCache, refreshFinanceFromCache]);

  const pendingOfflineSales = useMemo(
    () => offlineQueueToAdminSales(offlinePendingSales, sellers, session?.user.storeName),
    [offlinePendingSales, sellers, session?.user.storeName],
  );

  const salesMerged = useMemo(() => {
    const pendingIds = new Set(pendingOfflineSales.map((sale) => sale.id));
    const syncedOnly = sales.filter((sale) => !pendingIds.has(sale.id));
    const merged = sortSalesByCreatedAtDesc([...syncedOnly, ...pendingOfflineSales]);
    if (session?.user.role === 'ADMIN' && (offlineStoreMode ? storeDisplayName : session.user.storeName)) {
      const storeName = offlineStoreMode ? storeDisplayName : session.user.storeName;
      const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));
      const staffAtStoreIds = new Set(
        staff
          .filter((member) => member.isActive && staffAssignedStores(member).includes(storeName))
          .map((member) => member.id),
      );
      return merged.filter((sale) => {
        if (sale.pendingSync) {
          return true;
        }
        if (staffAtStoreIds.has(sale.sellerId)) {
          return true;
        }
        return sellerStoreById.get(sale.sellerId) === storeName;
      });
    }
    return merged;
  }, [sales, pendingOfflineSales, sellers, staff, session?.user.role, session?.user.storeName, offlineStoreMode, storeDisplayName]);

  const adminDayKey = useMemo(() => {
    if (session?.user.role !== 'ADMIN' || !opsDayUnlocked) {
      return todayKeyMoscow();
    }
    return adminViewDayKey;
  }, [session?.user.role, opsDayUnlocked, adminViewDayKey]);

  const homeDashboard = useMemo((): DashboardResponse | null => {
    if (!session) {
      return null;
    }
    if (session.user.role === 'ADMIN') {
      const base =
        dashboard ?? buildEmptyDashboardSkeleton(storeDisplayName);
      return buildAdminHomeDashboard(
        base,
        storeDisplayName,
        sellers,
        salesMerged,
        shifts,
        staff,
        adminDayKey,
      );
    }
    if (!dashboard) {
      return null;
    }
    return dashboard;
  }, [dashboard, session, sellers, salesMerged, shifts, staff, adminDayKey, storeDisplayName]);

  const todayStoreSales = useMemo(() => {
    if (!session) {
      return [] as AdminSale[];
    }
    const todayKey = adminDayKey;
    const currentStoreName = storeDisplayName;
    const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));
    return salesMerged.filter((sale) => {
      const saleStore = sellerStoreById.get(sale.sellerId);
      return saleStore === currentStoreName && calendarDayKeyMoscow(sale.createdAt) === todayKey;
    });
  }, [salesMerged, sellers, session, adminDayKey]);

  const todaySoldProducts = useMemo(() => {
    if (!session) {
      return [] as Array<{ name: string; qty: number }>;
    }
    const todayKey = adminDayKey;
    const currentStoreName = storeDisplayName;
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
  }, [salesMerged, sellers, session, adminDayKey]);

  const directorCashflowPages = useMemo(() => {
    if (session?.user.role !== 'DIRECTOR') {
      return [] as Array<{ key: string; title: string; amount: number }>;
    }
    const todayKey = todayKeyMoscow();
    const sellerStoreById = new Map(sellers.map((seller) => [seller.id, seller.storeName]));

    let rsDvtb = 0;
    let rsPvtb = 0;
    let rsPsber = 0;
    let rsLeha = 0;
    let transferTotal = 0;
    let cashTotal = 0;

    for (const sale of salesMerged) {
      if (calendarDayKeyMoscow(sale.createdAt) !== todayKey) {
        continue;
      }
      const storeName = sellerStoreById.get(sale.sellerId);
      if (!storeName) {
        continue;
      }
      if (sale.paymentType === 'TRANSFER') {
        transferTotal += sale.totalAmount;
        continue;
      }
      if (sale.paymentType !== 'NON_CASH') {
        cashTotal += sale.totalAmount;
        continue;
      }

      const rate = percentForStore(storeName, acquiringProfiles);
      const netAmount = sale.totalAmount - (sale.totalAmount * rate) / 100;
      const profileId = profileIdForStore(storeName, acquiringProfiles);

      if (profileId === 'detkov-vtb') {
        rsDvtb += netAmount;
      } else if (profileId === 'putintsev-sber') {
        rsPsber += netAmount;
      } else if (profileId === 'lyokha-rs') {
        rsLeha += netAmount;
      } else {
        rsPvtb += netAmount;
      }
    }

    return [
      { key: 'rs-d-vtb', title: 'Р/с Д ВТБ', amount: Math.round(rsDvtb * 100) / 100 },
      { key: 'rs-p-vtb', title: 'Р/С П ВТБ', amount: Math.round(rsPvtb * 100) / 100 },
      { key: 'rs-p-sber', title: 'Р/с П СБЕР', amount: Math.round(rsPsber * 100) / 100 },
      { key: 'cash', title: 'Наличные', amount: Math.round(cashTotal * 100) / 100 },
      { key: 'transfer', title: 'Перевод', amount: Math.round(transferTotal * 100) / 100 },
      { key: 'rs-leha', title: 'Р/с Лёха', amount: Math.round(rsLeha * 100) / 100 },
    ];
  }, [acquiringProfiles, salesMerged, sellers, session?.user.role]);

  const loadDashboard = async (token: string, options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!background) {
      setDashboardLoading(true);
    }
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
    const uid = session?.user?.id;
    const storeName = session?.user?.storeName;
    const desktopDashboardCache = roleUsesSyncCache(role) && uid != null;
    try {
      if (desktopDashboardCache) {
        const cached =
          (await loadSyncCache<DashboardResponse>(uid!, 'dashboard')) ?? null;
        const skeleton =
          role === 'ADMIN' && storeName
            ? buildEmptyDashboardSkeleton(storeName)
            : null;
        const immediate = cached ?? skeleton;
        if (immediate) {
          setDashboard(immediate);
          if (!background) {
            setDashboardLoading(false);
          }
        }
        const result = await loadSyncResource(
          API_BASE_URL,
          uid!,
          'dashboard',
          fetcher,
          immediate ?? (null as unknown as DashboardResponse),
          { onFresh: (data) => setDashboard(data), ...syncFreshGuard() },
        );
        if (result.data) {
          setDashboard(result.data);
        }
        if (result.fromCache) {
          markApiReachableSuccess();
        }
      } else {
        setDashboard(await fetcher());
      }
    } catch {
      if (role === 'ADMIN' && storeName && !dashboard) {
        setDashboard(buildEmptyDashboardSkeleton(storeName));
      } else {
        setDashboard((current) => current);
      }
    } finally {
      if (!background) {
        setDashboardLoading(false);
      }
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
      session?.user?.id != null &&
      (roleUsesSyncCache(role) || roleUsesAdminDesktopOutbox(role, isDesktopShell))
    ) {
      const result = await loadSyncResource(API_BASE_URL, session.user.id, 'sellers', fetcher, [], {
        onFresh: (data) => setSellers(data),
        ...syncFreshGuard(),
      });
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
    const uid = session?.user?.id;
    if (offlineStoreMode && uid != null) {
      const list = await ensureOfflineStoreProducts(uid);
      setProducts(list);
      return;
    }
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/products`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('products error');
      }
      return (await response.json()) as ProductItem[];
    };
    const role = session?.user?.role;
    if (uid != null && roleUsesSyncCache(role)) {
      const result = await loadSyncResource(API_BASE_URL, uid, 'products', fetcher, [], {
        onFresh: (data) => setProducts(data),
        ...syncFreshGuard(),
      });
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
        return normalizeInventoryOverview(await response.json());
      };
      const role = session?.user?.role;
      if (roleUsesSyncCache(role) && session?.user?.id != null) {
        const result = await loadSyncResource(
          API_BASE_URL,
          session.user.id,
          'inventoryOverview',
          fetcher,
          null as unknown as InventoryOverviewResponse,
          {
            onFresh: (data) =>
              setInventoryOverview(data ? normalizeInventoryOverview(data) : null),
            ...syncFreshGuard(),
          },
        );
        setInventoryOverview(
          result.data ? normalizeInventoryOverview(result.data) : null,
        );
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
      if (session?.user?.role === 'ADMIN' && session.user.id != null) {
        const result = await loadAdminResource(
          API_BASE_URL,
          session.user.id,
          'storeInventory',
          fetcher,
          null,
          {
            onFresh: (data) => setStoreInventory(data),
            ...syncFreshGuard(),
          },
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
    [isDesktopShell, session?.user?.id, session?.user?.role, syncFreshGuard],
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
    setInventoryOverview(normalizeInventoryOverview(data.overview));
    const costsResponse = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (costsResponse.ok) {
      setProductProcurementCosts((await costsResponse.json()) as ProductProcurementCost[]);
    }
  };

  const renameCatalogProduct = async (token: string, oldName: string, newName: string) => {
    const trimmedNew = newName.trim();
    if (!trimmedNew) {
      throw new Error('Укажите название товара');
    }
    const response = await fetch(`${API_BASE_URL}/admin/products`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ oldName, newName: trimmedNew }),
    });
    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
      const msg = Array.isArray(errBody?.message) ? errBody.message[0] : errBody?.message;
      throw new Error(typeof msg === 'string' ? msg : 'Не удалось переименовать товар');
    }
    const data = (await response.json()) as {
      catalog: ProductItem[];
      overview: InventoryOverviewResponse;
    };
    setProducts(data.catalog);
    setInventoryOverview(normalizeInventoryOverview(data.overview));
    const costsResponse = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (costsResponse.ok) {
      setProductProcurementCosts((await costsResponse.json()) as ProductProcurementCost[]);
    }
  };

  const deleteCatalogProduct = async (token: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Укажите товар');
    }
    if (
      !window.confirm(
        `Удалить «${trimmed}» из каталога?\n\nТовар исчезнет из всех складов и точек. Удаление возможно только при нулевых остатках.`,
      )
    ) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/admin/products`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
      const msg = Array.isArray(errBody?.message) ? errBody.message[0] : errBody?.message;
      throw new Error(typeof msg === 'string' ? msg : 'Не удалось удалить товар');
    }
    const data = (await response.json()) as {
      catalog: ProductItem[];
      overview: InventoryOverviewResponse;
    };
    setProducts(data.catalog);
    setInventoryOverview(normalizeInventoryOverview(data.overview));
    const costsResponse = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (costsResponse.ok) {
      setProductProcurementCosts((await costsResponse.json()) as ProductProcurementCost[]);
    }
  };

  const loadManagerStoreCommissions = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/manager-store-commissions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 404) {
          setManagerCommissionsApiOnline(false);
          return [] as ManagerStoreCommissionRow[];
        }
        if (!response.ok) {
          setManagerCommissionsApiOnline(false);
          throw new Error(
            await readApiErrorMessage(response, 'Не удалось загрузить проценты управляющего', {
              notFoundHint: MANAGER_COMMISSIONS_DEPLOY_HINT,
            }),
          );
        }
        setManagerCommissionsApiOnline(true);
        const data = (await response.json()) as { items: ManagerStoreCommissionRow[] };
        return Array.isArray(data.items) ? data.items : [];
      };
      const uid = session?.user?.id;
      const role = session?.user?.role;
      if (uid != null && roleUsesSyncCache(role)) {
        const result = await loadSyncResource(
          API_BASE_URL,
          uid,
          'managerStoreCommissions',
          fetcher,
          [],
          { onFresh: (data) => setManagerStoreCommissions(data), ...syncFreshGuard() },
        );
        setManagerStoreCommissions(result.data);
        return;
      }
      setManagerStoreCommissions(await fetcher());
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const saveManagerStoreCommissions = async (
    token: string,
    items: ManagerStoreCommissionRow[],
  ) => {
    const uid = session?.user?.id;
    const directorOffline = session?.user?.role === 'DIRECTOR' && uid !== undefined;
    const patchId = newClientId('mgrc');
    const createdAt = new Date().toISOString();
    const body = { patchId, items, createdAt };

    const put = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/manager-store-commissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          setManagerCommissionsApiOnline(false);
        }
        throw new Error(
          await readApiErrorMessage(response, 'Не удалось сохранить проценты', {
            notFoundHint: MANAGER_COMMISSIONS_DEPLOY_HINT,
          }),
        );
      }
      setManagerCommissionsApiOnline(true);
      const data = (await response.json()) as { items: ManagerStoreCommissionRow[] };
      setManagerStoreCommissions(Array.isArray(data.items) ? data.items : []);
    };

    if (directorOffline) {
      const mode = await runAdminMutation(uid, patchId, 'MANAGER_STORE_COMMISSIONS', body, put);
      if (mode === 'queued') {
        setManagerStoreCommissions(items);
        setManagerCommissionsApiOnline(true);
        setOfflineQueueTick((x) => x + 1);
        return;
      }
      return;
    }
    await put();
  };

  const replenishWarehouse = async (
    token: string,
    warehouseKey: string,
    name: string,
    qtyStr: string,
  ) => {
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
      body: JSON.stringify({ warehouseKey, name, qty }),
    });
    if (!response.ok) {
      throw new Error('Не удалось пополнить склад');
    }
    await loadInventoryOverview(token);
  };

  const resetWarehouseStock = async (token: string, warehouseKey: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/inventory/warehouse/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ warehouseKey }),
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, 'Не удалось обнулить склад'));
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

  const loadProductProcurementCosts = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/products/procurement-costs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error('procurement costs error');
        }
        return (await response.json()) as ProductProcurementCost[];
      };
      const uid = session?.user?.id;
      const role = session?.user?.role;
      if (uid != null && roleUsesSyncCache(role)) {
        const result = await loadSyncResource(
          API_BASE_URL,
          uid,
          'procurementCosts',
          fetcher,
          [],
          { onFresh: (data) => setProductProcurementCosts(data), ...syncFreshGuard() },
        );
        setProductProcurementCosts(result.data);
        return;
      }
      setProductProcurementCosts(await fetcher());
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const saveProductProcurementCosts = async (
    token: string,
    items: Array<{ name: string; cost: number }>,
  ) => {
    const uid = session?.user?.id;
    const directorOffline = session?.user?.role === 'DIRECTOR' && uid !== undefined;
    const patchId = newClientId('proc');
    const createdAt = new Date().toISOString();
    const body = { patchId, items, createdAt };

    const put = async () => {
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

    if (directorOffline) {
      const mode = await runAdminMutation(uid, patchId, 'PROCUREMENT_COSTS', body, put);
      if (mode === 'queued') {
        setProductProcurementCosts(items);
        setOfflineQueueTick((x) => x + 1);
        return;
      }
      return;
    }
    await put();
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
    if (uid != null && (role === 'DIRECTOR' || role === 'ACCOUNTANT')) {
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
    if (uid != null && (role === 'DIRECTOR' || role === 'ACCOUNTANT')) {
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

  const loadAcquiringProfiles = useCallback(
    async (token: string) => {
      const fetcher = async () => {
        const response = await fetch(`${API_BASE_URL}/admin/acquiring-percent`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error('acquiring percent error');
        }
        const data = (await response.json()) as {
          percent?: number;
          detkovPercent?: number;
          putintsevSberPercent?: number;
          lyokhaPercent?: number;
          profiles?: unknown;
        };
        return normalizeAcquiringProfiles(data.profiles, {
          putintsevVtb: data.percent,
          detkovVtb: data.detkovPercent,
          putintsevSber: data.putintsevSberPercent,
          lyokhaRs: data.lyokhaPercent,
        });
      };
      const uid = session?.user?.id;
      const role = session?.user?.role;
      const useAcquiringCache =
        uid != null &&
        roleUsesSyncCache(role);
      if (useAcquiringCache) {
        const result = await loadSyncResource(
          API_BASE_URL,
          uid,
          'acquiringProfiles',
          fetcher,
          defaultAcquiringProfiles(),
          { onFresh: (data) => setAcquiringProfiles(data), ...syncFreshGuard() },
        );
        setAcquiringProfiles(result.data);
        return;
      }
      const fresh = await fetcher();
      setAcquiringProfiles(fresh);
      if (uid != null && (role === 'DIRECTOR' || role === 'ACCOUNTANT')) {
        await saveAdminCache(uid, 'acquiringProfiles', fresh);
      }
    },
    [isDesktopShell, session?.user?.id, session?.user?.role],
  );

  const saveAcquiringProfiles = async (token: string, profiles: AcquiringProfile[]) => {
    const uid = session?.user?.id;
    const role = session?.user?.role;
    const directorOffline = role === 'DIRECTOR' && uid !== undefined;
    const patchId = newClientId('acq');
    const createdAt = new Date().toISOString();
    const body = {
      patchId,
      profiles: profiles.map((profile) => ({ id: profile.id, percent: profile.percent })),
      createdAt,
    };

    const put = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/acquiring-profiles`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ profiles }),
      });
      if (!response.ok) {
        throw new Error('save acquiring profiles error');
      }
      const data = (await response.json()) as { profiles?: unknown };
      const normalized = normalizeAcquiringProfiles(data.profiles, {
        putintsevVtb: profiles.find((p) => p.id === 'putintsev-vtb')?.percent,
        detkovVtb: profiles.find((p) => p.id === 'detkov-vtb')?.percent,
        putintsevSber: profiles.find((p) => p.id === 'putintsev-sber')?.percent,
        lyokhaRs: profiles.find((p) => p.id === 'lyokha-rs')?.percent,
      });
      setAcquiringProfiles(normalized);
      if (uid != null && (role === 'DIRECTOR' || role === 'ACCOUNTANT' || role === 'ADMIN')) {
        await saveAdminCache(uid, 'acquiringProfiles', normalized);
      }
    };

    if (directorOffline) {
      const normalized = normalizeAcquiringProfiles(profiles, {
        putintsevVtb: profiles.find((p) => p.id === 'putintsev-vtb')?.percent,
        detkovVtb: profiles.find((p) => p.id === 'detkov-vtb')?.percent,
        putintsevSber: profiles.find((p) => p.id === 'putintsev-sber')?.percent,
        lyokhaRs: profiles.find((p) => p.id === 'lyokha-rs')?.percent,
      });
      const mode = await runAdminMutation(uid, patchId, 'ACQUIRING_PROFILES', body, put);
      if (mode === 'queued') {
        setAcquiringProfiles(normalized);
        await saveAdminCache(uid, 'acquiringProfiles', normalized);
        setOfflineQueueTick((x) => x + 1);
        return;
      }
      return;
    }
    await put();
  };

  const normalizeFinanceOps = (raw: Partial<FinanceOpsSnapshot>): FinanceOpsSnapshot => {
    const categoryAmounts =
      raw.categoryAmounts ??
      FINANCE_EXPENSE_CATEGORY_LABELS.map((title) => ({ title, amount: 0 }));
    const categoryTotal =
      raw.totals?.categoryTotal ??
      Math.round(categoryAmounts.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
    return {
      accounts: raw.accounts ?? [],
      expenses: raw.expenses ?? [],
      incomes: raw.incomes ?? [],
      categoryAmounts,
      totals: {
        cash: raw.totals?.cash ?? 0,
        bank: raw.totals?.bank ?? 0,
        balance: raw.totals?.balance ?? 0,
        expenses: raw.totals?.expenses ?? 0,
        incomes: raw.totals?.incomes ?? 0,
        categoryTotal,
      },
    };
  };

  const applyCachedFinanceOps = async () => {
    const uid = session?.user?.id;
    if (uid === undefined) {
      return;
    }
    const cached = await loadSyncCache<FinanceOpsSnapshot>(uid, 'financeOps');
    if (cached) {
      setFinanceOps(normalizeFinanceOps(cached));
    }
  };

  const loadFinanceOps = async (token: string, options?: { preferNetwork?: boolean }) => {
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
    if (roleUsesSyncCache(role) && session?.user?.id != null) {
      const result = await loadSyncResource(API_BASE_URL, session.user.id, 'financeOps', fetcher, empty, {
        onFresh: (data) => setFinanceOps(data),
        ...syncFreshGuard(),
        preferNetwork: options?.preferNetwork,
      });
      setFinanceOps(result.data);
      return;
    }
    setFinanceOps(await fetcher());
  };

  const setFinanceExpenseCategoryAmount = async (
    token: string,
    title: string,
    amountStr: string,
  ) => {
    const num = Number(String(amountStr).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      throw new Error('Укажите корректную сумму');
    }
    const uid = session?.user?.id;
    const financeOffline =
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const patchId = newClientId('fcat');
    const createdAt = new Date().toISOString();
    const body = { patchId, title, amount: num, createdAt };

    const put = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/expense-category-amount`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, amount: num }),
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Не удалось сохранить сумму по статье'));
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, patchId, 'FINANCE_EXPENSE_CATEGORY', body, put);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await put();
    }
    await loadFinanceOps(token, { preferNetwork: true });
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
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await post();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const addFinanceExpense = async (
    token: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => {
    const amount = parseFinanceMoneyInput(payload.amount);
    if (amount === null) {
      throw new Error('INVALID_EXPENSE_AMOUNT');
    }
    const account = financeOps.accounts.find((a) => a.id === payload.accountId);
    const insufficient = financeExpenseInsufficientMessage(account, amount);
    if (insufficient) {
      throw new Error(insufficient);
    }
    const uid = session?.user?.id;
    const financeOffline =
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
        let message = 'add finance expense error';
        try {
          const data = (await response.json()) as { message?: string | string[] };
          const raw = data.message;
          if (typeof raw === 'string' && raw.trim()) {
            message = raw;
          } else if (Array.isArray(raw) && typeof raw[0] === 'string') {
            message = raw[0];
          }
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, expenseId, 'FINANCE_EXPENSE', body, post);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await post();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const updateFinanceIncome = async (
    token: string,
    id: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => {
    const amount = parseFinanceMoneyInput(payload.amount);
    if (amount === null) {
      throw new Error('Укажите корректную сумму');
    }
    const uid = session?.user?.id;
    const financeOffline =
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const updateId = newClientId('fincu');
    const createdAt = new Date().toISOString();
    const body = {
      updateId,
      incomeId: id,
      accountId: payload.accountId,
      amount,
      workDay: payload.workDay,
      comment: payload.comment,
      createdAt,
    };

    const put = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/incomes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountId: payload.accountId,
          amount,
          workDay: payload.workDay,
          comment: payload.comment,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, 'Не удалось изменить приход', {
            notFoundHint: `На сервере ещё нет API для редактирования приходов. ${API_DEPLOY_HINT}`,
          }),
        );
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, updateId, 'FINANCE_INCOME_UPDATE', body, put);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await put();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const updateFinanceExpense = async (
    token: string,
    id: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => {
    const amount = parseFinanceMoneyInput(payload.amount);
    if (amount === null) {
      throw new Error('Укажите корректную сумму');
    }
    const uid = session?.user?.id;
    const financeOffline =
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const updateId = newClientId('fexpu');
    const createdAt = new Date().toISOString();
    const body = {
      updateId,
      expenseId: id,
      accountId: payload.accountId,
      title: payload.title,
      amount,
      comment: payload.comment,
      createdAt,
    };

    const put = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/expenses/${encodeURIComponent(id)}`, {
        method: 'PUT',
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
        throw new Error(
          await readApiErrorMessage(response, 'Не удалось изменить расход', {
            notFoundHint: `На сервере ещё нет API для редактирования расходов. ${API_DEPLOY_HINT}`,
          }),
        );
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, updateId, 'FINANCE_EXPENSE_UPDATE', body, put);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await put();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const deleteFinanceIncome = async (token: string, id: string) => {
    const uid = session?.user?.id;
    const financeOffline =
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const deleteId = newClientId('fincd');
    const createdAt = new Date().toISOString();
    const body = { deleteId, incomeId: id, createdAt };

    const del = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/incomes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, 'Не удалось удалить приход', {
            notFoundHint: `На сервере ещё нет API для удаления приходов. ${API_DEPLOY_HINT}`,
          }),
        );
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, deleteId, 'FINANCE_INCOME_DELETE', body, del);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await del();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const deleteFinanceExpense = async (token: string, id: string) => {
    const uid = session?.user?.id;
    const financeOffline =
      (session?.user?.role === 'DIRECTOR' || session?.user?.role === 'ACCOUNTANT') &&
      uid !== undefined;
    const deleteId = newClientId('fexpd');
    const createdAt = new Date().toISOString();
    const body = { deleteId, expenseId: id, createdAt };

    const del = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/finance/expenses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, 'Не удалось удалить расход', {
            notFoundHint: `На сервере ещё нет API для удаления расходов. ${API_DEPLOY_HINT}`,
          }),
        );
      }
    };

    if (financeOffline) {
      const mode = await runAdminMutation(uid, deleteId, 'FINANCE_EXPENSE_DELETE', body, del);
      if (mode === 'queued') {
        setOfflineQueueTick((x) => x + 1);
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await del();
    }
    await loadFinanceOps(token, { preferNetwork: true });
  };

  const setFinanceAccountBalance = async (token: string, accountId: string, balanceStr: string) => {
    const num = Number(String(balanceStr).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      return;
    }
    const uid = session?.user?.id;
    const directorOffline = session?.user?.role === 'DIRECTOR' && uid !== undefined;
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
        await applyCachedFinanceOps();
        return;
      }
    } else {
      await put();
    }
    await loadFinanceOps(token, { preferNetwork: true });
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
      const uid = session?.user?.id;
      const role = session?.user?.role;
      const mergePending = async (rows: AdminSale[]): Promise<AdminSale[]> => {
        if (uid === undefined || role !== 'ADMIN') {
          return rows;
        }
        const pending = await listAdminSalesQueue(uid);
        const pendingSales = offlineQueueToAdminSales(
          pending,
          sellers,
          session?.user.storeName,
        );
        const pendingIds = new Set(pendingSales.map((sale) => sale.id));
        return sortSalesByCreatedAtDesc([
          ...rows.filter((sale) => !pendingIds.has(sale.id)),
          ...pendingSales,
        ]);
      };
      if (
        uid != null &&
        roleUsesSyncCache(role)
      ) {
        const cached = await loadSyncCache<AdminSale[]>(uid, 'sales');
        if (cached) {
          setSales(await mergePending(cached));
        }
        const result = await loadSyncResource(API_BASE_URL, uid, 'sales', fetcher, [], {
          onFresh: (data) => {
            void mergePending(data).then((merged) => setSales(merged));
          },
          ...syncFreshGuard(),
        });
        setSales(await mergePending(result.data));
        return;
      }
      setSales(await fetcher());
    },
    [isDesktopShell, session?.user?.id, session?.user?.role, session?.user?.storeName, sellers, syncFreshGuard],
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
    if (session?.user?.role === 'DIRECTOR' && session.user.id != null) {
      const result = await loadSyncResource(
        API_BASE_URL,
        session.user.id,
        'commissionRequests',
        fetcher,
        [],
        { onFresh: (data) => setCommissionRequests(data), ...syncFreshGuard() },
      );
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
    const role = session?.user?.role;
    const uid = session?.user?.id;
    if (uid != null && roleUsesSyncCache(role)) {
      const result = await loadSyncResource(API_BASE_URL, uid, 'shifts', fetcher, [], {
        onFresh: (data) => setShifts(data),
        ...syncFreshGuard(),
      });
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
    const role = session?.user?.role;
    const uid = session?.user?.id;
    if (uid != null && roleUsesSyncCache(role)) {
      const result = await loadSyncResource(API_BASE_URL, uid, 'staff', fetcher, [], {
        onFresh: (data) => setStaff(data),
        ...syncFreshGuard(),
      });
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

  const runDesktopManualSync = useCallback(async () => {
    const token = session?.token;
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (!token || userId === undefined || !role) {
      return;
    }
    setOutboxSyncing(true);
    markApiReachableSuccess();
    setApiReachable(true);
    try {
      await flushOutbox(API_BASE_URL, token, userId);
      const loads: Promise<unknown>[] = [loadDashboard(token)];
      if (role === 'DIRECTOR') {
        loads.push(
          loadFinanceOps(token),
          loadInventoryOverview(token),
          loadCommissionRequests(token),
          loadStaff(token),
          loadSellers(token),
          loadSales(token),
          loadShifts(token),
          loadProducts(token),
          loadProductProcurementCosts(token),
          loadAcquiringProfiles(token),
          loadManagerStoreCommissions(token),
        );
      } else if (role === 'ACCOUNTANT') {
        loads.push(
          loadFinanceOps(token),
          loadInventoryOverview(token),
          loadSales(token),
          loadSellers(token),
          loadProducts(token),
          loadProductProcurementCosts(token),
          loadAcquiringProfiles(token),
        );
      } else if (role === 'MANAGER') {
        loads.push(loadStaff(token), loadSellers(token), loadSales(token));
      } else if (role === 'ADMIN') {
        loads.push(
          loadSales(token),
          loadSellers(token),
          loadProducts(token),
          loadProductProcurementCosts(token),
          loadAcquiringProfiles(token),
          loadShifts(token),
          loadStaff(token),
          loadStoreInventory(token),
          loadGlobalEmployees(token),
        );
      }
      await Promise.allSettled(loads);
      if (role === 'DIRECTOR' || role === 'ACCOUNTANT') {
        setEquipmentRefreshKey((k) => k + 1);
      }
      setOfflineQueueTick((x) => x + 1);
    } finally {
      setOutboxSyncing(false);
      await refreshOutboxPendingCount();
    }
  }, [
    session?.token,
    session?.user?.id,
    session?.user?.role,
    loadDashboard,
    loadFinanceOps,
    loadInventoryOverview,
    loadCommissionRequests,
    loadStaff,
    loadSellers,
    loadSales,
    loadShifts,
    loadProducts,
    loadProductProcurementCosts,
    loadAcquiringProfiles,
    loadManagerStoreCommissions,
    loadStoreInventory,
    loadGlobalEmployees,
    refreshOutboxPendingCount,
  ]);

  const setStoreSellerPercent = async (token: string, sellerId: number, ratePercent: number) => {
    const uid = session?.user?.id;
    if (uid === undefined) {
      return;
    }
    const clientId = newClientId('pct');
    const createdAt = new Date().toISOString();
    const body = { clientId, sellerId, ratePercent, createdAt };
    const mode = await runAdminMutation(uid, clientId, 'DIRECTOR_SET_PERCENT', body, async () => {
      await Promise.resolve();
    });
    if (mode === 'queued') {
      setOfflineQueueTick((x) => x + 1);
      await loadSellers(token).catch(() => undefined);
      await loadStaff(token).catch(() => undefined);
    }
  };

  const setDirectorPercent = async (token: string, sellerId: number, ratePercent: number) => {
    const uid = session?.user?.id;
    const directorOffline = session?.user?.role === 'DIRECTOR' && uid !== undefined;
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
    const directorOffline = session?.user?.role === 'DIRECTOR' && uid !== undefined;
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
    const storeName = offlineStoreMode
      ? effectiveStoreName(session?.user.storeName ?? '')
      : (session?.user.storeName ?? '');
    const entry: OfflineQueuedSale = {
      saleId,
      sellerId,
      storeName,
      items,
      totalAmount,
      paymentType,
      createdAt: new Date().toISOString(),
    };
    const uid = session?.user?.id;
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;

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
        if (offlineStoreMode) {
          await applyOfflineAdminSnapshot();
        } else {
          const [cachedSales, cachedSellers, cachedInv] = await Promise.all([
            loadSyncCache<AdminSale[]>(uid, 'sales'),
            loadSyncCache<SellerProfile[]>(uid, 'sellers'),
            loadSyncCache<StoreInventoryDetailResponse | null>(uid, 'storeInventory'),
          ]);
          if (cachedSales) {
            setSales(cachedSales);
          }
          if (cachedSellers) {
            setSellers(cachedSellers);
          }
          if (cachedInv !== null) {
            setStoreInventory(cachedInv);
          }
        }
        void refreshOfflinePending();
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
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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

  const submitSaleDeleteWithReason = async (
    sale: Pick<AdminSale, 'id' | 'sellerName' | 'totalAmount' | 'createdAt' | 'pendingSync' | 'items'>,
    reason: string,
  ) => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new Error('Укажите причину удаления (не короче 3 символов)');
    }
    if (!session?.token) {
      throw new Error('Сессия не найдена');
    }
    const token = session.token;
    const uid = session.user.id;
    const storeName = session.user.storeName ?? '';
    const dayKey = calendarDayKeyMoscow(sale.createdAt);
    const journalBase = {
      id: newClientId('sdj'),
      saleId: sale.id,
      sellerName: sale.sellerName,
      amount: sale.totalAmount,
      reason: trimmed,
      createdAt: new Date().toISOString(),
      storeName: effectiveStoreName(storeName),
      dayKey,
      items: sale.items ?? [],
      saleCreatedAt: sale.createdAt,
    };

    if (sale.pendingSync && uid !== undefined) {
      const removed = await removeAdminSaleFromOutbox(uid, sale.id);
      if (!removed) {
        throw new Error('Продажа не найдена в очереди отправки');
      }
      await revertSaleStock(uid, removed);
      const cachedSales = (await loadAdminCache<Array<{ id: string }>>(uid, 'sales')) ?? [];
      await saveAdminCache(
        uid,
        'sales',
        cachedSales.filter((row) => row.id !== sale.id),
      );
      await appendSaleDeleteJournal(uid, { ...journalBase, status: 'local_removed' });
      setOfflineQueueTick((x) => x + 1);
      await loadSales(token).catch(() => undefined);
      setSalesNotice('Офлайн-продажа удалена локально.');
      return;
    }

    const requestId = newClientId('sdel');
    const createdAt = new Date().toISOString();
    const payload = {
      requestId,
      saleId: sale.id,
      reason: trimmed,
      storeName,
      sellerName: sale.sellerName,
      totalAmount: sale.totalAmount,
      items: sale.items ?? [],
      createdAt,
    };
    const postDelete = async () => {
      const response = await fetch(`${API_BASE_URL}/admin/sales/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ saleId: sale.id, reason: trimmed }),
      });
      if (!response.ok) {
        let message = 'Не удалось удалить продажу';
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

    const adminOutbox = roleUsesAdminDesktopOutbox(session.user.role, isDesktopShell) && uid !== undefined;
    if (adminOutbox) {
      const mode = await runAdminMutation(uid, requestId, 'ADMIN_SALE_DELETE_REQUEST', payload, postDelete);
      if (mode === 'queued') {
        await appendSaleDeleteJournal(uid, { ...journalBase, status: 'pending_sync' });
        setOfflineQueueTick((x) => x + 1);
        await loadSales(token).catch(() => undefined);
        await loadDashboard(token, { background: true }).catch(() => undefined);
        setSalesNotice('Удаление сохранено офлайн — отправится при подключении.');
        return;
      }
    } else {
      await postDelete();
    }

    if (uid !== undefined) {
      const cachedSales = (await loadAdminCache<Array<{ id: string }>>(uid, 'sales')) ?? [];
      await saveAdminCache(
        uid,
        'sales',
        cachedSales.filter((row) => row.id !== sale.id),
      );
      await appendSaleDeleteJournal(uid, { ...journalBase, status: 'deleted' });
    }
    await loadSales(token);
    await loadDashboard(token, { background: true }).catch(() => undefined);
    setSalesNotice('Продажа удалена.');
  };

  const updateSalePaymentType = async (
    token: string,
    saleId: string,
    paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER',
    pendingSync: boolean,
  ) => {
    setSalesNotice('');
    const userId = session?.user?.id;
    if (pendingSync && userId !== undefined) {
      const ok = await updateAdminSalePaymentInOutbox(userId, saleId, paymentType);
      if (!ok) {
        throw new Error('Не удалось обновить продажу в очереди отправки');
      }
      setOfflineQueueTick((x) => x + 1);
      setPaymentEditSaleId(null);
      return;
    }
    const response = await fetch(
      `${API_BASE_URL}/admin/sales/${encodeURIComponent(saleId)}/payment-type`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentType }),
      },
    );
    if (!response.ok) {
      let message = 'Не удалось изменить вид оплаты';
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
    setPaymentEditSaleId(null);
  };

  const downloadAdminDayReport = async (token: string) => {
    if (!session || session.user.role !== 'ADMIN') {
      return;
    }
    setDayReportNotice('');
    setDayReportBusy(true);
    try {
      const userId = session.user.id;
      let profiles = acquiringProfiles;
      let reportSales = salesMerged;
      let reportSellers = sellers;
      let reportStaff = staff;
      let reportShifts = shifts;
      let usedOfflineCache = !apiReachable;
      let cachedManagerCommissions: ManagerStoreCommissionRow[] | null = null;

      if (userId !== undefined) {
        const [cSales, cSellers, cStaff, cShifts, cProfiles, cManagerCommissions] =
          await Promise.all([
            loadSyncCache<AdminSale[]>(userId, 'sales'),
            loadSyncCache<SellerProfile[]>(userId, 'sellers'),
            loadSyncCache<StaffMember[]>(userId, 'staff'),
            loadSyncCache<ShiftInfo[]>(userId, 'shifts'),
            loadSyncCache<AcquiringProfile[]>(userId, 'acquiringProfiles'),
            loadSyncCache<ManagerStoreCommissionRow[]>(userId, 'managerStoreCommissions'),
          ]);
        if (cSellers?.length) {
          reportSellers = cSellers;
        }
        if (cStaff?.length) {
          reportStaff = cStaff;
        }
        if (cShifts?.length) {
          reportShifts = cShifts;
        }
        const pending = offlineQueueToAdminSales(
          offlinePendingSales,
          reportSellers,
          session.user.storeName,
        );
        const pendingIds = new Set(pending.map((sale) => sale.id));
        const syncedBase = cSales ?? sales;
        reportSales = sortSalesByCreatedAtDesc([
          ...syncedBase.filter((sale) => !pendingIds.has(sale.id)),
          ...pending,
        ]);
        if (cProfiles?.length) {
          profiles = cProfiles;
        }
        if (cManagerCommissions?.length) {
          cachedManagerCommissions = cManagerCommissions;
        }
        usedOfflineCache =
          usedOfflineCache || Boolean(cSales || cSellers || cProfiles || cManagerCommissions);
      }

      const { buildStoreDayReportData, downloadStoreDayReportXlsx } = await import(
        './export/storeDayReportXlsx'
      );
      let managerCommissions =
        managerStoreCommissions.length > 0
          ? managerStoreCommissions
          : (cachedManagerCommissions ?? []);
      if (apiReachable && managerCommissions.length === 0) {
        try {
          const response = await fetchWithTimeout(
            `${API_BASE_URL}/admin/manager-store-commissions`,
            { headers: { Authorization: `Bearer ${token}` } },
            6000,
          );
          if (response.ok) {
            const payload = (await response.json()) as { items?: ManagerStoreCommissionRow[] };
            if (Array.isArray(payload.items) && payload.items.length > 0) {
              managerCommissions = payload.items;
            }
          }
        } catch {
          // офлайн — дефолтные проценты в отчёте
        }
      }

      const reportDayKey = adminDayKey;
      let deletedSalesForReport: Array<{
        sellerName: string;
        amount: number;
        reason: string;
        statusLabel: string;
        deletedAt: string;
      }> = [];

      if (userId !== undefined) {
        const journal = await listSaleDeleteJournal(userId, storeDisplayName, reportDayKey);
        deletedSalesForReport = journal.map((entry) => ({
          sellerName: entry.sellerName,
          amount: entry.amount,
          reason: entry.reason,
          statusLabel:
            entry.status === 'local_removed'
              ? 'Удалено локально'
              : entry.status === 'pending_sync'
                ? 'Ожидает отправки'
                : 'Удалено',
          saleAt: entry.saleCreatedAt
            ? new Date(entry.saleCreatedAt).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : undefined,
          deletedAt: new Date(entry.createdAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
          itemsSold:
            entry.items && entry.items.length > 0
              ? entry.items.map((line) => `${line.name} ×${line.qty}`).join(', ')
              : undefined,
        }));
      }

      const reportData = buildStoreDayReportData({
        storeName: storeDisplayName,
        dayKey: reportDayKey,
        sales: reportSales,
        sellers: reportSellers,
        staff: reportStaff,
        shifts: reportShifts,
        acquiringProfiles: profiles,
        managerStoreCommissions: managerCommissions,
        deletedSales: deletedSalesForReport,
        acquiringRatePercentOverride: offlineStoreMode
          ? offlineAcquiringPercentForStore(
              storeDisplayName,
              profiles,
              percentForStore(storeDisplayName, profiles),
            )
          : undefined,
      });
      const saveResult = await downloadStoreDayReportXlsx(reportData);
      if (saveResult === 'cancelled') {
        setDayReportNotice('Сохранение отменено.');
        return;
      }
      setDayReportNotice(
        usedOfflineCache && !apiReachable
          ? 'Отчёт за день сохранён (офлайн, из локального кэша).'
          : 'Отчёт за день сохранён.',
      );
    } catch (error) {
      console.error('downloadAdminDayReport failed', error);
      let message = 'Не удалось сформировать отчёт за день.';
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('динамическ')) {
          message = 'Не удалось загрузить модуль отчёта. Проверьте сеть и обновите приложение.';
        } else if (error.message.includes('время ожидания') || error.message.includes('timeout')) {
          message = 'Сервер не ответил вовремя. Повторите при стабильной сети или используйте офлайн-кэш.';
        } else if (error.message.trim()) {
          message = `Не удалось сформировать отчёт: ${error.message}`;
        }
      }
      setDayReportNotice(message);
    } finally {
      setDayReportBusy(false);
    }
  };

  const openShift = async (token: string, assignedSellerIds: number[]) => {
    const uid = session?.user?.id;
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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
      }
    } else {
      await postOpen();
    }
    if (offlineStoreMode) {
      await applyOfflineAdminSnapshot();
    } else {
      await Promise.all([loadShifts(token), loadStaff(token)]);
    }
  };

  const closeShift = async (token: string, assignedSellerIds: number[] = []) => {
    const uid = session?.user?.id;
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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
      }
    } else {
      await postClose();
    }
    if (offlineStoreMode) {
      await applyOfflineAdminSnapshot();
    } else {
      await Promise.all([loadShifts(token), loadStaff(token)]);
    }
  };

  const addStaffMember = async (
    token: string,
    fullName: string,
    nickname: string,
    options?: { staffPosition?: StaffPositionKind; retoucherRatePercent?: number },
  ) => {
    const uid = session?.user?.id;
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
    const clientMemberId = newClientId('staff');
    const createdAt = new Date().toISOString();
    const payload = {
      clientMemberId,
      fullName,
      nickname,
      createdAt,
      storeName: effectiveStoreName(session?.user.storeName ?? ''),
      staffPosition: options?.staffPosition ?? 'SALES',
      retoucherRatePercent: options?.retoucherRatePercent,
    };

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
      }
      if (offlineStoreMode) {
        await applyOfflineAdminSnapshot();
      } else {
        await loadStaff(token);
        await loadSellers(token);
      }
      if (!offlineStoreMode) {
        await loadGlobalEmployees(token);
      }
      return;
    }
    await postStaff();
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const addOfflineManagerStaff = async (
    token: string,
    fullName: string,
    nickname: string,
    percent: number,
  ) => {
    const uid = session?.user?.id;
    if (uid === undefined) {
      return;
    }
    await addStaffMember(token, fullName, nickname, { staffPosition: 'MANAGER' });
    await saveOfflineManagerCommission(uid, storeDisplayName, percent);
    await applyOfflineAdminSnapshot();
  };

  const exitDirectorManagement = () => {
    clearOpsDayUnlock();
    setOpsDayUnlocked(false);
    setOpsDayUnlockOpen(false);
    setOpsDayUnlockDraft('');
  };

  const addStaffFromBase = async (token: string, employeeId: number) => {
    const uid = session?.user?.id;
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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
    const adminDesktop = roleUsesAdminDesktopOutbox(session?.user?.role, isDesktopShell) && uid !== undefined;
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

  const hydrateRoleCacheForUser = async (data: LoginResponse) => {
    const uid = data.user.id;
    const role = data.user.role;
    if (role === 'DIRECTOR' || role === 'ACCOUNTANT') {
      const [
        cachedFinance,
        cachedInventory,
        cachedCommission,
        cachedSellers,
        cachedAcquiring,
        cachedProducts,
        cachedProcurement,
        cachedManagerCommissions,
      ] = await Promise.all([
        loadSyncCache<FinanceOpsSnapshot>(uid, 'financeOps'),
        loadSyncCache<InventoryOverviewResponse>(uid, 'inventoryOverview'),
        role === 'DIRECTOR'
          ? loadSyncCache<CommissionRequest[]>(uid, 'commissionRequests')
          : Promise.resolve(null),
        loadSyncCache<SellerProfile[]>(uid, 'sellers'),
        loadSyncCache<AcquiringProfile[]>(uid, 'acquiringProfiles'),
        role === 'DIRECTOR'
          ? loadSyncCache<ProductItem[]>(uid, 'products')
          : Promise.resolve(null),
        role === 'DIRECTOR'
          ? loadSyncCache<ProductProcurementCost[]>(uid, 'procurementCosts')
          : Promise.resolve(null),
        role === 'DIRECTOR'
          ? loadSyncCache<ManagerStoreCommissionRow[]>(uid, 'managerStoreCommissions')
          : Promise.resolve(null),
      ]);
      if (cachedFinance) {
        setFinanceOps(normalizeFinanceOps(cachedFinance));
      }
      if (cachedInventory) {
        setInventoryOverview(normalizeInventoryOverview(cachedInventory));
      }
      if (cachedCommission) {
        setCommissionRequests(cachedCommission);
      }
      if (cachedSellers) {
        setSellers(cachedSellers);
      }
      if (cachedAcquiring?.length) {
        setAcquiringProfiles(cachedAcquiring);
      }
      if (cachedProducts?.length) {
        setProducts(cachedProducts);
      }
      if (cachedProcurement?.length) {
        setProductProcurementCosts(cachedProcurement);
      }
      if (cachedManagerCommissions?.length) {
        setManagerStoreCommissions(cachedManagerCommissions);
      }
      if (role === 'DIRECTOR') {
        const [cachedStaff, cachedSales, cachedShifts] = await Promise.all([
          loadSyncCache<StaffMember[]>(uid, 'staff'),
          loadSyncCache<AdminSale[]>(uid, 'sales'),
          loadSyncCache<ShiftInfo[]>(uid, 'shifts'),
        ]);
        if (cachedStaff?.length) {
          setStaff(cachedStaff);
        }
        if (cachedSales?.length) {
          setSales(cachedSales);
        }
        if (cachedShifts?.length) {
          setShifts(cachedShifts);
        }
      }
      return;
    }
    if (role === 'MANAGER') {
      const [cachedStaff, cachedSales, cachedSellers] = await Promise.all([
        loadSyncCache<StaffMember[]>(uid, 'staff'),
        loadSyncCache<AdminSale[]>(uid, 'sales'),
        loadSyncCache<SellerProfile[]>(uid, 'sellers'),
      ]);
      if (cachedStaff?.length) {
        setStaff(cachedStaff);
      }
      if (cachedSales?.length) {
        setSales(cachedSales);
      }
      if (cachedSellers) {
        setSellers(cachedSellers);
      }
      return;
    }
    if (role === 'ADMIN') {
      const [
        cachedSellers,
        cachedProducts,
        cachedStaff,
        cachedShifts,
        cachedSales,
        cachedInv,
        cachedProcurement,
        cachedAcquiring,
        cachedManagerCommissions,
        cachedDashboard,
      ] = await Promise.all([
        loadAdminCache<SellerProfile[]>(uid, 'sellers'),
        loadAdminCache<ProductItem[]>(uid, 'products'),
        loadAdminCache<StaffMember[]>(uid, 'staff'),
        loadAdminCache<ShiftInfo[]>(uid, 'shifts'),
        loadAdminCache<AdminSale[]>(uid, 'sales'),
        loadAdminCache<StoreInventoryDetailResponse | null>(uid, 'storeInventory'),
        loadAdminCache<ProductProcurementCost[]>(uid, 'procurementCosts'),
        loadAdminCache<AcquiringProfile[]>(uid, 'acquiringProfiles'),
        loadAdminCache<ManagerStoreCommissionRow[]>(uid, 'managerStoreCommissions'),
        loadAdminCache<DashboardResponse>(uid, 'dashboard'),
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
      if (cachedProcurement?.length) {
        setProductProcurementCosts(cachedProcurement);
      }
      if (cachedAcquiring?.length) {
        setAcquiringProfiles(cachedAcquiring);
      }
      if (cachedManagerCommissions?.length) {
        setManagerStoreCommissions(cachedManagerCommissions);
      }
      if (cachedDashboard) {
        setDashboard(cachedDashboard);
      } else {
        setDashboard(buildEmptyDashboardSkeleton(data.user.storeName));
      }
      setDashboardLoading(false);
    }
  };

  const bootstrapLoggedInUser = async (data: LoginResponse) => {
    setSession(data);
    if (offlineStoreMode) {
      await hydrateRoleCacheForUser(data);
      if (data.user.id != null && data.user.role === 'ADMIN') {
        await ensureOfflineStoreDefaults(data.user.id);
        await applyOfflineAdminSnapshot();
        if (!dashboard) {
          setDashboard(buildEmptyDashboardSkeleton(storeDisplayName || data.user.storeName));
          setDashboardLoading(false);
        }
      }
      return;
    }
    if (isDesktopShell) {
      setStaff([]);
      setSellers([]);
      setSales([]);
      setShifts([]);
      setGlobalEmployees([]);
      setProducts([]);
      setStoreInventory(null);
      await hydrateRoleCacheForUser(data);
    } else if (roleUsesSyncCache(data.user.role)) {
      await hydrateRoleCacheForUser(data);
    }
    void loadDashboardWithRetry(data.token).catch(() => undefined);
    if (!dashboard && data.user.role === 'ADMIN') {
      setDashboard(buildEmptyDashboardSkeleton(data.user.storeName));
      setDashboardLoading(false);
    }
    if (isDesktopShell) {
      setAdminError('');
      if (data.user.role === 'ADMIN') {
        await Promise.allSettled([
          loadStaff(data.token),
          loadSellers(data.token),
          loadSales(data.token),
          loadShifts(data.token),
          loadGlobalEmployees(data.token),
          loadStoreInventory(data.token),
        ]);
      }
      return;
    }
    if (
      data.user.role === 'ADMIN' ||
      data.user.role === 'DIRECTOR' ||
      data.user.role === 'ACCOUNTANT' ||
      data.user.role === 'MANAGER'
    ) {
      setAdminError('');
      if (data.user.role === 'DIRECTOR') {
        await Promise.allSettled([
          loadCommissionRequests(data.token),
          loadStaff(data.token),
          loadSellers(data.token),
          loadSales(data.token),
          loadShifts(data.token),
          loadAcquiringProfiles(data.token),
          loadProducts(data.token),
          loadProductProcurementCosts(data.token),
          loadManagerStoreCommissions(data.token),
          loadInventoryOverview(data.token),
          loadFinanceOps(data.token),
        ]);
      } else if (data.user.role === 'ACCOUNTANT') {
        await Promise.allSettled([
          loadFinanceOps(data.token),
          loadAcquiringProfiles(data.token),
        ]);
      } else if (data.user.role === 'MANAGER') {
        await Promise.allSettled([
          loadSellers(data.token),
          loadSales(data.token),
          loadStaff(data.token),
        ]);
      } else {
        const baseLoads = await Promise.allSettled([
          loadSellers(data.token),
          loadProducts(data.token),
          loadProductProcurementCosts(data.token),
          loadAcquiringProfiles(data.token),
          loadSales(data.token),
          loadCommissionRequests(data.token),
          loadShifts(data.token),
          loadStaff(data.token),
          loadGlobalEmployees(data.token),
          loadStoreInventory(data.token),
        ]);
        const failed = baseLoads.filter((item) => item.status === 'rejected').length;
        if (failed > 0) {
          setAdminError('Часть данных точки не загрузилась. Проверьте сеть.');
        }
      }
    } else {
      setSellers([]);
      setProducts([]);
      setSales([]);
      setProductProcurementCosts([]);
      setCommissionRequests([]);
      setShifts([]);
      setStaff([]);
      setAcquiringProfiles(defaultAcquiringProfiles());
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

    const enterWithSession = async (data: LoginResponse, fromOffline: boolean) => {
      if (fromOffline) {
        setApiReachable(false);
      } else {
        setApiReachable(true);
        if (data.user.role === 'ADMIN') {
          saveOfflineLoginCred(nickname, password, data);
        }
      }
      writeDirectorRootSession(null);
      setDirectorRootSession(null);
      setPassword('');
      setError('');
      navigate('/home', { replace: true });
      await bootstrapLoggedInUser(data);
    };

    try {
      const offlineAdmin = tryOfflineAdminLogin(nickname, password);
      if (offlineAdmin) {
        await enterWithSession(offlineAdmin, isOfflineLoginMode());
        return;
      }
      if (isOfflineLoginMode()) {
        setError(OFFLINE_ADMIN_LOGIN_HINT);
        return;
      }

      const data = await loginWithNicknamePassword(nickname, password);
      await enterWithSession(data, false);
    } catch (e) {
      const offlineAdmin = isOfflineLoginFetchError(e) ? tryOfflineAdminLogin(nickname, password) : null;
      if (offlineAdmin) {
        await enterWithSession(offlineAdmin, true);
        return;
      }
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
      setAcquiringProfiles(defaultAcquiringProfiles());
      setInventoryOverview(null);
      setStoreInventory(null);
      setError(
        isOfflineLoginFetchError(e) ? OFFLINE_ADMIN_LOGIN_HINT : describeLoginFetchError(e),
      );
      if (!isOfflineLoginFetchError(e)) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        window.localStorage.removeItem(SESSION_PERSISTENCE_KEY);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    if (offlineStoreMode) {
      return;
    }
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
    setAcquiringProfiles(defaultAcquiringProfiles());
    setFinanceOps({
      accounts: [],
      expenses: [],
      incomes: [],
      totals: { cash: 0, bank: 0, balance: 0, expenses: 0, incomes: 0 },
    });
    setInventoryOverview(null);
    setStoreInventory(null);
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

  const webSessionBootstrappedRef = useRef<string | null>(null);
  const desktopSessionBootstrappedRef = useRef<string | null>(null);
  const postFlushRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (userId === undefined || !roleUsesSyncCache(role)) {
      return;
    }
    void loadSyncCache<DashboardResponse>(userId, 'dashboard').then((cached) => {
      if (cached) {
        setDashboard((current) => current ?? cached);
      }
    });
  }, [session?.token, session?.user?.id, session?.user?.role]);

  useEffect(() => {
    if (offlineStoreMode || !session?.token || session.user.id == null || !roleUsesSyncEngine(session.user.role, isDesktopShell)) {
      return;
    }
    const token = session.token;
    const userId = session.user.id;
    const role = session.user.role;
    const stop = startSyncEngine({
      apiBaseUrl: API_BASE_URL,
      token,
      userId,
      enablePeriodicFlush: isDesktopShell,
      ignoreNavigatorOffline: isDesktopShell,
      onSyncingChange: setOutboxSyncing,
      onReachableChange: setApiReachable,
      onFlushed: () => {
        setOfflineQueueTick((x) => x + 1);
        void refreshOutboxPendingCount();
        if (isDesktopShell) {
          if (postFlushRefreshRef.current) {
            window.clearTimeout(postFlushRefreshRef.current);
          }
          postFlushRefreshRef.current = window.setTimeout(() => {
            postFlushRefreshRef.current = null;
            void runDesktopManualSync();
          }, 400);
          return;
        }
        if (role === 'ADMIN') {
          void Promise.allSettled([
            loadSales(token),
            loadSellers(token),
            loadProducts(token),
            loadShifts(token),
            loadStaff(token),
            loadStoreInventory(token),
            loadGlobalEmployees(token),
          ]);
          return;
        }
        if (role === 'MANAGER' || role === 'DIRECTOR' || role === 'ACCOUNTANT') {
          if (isDesktopShell) {
            if (postFlushRefreshRef.current) {
              window.clearTimeout(postFlushRefreshRef.current);
            }
            postFlushRefreshRef.current = window.setTimeout(() => {
              postFlushRefreshRef.current = null;
              void loadDashboard(token, { background: true }).catch(() => undefined);
            }, 2500);
          } else {
            void Promise.allSettled([
              loadDashboard(token, { background: true }),
              loadFinanceOps(token),
              loadSales(token),
              loadSellers(token),
              ...(role === 'DIRECTOR'
                ? [
                    loadInventoryOverview(token),
                    loadCommissionRequests(token),
                    loadProducts(token),
                    loadProductProcurementCosts(token),
                    loadAcquiringProfiles(token),
                    loadManagerStoreCommissions(token),
                  ]
                : role === 'ACCOUNTANT'
                  ? [loadProducts(token), loadProductProcurementCosts(token), loadAcquiringProfiles(token)]
                  : [loadStaff(token)]),
            ]);
          }
          return;
        }
        void loadSales(token).catch(() => undefined);
        void loadSellers(token).catch(() => undefined);
      },
    });
    return () => {
      if (postFlushRefreshRef.current) {
        window.clearTimeout(postFlushRefreshRef.current);
      }
      stop();
    };
  }, [
    session?.token,
    session?.user?.id,
    session?.user?.role,
    isDesktopShell,
    runDesktopManualSync,
    refreshOutboxPendingCount,
    loadFinanceOps,
    loadInventoryOverview,
    loadCommissionRequests,
    loadProducts,
    loadProductProcurementCosts,
    loadAcquiringProfiles,
    loadManagerStoreCommissions,
    loadStaff,
    loadSales,
    loadSellers,
    loadShifts,
    loadStoreInventory,
    loadGlobalEmployees,
    loadDashboard,
  ]);

  useEffect(() => {
    if (isDesktopShell || !session?.token || session.user.id == null) {
      return;
    }
    if (session.user.role === 'ADMIN') {
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
    if (isDesktopShell || !session?.token) {
      return;
    }
    const bootKey = `${session.token}:${session.user.role}`;
    if (webSessionBootstrappedRef.current === bootKey) {
      return;
    }
    webSessionBootstrappedRef.current = bootKey;
    void (async () => {
      try {
        try {
          await loadDashboard(session.token);
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          await loadDashboard(session.token);
        }
        const role = session.user.role;
        const loads: Promise<unknown>[] = [];
        if (role === 'ADMIN') {
          loads.push(
            loadSellers(session.token),
            loadProducts(session.token),
            loadProductProcurementCosts(session.token),
            loadAcquiringProfiles(session.token),
            loadSales(session.token),
            loadCommissionRequests(session.token),
            loadShifts(session.token),
            loadStaff(session.token),
            loadGlobalEmployees(session.token),
            loadStoreInventory(session.token),
          );
        } else if (role === 'DIRECTOR') {
          loads.push(
            loadCommissionRequests(session.token),
            loadStaff(session.token),
            loadSellers(session.token),
            loadSales(session.token),
            loadShifts(session.token),
            loadAcquiringProfiles(session.token),
          );
        } else if (role === 'ACCOUNTANT') {
          loads.push(loadFinanceOps(session.token), loadAcquiringProfiles(session.token));
        } else if (role === 'MANAGER') {
          loads.push(loadSellers(session.token), loadSales(session.token), loadStaff(session.token));
        }
        await Promise.allSettled(loads);
      } catch {
        setAdminError('Сессия восстановлена, но часть данных загрузится с задержкой.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один прогон при входе / смене роли
  }, [isDesktopShell, session?.token, session?.user?.role]);

  useEffect(() => {
    if (!isDesktopShell || !session?.token) {
      return;
    }
    const bootKey = `${session.user.id ?? 'x'}:${session.user.role}`;
    if (desktopSessionBootstrappedRef.current === bootKey) {
      return;
    }
    desktopSessionBootstrappedRef.current = bootKey;
    void bootstrapLoggedInUser(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один прогон при восстановлении сессии
  }, [isDesktopShell, session?.token, session?.user?.id, session?.user?.role]);

  /** Тяжёлые разделы — грузим по переходу с TTL, без дублирования параллельных запросов. */
  useEffect(() => {
    if (!session?.token) {
      return;
    }
    const token = session.token;
    const role = session.user.role;
    const path = location.pathname;

    if (role === 'DIRECTOR' || role === 'ACCOUNTANT') {
      if (path === '/shift') {
        void fetchRouteDataIfStale(`${role}:financeOps`, () => loadFinanceOps(token));
      }
      if (path === '/sales' || path === '/accounting/procurement') {
        void fetchRouteDataIfStale(`${role}:inventory`, async () => {
          await Promise.allSettled([
            loadInventoryOverview(token),
            loadProductProcurementCosts(token),
            loadProducts(token),
            loadAcquiringProfiles(token),
          ]);
        });
      }
      if (path === '/sales') {
        void fetchRouteDataIfStale(`${role}:sales`, async () => {
          await Promise.allSettled([loadSales(token), loadSellers(token)]);
        });
      }
      if (path === '/home') {
        void fetchRouteDataIfStale(`${role}:acquiring`, () => loadAcquiringProfiles(token));
      }
      if (role === 'DIRECTOR' && (path === '/team' || path === '/payroll')) {
        void fetchRouteDataIfStale(`director:${path}:team`, async () => {
          await Promise.allSettled([
            loadManagerStoreCommissions(token),
            loadStaff(token),
            loadSellers(token),
            loadSales(token),
            ...(path === '/team' ? [loadShifts(token)] : []),
          ]);
        });
      }
      return;
    }
    if (role === 'MANAGER' && path === '/team') {
      void fetchRouteDataIfStale('manager:team', async () => {
        await Promise.allSettled([loadStaff(token), loadSellers(token), loadSales(token)]);
      });
    }
    if (role === 'MANAGER' && path === '/sales') {
      void fetchRouteDataIfStale('manager:sales', async () => {
        await Promise.allSettled([loadSales(token), loadSellers(token)]);
      });
    }
    if (isDesktopShell && role === 'ADMIN' && (path === '/shift' || path === '/home')) {
      void Promise.allSettled([
        loadStaff(token),
        loadSellers(token),
        loadSales(token),
        loadShifts(token),
        loadGlobalEmployees(token),
        loadProductProcurementCosts(token),
        loadAcquiringProfiles(token),
        loadManagerStoreCommissions(token),
        loadStoreInventory(token),
      ]);
    }
    if (role === 'ADMIN' && path === '/home') {
      void refreshOfflinePending();
    }
  }, [isDesktopShell, location.pathname, session?.token, session?.user?.role, refreshOfflinePending]);

  const refreshAdminWebLive = useCallback(() => {
    if (!session?.token || isDesktopShell || session.user.role !== 'ADMIN') {
      return;
    }
    if (document.visibilityState !== 'visible') {
      return;
    }
    const token = session.token;
    const path = location.pathname;
    const loads: Promise<unknown>[] = [loadDashboard(token)];
    if (path === '/home' || path === '/shift') {
      loads.push(loadShifts(token), loadStaff(token), loadSellers(token));
    }
    if (path === '/sales' || path === '/shift') {
      loads.push(loadSales(token), loadSellers(token), loadProducts(token));
    }
    if (path === '/team') {
      loads.push(loadStoreInventory(token), loadGlobalEmployees(token));
    }
    void Promise.allSettled(loads);
  }, [isDesktopShell, location.pathname, session?.token, session?.user?.role]);

  useLiveSessionRefresh(
    Boolean(session?.token) && !isDesktopShell && session?.user.role === 'ADMIN',
    refreshAdminWebLive,
  );

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    if (!session?.user) {
      return [];
    }
    const r = session.user.role;
    const directorWebTrimmed = !isDesktopShell && r === 'DIRECTOR';
    const retoucher = r === 'RETOUCHER';
    const sellerOnly = r === 'SELLER';
    const financeViewer = r === 'ACCOUNTANT' || r === 'DIRECTOR' || r === 'MANAGER';
    const shiftL = financeViewer ? 'Оперативка' : 'Смена';
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
    ];
    if (!isDesktopShell && financeViewer) {
      base.push({ to: '/finance/expenses', label: 'Расходы', icon: <ExpensesIcon /> });
    }
    if (!directorWebTrimmed) {
      base.push({ to: '/sales', label: 'Продажи', icon: <SalesIcon /> });
    }
    if (r === 'DIRECTOR') {
      base.push(
        { to: '/accounting/equipment', label: 'Спецтехника', icon: <EquipmentIcon /> },
        { to: '/accounting/procurement', label: 'Закупки и склад', icon: <ProcurementIcon /> },
      );
      if (!directorWebTrimmed) {
        base.push({ to: '/payroll', label: 'Выплата зарплат', icon: <PayrollIcon /> });
      }
    }
    if (!directorWebTrimmed && !(offlineStoreMode && r === 'ADMIN')) {
      const teamNavLabel = r === 'ADMIN' ? 'Склад' : 'Сотрудники';
      base.push({ to: '/team', label: teamNavLabel, icon: <WarehouseIcon /> });
    }
    if (r === 'ACCOUNTANT') {
      base.push({ to: '/control', label: 'Отчёт', icon: <ControlIcon /> });
    }
    return base;
  }, [session, isDesktopShell, offlineStoreMode]);

  const desktopNavItems = mobileNavItems;

  if (!session && !offlineStoreMode) {
    const loginVersionLabel = isDesktopShell ? appVersionLabel() : null;
    return (
      <main
        className={`app loginScreen app--desktop${isDesktopShell ? '' : ' app--web'}`}
      >
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
            {API_BASE_URL ? (
              <p className="subtitle loginServerHint">
                Сервер: {apiServerLabel(API_BASE_URL)}
                {import.meta.env.DEV ? ` · ${API_BASE_URL}` : null}
              </p>
            ) : null}
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
        {loginVersionLabel ? (
          <p className="loginAppVersion" role="status">
            {loginVersionLabel}
          </p>
        ) : null}
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const role = session.user.role;
  const isRetoucher = role === 'RETOUCHER';
  const isSellerOnly = role === 'SELLER';
  const isManager = role === 'MANAGER';
  const isReadOnlyObserver = role === 'ACCOUNTANT' || role === 'MANAGER';
  const isFinanceViewer = role === 'ACCOUNTANT' || role === 'DIRECTOR';
  const directorWebTrimmed = !isDesktopShell && role === 'DIRECTOR';
  const shiftLabel = isFinanceViewer || isManager ? 'Оперативка' : 'Смена';
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
                    {dashboardLoading && !homeDashboard ? (
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
                          <div className="homePanelTitleRow">
                            <h3 className="homePanelTitle">{homeDashboard.title}</h3>
                            {homeDashboard.role === 'ADMIN' && session ? (
                              <button
                                type="button"
                                className="ghost homeDayReportBtn"
                                disabled={dayReportBusy}
                                onClick={() => void downloadAdminDayReport(session.token)}
                              >
                                {dayReportBusy ? 'Формируем…' : 'Скачать отчёт за день'}
                              </button>
                            ) : null}
                          </div>
                          {dayReportNotice ? (
                            <p className="notice homeDayReportNotice">{dayReportNotice}</p>
                          ) : null}
                          {homeDashboard.role === 'ADMIN' && opsDayUnlockOpen ? (
                            <form
                              className="opsDayUnlockBar"
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (verifyOpsDayUnlockPin(opsDayUnlockDraft)) {
                                  writeOpsDayUnlock(true);
                                  setOpsDayUnlocked(true);
                                  setOpsDayUnlockOpen(false);
                                  setOpsDayUnlockDraft('');
                                  return;
                                }
                                setOpsDayUnlockDraft('');
                              }}
                            >
                              <input
                                className="opsDayUnlockInput"
                                type="password"
                                autoComplete="off"
                                placeholder="Код"
                                value={opsDayUnlockDraft}
                                onChange={(event) => setOpsDayUnlockDraft(event.target.value)}
                              />
                            </form>
                          ) : null}
                          {homeDashboard.role === 'ADMIN' && opsDayUnlocked ? (
                            <div className="adminViewDayStrip" aria-label="День просмотра">
                              <button
                                type="button"
                                className="ghost adminViewDayNav"
                                onClick={() => {
                                  const prev = new Date(`${adminViewDayKey}T12:00:00`);
                                  prev.setDate(prev.getDate() - 1);
                                  setAdminViewDayKey(calendarDayKeyMoscow(prev.toISOString()));
                                }}
                              >
                                ‹
                              </button>
                              <input
                                className="adminViewDayInput"
                                type="date"
                                value={adminViewDayKey}
                                max={todayKeyMoscow()}
                                onChange={(event) => setAdminViewDayKey(event.target.value)}
                              />
                              <button
                                type="button"
                                className="ghost adminViewDayNav"
                                onClick={() => {
                                  const next = new Date(`${adminViewDayKey}T12:00:00`);
                                  next.setDate(next.getDate() + 1);
                                  const key = calendarDayKeyMoscow(next.toISOString());
                                  if (key <= todayKeyMoscow()) {
                                    setAdminViewDayKey(key);
                                  }
                                }}
                              >
                                ›
                              </button>
                              {offlineStoreMode ? (
                                <button
                                  type="button"
                                  className="ghost adminViewDayExit"
                                  onClick={exitDirectorManagement}
                                >
                                  Выйти
                                </button>
                              ) : null}
                              {offlineStoreMode ? (
                                <label className="adminViewDayStoreName">
                                  <span>Точка</span>
                                  <input
                                    type="text"
                                    defaultValue={storeDisplayName}
                                    onBlur={(event) => {
                                      const trimmed = event.target.value.trim();
                                      if (!trimmed) {
                                        return;
                                      }
                                      const prevName = storeDisplayName;
                                      setOfflineStoreName(trimmed);
                                      if (session) {
                                        void renameOfflineStoreAssignments(
                                          session.user.id,
                                          prevName,
                                          trimmed,
                                        ).then(async () => {
                                          await loadStaff(session.token).catch(() => undefined);
                                          await loadSellers(session.token).catch(() => undefined);
                                        });
                                        const nextSession = {
                                          ...session,
                                          user: { ...session.user, storeName: trimmed },
                                        };
                                        setSession(nextSession);
                                        persistOfflineStoreSession(nextSession);
                                        setDashboard(
                                          buildEmptyDashboardSkeleton(trimmed),
                                        );
                                      }
                                    }}
                                  />
                                </label>
                              ) : null}
                            </div>
                          ) : null}
                          {offlineStoreMode && homeDashboard.role === 'ADMIN' && opsDayUnlocked && session ? (
                            <StoreDirectorConsole
                              sellers={sellers
                                .filter((seller) => seller.storeName === storeDisplayName)
                                .map((seller) => ({
                                  id: seller.id,
                                  fullName: seller.fullName,
                                  nickname: seller.nickname,
                                  ratePercent: seller.ratePercent,
                                }))}
                              managerPercent={readOfflineStoreSettings().managerPercent}
                              hasManager={staff.some(
                                (member) =>
                                  member.isActive &&
                                  member.staffPosition === 'MANAGER' &&
                                  staffAssignedStores(member).includes(storeDisplayName),
                              )}
                              onStoreNameChange={(name) => {
                                if (!session) {
                                  return;
                                }
                                const prevName = storeDisplayName;
                                void renameOfflineStoreAssignments(session.user.id, prevName, name).then(
                                  async () => {
                                    await loadStaff(session.token).catch(() => undefined);
                                    await loadSellers(session.token).catch(() => undefined);
                                  },
                                );
                                const nextSession = {
                                  ...session,
                                  user: { ...session.user, storeName: name },
                                };
                                setSession(nextSession);
                                persistOfflineStoreSession(nextSession);
                                setDashboard(buildEmptyDashboardSkeleton(name));
                              }}
                              onAcquiringChange={() => undefined}
                              onSellerPercentChange={setStoreSellerPercent.bind(null, session.token)}
                              onAddManager={addOfflineManagerStaff.bind(null, session.token)}
                              onExitDirector={exitDirectorManagement}
                            />
                          ) : null}
                          {homeDashboard.role === 'DIRECTOR' && session ? (
                            <DirectorHomeApprovalsCarousel
                              token={session.token}
                              userId={session.user.id}
                              onDecided={() => {
                                void loadDashboard(session.token, { background: true });
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
                                      <dt
                                        className="adminHomeMetricTap"
                                        onClick={() => {
                                          adminMetricTapRef.current += 1;
                                          if (adminMetricTapRef.current >= 5) {
                                            adminMetricTapRef.current = 0;
                                            setOpsDayUnlockOpen((open) => !open);
                                          }
                                        }}
                                      >
                                        Выручка
                                      </dt>
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
                                      <li key={row.staffId}>
                                        <span className="adminSellerRegisterName">
                                          {formatPersonWithNickname(row.fullName, row.nickname)}
                                        </span>
                                        <span className="adminSellerRegisterAmount">{row.cash}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="muted">
                                    {shifts.some((s) => s.status === 'OPEN')
                                      ? 'В открытой смене пока никого нет — добавьте сотрудников в смену.'
                                      : 'Откройте смену и добавьте сотрудников — здесь появятся кассы за сегодня.'}
                                  </p>
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
                    {offlineStoreMode ? null : (
                    <button type="button" className="ghost homeLogoutButton" onClick={handleLogout}>
                      Выйти
                    </button>
                    )}
                  </section>
                </div>
              }
            />
            <Route path="/finance/auto" element={<Navigate to="/shift" replace />} />
            <Route
              path="/finance/expenses"
              element={
                isFinanceViewer && !isDesktopShell ? (
                  <div className="dashboard dashboard--financeDesktop dashboard--financeExpensesWeb">
                    <section className="sectionCard">
                      <div className="financeOpsWebBridge">
                        <FinanceOpsPanel
                          token={session.token}
                          isDirector={role === 'DIRECTOR'}
                          snapshot={financeOps}
                          onAddIncome={addFinanceIncome}
                          onAddExpense={addFinanceExpense}
                          onUpdateIncome={updateFinanceIncome}
                          onUpdateExpense={updateFinanceExpense}
                          onDeleteIncome={deleteFinanceIncome}
                          onDeleteExpense={deleteFinanceExpense}
                          onSetAccountBalance={setFinanceAccountBalance}
                          onSetCategoryAmount={setFinanceExpenseCategoryAmount}
                          preferDesktopLayout={false}
                          webSection="expenses"
                        />
                      </div>
                    </section>
                  </div>
                ) : (
                  <Navigate to="/shift" replace />
                )
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
                        : isFinanceViewer
                          ? ' dashboard--financeDesktop'
                          : ''
                  }`}
                >
                  <section className="sectionCard">
                    {isManager ? null : role === 'ACCOUNTANT' ? (
                      <AccountantStoreEquipmentStoresPanel
                        token={session.token}
                        userId={session.user.id}
                        refreshKey={equipmentRefreshKey}
                      />
                    ) : isFinanceViewer ? (
                      <div className={isDesktopShell ? undefined : 'financeOpsWebBridge'}>
                        <FinanceOpsPanel
                          token={session.token}
                          isDirector={role === 'DIRECTOR'}
                          snapshot={financeOps}
                          onAddIncome={addFinanceIncome}
                          onAddExpense={addFinanceExpense}
                          onUpdateIncome={updateFinanceIncome}
                          onUpdateExpense={updateFinanceExpense}
                          onDeleteIncome={deleteFinanceIncome}
                          onDeleteExpense={deleteFinanceExpense}
                          onSetAccountBalance={setFinanceAccountBalance}
                          onSetCategoryAmount={setFinanceExpenseCategoryAmount}
                          preferDesktopLayout={isDesktopShell}
                          webSection={!isDesktopShell ? 'ops' : undefined}
                        />
                      </div>
                    ) : (
                      <>
                        <ShiftPanel
                          token={session.token}
                          staff={staff}
                          shifts={shifts}
                          role={role}
                          storeName={role === 'ADMIN' ? session.user.storeName : undefined}
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
                          storeName={role === 'ADMIN' ? storeDisplayName : undefined}
                          readOnly={isReadOnlyObserver}
                          onAdd={addStaffMember}
                          onAddFromBase={addStaffFromBase}
                          onRemoveFromStore={removeStaffFromStore}
                          onDirectorSetPercent={
                            offlineStoreMode && opsDayUnlocked
                              ? setStoreSellerPercent
                              : setDirectorPercent
                          }
                          hideFromBase={offlineStoreMode}
                          storeDirectorEdit={offlineStoreMode && opsDayUnlocked}
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
                            storeName={storeDisplayName}
                            readOnly={isReadOnlyObserver}
                            onAdd={addStaffMember}
                            onAddFromBase={addStaffFromBase}
                            onRemoveFromStore={removeStaffFromStore}
                            onDirectorSetPercent={
                              offlineStoreMode && opsDayUnlocked
                                ? setStoreSellerPercent
                                : setDirectorPercent
                            }
                            hideFromBase={offlineStoreMode}
                            storeDirectorEdit={offlineStoreMode && opsDayUnlocked}
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
                ) : directorWebTrimmed ? (
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
                                sellers={sellersOnOpenShift(staff, sellers, shifts)}
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
                            acquiringProfiles={acquiringProfiles}
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
                              onResetWarehouse={resetWarehouseStock}
                              onSaveProcurementCosts={saveProductProcurementCosts}
                              onAddProduct={addCatalogProduct}
                              onRenameProduct={renameCatalogProduct}
                              onDeleteProduct={deleteCatalogProduct}
                              webMobileLayout={!isDesktopShell}
                            />
                          </section>
                          <section className="sectionCard sectionCard--acquiring">
                            <AccountantProcurementPanel
                              token={session.token}
                              profiles={acquiringProfiles}
                              onProfilesChange={setAcquiringProfiles}
                              onSaveProfiles={saveAcquiringProfiles}
                              webMobileLayout={!isDesktopShell}
                            />
                          </section>
                        </>
                      )
                    ) : (
                      <>
                        <section className="sectionCard sectionCard--salesLog">
                          <div className={`salesLog${isDesktopShell ? ' salesLog--desktop' : ''}`}>
                            {salesNotice ? <p className="notice saleRequestNotice">{salesNotice}</p> : null}
                            {!isReadOnlyObserver ? (
                              <SalesBySellerStrip
                                sales={todayStoreSales}
                                sellers={sellers}
                                shiftSellers={sellersOnOpenShift(staff, sellers, shifts)}
                                storeName={session.user.storeName}
                              />
                            ) : null}
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
                                        {sellerLabelFromProfiles(sellers, sale.sellerId, sale.sellerName)}
                                        {sale.pendingSync ? (
                                          <span className="salePendingBadge"> нет сети · отправится позже</span>
                                        ) : null}
                                        {role === 'ADMIN' ? (
                                          paymentEditSaleId === sale.id ? (
                                            <span
                                              className="salePayEdit"
                                              role="group"
                                              aria-label="Вид оплаты"
                                            >
                                              {(
                                                ['CASH', 'NON_CASH', 'TRANSFER'] as const
                                              ).map((pt) => (
                                                <button
                                                  key={pt}
                                                  type="button"
                                                  className={`salePayEditBtn ${
                                                    (sale.paymentType ?? 'CASH') === pt
                                                      ? 'salePayEditBtnActive'
                                                      : ''
                                                  }`}
                                                  disabled={paymentEditBusy}
                                                  onClick={() => {
                                                    if ((sale.paymentType ?? 'CASH') === pt) {
                                                      setPaymentEditSaleId(null);
                                                      return;
                                                    }
                                                    void (async () => {
                                                      setPaymentEditBusy(true);
                                                      try {
                                                        await updateSalePaymentType(
                                                          session.token,
                                                          sale.id,
                                                          pt,
                                                          Boolean(sale.pendingSync),
                                                        );
                                                      } catch (e) {
                                                        setSalesNotice(
                                                          e instanceof Error
                                                            ? e.message
                                                            : 'Не удалось изменить оплату',
                                                        );
                                                      } finally {
                                                        setPaymentEditBusy(false);
                                                      }
                                                    })();
                                                  }}
                                                >
                                                  {salePaymentLabel(pt)}
                                                </button>
                                              ))}
                                              <button
                                                type="button"
                                                className="salePayEditClose"
                                                aria-label="Закрыть"
                                                disabled={paymentEditBusy}
                                                onClick={() => setPaymentEditSaleId(null)}
                                              >
                                                ×
                                              </button>
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              className="salePay salePayBtn"
                                              title="Изменить вид оплаты"
                                              onClick={() => setPaymentEditSaleId(sale.id)}
                                            >
                                              {salePaymentLabel(sale.paymentType)}
                                            </button>
                                          )
                                        ) : (
                                          <span className="salePay">
                                            {salePaymentLabel(sale.paymentType)}
                                          </span>
                                        )}
                                        <span className="saleHeaderTrailing">
                                          {role === 'ADMIN' ? (
                                            <button
                                              type="button"
                                              className="saleDeleteBtn"
                                              title="Удалить продажу"
                                              aria-label="Удалить продажу"
                                              onClick={() => {
                                                setSalesNotice('');
                                                setSaleDeleteReason('');
                                                setSaleDeleteTarget({
                                                  id: sale.id,
                                                  pendingSync: Boolean(sale.pendingSync),
                                                  sellerName: sale.sellerName,
                                                  amount: sale.totalAmount,
                                                });
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
                                      {saleDeleteTarget?.id === sale.id ? (
                                        <form
                                          className="offlineSaleDeleteBar"
                                          onSubmit={(event) => {
                                            event.preventDefault();
                                            setSaleDeleteBusy(true);
                                            void submitSaleDeleteWithReason(sale, saleDeleteReason)
                                              .catch((err) => {
                                                setSalesNotice(
                                                  err instanceof Error
                                                    ? err.message
                                                    : 'Не удалось удалить продажу',
                                                );
                                              })
                                              .finally(() => {
                                                setSaleDeleteBusy(false);
                                                setSaleDeleteTarget(null);
                                                setSaleDeleteReason('');
                                              });
                                          }}
                                        >
                                          <p className="offlineSaleDeleteBarHint">
                                            {sale.pendingSync
                                              ? 'Продажа ещё не на сервере. Укажите причину удаления.'
                                              : 'Укажите причину удаления продажи.'}
                                          </p>
                                          <div className="offlineSaleDeleteBarRow">
                                            <input
                                              className="offlineSaleDeleteBarInput"
                                              type="text"
                                              autoComplete="off"
                                              autoFocus
                                              placeholder="Причина удаления"
                                              value={saleDeleteReason}
                                              disabled={saleDeleteBusy}
                                              onChange={(event) => setSaleDeleteReason(event.target.value)}
                                            />
                                            <button
                                              type="submit"
                                              className="primaryAction offlineSaleDeleteBarConfirm"
                                              disabled={saleDeleteBusy || saleDeleteReason.trim().length < 3}
                                            >
                                              {saleDeleteBusy ? '…' : 'Удалить'}
                                            </button>
                                            <button
                                              type="button"
                                              className="ghost offlineSaleDeleteBarCancel"
                                              disabled={saleDeleteBusy}
                                              onClick={() => {
                                                setSaleDeleteTarget(null);
                                                setSaleDeleteReason('');
                                              }}
                                            >
                                              Отмена
                                            </button>
                                          </div>
                                        </form>
                                      ) : null}
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
                      <AccountantStoreEquipmentStoresPanel
                        token={session.token}
                        userId={session.user.id}
                        refreshKey={equipmentRefreshKey}
                      />
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
                          await Promise.all([
                            loadInventoryOverview(session.token),
                            loadProducts(session.token),
                            loadAcquiringProfiles(session.token),
                          ]);
                        }}
                        onReplenish={replenishWarehouse}
                        onResetWarehouse={resetWarehouseStock}
                        onSaveProcurementCosts={saveProductProcurementCosts}
                        onAddProduct={addCatalogProduct}
                        onRenameProduct={renameCatalogProduct}
                        onDeleteProduct={deleteCatalogProduct}
                        webMobileLayout={!isDesktopShell}
                        bottomAside={
                          <AccountantProcurementPanel
                            layout="vertical"
                            token={session.token}
                            profiles={acquiringProfiles}
                            onProfilesChange={setAcquiringProfiles}
                            onSaveProfiles={saveAcquiringProfiles}
                          />
                        }
                      />
                    </section>
                  </div>
                )
              }
            />
            <Route
              path="/payroll"
              element={
                role === 'DIRECTOR' && isDesktopShell ? (
                  <div
                    className={`dashboard teamPage${
                      isDesktopShell ? ' dashboard--warehouseDesktop' : ''
                    }`}
                  >
                    <section
                      className={
                        isDesktopShell
                          ? 'teamPanelCard teamPanelCard--warehouseDesktop'
                          : 'sectionCard teamPanelCard'
                      }
                    >
                      <TeamStoresOverview
                        token={session.token}
                        staff={staff}
                        sellers={sellers}
                        sales={salesMerged}
                        shifts={shifts}
                        role={role}
                        managerStoreCommissions={managerStoreCommissions}
                        managerCommissionsApiOnline={managerCommissionsApiOnline}
                        onSaveManagerStoreCommissions={saveManagerStoreCommissions}
                        onReloadManagerCommissions={async () => {
                          await loadManagerStoreCommissions(session.token);
                        }}
                        onDirectorSetPercent={setDirectorPercent}
                        onRemoveFromStore={removeStaffFromStore}
                        onRestoreStaffToStore={restoreStaffToStore}
                        reportDayKey={teamDayKey}
                        onReportDayKeyChange={setTeamDayKey}
                        hideRemovedStaff
                        readOnlyTeamActions
                        payrollView
                        panelTitle="Выплата зарплат"
                      />
                    </section>
                  </div>
                ) : (
                  <Navigate to="/home" replace />
                )
              }
            />
            <Route
              path="/team"
              element={
                offlineStoreMode && role === 'ADMIN' ? (
                  <Navigate to="/home" replace />
                ) : isSellerOnly ? (
                  <Navigate to="/home" replace />
                ) : directorWebTrimmed ? (
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
                          managerStoreCommissions={managerStoreCommissions}
                          managerCommissionsApiOnline={managerCommissionsApiOnline}
                          onSaveManagerStoreCommissions={saveManagerStoreCommissions}
                          onReloadManagerCommissions={async () => {
                            await loadManagerStoreCommissions(session.token);
                          }}
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
                ) : role === 'ACCOUNTANT' ? (
                  <div className="dashboard">
                    <section className="sectionCard">
                      <FinanceReportPanel
                        token={session.token}
                        sales={salesMerged}
                        sellers={sellers}
                        procurementCosts={productProcurementCosts}
                        role={role}
                        acquiringProfiles={acquiringProfiles}
                        onRefreshFinanceInputs={refreshFinanceInputs}
                        onLoadPlans={loadRevenuePlans}
                        onSavePlans={saveRevenuePlans}
                      />
                    </section>
                  </div>
                ) : (
                  <Navigate to="/home" replace />
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
            navItems={desktopNavItems}
            userLabel={offlineStoreMode ? storeDisplayName : session.user.nickname}
            roleLabel={desktopRoleLabel}
            onLogout={handleLogout}
            hideLogout={offlineStoreMode}
            hideConnectionStatus={offlineStoreMode}
            syncToolbar={
              offlineStoreMode ? null : (
              <DesktopSyncToolbar
                online={desktopConnection.online}
                syncing={desktopConnection.syncing}
                pendingCount={outboxPendingCount}
                onSync={runDesktopManualSync}
              />
              )
            }
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

  const webNavLinks = (
    <>
      <NavLink to="/home" className={navTabClass} end>
        Главная
      </NavLink>
      {!isRetoucher && (
        <NavLink to="/shift" className={navTabClass}>
          {shiftLabel}
        </NavLink>
      )}
      {!isDesktopShell && isFinanceViewer ? (
        <NavLink to="/finance/expenses" className={navTabClass}>
          Расходы
        </NavLink>
      ) : null}
      {!isRetoucher && !isSellerOnly && (
        <>
          {!directorWebTrimmed ? (
            <NavLink to="/sales" className={navTabClass}>
              Продажи
            </NavLink>
          ) : null}
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
          {!directorWebTrimmed ? (
            <NavLink to="/team" className={navTabClass}>
              {role === 'ADMIN' ? 'Склад' : 'Сотрудники'}
            </NavLink>
          ) : null}
          {role === 'ACCOUNTANT' ? (
            <NavLink to="/control" className={navTabClass}>
              Отчёт
            </NavLink>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <main className={`app appWorkspace app--desktop${isDesktopShell ? '' : ' app--web'}`}>
      {!isDesktopShell ? (
        <>
          <header className="webIosTopBar">
            <h1 className="webIosTopBarBrand">Фотографы</h1>
            <button type="button" className="webIosTopBarLogout" onClick={handleLogout}>
              Выйти
            </button>
          </header>
          <header className="webAppHeader">
            <div className="webAppHeaderRow">
              <h1 className="webIosTopBarBrand">Фотографы</h1>
              <button type="button" className="webIosTopBarLogout" onClick={handleLogout}>
                Выйти
              </button>
            </div>
            <div className="quickNav desktopNav webAppHeaderTabs" role="tablist" aria-label="Разделы">
              {webNavLinks}
            </div>
          </header>
        </>
      ) : null}
      <section className="card cardWorkspace">
        {adminError ? <p className="error">{adminError}</p> : null}

        {routesOutlet}
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

function formatSaleItemsLine(items: Array<{ name: string; qty: number }>): string {
  if (items.length === 0) {
    return 'Без позиций';
  }
  return items.map((item) => `${item.name} × ${item.qty}`).join(' · ');
}

function salePaymentToneClass(paymentType?: AddSalePaymentType): string {
  if (paymentType === 'NON_CASH') {
    return 'salesBySellerPay--card';
  }
  if (paymentType === 'TRANSFER') {
    return 'salesBySellerPay--transfer';
  }
  return 'salesBySellerPay--cash';
}

function SalesBySellerStrip({
  sales,
  sellers,
  shiftSellers,
  storeName,
}: {
  sales: AdminSale[];
  sellers: SellerProfile[];
  shiftSellers: SellerProfile[];
  storeName: string;
}) {
  const groups = useMemo(() => {
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
    const bySeller = new Map<number, AdminSale[]>();
    for (const sale of sortSalesByCreatedAtDesc(sales)) {
      const bucket = bySeller.get(sale.sellerId) ?? [];
      bucket.push(sale);
      bySeller.set(sale.sellerId, bucket);
    }

    const orderedSellerIds: number[] = [];
    for (const seller of shiftSellers) {
      if (!orderedSellerIds.includes(seller.id)) {
        orderedSellerIds.push(seller.id);
      }
    }
    const extraSellerIds = [...bySeller.keys()]
      .filter((id) => !orderedSellerIds.includes(id))
      .sort((a, b) => {
        const totalA = (bySeller.get(a) ?? []).reduce((sum, sale) => sum + sale.totalAmount, 0);
        const totalB = (bySeller.get(b) ?? []).reduce((sum, sale) => sum + sale.totalAmount, 0);
        return totalB - totalA;
      });
    orderedSellerIds.push(...extraSellerIds);

    return orderedSellerIds.map((sellerId) => {
      const profile =
        sellerById.get(sellerId) ?? shiftSellers.find((seller) => seller.id === sellerId);
      const sellerSales = sortSalesByCreatedAtDesc(bySeller.get(sellerId) ?? []);
      const total = Math.round(sellerSales.reduce((sum, sale) => sum + sale.totalAmount, 0));
      return {
        sellerId,
        label: profile
          ? sellerLabelFromProfiles(sellers, sellerId, profile.fullName)
          : sellerSales[0]?.sellerName ?? 'Сотрудник',
        sales: sellerSales,
        total,
        count: sellerSales.length,
      };
    });
  }, [sales, sellers, shiftSellers]);

  if (groups.length === 0) {
    return (
      <section className="salesBySellerStrip" aria-label="Продажи по сотрудникам за сегодня">
        <div className="salesBySellerStripHead">
          <h4 className="salesBySellerStripTitle">По сотрудникам · {storeName}</h4>
          <p className="salesBySellerStripHint muted">Смена закрыта или продавцы не назначены</p>
        </div>
      </section>
    );
  }

  return (
    <section className="salesBySellerStrip" aria-label="Продажи по сотрудникам за сегодня">
      <div className="salesBySellerStripHead">
        <h4 className="salesBySellerStripTitle">По сотрудникам · сегодня</h4>
        <p className="salesBySellerStripHint">
          {shiftSellers.length > 0
            ? 'Карточка на каждого продавца в смене: время, оплата, сумма и товары'
            : 'Продавцы с продажами за сегодня'}
        </p>
      </div>
      <div className="salesBySellerTrack" role="list">
        {groups.map((group) => (
          <article key={group.sellerId} className="salesBySellerCard" role="listitem">
            <header className="salesBySellerCardHead">
              <strong className="salesBySellerCardName" title={group.label}>
                {group.label}
              </strong>
              <p className="salesBySellerCardSummary">
                <span>{group.count > 0 ? `${group.count} продаж` : 'Без продаж'}</span>
                <span className="salesBySellerCardSummarySep" aria-hidden>
                  ·
                </span>
                <span className="salesBySellerCardTotal">{formatRub(group.total)}</span>
              </p>
            </header>
            {group.sales.length === 0 ? (
              <p className="salesBySellerCardEmpty muted">Пока ничего не продал</p>
            ) : (
              <ul className="salesBySellerSaleList">
                {group.sales.map((sale) => (
                  <li
                    key={sale.id}
                    className={`salesBySellerSaleRow${sale.pendingSync ? ' salesBySellerSaleRow--pending' : ''}`}
                  >
                    <div className="salesBySellerSaleTop">
                      <time dateTime={sale.createdAt}>
                        {new Date(sale.createdAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </time>
                      <span
                        className={`salesBySellerPay ${salePaymentToneClass(sale.paymentType)}`}
                      >
                        {salePaymentLabel(sale.paymentType)}
                      </span>
                      <strong className="salesBySellerSaleAmount">
                        {formatRub(sale.totalAmount)}
                      </strong>
                    </div>
                    <p className="salesBySellerSaleItems" title={formatSaleItemsLine(sale.items)}>
                      {formatSaleItemsLine(sale.items)}
                    </p>
                    {sale.pendingSync ? (
                      <span className="salesBySellerSalePending">Офлайн · отправится позже</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
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
    const fetcher = async () => {
      const response = await fetch(`${API_BASE_URL}/director/control-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('control requests error');
      }
      return (await response.json()) as DirectorControlRequest[];
    };
    const applyItems = (rows: DirectorControlRequest[]) =>
      rows.filter((row) => row.kind === 'WRITE_OFF');
    if (userId !== undefined) {
      const result = await loadSyncResource(
        API_BASE_URL,
        userId,
        'controlRequests',
        fetcher,
        [],
        { onFresh: (data) => setItems(applyItems(data)) },
      );
      setItems(applyItems(result.data));
      return;
    }
    try {
      setItems(applyItems(await fetcher()));
    } catch {
      /* keep cached items */
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void load();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
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
      if (userId !== undefined) {
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
      <p className="directorApprovalsCarouselKind">Списание товара</p>
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
  const [rows, setRows] = useState<Row[]>(() => readDirectorDemoAccountsCache() ?? []);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(() => readDirectorDemoAccountsCache() === null);
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
      writeDirectorDemoAccountsCache(data);
      setIdx((i) => (data.length === 0 ? 0 : Math.min(i, data.length - 1)));
    } catch {
      const cached = readDirectorDemoAccountsCache();
      if (cached?.length) {
        setRows(cached);
        setIdx((i) => Math.min(i, cached.length - 1));
      } else {
        setErr('Не удалось загрузить учётные записи');
      }
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
    if (pwd.length < 8) {
      setErr('Новый пароль: минимум 8 символов');
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
      if (userId !== undefined) {
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
            <div className="directorDemoAccountsMobile">
              {total > 1 ? (
                <div
                  className="directorDemoAccountsPicker"
                  role="tablist"
                  aria-label="Учётные записи"
                >
                  {rows.map((row, i) => (
                    <button
                      key={row.nickname}
                      type="button"
                      role="tab"
                      aria-selected={i === idx}
                      className={`directorDemoAccountsPickerChip${i === idx ? ' directorDemoAccountsPickerChip--active' : ''}`}
                      onClick={() => {
                        setIdx(i);
                        setErr('');
                        setHint('');
                        setDraftPwd('');
                      }}
                    >
                      <span className="directorDemoAccountsPickerNick">{row.nickname}</span>
                      <span className="directorDemoAccountsPickerRole">{directorDemoRoleLabel(row.role)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
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
function parseFinanceMoneyInput(raw: string): number | null {
  const n = Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.round(n * 100) / 100;
}

function financeExpenseInsufficientMessage(
  account: FinanceAccount | undefined,
  amount: number,
): string | null {
  if (!account) {
    return 'Выберите счёт';
  }
  const balance = Math.round(account.balance * 100) / 100;
  if (Math.round(balance * 100) < Math.round(amount * 100)) {
    return `Недостаточно средств на «${account.name?.trim() || 'Счёт'}». Доступно: ${balance.toLocaleString('ru-RU')} ₽`;
  }
  return null;
}

const FINANCE_OPS_PRIMARY_ACCOUNT_IDS = [
  'fa-bank-extra',
  'fa-bank-main',
  'fa-bank-putintsev-sber',
  'fa-bank-lyokha',
  'fa-transfer',
  'fa-cash-main',
] as const;

function financeAccountToneClass(accountId: string): string {
  const key = accountId.replace(/^auto-/, '');
  const known = FINANCE_OPS_PRIMARY_ACCOUNT_IDS as readonly string[];
  return known.includes(key) ? `financeOpsAccountTone--${key}` : 'financeOpsAccountTone--default';
}

function FinanceSensitiveAmount({
  visible,
  value,
  format,
  className,
}: {
  visible: boolean;
  value: number;
  format: (amount: number) => string;
  className?: string;
}) {
  return (
    <span
      className={`financeOpsSensitiveAmount${visible ? '' : ' financeOpsSensitiveAmount--hidden'}${className ? ` ${className}` : ''}`}
      aria-label={visible ? format(value) : 'Сумма скрыта'}
    >
      {visible ? format(value) : '••••••'}
    </span>
  );
}

function FinanceSensitiveToggleButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="financeOpsSensitiveToggle"
      aria-pressed={visible}
      aria-label={visible ? 'Скрыть суммы' : 'Показать суммы'}
      title={visible ? 'Скрыть суммы' : 'Показать суммы'}
      onClick={onToggle}
    >
      {visible ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            fill="currentColor"
            d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            fill="currentColor"
            d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
          />
        </svg>
      )}
    </button>
  );
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

const FINANCE_EXPENSE_DEFAULT_CATEGORY: (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number] = 'ЗП';

function financeStoreNameFromComment(comment?: string): string {
  const value = comment?.trim() ?? '';
  return (ALL_DEMO_STORE_NAMES as readonly string[]).includes(value)
    ? value
    : ALL_DEMO_STORE_NAMES[0];
}

function financeRecordTimeMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sortFinanceIncomesDesc<T extends { workDay: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byDay = b.workDay.localeCompare(a.workDay);
    if (byDay !== 0) {
      return byDay;
    }
    return financeRecordTimeMs(b.createdAt) - financeRecordTimeMs(a.createdAt);
  });
}

function sortFinanceExpensesDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => financeRecordTimeMs(b.createdAt) - financeRecordTimeMs(a.createdAt),
  );
}

const FINANCE_HISTORY_MONTH_LABELS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

function financeHistoryDayKeyFromIso(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function financeHistoryYesterdayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 86_400_000));
}

function financeHistoryWeekStartKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 6 * 86_400_000));
}

function isFinanceHistoryDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function FinanceHistoryStoreFilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="financeOpsHistoryFilterIconSvg" aria-hidden>
      <path
        d="M5 9.5h14v9H5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 9.5V7.8c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8.8 1.8 1.8V9.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function FinanceHistoryAccountFilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="financeOpsHistoryFilterIconSvg" aria-hidden>
      <rect x="4.5" y="7" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 10.5h15" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 14.2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FinanceHistoryDateFilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="financeOpsHistoryFilterIconSvg" aria-hidden>
      <rect x="4.5" y="6" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4.8v3.2M16 4.8v3.2M4.5 10h15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.2 13.8h2.4M13.4 13.8h2.4M8.2 16.8h2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function formatFinanceHistoryDayLabel(dayKey: string): string {
  const today = todayKeyMoscow();
  const yesterday = financeHistoryYesterdayKey();
  if (dayKey === today) {
    return 'Сегодня';
  }
  if (dayKey === yesterday) {
    return 'Вчера';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!match) {
    return dayKey;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
  const monthLabel = FINANCE_HISTORY_MONTH_LABELS[month - 1] ?? match[2];
  return `${day} ${monthLabel} ${year}, ${weekday}`;
}

type FinanceHistoryListRow = {
  id: string;
  dayKey: string;
  accountId: string;
  accountName: string;
  amount: number;
  comment?: string;
  timeLabel: string;
  title?: string;
  workDay?: string;
};

function financeHistoryStoreLabel(row: FinanceHistoryListRow, kind: 'expense' | 'income'): string | null {
  const comment = row.comment?.trim() ?? '';
  if (!comment) {
    return null;
  }
  if (kind === 'income') {
    return comment;
  }
  if (row.title?.trim() === 'ЗП') {
    return comment;
  }
  return null;
}

function filterFinanceHistoryRows(
  rows: FinanceHistoryListRow[],
  kind: 'expense' | 'income',
  storeFilter: string,
  accountFilter: string,
  dateFilter: string,
): FinanceHistoryListRow[] {
  let result = rows;
  if (storeFilter) {
    result = result.filter((row) => financeHistoryStoreLabel(row, kind) === storeFilter);
  }
  if (accountFilter) {
    result = result.filter((row) => row.accountId === accountFilter);
  }
  if (dateFilter) {
    const today = todayKeyMoscow();
    const yesterday = financeHistoryYesterdayKey();
    const weekStart = financeHistoryWeekStartKey();
    if (dateFilter === 'today') {
      result = result.filter((row) => row.dayKey === today);
    } else if (dateFilter === 'yesterday') {
      result = result.filter((row) => row.dayKey === yesterday);
    } else if (dateFilter === 'week') {
      result = result.filter((row) => row.dayKey >= weekStart && row.dayKey <= today);
    } else if (isFinanceHistoryDayKey(dateFilter)) {
      result = result.filter((row) => row.dayKey === dateFilter);
    }
  }
  return result;
}

function financeHistoryAccountFilterOptions(accounts: FinanceAccount[]): FinanceAccount[] {
  const primaryIds = FINANCE_OPS_PRIMARY_ACCOUNT_IDS as readonly string[];
  const primaryIdSet = new Set<string>(primaryIds);
  const primary = primaryIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account): account is FinanceAccount => Boolean(account));
  const rest = accounts.filter((account) => !primaryIdSet.has(account.id));
  return [...primary, ...rest];
}

function groupFinanceHistoryByDay(rows: FinanceHistoryListRow[]) {
  const groups: Array<{ dayKey: string; rows: FinanceHistoryListRow[] }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.dayKey !== row.dayKey) {
      groups.push({ dayKey: row.dayKey, rows: [row] });
    } else {
      last.rows.push(row);
    }
  }
  return groups;
}

function FinanceOpsHistoryList({
  title,
  emptyLabel,
  rows,
  kind,
  accounts,
  expenseCategories,
  canEdit,
  busyId,
  onEditExpense,
  onEditIncome,
  onDeleteExpense,
  onDeleteIncome,
  pageLayout = false,
}: {
  title: string;
  emptyLabel: string;
  rows: FinanceHistoryListRow[];
  kind: 'expense' | 'income';
  accounts: FinanceAccount[];
  expenseCategories?: readonly string[];
  canEdit: boolean;
  busyId: string;
  pageLayout?: boolean;
  onEditExpense?: (
    id: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => Promise<void>;
  onEditIncome?: (
    id: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => Promise<void>;
  onDeleteExpense?: (id: string) => Promise<void>;
  onDeleteIncome?: (id: string) => Promise<void>;
}) {
  const fmt = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;
  const [storeFilter, setStoreFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [openFilter, setOpenFilter] = useState<'store' | 'account' | 'date' | null>(null);
  const accountFilterOptions = useMemo(
    () => financeHistoryAccountFilterOptions(accounts),
    [accounts],
  );
  const filteredRows = useMemo(
    () => filterFinanceHistoryRows(rows, kind, storeFilter, accountFilter, dateFilter),
    [rows, kind, storeFilter, accountFilter, dateFilter],
  );
  const groups = useMemo(() => groupFinanceHistoryByDay(filteredRows), [filteredRows]);
  const hasActiveFilters = Boolean(storeFilter || accountFilter || dateFilter);
  const customDateValue = isFinanceHistoryDayKey(dateFilter) ? dateFilter : '';

  const toggleFilterPanel = (panel: 'store' | 'account' | 'date') => {
    setOpenFilter((current) => (current === panel ? null : panel));
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editComment, setEditComment] = useState('');
  const [editStore, setEditStore] = useState<string>(ALL_DEMO_STORE_NAMES[0]);
  const [editTitle, setEditTitle] = useState('');
  const [editWorkDay, setEditWorkDay] = useState('');
  const [editError, setEditError] = useState('');

  const startEdit = (row: FinanceHistoryListRow) => {
    setEditingId(row.id);
    setEditAccountId(row.accountId);
    setEditAmount(String(row.amount));
    const title = row.title ?? FINANCE_EXPENSE_DEFAULT_CATEGORY;
    setEditTitle(title);
    if (kind === 'income') {
      setEditStore(financeStoreNameFromComment(row.comment));
      setEditComment('');
    } else if (title === 'ЗП') {
      setEditStore(financeStoreNameFromComment(row.comment));
      setEditComment('');
    } else {
      setEditComment(row.comment ?? '');
      setEditStore(ALL_DEMO_STORE_NAMES[0]);
    }
    setEditWorkDay(row.workDay ?? row.dayKey);
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingId) {
      return;
    }
    setEditError('');
    try {
      if (kind === 'expense' && onEditExpense) {
        const expenseComment =
          editTitle === 'ЗП' ? editStore.trim() : editComment.trim() || undefined;
        if (editTitle === 'ЗП' && !expenseComment) {
          throw new Error('Выберите магазин');
        }
        await onEditExpense(editingId, {
          accountId: editAccountId,
          title: editTitle,
          amount: editAmount,
          comment: expenseComment || undefined,
        });
      } else if (kind === 'income' && onEditIncome) {
        const incomePoint = editStore.trim();
        if (!incomePoint) {
          throw new Error('Выберите точку прихода');
        }
        await onEditIncome(editingId, {
          accountId: editAccountId,
          amount: editAmount,
          workDay: editWorkDay,
          comment: incomePoint,
        });
      }
      setEditingId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setEditError(message || 'Не удалось сохранить изменения');
    }
  };

  const deleteEdit = async () => {
    if (!editingId) {
      return;
    }
    const label = kind === 'income' ? 'приход' : 'расход';
    if (!window.confirm(`Удалить этот ${label}? Сумма на счёте будет пересчитана.`)) {
      return;
    }
    setEditError('');
    try {
      if (kind === 'expense' && onDeleteExpense) {
        await onDeleteExpense(editingId);
      } else if (kind === 'income' && onDeleteIncome) {
        await onDeleteIncome(editingId);
      }
      setEditingId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setEditError(message || 'Не удалось удалить запись');
    }
  };

  return (
    <div
      className={`financeOpsHistoryMini financeOpsHistoryMini--${kind}${
        pageLayout ? ' financeOpsHistoryMini--page' : ''
      }`}
    >
      <div className="financeOpsHistoryMiniHead">
        <p className="financeOpsHistoryMiniTitle">{title}</p>
        <div className="financeOpsHistoryFilters">
          {pageLayout ? (
            <>
              <div className="financeOpsHistoryFilterIconRow" role="toolbar" aria-label="Фильтры истории">
                <button
                  type="button"
                  className={`financeOpsHistoryFilterIconBtn${
                    openFilter === 'store' || storeFilter ? ' financeOpsHistoryFilterIconBtn--active' : ''
                  }`}
                  aria-label="Фильтр по магазину"
                  aria-pressed={openFilter === 'store' || Boolean(storeFilter)}
                  onClick={() => toggleFilterPanel('store')}
                >
                  <FinanceHistoryStoreFilterIcon />
                </button>
                <button
                  type="button"
                  className={`financeOpsHistoryFilterIconBtn${
                    openFilter === 'account' || accountFilter ? ' financeOpsHistoryFilterIconBtn--active' : ''
                  }`}
                  aria-label="Фильтр по виду расчёта"
                  aria-pressed={openFilter === 'account' || Boolean(accountFilter)}
                  onClick={() => toggleFilterPanel('account')}
                >
                  <FinanceHistoryAccountFilterIcon />
                </button>
                <button
                  type="button"
                  className={`financeOpsHistoryFilterIconBtn${
                    openFilter === 'date' || dateFilter ? ' financeOpsHistoryFilterIconBtn--active' : ''
                  }`}
                  aria-label="Фильтр по дате"
                  aria-pressed={openFilter === 'date' || Boolean(dateFilter)}
                  onClick={() => toggleFilterPanel('date')}
                >
                  <FinanceHistoryDateFilterIcon />
                </button>
              </div>
              {openFilter === 'store' ? (
                <div className="financeOpsHistoryFilterChips" role="group" aria-label="Магазин">
                  <button
                    type="button"
                    className={`financeOpsHistoryFilterChip${storeFilter === '' ? ' financeOpsHistoryFilterChip--active' : ''}`}
                    onClick={() => {
                      setStoreFilter('');
                      setOpenFilter(null);
                    }}
                  >
                    Все
                  </button>
                  {ALL_DEMO_STORE_NAMES.map((storeName) => (
                    <button
                      key={storeName}
                      type="button"
                      className={`financeOpsHistoryFilterChip${storeFilter === storeName ? ' financeOpsHistoryFilterChip--active' : ''}`}
                      onClick={() => {
                        setStoreFilter(storeName);
                        setOpenFilter(null);
                      }}
                    >
                      {storeName}
                    </button>
                  ))}
                </div>
              ) : null}
              {openFilter === 'account' ? (
                <div className="financeOpsHistoryFilterChips" role="group" aria-label="Вид расчёта">
                  <button
                    type="button"
                    className={`financeOpsHistoryFilterChip${accountFilter === '' ? ' financeOpsHistoryFilterChip--active' : ''}`}
                    onClick={() => {
                      setAccountFilter('');
                      setOpenFilter(null);
                    }}
                  >
                    Все
                  </button>
                  {accountFilterOptions.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={`financeOpsHistoryFilterChip financeOpsHistoryFilterChip--account ${financeAccountToneClass(account.id)}${
                        accountFilter === account.id ? ' financeOpsHistoryFilterChip--active' : ''
                      }`}
                      onClick={() => {
                        setAccountFilter(account.id);
                        setOpenFilter(null);
                      }}
                    >
                      {account.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {openFilter === 'date' ? (
                <div className="financeOpsHistoryFilterChips financeOpsHistoryFilterChips--date" role="group" aria-label="Дата">
                  {[
                    { value: '', label: 'Все' },
                    { value: 'today', label: 'Сегодня' },
                    { value: 'yesterday', label: 'Вчера' },
                    { value: 'week', label: '7 дней' },
                  ].map((preset) => (
                    <button
                      key={preset.value || 'all'}
                      type="button"
                      className={`financeOpsHistoryFilterChip${
                        dateFilter === preset.value ? ' financeOpsHistoryFilterChip--active' : ''
                      }`}
                      onClick={() => {
                        setDateFilter(preset.value);
                        setOpenFilter(null);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <label className="financeOpsHistoryFilterDateInline">
                    <span className="financeOpsHistoryFilterDateInlineLabel">Дата</span>
                    <input
                      className="financeOpsHistoryFilterPanelDate"
                      type="date"
                      value={customDateValue}
                      max={todayKeyMoscow()}
                      onChange={(event) => {
                        setDateFilter(event.target.value);
                        setOpenFilter(null);
                      }}
                      aria-label={`Конкретная дата: ${title}`}
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="financeOpsHistoryStoreFilter">
                <span className="financeOpsHistoryStoreFilterLabel">Магазин</span>
                <select
                  value={storeFilter}
                  onChange={(event) => setStoreFilter(event.target.value)}
                  aria-label={`Фильтр по магазину: ${title}`}
                >
                  <option value="">Все магазины</option>
                  {ALL_DEMO_STORE_NAMES.map((storeName) => (
                    <option key={storeName} value={storeName}>
                      {storeName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="financeOpsHistoryStoreFilter financeOpsHistoryAccountFilter">
                <span className="financeOpsHistoryStoreFilterLabel">Вид расчёта</span>
                <select
                  value={accountFilter}
                  onChange={(event) => setAccountFilter(event.target.value)}
                  aria-label={`Фильтр по виду расчёта: ${title}`}
                >
                  <option value="">Все виды</option>
                  {accountFilterOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>
      <div className="financeOpsHistoryMiniTrack" role="list" aria-label={title}>
        {filteredRows.length === 0 ? (
          <p className="financeOpsHistoryMiniEmpty">
            {rows.length === 0
              ? emptyLabel
              : hasActiveFilters
                ? 'Нет операций по выбранным фильтрам'
                : emptyLabel}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.dayKey} className="financeOpsHistoryDayGroup" role="presentation">
              <div className="financeOpsHistoryDayDivider">
                <span className="financeOpsHistoryDayDividerLabel">
                  {formatFinanceHistoryDayLabel(group.dayKey)}
                </span>
              </div>
              {group.rows.map((row) => {
                const isEditing = editingId === row.id;
                const isBusy = busyId === row.id;
                const expenseCategoryLabel = kind === 'expense' ? row.title?.trim() || '' : '';
                const commentLabel = row.comment?.trim() || '';
                return (
                  <article
                    key={row.id}
                    className={`financeOpsHistoryMiniChip ${financeAccountToneClass(row.accountId)}`}
                    role="listitem"
                  >
                    {isEditing ? (
                      <div className="financeOpsHistoryEditForm">
                        <label className="financeOpsHistoryEditField">
                          <span>Счёт</span>
                          <select
                            value={editAccountId}
                            onChange={(event) => setEditAccountId(event.target.value)}
                          >
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {kind === 'expense' && expenseCategories ? (
                          <label className="financeOpsHistoryEditField">
                            <span>Статья</span>
                            <select
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                            >
                              {expenseCategories.map((label) => (
                                <option key={label} value={label}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {kind === 'income' ? (
                          <label className="financeOpsHistoryEditField">
                            <span>День</span>
                            <input
                              type="date"
                              value={editWorkDay}
                              onChange={(event) => setEditWorkDay(event.target.value)}
                            />
                          </label>
                        ) : null}
                        <label className="financeOpsHistoryEditField">
                          <span>Сумма, ₽</span>
                          <input
                            inputMode="decimal"
                            value={editAmount}
                            onChange={(event) => setEditAmount(event.target.value)}
                          />
                        </label>
                        {kind === 'income' || (kind === 'expense' && editTitle === 'ЗП') ? (
                          <label className="financeOpsHistoryEditField">
                            <span>{kind === 'income' ? 'Точка прихода' : 'Магазин'}</span>
                            <select
                              value={editStore}
                              onChange={(event) => setEditStore(event.target.value)}
                            >
                              {ALL_DEMO_STORE_NAMES.map((storeName) => (
                                <option key={storeName} value={storeName}>
                                  {storeName}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="financeOpsHistoryEditField">
                            <span>Комментарий</span>
                            <input
                              value={editComment}
                              onChange={(event) => setEditComment(event.target.value)}
                              placeholder="Необязательно"
                            />
                          </label>
                        )}
                        {editError ? <p className="error financeOpsHistoryEditError">{editError}</p> : null}
                        <div className="financeOpsHistoryEditActions">
                          <button
                            type="button"
                            className="primaryAction"
                            disabled={isBusy}
                            onClick={() => void saveEdit()}
                          >
                            {isBusy ? 'Сохраняем…' : 'Сохранить'}
                          </button>
                          <button type="button" className="ghost" disabled={isBusy} onClick={cancelEdit}>
                            Отмена
                          </button>
                          {(kind === 'income' && onDeleteIncome) || (kind === 'expense' && onDeleteExpense) ? (
                            <button
                              type="button"
                              className="ghost financeOpsHistoryDeleteBtn"
                              disabled={isBusy}
                              onClick={() => void deleteEdit()}
                            >
                              {isBusy ? '…' : 'Удалить'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="financeOpsHistoryMiniChipLine">
                        <span className="financeOpsHistoryMiniChipAccount" title={row.accountName}>
                          {row.accountName}
                        </span>
                        <strong className="financeOpsHistoryMiniChipValue">{fmt(row.amount)}</strong>
                        {expenseCategoryLabel ? (
                          <span
                            className="financeOpsHistoryMiniChipCategory"
                            title={expenseCategoryLabel}
                          >
                            {expenseCategoryLabel}
                          </span>
                        ) : null}
                        {commentLabel ? (
                          <span className="financeOpsHistoryMiniChipNote" title={commentLabel}>
                            {commentLabel}
                          </span>
                        ) : (
                          <span className="financeOpsHistoryMiniChipNote financeOpsHistoryMiniChipNote--empty" />
                        )}
                        <span className="financeOpsHistoryMiniChipTail">
                          <span className="financeOpsHistoryMiniChipTime">{row.timeLabel}</span>
                          {canEdit ? (
                            <button
                              type="button"
                              className="ghost financeOpsHistoryEditBtn"
                              onClick={() => startEdit(row)}
                            >
                              Изменить
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
              <div className="financeOpsHistoryDayTotal" aria-label={`Итого за ${formatFinanceHistoryDayLabel(group.dayKey)}`}>
                <span className="financeOpsHistoryDayTotalLabel">Итого за день</span>
                <strong className="financeOpsHistoryDayTotalValue">
                  {fmt(group.rows.reduce((sum, item) => sum + item.amount, 0))}
                </strong>
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function useWideFinanceLayout(preferDesktop: boolean) {
  const [wide, setWide] = useState(
    () =>
      preferDesktop ||
      (typeof window !== 'undefined' && window.matchMedia('(min-width: 880px)').matches),
  );
  useEffect(() => {
    if (preferDesktop) {
      return;
    }
    const mq = window.matchMedia('(min-width: 880px)');
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preferDesktop]);
  return wide;
}

function FinanceOpsPanel({
  token,
  isDirector,
  snapshot,
  onAddIncome,
  onAddExpense,
  onUpdateIncome,
  onUpdateExpense,
  onDeleteIncome,
  onDeleteExpense,
  onSetAccountBalance,
  onSetCategoryAmount,
  preferDesktopLayout = false,
  webSection,
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
  onUpdateIncome?: (
    token: string,
    id: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => Promise<void>;
  onUpdateExpense?: (
    token: string,
    id: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => Promise<void>;
  onDeleteIncome?: (token: string, id: string) => Promise<void>;
  onDeleteExpense?: (token: string, id: string) => Promise<void>;
  onSetAccountBalance: (token: string, accountId: string, balance: string) => Promise<void>;
  onSetCategoryAmount?: (token: string, title: string, amount: string) => Promise<void>;
  preferDesktopLayout?: boolean;
  webSection?: 'ops' | 'expenses';
}) {
  const primaryFinanceAccounts = useMemo(() => {
    const map = new Map(snapshot.accounts.map((a) => [a.id, a]));
    return FINANCE_OPS_PRIMARY_ACCOUNT_IDS.map((id) => map.get(id)).filter(
      (a): a is FinanceAccount => Boolean(a),
    );
  }, [snapshot.accounts]);

  const [incomeAmountDraft, setIncomeAmountDraft] = useState('');
  const [selectedIncomeAccountId, setSelectedIncomeAccountId] = useState('');
  const [selectedFlowAccountId, setSelectedFlowAccountId] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState(snapshot.accounts[0]?.id ?? '');
  const [expenseTitle, setExpenseTitle] = useState<
    (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number]
  >(FINANCE_EXPENSE_DEFAULT_CATEGORY);
  const [expenseStore, setExpenseStore] = useState<string>(ALL_DEMO_STORE_NAMES[0]);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseComment, setExpenseComment] = useState('');
  const [incomeStoreDraft, setIncomeStoreDraft] = useState<string>(ALL_DEMO_STORE_NAMES[0]);
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
  const compactFinanceUi = useWideFinanceLayout(preferDesktopLayout);
  const isWebSplit = Boolean(webSection) && !preferDesktopLayout;
  const showOpsSection = !isWebSplit || webSection === 'ops';
  const showExpensesSection = !isWebSplit || webSection === 'expenses';
  const showArticlesCarousel = preferDesktopLayout || (isWebSplit && webSection === 'expenses');
  const [expenseArticlesSheetOpen, setExpenseArticlesSheetOpen] = useState(
    compactFinanceUi || webSection === 'expenses',
  );
  const [editingCategoryTitle, setEditingCategoryTitle] = useState<string | null>(null);
  const [editingCategoryAmount, setEditingCategoryAmount] = useState('');
  const [categoryAmountBusy, setCategoryAmountBusy] = useState('');
  const location = useLocation();
  const [financeSensitiveVisible, setFinanceSensitiveVisible] = useState(false);

  useEffect(() => {
    setFinanceSensitiveVisible(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!expenseAccountId && snapshot.accounts.length > 0) {
      setExpenseAccountId(snapshot.accounts[0].id);
    }
  }, [expenseAccountId, snapshot.accounts]);

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

  const resolvedFlowAccountId =
    selectedFlowAccountId || primaryFinanceAccounts[0]?.id || '';
  const resolvedIncomeAccountId =
    selectedIncomeAccountId || primaryFinanceAccounts[0]?.id || '';

  const fmt = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;

  const expenseTotalsByArticle = useMemo(() => {
    if (snapshot.categoryAmounts?.length) {
      return snapshot.categoryAmounts.map((row) => ({
        title: row.title,
        total: row.amount,
      }));
    }
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
  }, [snapshot.categoryAmounts, snapshot.expenses]);

  const expensesGrandTotal = useMemo(() => {
    if (snapshot.totals.categoryTotal !== undefined) {
      return snapshot.totals.categoryTotal;
    }
    return Math.round(
      expenseTotalsByArticle.reduce((sum, row) => sum + row.total, 0) * 100,
    ) / 100;
  }, [snapshot.totals.categoryTotal, expenseTotalsByArticle]);

  const incomeHistoryRows = useMemo((): FinanceHistoryListRow[] => {
    const accountNames = new Map(snapshot.accounts.map((a) => [a.id, a.name?.trim() || 'Счёт']));
    return sortFinanceIncomesDesc(snapshot.incomes ?? []).map((item) => {
        const entryTime = new Date(item.createdAt).toLocaleString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        });
        return {
          id: item.id,
          dayKey: item.workDay,
          accountId: item.accountId,
          accountName: accountNames.get(item.accountId) ?? item.accountName ?? 'Счёт',
          amount: item.amount,
          comment: item.comment?.trim() || undefined,
          timeLabel: entryTime,
          workDay: item.workDay,
        };
      });
  }, [snapshot.incomes, snapshot.accounts]);

  const expenseHistoryRows = useMemo((): FinanceHistoryListRow[] => {
    return sortFinanceExpensesDesc(snapshot.expenses).map((item) => {
        const when = new Date(item.createdAt).toLocaleString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        });
        return {
          id: item.id,
          dayKey: financeHistoryDayKeyFromIso(item.createdAt),
          accountId: item.accountId,
          accountName: item.accountName?.trim() || 'Счёт',
          amount: item.amount,
          comment: item.comment?.trim() || undefined,
          timeLabel: when,
          title: item.title,
        };
      });
  }, [snapshot.expenses]);

  const handleHistoryIncomeEdit = async (
    id: string,
    payload: { accountId: string; amount: string; workDay: string; comment?: string },
  ) => {
    if (!onUpdateIncome) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await onUpdateIncome(token, id, payload);
      setStatus('Приход обновлён.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      throw new Error(message || 'Не удалось изменить приход');
    } finally {
      setBusyId('');
    }
  };

  const handleHistoryExpenseEdit = async (
    id: string,
    payload: { accountId: string; title: string; amount: string; comment?: string },
  ) => {
    if (!onUpdateExpense) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await onUpdateExpense(token, id, payload);
      setStatus('Расход обновлён.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      throw new Error(message || 'Не удалось изменить расход');
    } finally {
      setBusyId('');
    }
  };

  const handleHistoryIncomeDelete = async (id: string) => {
    if (!onDeleteIncome) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await onDeleteIncome(token, id);
      setStatus('Приход удалён.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      throw new Error(message || 'Не удалось удалить приход');
    } finally {
      setBusyId('');
    }
  };

  const handleHistoryExpenseDelete = async (id: string) => {
    if (!onDeleteExpense) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await onDeleteExpense(token, id);
      setStatus('Расход удалён.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      throw new Error(message || 'Не удалось удалить расход');
    } finally {
      setBusyId('');
    }
  };

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

  const activeFlowAccountId = compactFinanceUi
    ? resolvedFlowAccountId
    : resolvedIncomeAccountId;

  const submitIncomeForSelectedAccount = async () => {
    setError('');
    setStatus('');
    if (!activeFlowAccountId) {
      setError('Выберите счёт');
      return;
    }
    const amountStr = incomeAmountDraft;
    const n = Number(String(amountStr).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError('Укажите сумму прихода');
      return;
    }
    setBusyId(`income-${activeFlowAccountId}`);
    try {
      const incomePoint = incomeStoreDraft.trim();
      if (!incomePoint) {
        setError('Выберите точку прихода');
        setBusyId('');
        return;
      }
      await onAddIncome(token, {
        accountId: activeFlowAccountId,
        amount: amountStr,
        workDay: todayKeyMoscow(),
        comment: incomePoint,
      });
      setIncomeAmountDraft('');
      const acc = snapshot.accounts.find((a) => a.id === activeFlowAccountId);
      setStatus(acc ? `Приход на «${acc.name}» записан, баланс обновлён.` : 'Приход записан.');
    } catch {
      setError('Не удалось записать приход');
    } finally {
      setBusyId('');
    }
  };

  const expenseAccountIdForForm = compactFinanceUi ? selectedFlowAccountId : expenseAccountId;
  const expenseAccountForForm = snapshot.accounts.find((a) => a.id === expenseAccountIdForForm);
  const parsedExpenseAmount = parseFinanceMoneyInput(expenseAmount);
  const expenseInsufficientMessage =
    parsedExpenseAmount !== null
      ? financeExpenseInsufficientMessage(expenseAccountForForm, parsedExpenseAmount)
      : null;
  const canSubmitExpense =
    Boolean(expenseAccountIdForForm) &&
    parsedExpenseAmount !== null &&
    !expenseInsufficientMessage;

  const startCategoryEdit = (title: string, currentTotal: number) => {
    if (!isDirector || !onSetCategoryAmount) {
      return;
    }
    setEditingCategoryTitle(title);
    setEditingCategoryAmount(String(currentTotal));
    setError('');
  };

  const cancelCategoryEdit = () => {
    setEditingCategoryTitle(null);
    setEditingCategoryAmount('');
    setCategoryAmountBusy('');
  };

  const saveCategoryEdit = async (title: string) => {
    if (!onSetCategoryAmount || editingCategoryTitle !== title) {
      return;
    }
    const parsed = parseFinanceMoneyInput(editingCategoryAmount);
    if (parsed === null) {
      setError('Укажите корректную сумму по статье');
      return;
    }
    setCategoryAmountBusy(title);
    setError('');
    try {
      await onSetCategoryAmount(token, title, String(parsed));
      setStatus(`Сумма по статье «${title}» сохранена.`);
      cancelCategoryEdit();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Не удалось сохранить сумму по статье');
    } finally {
      setCategoryAmountBusy('');
    }
  };

  const renderExpenseArticleChip = (row: { title: string; total: number }) => {
    const canEdit = isDirector && Boolean(onSetCategoryAmount);
    const isEditing = editingCategoryTitle === row.title;
    const busy = categoryAmountBusy === row.title;

    if (isEditing) {
      return (
        <article
          key={row.title}
          className="financeOpsExpenseArticlesChip financeOpsExpenseArticlesChip--editing"
          role="listitem"
        >
          <span className="financeOpsExpenseArticlesChipTitle">{row.title}</span>
          <input
            className="financeOpsExpenseArticlesChipInput"
            type="text"
            inputMode="decimal"
            autoFocus
            disabled={busy}
            value={editingCategoryAmount}
            onChange={(event) => setEditingCategoryAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveCategoryEdit(row.title);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelCategoryEdit();
              }
            }}
            onBlur={() => {
              if (categoryAmountBusy === row.title) {
                return;
              }
              void saveCategoryEdit(row.title);
            }}
            aria-label={`Сумма по статье ${row.title}`}
          />
        </article>
      );
    }

    if (canEdit) {
      return (
        <button
          key={row.title}
          type="button"
          className="financeOpsExpenseArticlesChip financeOpsExpenseArticlesChip--editable"
          role="listitem"
          disabled={Boolean(categoryAmountBusy)}
          onClick={() => startCategoryEdit(row.title, row.total)}
        >
          <span className="financeOpsExpenseArticlesChipTitle">{row.title}</span>
          <FinanceSensitiveAmount
            visible={financeSensitiveVisible}
            value={row.total}
            format={fmt}
            className="financeOpsExpenseArticlesChipAmount"
          />
        </button>
      );
    }

    return (
      <article key={row.title} className="financeOpsExpenseArticlesChip" role="listitem">
        <span className="financeOpsExpenseArticlesChipTitle">{row.title}</span>
        <FinanceSensitiveAmount
          visible={financeSensitiveVisible}
          value={row.total}
          format={fmt}
          className="financeOpsExpenseArticlesChipAmount"
        />
      </article>
    );
  };

  const submitExpense = async () => {
    const accountId = expenseAccountIdForForm;
    if (!accountId) {
      setError('Выберите счёт');
      return;
    }
    const amount = parseFinanceMoneyInput(expenseAmount);
    if (amount === null) {
      setError('Укажите сумму расхода');
      return;
    }
    const insufficient = financeExpenseInsufficientMessage(
      snapshot.accounts.find((a) => a.id === accountId),
      amount,
    );
    if (insufficient) {
      setError(insufficient);
      return;
    }
    setBusyId('expense');
    setError('');
    setStatus('');
    try {
      let comment: string | undefined;
      if (expenseTitle === 'ЗП') {
        const store = expenseStore.trim();
        if (!store) {
          setError('Выберите магазин');
          setBusyId('');
          return;
        }
        comment = store;
      } else {
        comment = expenseComment.trim() || undefined;
      }
      await onAddExpense(token, {
        accountId,
        title: expenseTitle,
        amount: expenseAmount,
        comment,
      });
      setExpenseTitle(FINANCE_EXPENSE_DEFAULT_CATEGORY);
      setExpenseStore(ALL_DEMO_STORE_NAMES[0]);
      setExpenseAmount('');
      setExpenseComment('');
      const acc = snapshot.accounts.find((a) => a.id === accountId);
      setStatus(acc ? `Расход со счёта «${acc.name}» добавлен.` : 'Расход добавлен.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message && message !== 'add finance expense error' && message !== 'INVALID_EXPENSE_AMOUNT'
          ? message
          : 'Не удалось добавить расход',
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <div
      className={`opsCard financeOpsCard ${isDirector ? 'financeOpsCardDirector' : ''}${
        compactFinanceUi ? ' financeOpsCard--desktop' : ''
      }${isWebSplit ? ` financeOpsCard--web-${webSection}` : ''}`}
    >
      <div className={`financeOpsShell${compactFinanceUi ? ' financeOpsShell--desktop' : ''}`}>
      {showOpsSection ? (
      <header className="financeOpsHero">
        <div className="financeOpsHeroTop">
          <h4 className="financeOpsPageTitle">Оперативные финансы</h4>
          <FinanceSensitiveToggleButton
            visible={financeSensitiveVisible}
            onToggle={() => setFinanceSensitiveVisible((open) => !open)}
          />
        </div>
        <div className="financeOpsHeroMain">
          <div className="financeOpsBankTotalCallout" role="note">
            <span className="financeOpsBankTotalCalloutLabel">Общий остаток</span>
            <FinanceSensitiveAmount
              visible={financeSensitiveVisible}
              value={snapshot.totals.balance}
              format={fmt}
              className="financeOpsBankTotalCalloutValue"
            />
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
                            <FinanceSensitiveAmount
                              visible={financeSensitiveVisible}
                              value={Number(String(adjustNewBalance).replace(',', '.')) || 0}
                              format={fmt}
                            />
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
                      <FinanceSensitiveAmount visible={financeSensitiveVisible} value={acc.balance} format={fmt} />
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
      ) : (
      <header className="financeOpsHero financeOpsHero--expensesWeb">
        <div className="financeOpsHeroTop">
          <h4 className="financeOpsPageTitle">Расходы</h4>
          <FinanceSensitiveToggleButton
            visible={financeSensitiveVisible}
            onToggle={() => setFinanceSensitiveVisible((open) => !open)}
          />
        </div>
      </header>
      )}

      {compactFinanceUi ? (
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
              {expenseTitle === 'ЗП' ? (
                <label className="financeOpsFlowSideField financeOpsFlowSideField--comment">
                  <span className="financeOpsFlowSideFieldLabel">Магазин</span>
                  <select
                    className="financeOpsExpenseCategoryInline"
                    value={expenseStore}
                    onChange={(event) => setExpenseStore(event.target.value)}
                    aria-label="Магазин для ЗП"
                  >
                    {ALL_DEMO_STORE_NAMES.map((storeName) => (
                      <option key={storeName} value={storeName}>
                        {storeName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="financeOpsFlowSideField financeOpsFlowSideField--comment">
                  <span className="financeOpsFlowSideFieldLabel">Комментарий</span>
                  <input
                    className="financeOpsCommentInput"
                    type="text"
                    maxLength={200}
                    aria-label="Комментарий к расходу"
                    value={expenseComment}
                    onChange={(event) => setExpenseComment(event.target.value)}
                    placeholder="Необязательно"
                  />
                </label>
              )}
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
              {expenseInsufficientMessage ? (
                <p className="error financeOpsExpenseHint" role="alert">
                  {expenseInsufficientMessage}
                </p>
              ) : null}
              <button
                type="button"
                className="primaryAction financeOpsExpenseSubmit"
                disabled={!canSubmitExpense || busyId === 'expense'}
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
              {primaryFinanceAccounts.map((acc) => {
                const chipInsufficient =
                  parsedExpenseAmount !== null &&
                  financeExpenseInsufficientMessage(acc, parsedExpenseAmount) !== null;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    className={`ghost financeOpsFlowAccountChip ${financeAccountToneClass(acc.id)}${
                      selectedFlowAccountId === acc.id ? ' financeOpsFlowAccountChip--active' : ''
                    }${chipInsufficient ? ' financeOpsFlowAccountChip--insufficient' : ''}`}
                    onClick={() => setSelectedFlowAccountId(acc.id)}
                    title={
                      chipInsufficient
                        ? `Доступно: ${acc.balance.toLocaleString('ru-RU')} ₽`
                        : undefined
                    }
                  >
                    {acc.name?.trim() || 'Счёт'}
                  </button>
                );
              })}
            </div>
            <div className="financeOpsIncomeEntryCallout">
              <label className="financeOpsFlowSideField financeOpsFlowSideField--amount financeOpsFlowSideField--income">
                <span className="financeOpsEntryCalloutLabel">Сумма прихода</span>
                <input
                  className="financeOpsIncomeEntryInput"
                  inputMode="decimal"
                  aria-label="Сумма прихода за день"
                  value={incomeAmountDraft}
                  onChange={(event) => setIncomeAmountDraft(event.target.value)}
                  placeholder="0"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitIncomeForSelectedAccount();
                    }
                  }}
                />
              </label>
              <label className="financeOpsFlowSideField financeOpsFlowSideField--comment">
                <span className="financeOpsFlowSideFieldLabel">Точка прихода</span>
                <select
                  className="financeOpsExpenseCategoryInline"
                  value={incomeStoreDraft}
                  onChange={(event) => setIncomeStoreDraft(event.target.value)}
                  aria-label="Точка прихода"
                >
                  {ALL_DEMO_STORE_NAMES.map((storeName) => (
                    <option key={storeName} value={storeName}>
                      {storeName}
                    </option>
                  ))}
                </select>
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
          {showOpsSection ? (
          <section className="financeOpsZone financeOpsZone--income financeOpsIncomeBlock addSaleForm">
            <h4 className="financeOpsZoneTitle">Приход за день</h4>
            <label className="financeOpsAccountsPick">
              <span className="financeOpsFieldLabel">Счёт прихода</span>
              <div className="financeOpsAccountBtnRow" role="group" aria-label="Счёт для записи прихода">
                {primaryFinanceAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className={`ghost paymentTypeBtn financeOpsAccountPickBtn ${financeAccountToneClass(acc.id)}${
                      selectedIncomeAccountId === acc.id ? ' paymentTypeBtnActive' : ''
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
                  value={incomeAmountDraft}
                  onChange={(event) => setIncomeAmountDraft(event.target.value)}
                  placeholder="Например, 15000"
                />
              </label>
              <label className="financeOpsCommentField">
                <span className="financeOpsFieldLabel">Точка прихода</span>
                <select
                  className="financeOpsExpenseUnifiedSelect"
                  value={incomeStoreDraft}
                  onChange={(event) => setIncomeStoreDraft(event.target.value)}
                  aria-label="Точка прихода"
                >
                  {ALL_DEMO_STORE_NAMES.map((storeName) => (
                    <option key={storeName} value={storeName}>
                      {storeName}
                    </option>
                  ))}
                </select>
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
          ) : null}

          {showExpensesSection ? (
          <section className={`financeOpsZone financeOpsZone--expense addSaleForm${isWebSplit ? ' financeOpsZone--expenseWeb' : ''}`}>
            <h4 className="financeOpsZoneTitle">Расход</h4>
            {isWebSplit ? (
              <>
                <label className="financeOpsAccountsPick">
                  <span className="financeOpsFieldLabel">Счёт списания</span>
                  <div className="financeOpsAccountBtnRow" role="group" aria-label="Счёт списания">
                    {snapshot.accounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        className={`ghost paymentTypeBtn financeOpsAccountPickBtn ${financeAccountToneClass(account.id)}${
                          expenseAccountId === account.id ? ' paymentTypeBtnActive' : ''
                        }`}
                        onClick={() => setExpenseAccountId(account.id)}
                      >
                        {account.name}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="financeOpsAccountsPick">
                  <span className="financeOpsFieldLabel">Статья расхода</span>
                  <div
                    className="financeOpsAccountBtnRow financeOpsExpenseCategoryRow"
                    role="group"
                    aria-label="Статья расхода"
                  >
                    {FINANCE_EXPENSE_CATEGORY_LABELS.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`ghost paymentTypeBtn financeOpsExpenseCategoryBtn${
                          expenseTitle === label ? ' paymentTypeBtnActive' : ''
                        }`}
                        onClick={() => setExpenseTitle(label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </label>
                {expenseTitle === 'ЗП' ? (
                  <label className="financeOpsCommentField financeOpsExpenseStoreField">
                    <span className="financeOpsFieldLabel">Магазин</span>
                    <select
                      className="financeOpsExpenseUnifiedSelect"
                      value={expenseStore}
                      onChange={(event) => setExpenseStore(event.target.value)}
                      aria-label="Магазин для ЗП"
                    >
                      {ALL_DEMO_STORE_NAMES.map((storeName) => (
                        <option key={storeName} value={storeName}>
                          {storeName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="financeOpsAmountField">
                  <span className="financeOpsFieldLabel">Сумма, ₽</span>
                  <input
                    inputMode="decimal"
                    value={expenseAmount}
                    onChange={(event) => setExpenseAmount(event.target.value)}
                    placeholder="Например, 5000"
                  />
                </label>
                {expenseTitle !== 'ЗП' ? (
                  <label className="financeOpsCommentField">
                    <span className="financeOpsFieldLabel">Комментарий</span>
                    <input
                      className="financeOpsCommentInput"
                      type="text"
                      maxLength={200}
                      aria-label="Комментарий к расходу"
                      value={expenseComment}
                      onChange={(event) => setExpenseComment(event.target.value)}
                      placeholder="Необязательно"
                    />
                  </label>
                ) : null}
              </>
            ) : (
              <>
            <div className="financeOpsExpensePickRow">
              <label
                className={`financeOpsExpenseUnifiedPick financeOpsExpenseAccountPick ${financeAccountToneClass(expenseAccountId)}`}
              >
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
            {expenseTitle === 'ЗП' ? (
              <label className="financeOpsExpenseUnifiedPick financeOpsExpenseStorePick">
                <span className="financeOpsExpenseUnifiedPickCaption">Магазин</span>
                <select
                  className="financeOpsExpenseUnifiedSelect"
                  value={expenseStore}
                  onChange={(event) => setExpenseStore(event.target.value)}
                  aria-label="Магазин для ЗП"
                >
                  {ALL_DEMO_STORE_NAMES.map((storeName) => (
                    <option key={storeName} value={storeName}>
                      {storeName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
              {expenseTitle === 'ЗП' ? null : (
                <label className="financeOpsCommentField">
                  <span className="financeOpsFieldLabel">Комментарий</span>
                  <input
                    className="financeOpsCommentInput"
                    type="text"
                    maxLength={200}
                    aria-label="Комментарий к расходу"
                    value={expenseComment}
                    onChange={(event) => setExpenseComment(event.target.value)}
                    placeholder="Необязательно"
                  />
                </label>
              )}
            </div>
              </>
            )}
            {expenseInsufficientMessage ? (
              <p className="error financeOpsExpenseHint" role="alert">
                {expenseInsufficientMessage}
              </p>
            ) : null}
            <button
              type="button"
              className="primaryAction addSaleSubmitBottom"
              disabled={!canSubmitExpense || busyId === 'expense'}
              onClick={() => void submitExpense()}
            >
              Добавить расход
            </button>
          </section>
          ) : null}
        </>
      )}

      {status || error ? (
        <div className="financeOpsStatusBar" role="status">
          {status ? <p className="success financeOpsStatusMsg">{status}</p> : null}
          {error ? <p className="error financeOpsStatusMsg">{error}</p> : null}
        </div>
      ) : null}

      {showExpensesSection ? (
      <section
        className={`financeOpsZone financeOpsZone--articles financeOpsExpenseArticlesSheet${
          compactFinanceUi ? ' financeOpsExpenseArticlesSheet--desktop' : ''
        }${showArticlesCarousel ? ' financeOpsExpenseArticlesSheet--open financeOpsExpenseArticlesSheet--carousel' : ''}${
          expenseArticlesSheetOpen ? ' financeOpsExpenseArticlesSheet--open' : ''
        }`}
      >
        {showArticlesCarousel ? (
          <>
            <div className="financeOpsArticlesHead">
              <h4 className="financeOpsZoneTitle">Расходы по статьям</h4>
              <FinanceSensitiveAmount
                visible={financeSensitiveVisible}
                value={expensesGrandTotal}
                format={fmt}
                className="financeOpsArticlesTotal"
              />
            </div>
            {isWebSplit ? (
              <p className="financeOpsExpenseArticlesSheetHint">
                {isDirector
                  ? 'Нажмите на статью, чтобы изменить сумму. Прокрутите вбок для остальных статей.'
                  : 'Прокрутите вбок — суммы по каждой статье.'}
              </p>
            ) : null}
            <div
              className="financeOpsExpenseArticlesCarousel financeOpsExpenseArticlesCarousel--desktop"
              role="list"
              aria-label="Суммы расходов по статьям"
            >
              {expenseTotalsByArticle.map((row) => renderExpenseArticleChip(row))}
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
                <FinanceSensitiveAmount
                  visible={financeSensitiveVisible}
                  value={expensesGrandTotal}
                  format={fmt}
                  className="financeOpsExpenseArticlesSheetHandleTotal"
                />
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
                  {isDirector
                    ? 'Нажмите на статью, чтобы изменить сумму. Прокрутите вбок для остальных статей.'
                    : 'Прокрутите вбок — суммы по каждой статье.'}
                </p>
                <div
                  className="financeOpsExpenseArticlesCarousel"
                  role="list"
                  aria-label="Суммы расходов по статьям"
                >
                  {expenseTotalsByArticle.map((row) => renderExpenseArticleChip(row))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      ) : null}

      {compactFinanceUi ? (
        <section className="financeOpsZone financeOpsZone--historyMini">
          <div className="financeOpsHistoryMiniRow">
            <FinanceOpsHistoryList
              title="Последние расходы"
              emptyLabel="Расходов пока нет"
              rows={expenseHistoryRows}
              kind="expense"
              accounts={snapshot.accounts}
              expenseCategories={FINANCE_EXPENSE_CATEGORY_LABELS}
              canEdit={Boolean(onUpdateExpense)}
              busyId={busyId}
              pageLayout
              onEditExpense={onUpdateExpense ? handleHistoryExpenseEdit : undefined}
              onDeleteExpense={onDeleteExpense ? handleHistoryExpenseDelete : undefined}
            />
            <FinanceOpsHistoryList
              title="Последние приходы по счетам"
              emptyLabel="Приходов пока нет"
              rows={incomeHistoryRows}
              kind="income"
              accounts={snapshot.accounts}
              canEdit={Boolean(onUpdateIncome)}
              busyId={busyId}
              pageLayout
              onEditIncome={onUpdateIncome ? handleHistoryIncomeEdit : undefined}
              onDeleteIncome={onDeleteIncome ? handleHistoryIncomeDelete : undefined}
            />
          </div>
        </section>
      ) : isWebSplit ? (
        <>
          {showOpsSection ? (
            <section className="financeOpsZone financeOpsZone--historyPage financeOpsZone--historyIncomes">
              <FinanceOpsHistoryList
                title="Последние приходы по счетам"
                emptyLabel="Приходов пока нет"
                rows={incomeHistoryRows}
                kind="income"
                accounts={snapshot.accounts}
                canEdit={Boolean(onUpdateIncome)}
                busyId={busyId}
                pageLayout
                onEditIncome={onUpdateIncome ? handleHistoryIncomeEdit : undefined}
                onDeleteIncome={onDeleteIncome ? handleHistoryIncomeDelete : undefined}
              />
            </section>
          ) : null}
          {showExpensesSection ? (
            <section className="financeOpsZone financeOpsZone--historyPage financeOpsZone--historyExpenses">
              <FinanceOpsHistoryList
                title="Последние расходы"
                emptyLabel="Расходов пока нет"
                rows={expenseHistoryRows}
                kind="expense"
                accounts={snapshot.accounts}
                expenseCategories={FINANCE_EXPENSE_CATEGORY_LABELS}
                canEdit={Boolean(onUpdateExpense)}
                busyId={busyId}
                pageLayout
                onEditExpense={onUpdateExpense ? handleHistoryExpenseEdit : undefined}
                onDeleteExpense={onDeleteExpense ? handleHistoryExpenseDelete : undefined}
              />
            </section>
          ) : null}
        </>
      ) : (
        <section className="financeOpsZone financeOpsZone--history financeHistoryAccordions">
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
                <FinanceOpsHistoryList
                  title="Последние расходы"
                  emptyLabel="Расходов пока нет"
                  rows={expenseHistoryRows}
                  kind="expense"
                  accounts={snapshot.accounts}
                  expenseCategories={FINANCE_EXPENSE_CATEGORY_LABELS}
                  canEdit={Boolean(onUpdateExpense)}
                  busyId={busyId}
                  onEditExpense={onUpdateExpense ? handleHistoryExpenseEdit : undefined}
                  onDeleteExpense={onDeleteExpense ? handleHistoryExpenseDelete : undefined}
                />
              </div>
            </div>
          </section>

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
                <FinanceOpsHistoryList
                  title="Последние приходы по счетам"
                  emptyLabel="Приходов пока нет"
                  rows={incomeHistoryRows}
                  kind="income"
                  accounts={snapshot.accounts}
                  canEdit={Boolean(onUpdateIncome)}
                  busyId={busyId}
                  onEditIncome={onUpdateIncome ? handleHistoryIncomeEdit : undefined}
                  onDeleteIncome={onDeleteIncome ? handleHistoryIncomeDelete : undefined}
                />
              </div>
            </div>
          </section>
        </section>
      )}
      </div>
    </div>
  );
}

function shiftMemberRoleLabel(position: StaffPositionKind): string {
  if (position === 'RETOUCHER') {
    return 'ретушёр';
  }
  if (position === 'MANAGER') {
    return 'управляющий';
  }
  return 'продавец';
}

function ShiftPanel({
  token,
  staff,
  shifts,
  role,
  storeName,
  readOnly,
  onOpen,
  onClose,
}: {
  token: string;
  staff: StaffMember[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  /** Для админа — только сотрудники этой торговой точки. */
  storeName?: string;
  readOnly?: boolean;
  onOpen: (token: string, assignedSellerIds: number[]) => Promise<void>;
  onClose: (token: string, assignedSellerIds: number[]) => Promise<void>;
}) {
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const shiftAssignableStaff = useMemo(() => {
    const active = staff.filter((member) => member.isActive);
    if (role === 'ADMIN' && storeName?.trim()) {
      return staffAtStore(active, storeName);
    }
    return active;
  }, [staff, role, storeName]);

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
            title={`${formatPersonWithNickname(member.fullName, member.nickname)} (${member.storeName})`}
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
              <span className="shiftSellerName">
                {member.fullName}
                {member.nickname?.trim() ? (
                  <span className="teamMemberNick"> ({member.nickname})</span>
                ) : null}
              </span>
              <span className="shiftSellerStore">
                {' '}
                — {member.storeName || storeName || 'точка'} ({shiftMemberRoleLabel(member.staffPosition)})
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
  storeDirectorEdit = false,
}: {
  token: string;
  member: StaffMember;
  seller?: SellerProfile;
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  openShiftId?: string;
  storeDirectorEdit?: boolean;
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

      {!isRetoucher && seller && (role === 'DIRECTOR' || (role === 'ADMIN' && storeDirectorEdit)) && (
        <div className="directorPercent teamPercentEdit">
          <label>
            Новый % {role === 'ADMIN' ? '(директор)' : '(директор)'}
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

function ManagerStoreCommissionPanel({
  token,
  items,
  apiOnline = true,
  onSave,
  onReload,
}: {
  token: string;
  items: ManagerStoreCommissionRow[];
  apiOnline?: boolean;
  onSave: (token: string, items: ManagerStoreCommissionRow[]) => Promise<void>;
  onReload?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const rows = useMemo(
    () => (items.length > 0 ? items : [...DEFAULT_MANAGER_STORE_COMMISSIONS]),
    [items],
  );

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const payload = rows.map((row) => {
        const raw = draft[row.storeName] ?? String(row.percent);
        const percent = Math.max(0, Math.min(100, Number(String(raw).replace(',', '.')) || 0));
        return { storeName: row.storeName, percent };
      });
      await onSave(token, payload);
      setDraft({});
      setStatus('Проценты управляющего сохранены');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="teamManagerCommissionCard teamManagerCommissionCard--compact">
      <div className="teamManagerCommissionTop">
        <div className="teamManagerCommissionHead">
          <h4 className="teamManagerCommissionTitle">Зарплата управляющего</h4>
          <p className="teamManagerCommissionHint">% от выручки точки за день · 0 = не участвует</p>
        </div>
        {onReload ? (
          <button
            type="button"
            className="invGhostBtn teamManagerCommissionRefresh"
            onClick={() => void onReload()}
            aria-label="Обновить проценты"
            title="Обновить"
          >
            ↻
          </button>
        ) : null}
      </div>
      {!apiOnline ? (
        <p className="teamManagerCommissionWarn teamManagerCommissionMsg" role="status">
          {MANAGER_COMMISSIONS_DEPLOY_HINT}
        </p>
      ) : null}
      {error ? (
        <p className="invInlineError teamManagerCommissionMsg" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="invInlineOk teamManagerCommissionMsg">{status}</p> : null}
      <div className="teamManagerCommissionGrid teamManagerCommissionGrid--compact">
        {rows.map((row) => (
          <label key={row.storeName} className="teamManagerCommissionRow">
            <span className="teamManagerCommissionStore" title={row.storeName}>
              {row.storeName}
            </span>
            <span className="teamManagerCommissionInputWrap">
              <input
                type="text"
                inputMode="decimal"
                className="teamManagerCommissionInput"
                value={draft[row.storeName] ?? String(row.percent)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [row.storeName]: event.target.value }))
                }
                aria-label={`Процент управляющего: ${row.storeName}`}
              />
              <span className="teamManagerCommissionSuffix">%</span>
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="primaryAction teamManagerCommissionSave"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? '…' : 'Сохранить'}
      </button>
    </section>
  );
}

function TeamStoresOverview({
  token,
  staff,
  sellers,
  sales,
  shifts,
  role,
  managerStoreCommissions = [],
  managerCommissionsApiOnline = true,
  onSaveManagerStoreCommissions,
  onReloadManagerCommissions,
  onDirectorSetPercent,
  onRemoveFromStore,
  onRestoreStaffToStore,
  reportDayKey,
  onReportDayKeyChange,
  hideRemovedStaff,
  readOnlyTeamActions,
  payrollView = false,
  panelTitle = 'Сотрудники по точкам',
}: {
  token: string;
  staff: StaffMember[];
  sellers: SellerProfile[];
  sales: AdminSale[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  managerStoreCommissions?: ManagerStoreCommissionRow[];
  managerCommissionsApiOnline?: boolean;
  onSaveManagerStoreCommissions?: (
    token: string,
    items: ManagerStoreCommissionRow[],
  ) => Promise<void>;
  onReloadManagerCommissions?: () => Promise<void>;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
  onRemoveFromStore: (token: string, id: number, storeName?: string) => Promise<void>;
  onRestoreStaffToStore: (token: string, staffId: number, storeName: string) => Promise<void>;
  reportDayKey?: string;
  onReportDayKeyChange?: (dayKey: string) => void;
  hideRemovedStaff?: boolean;
  readOnlyTeamActions?: boolean;
  payrollView?: boolean;
  panelTitle?: string;
}) {
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const openShiftId = openShift?.id;
  const canEditPercent = role === 'DIRECTOR' || role === 'ACCOUNTANT';
  const sellerById = new Map(sellers.map((item) => [item.id, item]));
  const todayActual = todayKeyMoscow();
  const calendarReportKey = reportDayKey ?? todayActual;
  const reportIsToday = calendarReportKey === todayActual;
  const managerPayrollView = role === 'MANAGER' || payrollView;
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
  const [removeError, setRemoveError] = useState('');

  const [storeAccordionOpen, setStoreAccordionOpen] = useState<Record<string, boolean>>({});
  const desktopWarehouse = isTauriRuntime();
  const [selectedStoreName, setSelectedStoreName] = useState('');
  const managerCommissionBlock =
    !payrollView && role === 'DIRECTOR' && onSaveManagerStoreCommissions ? (
      <ManagerStoreCommissionPanel
        token={token}
        items={managerStoreCommissions}
        apiOnline={managerCommissionsApiOnline}
        onSave={onSaveManagerStoreCommissions}
        onReload={onReloadManagerCommissions}
      />
    ) : null;

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

  const memberPayrollDayRub = (member: StaffMember, storeName: string): number => {
    const seller = sellerById.get(member.id);
    if (member.staffPosition === 'MANAGER') {
      return managerEarnForStore(storeName, sales, sellers, calendarReportKey, managerStoreCommissions);
    }
    if (member.staffPosition === 'RETOUCHER') {
      const ratePct = member.retoucherRatePercent ?? 5;
      return retoucherEarnRubSnapshot(storeName, sellers, sales, ratePct, calendarReportKey)?.todayRub ?? 0;
    }
    return Math.round(((todaySalesBySellerId.get(member.id) ?? 0) * (seller?.ratePercent ?? 0)) / 100);
  };

  const storePayrollDayTotal = (members: StaffMember[], storeName: string) =>
    members.reduce((sum, member) => sum + memberPayrollDayRub(member, storeName), 0);

  const renderManagerPayrollFooter = (storeName: string, members: StaffMember[]) => {
    const total = storePayrollDayTotal(members, storeName);
    return (
      <div className="teamManagerPayrollTotal" role="status" aria-label={`Итого ЗП за день: ${storeName}`}>
        <span className="teamManagerPayrollTotalLabel">Итого за день</span>
        <strong className="teamManagerPayrollTotalValue">{total.toLocaleString('ru-RU')} ₽</strong>
      </div>
    );
  };

  const renderWarehouseMember = (member: StaffMember, storeName: string) => {
    const seller = sellerById.get(member.id);
    const isManagerStaff = member.staffPosition === 'MANAGER';
    const isRetoucher = member.staffPosition === 'RETOUCHER';
    const isShiftOpen = Boolean(openShiftId && member.assignedShiftId === openShiftId);
    const ratePctRetoucher = member.retoucherRatePercent ?? 5;
    const retoucherEarn = isRetoucher
      ? retoucherEarnRubSnapshot(storeName, sellers, sales, ratePctRetoucher, calendarReportKey)
      : null;
    const managerDayRub = isManagerStaff
      ? managerEarnForStore(storeName, sales, sellers, calendarReportKey, managerStoreCommissions)
      : 0;
    const managerPct = isManagerStaff ? managerPercentForStore(storeName, managerStoreCommissions) : 0;
    if (managerPayrollView) {
      const salaryDayRub = memberPayrollDayRub(member, storeName);
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
    if (isManagerStaff) {
      const storeRevenue = storeRevenueForReportDay(storeName, sales, sellers, calendarReportKey);
      const cardDesktopClass = desktopWarehouse ? ' teamMemberCard--desktop' : '';
      return (
        <article
          key={`${storeName}-${member.id}`}
          className={`teamMemberCard storeTeamMemberCard${cardDesktopClass} teamMemberCardShiftClosed`}
        >
          <div className="teamMemberTop">
            <div>
              <p className="teamMemberName">
                <strong>{member.fullName}</strong>{' '}
                <span className="teamMemberNick">({member.nickname})</span>
                <span className="statusPill statusPillOn managerStaffBadge">Управляющий</span>
              </p>
              <p className="teamMemberShiftState shiftClosed">Процент с выручки точки</p>
            </div>
          </div>
          <div className="teamMemberStats">
            <div className="statCell">
              <span className="statLabel">
                {reportIsToday ? 'Заработок за сегодня' : 'Заработок за выбранный день'}
              </span>
              <span className="statValue">{managerDayRub.toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="statCell">
              <span className="statLabel">
                {reportIsToday ? 'Выручка точки за сегодня' : 'Выручка точки за день'}
              </span>
              <span className="statValue">{storeRevenue.toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="statCell">
              <span className="statLabel">Ставка</span>
              <span className="statValue strong">{managerPct}%</span>
            </div>
          </div>
        </article>
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
                  setRemoveError('');
                  try {
                    await onRemoveFromStore(token, member.id, storeName);
                  } catch (error) {
                    setRemoveError(error instanceof Error ? error.message : 'Не удалось убрать сотрудника из точки');
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
          <h4 className="teamWarehouseTitle">{panelTitle}</h4>
          {reportDateBar}
        </header>
        {removeError ? <p className="notice">{removeError}</p> : null}
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
                    <>
                      {activeMembers.map((member) => renderWarehouseMember(member, activeStore))}
                      {managerPayrollView
                        ? renderManagerPayrollFooter(activeStore, activeMembers)
                        : null}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="teamWarehouseEmpty">Нет привязанных точек.</p>
            )}
          </main>
        </div>
        {renderRemovedStaffSection()}
        {managerCommissionBlock}
      </div>
    );
  }

  return (
    <div className="staffPanelRoot staffPanelStoresOverview">
      <h4 className="staffPanelTitle">{panelTitle}</h4>
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
                    {managerPayrollView ? renderManagerPayrollFooter(storeName, members) : null}
                </div>
              </div>
            </div>
          </section>
          );
        })}
      </div>

      {renderRemovedStaffSection()}
      {managerCommissionBlock}
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
  storeName,
  readOnly,
  showOnlyCards,
  hideCards,
  managementAccordion,
  onAdd,
  onAddFromBase,
  onRemoveFromStore,
  onDirectorSetPercent,
  hideFromBase = false,
  storeDirectorEdit = false,
}: {
  token: string;
  staff: StaffMember[];
  sellers: SellerProfile[];
  globalEmployees: GlobalEmployee[];
  shifts: ShiftInfo[];
  role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
  storeName?: string;
  readOnly?: boolean;
  showOnlyCards?: boolean;
  hideCards?: boolean;
  managementAccordion?: boolean;
  hideFromBase?: boolean;
  storeDirectorEdit?: boolean;
  onAdd: (token: string, fullName: string, nickname: string) => Promise<void>;
  onAddFromBase: (token: string, employeeId: number) => Promise<void>;
  onRemoveFromStore: (token: string, id: number, storeName?: string) => Promise<void>;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [pickedEmployeeId, setPickedEmployeeId] = useState<number | null>(null);
  const staffForPanel = useMemo(() => {
    if (role === 'ADMIN' && storeName?.trim()) {
      return staffAtStore(staff, storeName);
    }
    return staff.filter((member) => member.isActive);
  }, [staff, role, storeName]);
  const baseCandidates = globalEmployees.filter((employee) => {
    const existing = staffForPanel.find((member) => member.id === employee.id);
    return existing?.staffPosition !== 'RETOUCHER';
  });
  const firstGlobalId = baseCandidates[0]?.id ?? 0;
  const selectedEmployeeId =
    pickedEmployeeId !== null && baseCandidates.some((employee) => employee.id === pickedEmployeeId)
      ? pickedEmployeeId
      : firstGlobalId;
  const staffIds = new Set(staffForPanel.map((member) => member.id));
  const selectedEmployee = baseCandidates.find((employee) => employee.id === selectedEmployeeId);
  const alreadyInStore = selectedEmployee ? staffIds.has(selectedEmployee.id) : false;
  const openShift = shifts.find((item) => item.status === 'OPEN');
  const removableSalesStaff = staffForPanel.filter((member) => member.staffPosition === 'SALES');
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

  const staffRosterCards = staffForPanel.map((member) => {
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
        storeDirectorEdit={storeDirectorEdit}
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
        {hideFromBase ? null : (
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
        )}
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
              await onRemoveFromStore(token, selectedRemovalStaff.id, storeName ?? selectedRemovalStaff.storeName);
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
              await onRemoveFromStore(token, selectedRemovalStaff.id, storeName ?? selectedRemovalStaff.storeName);
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
                    await onRemoveFromStore(token, selectedRemovalStaff.id, storeName ?? selectedRemovalStaff.storeName);
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

function WebWarehouseSheet({
  id,
  title,
  badge,
  meta,
  open,
  onToggle,
  actions,
  className,
  children,
}: {
  id: string;
  title: string;
  badge?: string;
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`webWarehouseSheet procurementAccordion${open ? ' webWarehouseSheet--open' : ' procurementAccordion--collapsed'}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="webWarehouseSheetHandle procurementAccordionTrigger"
        aria-expanded={open}
        aria-controls={`web-warehouse-sheet-${id}`}
        onClick={onToggle}
      >
        <span className="webWarehouseSheetHandleMain">
          {badge ? (
            <span className="webWarehouseSheetBadge" aria-hidden>
              {badge}
            </span>
          ) : null}
          <span className="webWarehouseSheetHandleTitle">{title}</span>
        </span>
        {actions ? (
          <span
            className="webWarehouseSheetHandleActions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
        <span className="procurementAccordionChevron webWarehouseSheetChevron" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>
      <div
        className="procurementAccordionPanel webWarehouseSheetPanel"
        id={`web-warehouse-sheet-${id}`}
        aria-hidden={!open}
      >
        <div className="procurementAccordionPanelInner">
          <div className="procurementAccordionBody webWarehouseSheetBody">
            {meta}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function DirectorWarehousePanel({
  token,
  overview,
  products = [],
  procurementCosts = [],
  onReload,
  onReplenish,
  onResetWarehouse,
  onSaveProcurementCosts,
  onAddProduct,
  onRenameProduct,
  onDeleteProduct,
  bottomAside,
  webMobileLayout = false,
}: {
  token: string;
  overview: InventoryOverviewResponse | null;
  products?: ProductItem[];
  procurementCosts?: ProductProcurementCost[];
  onReload: () => Promise<void>;
  onReplenish: (token: string, warehouseKey: string, name: string, qtyStr: string) => Promise<void>;
  onResetWarehouse?: (token: string, warehouseKey: string) => Promise<void>;
  onSaveProcurementCosts?: (
    token: string,
    items: Array<{ name: string; cost: number }>,
  ) => Promise<void>;
  onAddProduct?: (token: string, name: string, priceStr: string) => Promise<void>;
  onRenameProduct?: (token: string, oldName: string, newName: string) => Promise<void>;
  onDeleteProduct?: (token: string, name: string) => Promise<void>;
  bottomAside?: ReactNode;
  webMobileLayout?: boolean;
}) {
  const [replenishDraft, setReplenishDraft] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});
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
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);

  const showProcurement = Boolean(onSaveProcurementCosts);
  const canAddProduct = Boolean(onAddProduct);
  const canRenameProduct = Boolean(onRenameProduct);
  const canDeleteProduct = Boolean(onDeleteProduct);
  const warehouseSections =
    overview?.warehouses && overview.warehouses.length > 0
      ? overview.warehouses
      : DEFAULT_INVENTORY_WAREHOUSES.map((w) => ({ ...w, storeNames: [...w.storeNames] }));
  const productRows = overview?.products ?? [];
  const costByName = new Map(procurementCosts.map((item) => [item.name.trim(), item.cost]));
  const orderedNames = [
    ...new Set([
      ...productRows.map((row) => row.name.trim()),
      ...products.map((item) => item.name.trim()),
    ]),
  ].filter(Boolean);
  const allRowsForCosts = orderedNames.map((name) => ({
    name,
    currentCost: costByName.get(name) ?? 0,
  }));
  const stockColCount = 5;

  const replenishDraftKey = (warehouseKey: string, name: string) => `${warehouseKey}::${name}`;
  const [resettingWarehouseKey, setResettingWarehouseKey] = useState<string | null>(null);
  const [resettingCosts, setResettingCosts] = useState(false);
  const [resetConfirm, setResetConfirm] = useState<
    | { kind: 'warehouse'; warehouseKey: string; label: string }
    | { kind: 'costs' }
    | null
  >(null);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [warehouseSheetOpen, setWarehouseSheetOpen] = useState<Record<string, boolean>>({});
  const [catalogSheetOpen, setCatalogSheetOpen] = useState(false);
  const [acquiringSheetOpen, setAcquiringSheetOpen] = useState(false);

  const toggleWarehouseSheet = (warehouseKey: string) => {
    setWarehouseSheetOpen((current) => ({ ...current, [warehouseKey]: !current[warehouseKey] }));
  };

  const warehouseCardTone = (warehouseKey: string) => {
    if (warehouseKey === WAREHOUSE_SADY_KEY) {
      return 'sady';
    }
    if (warehouseKey === WAREHOUSE_CENTER_KEY) {
      return 'center';
    }
    return 'default';
  };

  const rowsForWarehouse = (warehouseKey: string) =>
    orderedNames.map((name) => {
      const stock = productRows.find((row) => row.name.trim() === name)?.stockByWarehouse[warehouseKey];
      const qtyWarehouse = stock?.qtyWarehouse ?? 0;
      const qtyInStores = stock?.qtyInStores ?? 0;
      return {
        name,
        qtyWarehouse,
        qtyInStores,
        qtyGrandTotal: qtyWarehouse + qtyInStores,
        currentCost: costByName.get(name) ?? 0,
      };
    });

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

  const handleReplenish = async (warehouseKey: string, warehouseLabel: string, name: string) => {
    const busyKey = replenishDraftKey(warehouseKey, name);
    setBusyName(busyKey);
    setError('');
    setStatus('');
    try {
      await onReplenish(
        token,
        warehouseKey,
        name,
        replenishDraft[replenishDraftKey(warehouseKey, name)] ?? '0',
      );
      setReplenishDraft((current) => ({ ...current, [replenishDraftKey(warehouseKey, name)]: '' }));
      setStatus(`Склад «${warehouseLabel}» пополнен: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось пополнить склад');
    } finally {
      setBusyName(null);
    }
  };

  const handleResetWarehouse = async (warehouseKey: string, warehouseLabel: string) => {
    if (!onResetWarehouse) {
      return;
    }
    if (resetConfirmText.trim() !== 'ОБНУЛИТЬ') {
      setError('Введите ОБНУЛИТЬ для подтверждения');
      return;
    }
    setResettingWarehouseKey(warehouseKey);
    setError('');
    setStatus('');
    try {
      await onResetWarehouse(token, warehouseKey);
      setStatus(`Склад «${warehouseLabel}» и все его точки обнулены`);
      setResetConfirm(null);
      setResetConfirmText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обнулить склад');
    } finally {
      setResettingWarehouseKey(null);
    }
  };

  const handleResetProcurementCosts = async () => {
    if (!onSaveProcurementCosts) {
      return;
    }
    if (resetConfirmText.trim() !== 'ОБНУЛИТЬ') {
      setCostError('Введите ОБНУЛИТЬ для подтверждения');
      return;
    }
    setResettingCosts(true);
    setCostError('');
    setCostStatus('');
    setError('');
    try {
      const payload = allRowsForCosts.map((row) => ({ name: row.name, cost: 0 }));
      await onSaveProcurementCosts(token, payload);
      setCostDraft({});
      setCostStatus('Закупочные цены обнулены');
      setResetConfirm(null);
      setResetConfirmText('');
    } catch (e) {
      setCostError(e instanceof Error ? e.message : 'Не удалось обнулить цены');
    } finally {
      setResettingCosts(false);
    }
  };

  const beginResetConfirm = (
    next:
      | { kind: 'warehouse'; warehouseKey: string; label: string }
      | { kind: 'costs' },
  ) => {
    setResetConfirm(next);
    setResetConfirmText('');
    setError('');
    setCostError('');
  };

  const renderResetAction = (
    isActive: boolean,
    onBegin: () => void,
    onConfirm: () => void,
    busy: boolean,
    label: string,
  ) => {
    if (isActive) {
      return (
        <div className="directorWarehouseResetConfirm" role="group" aria-label="Подтверждение обнуления">
          <input
            type="text"
            className="directorWarehouseResetConfirmInput"
            value={resetConfirmText}
            onChange={(event) => setResetConfirmText(event.target.value)}
            placeholder="ОБНУЛИТЬ"
            aria-label="Подтверждение: введите ОБНУЛИТЬ"
          />
          <button
            type="button"
            className="directorWarehouseResetConfirmOk"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? '…' : 'Да'}
          </button>
          <button
            type="button"
            className="directorWarehouseResetConfirmCancel"
            disabled={busy}
            onClick={() => {
              setResetConfirm(null);
              setResetConfirmText('');
            }}
          >
            ×
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="directorWarehouseResetBtn"
        disabled={Boolean(resetConfirm) || busy}
        onClick={onBegin}
        title={`${label}: склад и все точки региона`}
      >
        {label}
      </button>
    );
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

  const catalogNameValue = (rowName: string) => nameDraft[rowName] ?? rowName;
  const catalogNameChanged = (rowName: string) =>
    catalogNameValue(rowName).trim() !== rowName.trim();

  const handleRenameProduct = async (rowName: string) => {
    if (!onRenameProduct) {
      return;
    }
    const nextName = catalogNameValue(rowName).trim();
    if (!nextName || !catalogNameChanged(rowName)) {
      return;
    }
    setRenamingName(rowName);
    setError('');
    setCostError('');
    setStatus('');
    setCostStatus('');
    try {
      await onRenameProduct(token, rowName, nextName);
      setNameDraft((current) => {
        const next = { ...current };
        delete next[rowName];
        return next;
      });
      setCostDraft((current) => {
        const next = { ...current };
        const cost = next[rowName];
        if (cost !== undefined) {
          next[nextName] = cost;
          delete next[rowName];
        }
        return next;
      });
      setStatus(`Товар переименован: «${nextName}»`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переименовать');
    } finally {
      setRenamingName(null);
    }
  };

  const handleDeleteProduct = async (name: string) => {
    if (!onDeleteProduct) {
      return;
    }
    setDeletingName(name);
    setError('');
    setStatus('');
    try {
      await onDeleteProduct(token, name);
      setStatus(`Товар «${name}» удалён из каталога`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить товар');
    } finally {
      setDeletingName(null);
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
      const payload = allRowsForCosts.map((row) => ({
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

  const renderWebCatalogList = () => (
    <div className="webCatalogList" role="list" aria-label="Каталог товаров">
      {allRowsForCosts.length === 0 ? (
        <p className="webCatalogEmpty muted">Нет товаров в каталоге</p>
      ) : (
        allRowsForCosts.map((row) => (
          <article key={`catalog-mobile-${row.name}`} className="webCatalogCard" role="listitem">
            <div className="webCatalogCardTop">
              {canRenameProduct ? (
                <div className="webCatalogNameRow" role="group" aria-label={`Название: ${row.name}`}>
                  <input
                    type="text"
                    className="dwCatalogNameInput webCatalogNameInput"
                    value={catalogNameValue(row.name)}
                    maxLength={120}
                    disabled={renamingName === row.name}
                    onChange={(event) =>
                      setNameDraft((current) => ({
                        ...current,
                        [row.name]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleRenameProduct(row.name);
                      }
                    }}
                    aria-label={`Название: ${row.name}`}
                  />
                  {catalogNameChanged(row.name) ? (
                    <button
                      type="button"
                      className="dwCatalogNameSaveBtn webCatalogSaveBtn"
                      disabled={renamingName === row.name}
                      onClick={() => void handleRenameProduct(row.name)}
                    >
                      {renamingName === row.name ? '…' : '✓'}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="webCatalogName">{row.name}</p>
              )}
              {canDeleteProduct ? (
                <button
                  type="button"
                  className="webCatalogDeleteBtn"
                  disabled={deletingName === row.name}
                  onClick={() => void handleDeleteProduct(row.name)}
                >
                  {deletingName === row.name ? '…' : 'Удалить'}
                </button>
              ) : null}
            </div>
            {showProcurement ? (
              <label className="webCatalogCostRow">
                <span className="webCatalogCostLabel">Закуп. цена, ₽</span>
                <input
                  className="dwCostInput procurementCostInput webCatalogCostInput"
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
              </label>
            ) : null}
          </article>
        ))
      )}
    </div>
  );

  return (
    <div
      className={`invGlassRoot directorWarehouseRoot${showProcurement ? ' directorWarehouseRoot--withCosts' : ''}${webMobileLayout ? ' directorWarehouseRoot--webMobile' : ''}`}
    >
      <div className="invGlassShell directorWarehouseShell">
        <header className="invGlassHeader directorWarehouseHeader">
          <div className="directorWarehouseHeaderMain">
            <h3 className="invGlassTitle directorWarehouseTitle">Склад и остатки</h3>
            <p className="directorWarehouseSubtitle">
              Два склада: «Сады моря» и «Центр». Точка списывает товар только со своего склада.
            </p>
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

        <div className="directorWarehouseLayout">
          <div className="directorWarehouseCards">
            {warehouseSections.map((section) => {
                const rows = rowsForWarehouse(section.key);
                const tone = warehouseCardTone(section.key);
                const badge = tone === 'sady' ? 'SM' : tone === 'center' ? 'Ц' : '·';
                const resetAction = onResetWarehouse
                  ? renderResetAction(
                      resetConfirm?.kind === 'warehouse' &&
                        resetConfirm.warehouseKey === section.key,
                      () =>
                        beginResetConfirm({
                          kind: 'warehouse',
                          warehouseKey: section.key,
                          label: section.label,
                        }),
                      () => void handleResetWarehouse(section.key, section.label),
                      resettingWarehouseKey === section.key,
                      'Обнулить',
                    )
                  : null;
                const storeChips = (
                  <div className="directorWarehouseStoreChips">
                    {section.storeNames.map((store) => (
                      <span key={store} className="directorWarehouseStoreChip" title={store}>
                        {store}
                      </span>
                    ))}
                  </div>
                );
                const warehouseTable = (
                  <div className="invTableScroll invTableScrollFit directorWarehouseTableWrap">
                    <table className="invTable invTableWarehouse">
                      <thead>
                        <tr>
                          <th scope="col">Товар</th>
                          <th className="invThNum dwThNum" scope="col" title={`Склад «${section.label}»`}>
                            Склад
                          </th>
                          <th className="invThNum dwThNum" scope="col" title="Сумма по точкам этого склада">
                            Точки
                          </th>
                          <th className="invThNum dwThNum" scope="col">
                            Всего
                          </th>
                          <th
                            className="invThAction dwThAction"
                            scope="col"
                            title="Количество и подтверждение пополнения"
                          >
                            Пополнить
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={stockColCount} className="invTableEmpty">
                              Нет позиций в каталоге
                            </td>
                          </tr>
                        ) : (
                          rows.map((row) => {
                            const busyKey = replenishDraftKey(section.key, row.name);
                            return (
                              <tr key={`${section.key}-${row.name}`}>
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
                                  <div
                                    className="dwReplenish"
                                    role="group"
                                    aria-label={`Пополнить склад «${section.label}»: ${row.name}`}
                                  >
                                    <input
                                      className="dwReplenishInput"
                                      inputMode="numeric"
                                      placeholder="0"
                                      value={replenishDraft[busyKey] ?? ''}
                                      onChange={(event) =>
                                        setReplenishDraft((current) => ({
                                          ...current,
                                          [busyKey]: event.target.value,
                                        }))
                                      }
                                      aria-label={`Штук для пополнения: ${row.name}`}
                                    />
                                    <button
                                      type="button"
                                      className="dwReplenishBtn"
                                      disabled={busyName === busyKey}
                                      title={`Пополнить склад «${section.label}»`}
                                      aria-label="Подтвердить пополнение"
                                      onClick={() =>
                                        void handleReplenish(section.key, section.label, row.name)
                                      }
                                    >
                                      {busyName === busyKey ? '…' : '✓'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                );

                if (webMobileLayout) {
                  return (
                    <WebWarehouseSheet
                      key={section.key}
                      id={`warehouse-${section.key}`}
                      title={`Склад «${section.label}»`}
                      badge={badge}
                      open={Boolean(warehouseSheetOpen[section.key])}
                      onToggle={() => toggleWarehouseSheet(section.key)}
                      actions={resetAction}
                      className={`webWarehouseSheet--stock webWarehouseSheet--${tone}`}
                      meta={storeChips}
                    >
                      {warehouseTable}
                    </WebWarehouseSheet>
                  );
                }

                return (
                  <article
                    key={section.key}
                    className={`directorWarehouseCard directorWarehouseCard--${tone}`}
                  >
                    <header className="directorWarehouseCardHeader">
                      <div className="directorWarehouseCardTitleRow">
                        <div className="directorWarehouseCardTitleMain">
                          <span className="directorWarehouseCardBadge" aria-hidden>
                            {badge}
                          </span>
                          <h4 className="directorWarehouseCardTitle">Склад «{section.label}»</h4>
                        </div>
                        {resetAction}
                      </div>
                      {storeChips}
                    </header>
                    {warehouseTable}
                  </article>
                );
              })}
          </div>

          {showProcurement || canDeleteProduct ? (
            <div className={`directorWarehouseFooterRow${bottomAside ? ' directorWarehouseFooterRow--withAside' : ''}`}>
            {webMobileLayout ? (
              <WebWarehouseSheet
                id="catalog"
                title="Каталог товаров"
                open={catalogSheetOpen}
                onToggle={() => setCatalogSheetOpen((open) => !open)}
                actions={
                  showProcurement
                    ? renderResetAction(
                        resetConfirm?.kind === 'costs',
                        () => beginResetConfirm({ kind: 'costs' }),
                        () => void handleResetProcurementCosts(),
                        resettingCosts,
                        'Обнулить цены',
                      )
                    : null
                }
                className="webWarehouseSheet--catalog"
              >
                <p className="directorWarehouseCatalogHint">
                  Название можно изменить в карточке (✓). Закупочные цены общие для обоих складов. Удаление —
                  только при нулевых остатках везде.
                </p>
                {renderWebCatalogList()}
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
              </WebWarehouseSheet>
            ) : (
            <section className="directorWarehouseCatalogCard">
              <header className="directorWarehouseCatalogHeader">
                <div className="directorWarehouseCatalogTitleRow">
                  <h4 className="directorWarehouseCatalogTitle">Каталог товаров</h4>
                  {showProcurement
                    ? renderResetAction(
                        resetConfirm?.kind === 'costs',
                        () => beginResetConfirm({ kind: 'costs' }),
                        () => void handleResetProcurementCosts(),
                        resettingCosts,
                        'Обнулить цены',
                      )
                    : null}
                </div>
                <p className="directorWarehouseCatalogHint">
                  Название можно изменить в таблице (✓). Закупочные цены общие для обоих складов. Удаление —
                  только при нулевых остатках везде.
                </p>
              </header>
              <div className="invTableScroll invTableScrollFit directorWarehouseCatalogTableWrap">
                <table className="invTable invTableCatalog">
                  <thead>
                    <tr>
                      <th scope="col">Товар</th>
                      {showProcurement ? (
                        <th className="invThNum dwThCost" scope="col" title="Закупочная цена, ₽">
                          Закуп. цена
                        </th>
                      ) : null}
                      {canDeleteProduct ? (
                        <th className="invThAction dwThDelete" scope="col">
                          Удалить
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {allRowsForCosts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={(showProcurement ? 1 : 0) + (canDeleteProduct ? 1 : 0) + 1}
                          className="invTableEmpty"
                        >
                          Нет товаров в каталоге
                        </td>
                      </tr>
                    ) : (
                      allRowsForCosts.map((row) => (
                        <tr key={`catalog-desktop-${row.name}`}>
                          <td className="invTdName">
                            {canRenameProduct ? (
                              <div
                                className="dwCatalogNameEdit"
                                role="group"
                                aria-label={`Название товара: ${row.name}`}
                              >
                                <input
                                  type="text"
                                  className="dwCatalogNameInput"
                                  value={catalogNameValue(row.name)}
                                  maxLength={120}
                                  disabled={renamingName === row.name}
                                  onChange={(event) =>
                                    setNameDraft((current) => ({
                                      ...current,
                                      [row.name]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      void handleRenameProduct(row.name);
                                    }
                                  }}
                                  aria-label={`Название: ${row.name}`}
                                />
                                {catalogNameChanged(row.name) ? (
                                  <button
                                    type="button"
                                    className="dwCatalogNameSaveBtn"
                                    disabled={renamingName === row.name}
                                    title="Сохранить название"
                                    aria-label="Сохранить название"
                                    onClick={() => void handleRenameProduct(row.name)}
                                  >
                                    {renamingName === row.name ? '…' : '✓'}
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              row.name
                            )}
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
                          {canDeleteProduct ? (
                            <td className="invTdAction dwTdDelete">
                              <button
                                type="button"
                                className="directorWarehouseDeleteBtn"
                                disabled={deletingName === row.name}
                                title="Удалить из каталога (остатки должны быть 0)"
                                onClick={() => void handleDeleteProduct(row.name)}
                              >
                                {deletingName === row.name ? '…' : 'Удалить'}
                              </button>
                            </td>
                          ) : null}
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
            </section>
            )}
            {bottomAside ? (
              webMobileLayout ? (
                <WebWarehouseSheet
                  id="acquiring"
                  title="Эквайринг"
                  open={acquiringSheetOpen}
                  onToggle={() => setAcquiringSheetOpen((open) => !open)}
                  className="webWarehouseSheet--acquiring"
                >
                  {bottomAside}
                </WebWarehouseSheet>
              ) : (
                <div className="directorWarehouseAside">{bottomAside}</div>
              )
            ) : null}
            </div>
          ) : null}
        </div>
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

function AccountantStoreEquipmentStoresPanel({
  token,
  userId,
  refreshKey = 0,
}: {
  token: string;
  userId?: number;
  refreshKey?: number;
}) {
  type StoreRow = { storeName: string } & StoreEquipmentCounts;
  const isDesktop = isTauriRuntime();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [customTypes, setCustomTypes] = useState<StoreEquipmentCustomType[]>([]);
  const [draftByStore, setDraftByStore] = useState<Record<string, StoreEquipmentCounts>>({});
  const applyEquipmentPayload = useCallback((payload: StoreEquipmentCachePayload) => {
    const rows = payload.stores as StoreRow[];
    setStores(rows);
    setCustomTypes(payload.customTypes ?? []);
    const nextDraft: Record<string, StoreEquipmentCounts> = {};
    for (const row of rows) {
      const { storeName, ...counts } = row;
      nextDraft[storeName] = normalizeStoreEquipmentCounts(counts);
    }
    setDraftByStore(nextDraft);
  }, []);
  const [selectedStore, setSelectedStore] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busyStore, setBusyStore] = useState<string | null>(null);
  const [addingType, setAddingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [busyAddType, setBusyAddType] = useState(false);
  const [reloading, setReloading] = useState(false);
  const swipeStartX = useRef<number | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const equipmentFields = useMemo(() => buildStoreEquipmentFields(customTypes), [customTypes]);

  const persistEquipmentCache = useCallback(
    async (rows: StoreRow[], types: StoreEquipmentCustomType[]) => {
      if (userId === undefined) {
        return;
      }
      await saveStoreEquipmentCache(userId, { stores: rows, customTypes: types });
    },
    [userId],
  );

  const sortedStores = useMemo(() => {
    if (!stores?.length) {
      return [];
    }
    return [...stores].sort((a, b) => a.storeName.localeCompare(b.storeName, 'ru-RU'));
  }, [stores]);

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      const background = options?.background === true;
      if (!background) {
        setError('');
        if (!hasLoadedOnceRef.current) {
          setStatus('');
        }
      } else {
        setReloading(true);
      }

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline && userId !== undefined && !hasLoadedOnceRef.current) {
        const cached = await loadStoreEquipmentCache(userId);
        if (cached?.stores?.length) {
          applyEquipmentPayload(cached);
          hasLoadedOnceRef.current = true;
        }
      }

      try {
        const response = await fetchWithTimeout(
          `${API_BASE_URL}/admin/store-equipment`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
          15_000,
        );
        if (!response.ok) {
          const msg = await readApiErrorMessage(response, 'Не удалось загрузить свод по точкам');
          if (!hasLoadedOnceRef.current) {
            if (response.status === 403) {
              setError(
                msg.includes('бухгалтер')
                  ? 'Сервер ещё не обновлён: директору нужен деплой backend с доступом к спецтехнике.'
                  : msg,
              );
            } else if (response.status === 401) {
              setError('Сессия истекла — выйдите и войдите снова');
            } else {
              setError(msg);
            }
          } else if (!background) {
            setError(msg);
          }
          return;
        }
        const data = (await response.json()) as {
          stores?: StoreRow[];
          customTypes?: StoreEquipmentCustomType[];
        };
        const rows = Array.isArray(data.stores) ? data.stores : [];
        const types = data.customTypes ?? [];
        applyEquipmentPayload({ stores: rows, customTypes: types });
        await persistEquipmentCache(rows, types);
        markApiReachableSuccess();
        hasLoadedOnceRef.current = true;
        if (background) {
          setStatus('Данные обновлены');
        }
      } catch {
        if (!hasLoadedOnceRef.current) {
          setError('Не удалось загрузить свод — проверьте сеть и нажмите ↻');
        } else if (!background) {
          setError('Не удалось обновить — проверьте сеть');
        }
      } finally {
        setReloading(false);
      }
    },
    [applyEquipmentPayload, persistEquipmentCache, token, userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshKey > 0) {
      void load({ background: true });
    }
  }, [refreshKey, load]);

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
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/admin/store-equipment`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            storeName,
            pc: row.pc,
            camera: row.camera,
            printer: row.printer,
            sdCard: row.sdCard,
            monitor: row.monitor,
            mouse: row.mouse,
            keyboard: row.keyboard,
            cardReader: row.cardReader,
            extra: row.extra ?? {},
          }),
        },
        20_000,
      );
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Не удалось сохранить'));
      }
      const data = (await response.json()) as { storeName: string; equipment: StoreEquipmentCounts };
      const equipment = normalizeStoreEquipmentCounts(data.equipment);
      const savedRow: StoreRow = { storeName: data.storeName, ...equipment };
      setDraftByStore((current) => ({
        ...current,
        [data.storeName]: equipment,
      }));
      let nextStores: StoreRow[] = [];
      setStores((current) => {
        nextStores = current
          ? current.map((item) => (item.storeName === data.storeName ? savedRow : item))
          : [savedRow];
        return nextStores;
      });
      await persistEquipmentCache(nextStores, customTypes);
      markApiReachableSuccess();
      setStatus(`Сохранено: ${data.storeName}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
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
              : `Всего единиц: ${activeTotal}`}
          </p>
        </div>
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
        <button
          type="button"
          className="ghost storeEquipReloadBtn"
          title="Обновить с сервера"
          disabled={reloading || Boolean(busyStore)}
          onClick={() => void load({ background: true })}
        >
          {reloading ? 'Обновление…' : '↻ Обновить'}
        </button>
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
                <th
                  className="invThNum"
                  scope="col"
                  title={detail?.warehouseLabel ? `Склад «${detail.warehouseLabel}»` : 'На складе вашей зоны'}
                >
                  {detail?.warehouseLabel ? `Склад «${detail.warehouseLabel}»` : 'Склад'}
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

const ACQUIRING_PERCENT_PLACEHOLDER: Record<AcquiringProfileId, string> = {
  'putintsev-vtb': '1.94',
  'detkov-vtb': '2',
  'putintsev-sber': '1.8',
  'lyokha-rs': '1.8',
};

const ACQUIRING_PROFILE_BADGE: Record<AcquiringProfileId, string> = {
  'putintsev-vtb': 'ВТБ',
  'detkov-vtb': 'ДВ',
  'putintsev-sber': 'СБ',
  'lyokha-rs': 'Л',
};

function AccountantProcurementPanel({
  layout = 'horizontal',
  token,
  profiles,
  onProfilesChange,
  onSaveProfiles,
  webMobileLayout = false,
}: {
  layout?: 'horizontal' | 'vertical';
  token: string;
  profiles: AcquiringProfile[];
  onProfilesChange: (profiles: AcquiringProfile[]) => void;
  onSaveProfiles: (token: string, profiles: AcquiringProfile[]) => Promise<void>;
  webMobileLayout?: boolean;
}) {
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<AcquiringProfileId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const queueSave = (next: AcquiringProfile[]) => {
    onProfilesChange(next);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      void (async () => {
        setError('');
        try {
          await onSaveProfiles(token, profilesRef.current);
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1200);
        } catch {
          setError('Не удалось сохранить настройки эквайринга');
        }
      })();
    }, 400);
  };

  const isVertical = layout === 'vertical';

  const panel = (
    <section
      className={`directorWarehouseCatalogCard acquiringCard${isVertical ? ' acquiringCard--vertical' : ''}`}
    >
      <header className="directorWarehouseCatalogHeader">
        <div className="directorWarehouseCatalogTitleRow">
          <h4 className="directorWarehouseCatalogTitle">Эквайринг</h4>
          {saved ? (
            <span className="invInlineOk acquiringSavedBadge" aria-live="polite">
              Сохранено
            </span>
          ) : null}
        </div>
        <p className="directorWarehouseCatalogHint">
          Комиссия с безнала и привязка торговых точек к расчётному счёту
        </p>
      </header>

      {error ? (
        <p className="invInlineError acquiringError" role="alert">
          {error}
        </p>
      ) : null}

      <div className="invTableScroll invTableScrollFit acquiringTableWrap">
        <table className="invTable invTableAcquiring">
          <thead>
            <tr>
              <th scope="col">Счёт</th>
              <th scope="col">Точки</th>
              <th className="invThNum acquiringThPct" scope="col">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const editing = editingProfileId === profile.id;
              const assignedStores = storesForProfile(profile.id, profiles);
              const isDefaultAccount = profile.id === ACQUIRING_DEFAULT_PROFILE_ID;
              return (
                <Fragment key={profile.id}>
                  <tr
                    className={`acquiringTr${editing ? ' acquiringTr--open' : ''}`}
                    data-profile={profile.id}
                  >
                    <td className="invTdName acquiringTdAccount">
                      <button
                        type="button"
                        className="acquiringAccountBtn"
                        aria-expanded={editing}
                        onClick={() => setEditingProfileId(editing ? null : profile.id)}
                      >
                        <span className="acquiringAccountBtnMain">
                          <span
                            className={`directorWarehouseCardBadge acquiringBadge acquiringBadge--${profile.id}`}
                            aria-hidden
                          >
                            {ACQUIRING_PROFILE_BADGE[profile.id]}
                          </span>
                          <span className="acquiringAccountLabel">{profile.label}</span>
                        </span>
                        <span className="acquiringRowChevron" aria-hidden>
                          {editing ? '▴' : '▾'}
                        </span>
                      </button>
                    </td>
                    <td className="acquiringTdStores">
                      {assignedStores.length === 0 ? (
                        <span className="acquiringStoresMuted">Нет точек</span>
                      ) : isDefaultAccount &&
                        assignedStores.length === ALL_DEMO_STORE_NAMES.length ? (
                        <span className="acquiringStoresSummary">Все точки</span>
                      ) : (
                        <div
                          className="directorWarehouseStoreChips acquiringStoreChips"
                          aria-label={`Точки: ${profile.label}`}
                        >
                          {assignedStores.map((storeName) => (
                            <span key={`${profile.id}-${storeName}`} className="directorWarehouseStoreChip">
                              {acquiringStoreChipLabel(storeName)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="invTdNum acquiringTdPct">
                      <div
                        className="dwReplenish acquiringPctWrap"
                        role="group"
                        aria-label={`Комиссия: ${profile.label}`}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <input
                          className="dwReplenishInput acquiringPctInput"
                          inputMode="decimal"
                          value={String(profile.percent)}
                          onChange={(event) => {
                            const raw = event.target.value.replace(',', '.');
                            if (raw.trim() === '' || raw === '.' || raw === ',') {
                              return;
                            }
                            const num = Number(raw);
                            if (!Number.isFinite(num)) {
                              return;
                            }
                            queueSave(setProfilePercent(profilesRef.current, profile.id, num));
                          }}
                          onBlur={(event) => {
                            const num = Number(String(event.target.value).replace(',', '.'));
                            if (!Number.isFinite(num) || num < 0 || num > 100) {
                              return;
                            }
                            queueSave(setProfilePercent(profilesRef.current, profile.id, num));
                          }}
                          placeholder={ACQUIRING_PERCENT_PLACEHOLDER[profile.id]}
                        />
                        <span className="acquiringPctSuffix" aria-hidden>
                          %
                        </span>
                      </div>
                    </td>
                  </tr>
                  {editing ? (
                    <tr className="acquiringTrExpand">
                      <td colSpan={3}>
                        <div className="acquiringPicker">
                          <p className="acquiringPickerHint">
                            {isDefaultAccount
                              ? 'Счёт по умолчанию: сюда попадают точки без привязки к другим счетам. Чтобы убрать точку — отметьте её на другом счёте.'
                              : `Отметьте точки для «${profile.label}». Одна точка — только на одном счёте.`}
                          </p>
                          <div className="invTableScroll acquiringPickerScroll">
                            <table
                              className="invTable invTableAcquiringStores"
                              aria-label={`Выбор точек: ${profile.label}`}
                            >
                              <thead>
                                <tr>
                                  <th scope="col">Точка</th>
                                  <th scope="col">Сейчас</th>
                                  <th className="invThAction acquiringStorePickTh" scope="col">
                                    На счёте
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {ALL_DEMO_STORE_NAMES.map((storeName) => {
                                  const on = isStoreOnProfile(storeName, profile.id, profiles);
                                  const ownerId = profileIdForStore(storeName, profiles);
                                  const owner = profiles.find((item) => item.id === ownerId);
                                  const canTurnOff = canUnassignStoreFromProfile(
                                    storeName,
                                    profile.id,
                                    profiles,
                                  );
                                  const lockedOnDefault =
                                    isDefaultAccount && on && !canTurnOff;
                                  return (
                                    <tr
                                      key={`${profile.id}-pick-${storeName}`}
                                      className={on ? 'acquiringStoreTr--on' : ''}
                                    >
                                      <td className="invTdName acquiringStoreName">
                                        {acquiringStoreChipLabel(storeName)}
                                      </td>
                                      <td className="acquiringStoreOwner">
                                        {owner?.label ?? '—'}
                                      </td>
                                      <td className="invTdAction acquiringStorePickTd">
                                        <button
                                          type="button"
                                          className={`acquiringStorePickBtn${on ? ' acquiringStorePickBtn--on' : ''}`}
                                          aria-pressed={on}
                                          aria-label={`${on ? 'Убрать' : 'Добавить'}: ${storeName}`}
                                          disabled={lockedOnDefault}
                                          onClick={() => {
                                            if (on && !canTurnOff) {
                                              return;
                                            }
                                            queueSave(
                                              toggleStoreOnProfile(
                                                profilesRef.current,
                                                profile.id,
                                                storeName,
                                                !on,
                                              ),
                                            );
                                          }}
                                        >
                                          {on ? '✓' : ''}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="acquiringPickerActions">
                            <button
                              type="button"
                              className="invPrimaryMini acquiringPickerDone"
                              onClick={() => setEditingProfileId(null)}
                            >
                              Готово
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  if (webMobileLayout && !isVertical) {
    return (
      <WebWarehouseSheet
        id="acquiring-standalone"
        title="Эквайринг"
        open={sheetOpen}
        onToggle={() => setSheetOpen((open) => !open)}
        className="webWarehouseSheet--acquiring webWarehouseSheet--standalone"
      >
        <div className="webWarehouseSheetEmbeddedPanel">{panel}</div>
      </WebWarehouseSheet>
    );
  }

  return panel;
}

function FinanceReportPanel({
  token,
  sales,
  sellers,
  procurementCosts,
  role,
  acquiringProfiles,
  onRefreshFinanceInputs,
  onLoadPlans,
  onSavePlans,
}: {
  token: string;
  sales: AdminSale[];
  sellers: SellerProfile[];
  procurementCosts: ProductProcurementCost[];
  role: 'DIRECTOR' | 'ACCOUNTANT' | 'ADMIN' | 'SELLER';
  acquiringProfiles: AcquiringProfile[];
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
  const procurementByNormKey = useMemo(
    () => new Map(procurementCosts.map((item) => [normProcurementKey(item.name), item.cost])),
    [procurementCosts],
  );
  const salesForDay = useMemo(
    () =>
      sales.filter((sale) => {
        const day = calendarDayKeyMoscow(sale.createdAt);
        return day >= fromDay && day <= toDay;
      }),
    [sales, fromDay, toDay],
  );
  const planByStore = useMemo(
    () => new Map(plans.map((item) => [item.storeName, item.planRevenue])),
    [plans],
  );

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

  const storeNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...sellers.map((seller) => seller.storeName),
          ...sales
            .map((sale) => sellers.find((s) => s.id === sale.sellerId)?.storeName)
            .filter((name): name is string => Boolean(name)),
        ]),
      ).sort((a, b) => a.localeCompare(b, 'ru-RU')),
    [sellers, sales],
  );

  const rows = useMemo(() => {
    const rateBySellerId = new Map(sellers.map((seller) => [seller.id, seller.ratePercent]));
    return storeNames.map((storeName) => {
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
      const acquiringRateForStore = percentForStore(storeName, acquiringProfiles);
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
              lineSum +
              (procurementByNormKey.get(normProcurementKey(String(line.name))) ?? 0) * line.qty,
            0,
          )
        );
      }, 0);
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
  }, [
    storeNames,
    sellers,
    salesForDay,
    acquiringProfiles,
    procurementByNormKey,
    planDraft,
    planByStore,
  ]);

  const totals = useMemo(
    () =>
      rows.reduce(
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
      ),
    [rows],
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
