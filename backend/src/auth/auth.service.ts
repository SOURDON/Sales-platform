import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CashEventType as PrismaCashEventType,
  CommissionRequestStatus as PrismaCommissionRequestStatus,
  DirectorApprovalKind as PrismaDirectorApprovalKind,
  DirectorApprovalState as PrismaDirectorApprovalState,
  FinanceAccountKind as PrismaFinanceAccountKind,
  PaymentType as PrismaPaymentType,
  Prisma,
  StaffPosition,
  ShiftStatus,
  UserRole as PrismaUserRole,
  WriteOffReason,
} from '@prisma/client';
import {
  type AcquiringProfile,
  defaultAcquiringProfiles,
  normalizeAcquiringProfiles,
  parseAcquiringProfilesJson,
  percentForStore,
  profileIdForStore,
  serializeAcquiringProfiles,
  syncLegacyPercentsFromProfiles,
} from '../acquiring/acquiring-profiles';
import {
  FINANCE_EXPENSE_CATEGORY_LABELS,
  isFinanceExpenseCategoryLabel,
  normalizeFinanceCategoryAmounts,
  serializeFinanceCategoryAmounts,
  defaultFinanceCategoryAmounts,
} from '../finance/expense-categories';
import {
  ensureDemoData,
  ensureManagerStaffAndAssignments,
  ensureManagerUserIfMissing,
  ensureRetoucherUsersIfMissing,
} from '../database/ensure-demo-data';
import { migrateLegacyDemoNicknames } from '../database/migrate-demo-nicknames';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDefaultDemoUserRows,
  buildDefaultManagerStoreAssignments,
  buildDefaultSellerProfileRows,
  buildDefaultStaffRows,
} from './build-demo-entities';
import { getDefaultDemoPassword } from './demo-password';
import {
  CENTRAL_WAREHOUSE_LOCATION_KEY,
  DEMO_STORE_NAMES,
  MANAGER_ASSIGNED_STORE_NAMES,
  MANAGER_USER_NICKNAME,
  WAREHOUSE_KEYS,
  WAREHOUSE_SADY_KEY,
  WAREHOUSES,
  isWarehouseKey,
  storesForWarehouse,
  warehouseKeyForStore,
  warehouseLabelForKey,
} from './demo-stores';

export type UserRole = 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';

type CommissionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface CommissionChangeRequest {
  id: string;
  createdAt: string;
  sellerId: number;
  requestedByNickname: string;
  requestedPercent: number;
  previousPercent: number;
  status: CommissionRequestStatus;
  comment?: string;
}

interface DemoUser {
  id: number;
  nickname: string;
  password: string;
  fullName: string;
  role: UserRole;
  storeName: string;
  isActive: boolean;
}

interface GlobalEmployee {
  id: number;
  fullName: string;
  nickname: string;
  homeStore: string;
  isActive: boolean;
}

interface DemoTokenPayload {
  sub: number;
  nickname: string;
  role: UserRole;
  exp: number;
}

interface SaleLine {
  name: string;
  qty: number;
}

type SalePaymentType = 'CASH' | 'NON_CASH' | 'TRANSFER';

function prismaPaymentTypeToInternal(pt: PrismaPaymentType): SalePaymentType {
  if (pt === PrismaPaymentType.NON_CASH) {
    return 'NON_CASH';
  }
  if (pt === PrismaPaymentType.TRANSFER) {
    return 'TRANSFER';
  }
  return 'CASH';
}

function internalPaymentTypeToPrisma(pt: SalePaymentType): PrismaPaymentType {
  if (pt === 'NON_CASH') {
    return PrismaPaymentType.NON_CASH;
  }
  if (pt === 'TRANSFER') {
    return PrismaPaymentType.TRANSFER;
  }
  return PrismaPaymentType.CASH;
}

export type StoreEquipmentBuiltinKey =
  | 'pc'
  | 'camera'
  | 'printer'
  | 'sdCard'
  | 'monitor'
  | 'mouse'
  | 'keyboard'
  | 'cardReader';

export type StoreEquipmentCounts = {
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

export type StoreEquipmentCustomTypeDto = { id: string; label: string };

const STORE_EQUIPMENT_BUILTIN_KEYS: StoreEquipmentBuiltinKey[] = [
  'pc',
  'camera',
  'printer',
  'sdCard',
  'monitor',
  'mouse',
  'keyboard',
  'cardReader',
];

function parseStoreEquipmentExtra(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim()) {
      out[k.trim()] = clampEquipmentInt(v);
    }
  }
  return out;
}

function emptyStoreEquipmentCounts(): StoreEquipmentCounts {
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

function clampEquipmentInt(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(9999, n);
}

interface SaleRecord {
  id: string;
  createdAt: string;
  items: SaleLine[];
  totalAmount: number;
  units: number;
  paymentType: SalePaymentType;
}

interface SellerProfile {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
  salesAmount: number;
  checksCount: number;
  sales: SaleRecord[];
  commissionAmount: number;
}

interface WriteOffItem {
  id: string;
  createdAt: string;
  name: string;
  qty: number;
  reason: 'Брак' | 'Поломка';
}

type DirectorApprovalKindMem = 'SALE_DELETE' | 'WRITE_OFF';
type DirectorApprovalStateMem = 'PENDING' | 'APPROVED' | 'REJECTED';

interface DirectorApprovalPayloadMem {
  saleId?: string;
  name?: string;
  qty?: number;
  reason?: string;
  totalAmount?: number;
  units?: number;
  items?: Array<{ name: string; qty: number }>;
  sellerId?: number;
  sellerName?: string;
  sellerNickname?: string;
}

interface DirectorApprovalRequestMem {
  id: string;
  createdAt: string;
  kind: DirectorApprovalKindMem;
  state: DirectorApprovalStateMem;
  requestedByNickname: string;
  storeName: string;
  payload: DirectorApprovalPayloadMem;
  resolvedAt?: string;
  resolvedBy?: string;
}

type CashEventType = 'RETURN' | 'CANCEL' | 'ADJUSTMENT';

interface Shift {
  id: string;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  assignedSellerIds: number[];
  checksCount: number;
  itemsCount: number;
  status: 'OPEN' | 'CLOSED';
}

interface CashDisciplineEvent {
  id: string;
  createdAt: string;
  type: CashEventType;
  comment: string;
  createdBy: string;
}

type StaffPositionKind = 'SALES' | 'RETOUCHER' | 'MANAGER';

interface StaffMember {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
  staffPosition: StaffPositionKind;
  /** Доля от дневной выручки точки для RETOUCHER (остальным позициям не используется). */
  retoucherRatePercent: number;
  /** Для ретушёра: начисление за текущий календарный день по точке. */
  earningsAmount: number;
}

interface StoreStaffAssignment {
  storeName: string;
  staffId: number;
}

type StaffMigrationRow = StaffMember & {
  storeName?: string;
  assignedStores?: string[];
};

function staffStoresFromMigrationRow(row: StaffMigrationRow): string[] {
  if (Array.isArray(row.assignedStores) && row.assignedStores.length > 0) {
    return [...row.assignedStores];
  }
  const home = row.storeName?.trim();
  if (home && home !== 'Все точки') {
    return [home];
  }
  if (row.staffPosition === 'MANAGER' || row.nickname === MANAGER_USER_NICKNAME) {
    return [...MANAGER_ASSIGNED_STORE_NAMES];
  }
  return [];
}

interface ThresholdNotification {
  id: string;
  type: 'LOW_STOCK' | 'HIGH_DAMAGE_WRITE_OFF' | 'NO_SALES';
  message: string;
  createdAt: string;
}

interface AuditLogItem {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  details: string;
}

type FinanceAccountKind = 'CASH' | 'BANK';

interface FinanceAccount {
  id: string;
  name: string;
  kind: FinanceAccountKind;
  balance: number;
}

interface FinanceExpense {
  id: string;
  createdAt: string;
  title: string;
  amount: number;
  comment?: string;
  createdBy: string;
  accountId: string;
  accountName: string;
}

interface FinanceIncome {
  id: string;
  createdAt: string;
  workDay: string;
  amount: number;
  comment?: string;
  createdBy: string;
  accountId: string;
  accountName: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  public productCatalog: Array<{ name: string; price: number }> = [];

  private readonly logger = new Logger(AuthService.name);
  private readonly persistenceEnabled = Boolean(process.env.DATABASE_URL);
  private static readonly MAX_AUDIT_LOG_ITEMS = 3000;
  /** Продажи старше этого окна не держим в RAM. На Timeweb задайте SALES_MEMORY_DAYS=1825 в .env. */
  private static salesMemoryDays(): number {
    const n = Number(process.env.SALES_MEMORY_DAYS ?? 730);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : 730;
  }
  /** Склеивает частые записи в одну, чтобы не переписывать всю БД на каждый чих. */
  private static readonly PERSIST_DEBOUNCE_MS = 2000;
  private persistChain: Promise<void> = Promise.resolve();
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private persistFlushScheduled = false;
  private dashboardOverviewCache: { nickname: string; at: number; payload: unknown } | null = null;
  private static readonly DASHBOARD_OVERVIEW_CACHE_MS = 20_000;

  private commissionChangeRequests: CommissionChangeRequest[] = [];
  private directorApprovalRequests: DirectorApprovalRequestMem[] = [];
  private currentShiftId: string | null = null;
  private lastSaleAt: string | null = null;
  private acquiringPercent = 1.8;
  private acquiringPercentDetkov = 1.8;
  private acquiringPercentPutintsevSber = 1.8;
  private acquiringPercentLyokha = 1.8;
  private acquiringProfilesJson: string | null = null;
  private shiftHistory: Shift[] = [];
  private cashDisciplineEvents: CashDisciplineEvent[] = [];
  private staff: StaffMember[] = [];
  private storeStaffAssignments: StoreStaffAssignment[] = [];
  /** Остатки: ключ локации — центральный склад или `storeName` точки. */
  private productStockByLocation: Record<string, Record<string, number>> = {};
  private productProcurementCosts: Record<string, number> = {};
  private storeRevenuePlans: Record<string, Record<string, number>> = {};
  /** Процент управляющего от дневной выручки точки (0 = не участвует). */
  private managerStoreCommissions: Record<string, number> = {};
  private auditLog: AuditLogItem[] = [];
  private adminWriteOffs: WriteOffItem[] = [];
  private financeAccounts: FinanceAccount[] = [];
  private financeExpenses: FinanceExpense[] = [];
  private financeIncomes: FinanceIncome[] = [];
  /** Отдельный журнал «Оперативка авто» — не смешивается с ручной оперативкой. */
  private autoFinanceAccounts: FinanceAccount[] = [];
  private autoFinanceIncomes: FinanceIncome[] = [];
  private financeExpenseCategoryAmounts: Record<string, number> = defaultFinanceCategoryAmounts();
  private storeEquipmentByStore: Record<string, StoreEquipmentCounts> = {};
  private storeEquipmentCustomTypes: StoreEquipmentCustomTypeDto[] = [];

  private allStockLocationKeys(): string[] {
    return [...WAREHOUSE_KEYS, ...DEMO_STORE_NAMES];
  }

  private migrateLegacyCentralWarehouse(): void {
    const legacy = this.productStockByLocation[CENTRAL_WAREHOUSE_LOCATION_KEY];
    if (!legacy) {
      return;
    }
    for (const [productName, qty] of Object.entries(legacy)) {
      if (!Number.isFinite(qty) || qty <= 0) {
        continue;
      }
      this.ensureStockCell(WAREHOUSE_SADY_KEY, productName);
      const row = this.productStockByLocation[WAREHOUSE_SADY_KEY];
      row[productName] = (row[productName] ?? 0) + qty;
    }
    delete this.productStockByLocation[CENTRAL_WAREHOUSE_LOCATION_KEY];
  }

  private stockLocationLabel(locationKey: string): string {
    if (isWarehouseKey(locationKey)) {
      return `склад «${warehouseLabelForKey(locationKey)}»`;
    }
    return `точка «${locationKey}»`;
  }

  private ensureStockCell(locationKey: string, productName: string): void {
    if (!this.productStockByLocation[locationKey]) {
      this.productStockByLocation[locationKey] = {};
    }
    const row = this.productStockByLocation[locationKey];
    if (row[productName] === undefined) {
      row[productName] = 0;
    }
  }

  private syncStockWithCatalog(): void {
    const names = this.productCatalog.map((p) => p.name.trim()).filter(Boolean);
    for (const loc of this.allStockLocationKeys()) {
      if (!this.productStockByLocation[loc]) {
        this.productStockByLocation[loc] = {};
      }
      const m = this.productStockByLocation[loc];
      for (const nm of names) {
        if (m[nm] === undefined) {
          m[nm] = 0;
        }
      }
    }
    const allowed = new Set(names);
    for (const loc of Object.keys(this.productStockByLocation)) {
      const m = this.productStockByLocation[loc];
      for (const k of Object.keys(m)) {
        if (!allowed.has(k)) {
          delete m[k];
        }
      }
    }
  }

  private getStockQty(locationKey: string, productName: string): number {
    return this.productStockByLocation[locationKey]?.[productName] ?? 0;
  }

  private addStockDelta(locationKey: string, productName: string, delta: number): void {
    this.ensureStockCell(locationKey, productName);
    const row = this.productStockByLocation[locationKey];
    row[productName] = Math.round((row[productName] ?? 0) + delta);
  }

  private stockStoreKeyForActor(actor: string): string | null {
    const user = this.demoUsers.find((u) => u.nickname === actor);
    if (!user) {
      return null;
    }
    if (user.role === 'ADMIN') {
      return user.storeName;
    }
    return null;
  }

  getInventoryOverview() {
    this.syncStockWithCatalog();
    const warehouses = WAREHOUSES.map((w) => ({
      key: w.key,
      label: w.label,
      storeNames: [...storesForWarehouse(w.key)],
    }));
    const products = this.productCatalog.map((p) => {
      const stockByWarehouse: Record<string, { qtyWarehouse: number; qtyInStores: number }> = {};
      let qtyGrandTotal = 0;
      for (const w of WAREHOUSES) {
        const qtyWarehouse = this.getStockQty(w.key, p.name);
        const qtyInStores = storesForWarehouse(w.key).reduce(
          (sum, storeName) => sum + this.getStockQty(storeName, p.name),
          0,
        );
        stockByWarehouse[w.key] = { qtyWarehouse, qtyInStores };
        qtyGrandTotal += qtyWarehouse + qtyInStores;
      }
      return {
        name: p.name,
        price: p.price,
        stockByWarehouse,
        qtyGrandTotal,
      };
    });
    return {
      warehouses,
      storeNames: [...DEMO_STORE_NAMES],
      products,
    };
  }

  getStoreInventoryDetail(storeName: string) {
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(storeName)) {
      return null;
    }
    const warehouseKey = warehouseKeyForStore(storeName);
    if (!warehouseKey) {
      return null;
    }
    this.syncStockWithCatalog();
    const products = this.productCatalog.map((p) => ({
      name: p.name,
      price: p.price,
      qtyInStore: this.getStockQty(storeName, p.name),
      qtyOnWarehouse: this.getStockQty(warehouseKey, p.name),
    }));
    return {
      storeName,
      warehouseKey,
      warehouseLabel: warehouseLabelForKey(warehouseKey),
      products,
    };
  }

  addProductToCatalog(
    name: string,
    price: number,
    actor: string,
  ): { name: string; price: number } | { error: string } {
    const trimmed = name.trim();
    if (!trimmed) {
      return { error: 'Укажите название товара' };
    }
    if (trimmed.length > 120) {
      return { error: 'Слишком длинное название' };
    }
    const exists = this.productCatalog.some(
      (p) => p.name.trim().toLocaleLowerCase('ru-RU') === trimmed.toLocaleLowerCase('ru-RU'),
    );
    if (exists) {
      return { error: 'Такой товар уже есть в каталоге' };
    }
    const salePrice = Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0;
    const item = { name: trimmed, price: salePrice };
    this.productCatalog.push(item);
    this.syncProcurementKeysWithCatalog();
    this.syncStockWithCatalog();
    this.pushAudit(actor, 'PRODUCT_ADDED', trimmed);
    this.queuePersist();
    return item;
  }

  removeProductFromCatalog(
    name: string,
    actor: string,
  ): { ok: true } | { error: string } {
    const trimmed = name.trim();
    if (!trimmed) {
      return { error: 'Укажите название товара' };
    }
    const product = this.productCatalog.find(
      (p) => p.name.trim().toLocaleLowerCase('ru-RU') === trimmed.toLocaleLowerCase('ru-RU'),
    );
    if (!product) {
      return { error: 'Товар не найден в каталоге' };
    }
    const catalogName = product.name;
    let stockTotal = 0;
    for (const loc of this.allStockLocationKeys()) {
      stockTotal += this.getStockQty(loc, catalogName);
    }
    if (stockTotal > 0) {
      return {
        error: `Нельзя удалить: осталось ${stockTotal} шт. на складах и точках. Сначала спишите или переместите остатки.`,
      };
    }
    this.productCatalog = this.productCatalog.filter((p) => p.name !== catalogName);
    delete this.productProcurementCosts[catalogName];
    for (const loc of Object.keys(this.productStockByLocation)) {
      const row = this.productStockByLocation[loc];
      if (row) {
        delete row[catalogName];
      }
    }
    this.syncProcurementKeysWithCatalog();
    this.syncStockWithCatalog();
    this.pushAudit(actor, 'PRODUCT_REMOVED', catalogName);
    this.queuePersist();
    return { ok: true };
  }

  renameProductInCatalog(
    oldName: string,
    newName: string,
    actor: string,
  ): { name: string; price: number } | { error: string } {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    if (!trimmedOld || !trimmedNew) {
      return { error: 'Укажите название товара' };
    }
    if (trimmedNew.length > 120) {
      return { error: 'Слишком длинное название' };
    }
    const product = this.productCatalog.find(
      (p) => p.name.trim().toLocaleLowerCase('ru-RU') === trimmedOld.toLocaleLowerCase('ru-RU'),
    );
    if (!product) {
      return { error: 'Товар не найден в каталоге' };
    }
    const catalogName = product.name;
    if (catalogName.trim().toLocaleLowerCase('ru-RU') === trimmedNew.toLocaleLowerCase('ru-RU')) {
      return { name: catalogName, price: product.price };
    }
    const exists = this.productCatalog.some(
      (p) =>
        p.name !== catalogName &&
        p.name.trim().toLocaleLowerCase('ru-RU') === trimmedNew.toLocaleLowerCase('ru-RU'),
    );
    if (exists) {
      return { error: 'Товар с таким названием уже есть' };
    }
    product.name = trimmedNew;
    for (const loc of Object.keys(this.productStockByLocation)) {
      const row = this.productStockByLocation[loc];
      if (!row || row[catalogName] === undefined) {
        continue;
      }
      const qty = row[catalogName];
      delete row[catalogName];
      row[trimmedNew] = qty;
    }
    if (catalogName in this.productProcurementCosts) {
      this.productProcurementCosts[trimmedNew] = this.productProcurementCosts[catalogName]!;
      delete this.productProcurementCosts[catalogName];
    }
    for (const wo of this.adminWriteOffs) {
      if (wo.name === catalogName) {
        wo.name = trimmedNew;
      }
    }
    for (const seller of this.sellerProfiles) {
      for (const sale of seller.sales) {
        for (const item of sale.items) {
          if (item.name.trim() === catalogName) {
            item.name = trimmedNew;
          }
        }
      }
    }
    this.syncProcurementKeysWithCatalog();
    this.syncStockWithCatalog();
    this.pushAudit(actor, 'PRODUCT_RENAMED', `${catalogName} → ${trimmedNew}`);
    this.queuePersist();
    return { name: trimmedNew, price: product.price };
  }

  replenishWarehouseStock(
    productName: string,
    qty: number,
    actor: string,
    warehouseKey: string,
  ) {
    const name = productName?.trim();
    if (
      !name ||
      !this.productCatalog.some((p) => p.name === name) ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !isWarehouseKey(warehouseKey)
    ) {
      return null;
    }
    const n = Math.floor(qty);
    this.addStockDelta(warehouseKey, name, n);
    this.pushAudit(
      actor,
      'WAREHOUSE_REPLENISH',
      `${name} +${n} → ${warehouseLabelForKey(warehouseKey)}`,
    );
    this.queuePersist();
    return { ok: true as const };
  }

  transferWarehouseToStore(storeName: string, productName: string, qty: number, actor: string) {
    const actorUser = this.demoUsers.find((u) => u.nickname === actor);
    if (!actorUser) {
      return null;
    }
    if (actorUser.role === 'ADMIN' && actorUser.storeName !== storeName) {
      return null;
    }
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(storeName)) {
      return null;
    }
    const name = productName?.trim();
    if (!name || !this.productCatalog.some((p) => p.name === name)) {
      return null;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return null;
    }
    const warehouseKey = warehouseKeyForStore(storeName);
    if (!warehouseKey) {
      return null;
    }
    const n = Math.floor(qty);
    if (this.getStockQty(warehouseKey, name) < n) {
      return null;
    }
    this.addStockDelta(warehouseKey, name, -n);
    this.addStockDelta(storeName, name, n);
    this.pushAudit(
      actor,
      'INVENTORY_TRANSFER_TO_STORE',
      `${name} ${n} шт. (${warehouseLabelForKey(warehouseKey)}) → ${storeName}`,
    );
    this.queuePersist();
    return { ok: true as const };
  }

  resetWarehouseStock(warehouseKey: string, actor: string) {
    if (!isWarehouseKey(warehouseKey)) {
      return null;
    }
    this.syncStockWithCatalog();
    const storeNames = storesForWarehouse(warehouseKey);
    const locationKeys = [warehouseKey, ...storeNames];
    for (const p of this.productCatalog) {
      for (const loc of locationKeys) {
        this.ensureStockCell(loc, p.name);
        this.productStockByLocation[loc][p.name] = 0;
      }
    }
    this.pushAudit(
      actor,
      'WAREHOUSE_RESET',
      `Обнулён склад «${warehouseLabelForKey(warehouseKey)}» и ${storeNames.length} точек`,
    );
    this.queuePersist();
    return { ok: true as const, storeNames: [...storeNames] };
  }

  getWriteOffs(filters?: { reason?: 'Брак' | 'Поломка'; dateFrom?: string; dateTo?: string }) {
    return this.adminWriteOffs
      .filter((item) => {
        if (filters?.reason && item.reason !== filters.reason) {
          return false;
        }
        if (filters?.dateFrom && new Date(item.createdAt) < new Date(filters.dateFrom)) {
          return false;
        }
        if (filters?.dateTo && new Date(item.createdAt) > new Date(filters.dateTo)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getWriteOffsCsv(filters?: { reason?: 'Брак' | 'Поломка'; dateFrom?: string; dateTo?: string }) {
    const rows = this.getWriteOffs(filters);
    const header = 'id;createdAt;name;qty;reason';
    const lines = rows.map(
      (item) => `${item.id};${item.createdAt};${item.name};${item.qty};${item.reason}`,
    );
    return [header, ...lines].join('\n');
  }

  getProductProcurementCosts() {
    return this.productCatalog.map((item) => {
      const k = item.name.trim();
      return {
        name: item.name,
        cost: k in this.productProcurementCosts ? this.productProcurementCosts[k]! : 0,
      };
    });
  }

  getStoreRevenuePlans(dayKey: string) {
    const plans = this.storeRevenuePlans[dayKey] ?? {};
    return DEMO_STORE_NAMES.map((storeName) => ({
      dayKey,
      storeName,
      planRevenue: plans[storeName] ?? 0,
    }));
  }

  setStoreRevenuePlans(
    dayKey: string,
    items: Array<{ storeName: string; planRevenue: number }>,
    actor = 'system',
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      return this.getStoreRevenuePlans(new Date().toISOString().slice(0, 10));
    }
    const validStores = new Set(DEMO_STORE_NAMES);
    const current = this.storeRevenuePlans[dayKey] ?? {};
    for (const item of items) {
      if (!validStores.has(item.storeName as (typeof DEMO_STORE_NAMES)[number])) {
        continue;
      }
      if (!Number.isFinite(item.planRevenue) || item.planRevenue < 0) {
        continue;
      }
      current[item.storeName] = Math.round(item.planRevenue * 100) / 100;
    }
    this.storeRevenuePlans[dayKey] = current;
    this.pushAudit(actor, 'STORE_REVENUE_PLAN_UPDATED', `day=${dayKey}, rows=${items.length}`);
    this.queuePersist();
    return this.getStoreRevenuePlans(dayKey);
  }

  getAcquiringPercent() {
    return this.acquiringPercent;
  }

  getAcquiringPercentDetkov() {
    return this.acquiringPercentDetkov;
  }

  getAcquiringPercentPutintsevSber() {
    return this.acquiringPercentPutintsevSber;
  }

  getAcquiringPercentLyokha() {
    return this.acquiringPercentLyokha;
  }

  getAcquiringProfiles(): AcquiringProfile[] {
    return parseAcquiringProfilesJson(this.acquiringProfilesJson, {
      putintsevVtb: this.acquiringPercent,
      detkovVtb: this.acquiringPercentDetkov,
      putintsevSber: this.acquiringPercentPutintsevSber,
      lyokhaRs: this.acquiringPercentLyokha,
    });
  }

  getAcquiringConfig() {
    const profiles = this.getAcquiringProfiles();
    const legacy = syncLegacyPercentsFromProfiles(profiles);
    return {
      percent: legacy.acquiringPercent,
      detkovPercent: legacy.acquiringPercentDetkov,
      putintsevSberPercent: legacy.acquiringPercentPutintsevSber,
      lyokhaPercent: legacy.acquiringPercentLyokha,
      profiles,
    };
  }

  setAcquiringProfiles(profilesInput: unknown, actor = 'system') {
    const profiles = normalizeAcquiringProfiles(profilesInput, {
      putintsevVtb: this.acquiringPercent,
      detkovVtb: this.acquiringPercentDetkov,
      putintsevSber: this.acquiringPercentPutintsevSber,
      lyokhaRs: this.acquiringPercentLyokha,
    });
    const legacy = syncLegacyPercentsFromProfiles(profiles);
    this.acquiringPercent = legacy.acquiringPercent;
    this.acquiringPercentDetkov = legacy.acquiringPercentDetkov;
    this.acquiringPercentPutintsevSber = legacy.acquiringPercentPutintsevSber;
    this.acquiringPercentLyokha = legacy.acquiringPercentLyokha;
    this.acquiringProfilesJson = serializeAcquiringProfiles(profiles);
    this.pushAudit(actor, 'ACQUIRING_PROFILES_UPDATED', `${profiles.length} profiles`);
    this.queueIncremental(() => this.persistIncrementalAcquiringConfig());
    return this.getAcquiringConfig();
  }

  getFinanceOpsSnapshot() {
    const accounts = this.financeAccounts
      .map((item) => ({ ...item }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'));
    const expenses = [...this.financeExpenses].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const incomes = [...this.financeIncomes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const cashTotal = accounts
      .filter((item) => item.kind === 'CASH')
      .reduce((sum, item) => sum + item.balance, 0);
    const bankTotal = accounts
      .filter((item) => item.kind === 'BANK')
      .reduce((sum, item) => sum + item.balance, 0);
    const totalBalance = cashTotal + bankTotal;
    const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
    const incomeTotal = incomes.reduce((sum, item) => sum + item.amount, 0);
    const categoryAmounts = this.getFinanceCategoryAmountRows();
    const categoryTotal = categoryAmounts.reduce((sum, row) => sum + row.amount, 0);
    return {
      accounts,
      expenses,
      incomes,
      categoryAmounts,
      totals: {
        cash: Math.round(cashTotal * 100) / 100,
        bank: Math.round(bankTotal * 100) / 100,
        balance: Math.round(totalBalance * 100) / 100,
        expenses: Math.round(expenseTotal * 100) / 100,
        incomes: Math.round(incomeTotal * 100) / 100,
        categoryTotal: Math.round(categoryTotal * 100) / 100,
      },
    };
  }

  private getFinanceCategoryAmountRows() {
    return FINANCE_EXPENSE_CATEGORY_LABELS.map((title) => ({
      title,
      amount: Math.round((this.financeExpenseCategoryAmounts[title] ?? 0) * 100) / 100,
    }));
  }

  setFinanceExpenseCategoryAmount(title: string, amount: number, actor = 'system') {
    const trimmed = title.trim();
    if (!isFinanceExpenseCategoryLabel(trimmed)) {
      return null;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }
    const safe = Math.round(amount * 100) / 100;
    this.financeExpenseCategoryAmounts[trimmed] = safe;
    this.pushAudit(actor, 'FINANCE_CATEGORY_AMOUNT_UPDATED', `${trimmed}=${safe}`);
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalFinanceCategoryAmounts());
    return { title: trimmed, amount: safe };
  }

  setAcquiringPercent(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercent = Math.round(percent * 1000) / 1000;
    this.pushAudit(actor, 'ACQUIRING_PERCENT_UPDATED', String(this.acquiringPercent));
    this.syncAcquiringProfilesJsonFromLegacyPercents();
    this.queueIncremental(() => this.persistIncrementalAcquiringConfig());
    return { percent: this.acquiringPercent };
  }

  setAcquiringPercentDetkov(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercentDetkov = Math.round(percent * 1000) / 1000;
    this.pushAudit(actor, 'ACQUIRING_PERCENT_DETKOV_UPDATED', String(this.acquiringPercentDetkov));
    this.syncAcquiringProfilesJsonFromLegacyPercents();
    this.queueIncremental(() => this.persistIncrementalAcquiringConfig());
    return { percent: this.acquiringPercentDetkov };
  }

  setAcquiringPercentPutintsevSber(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercentPutintsevSber = Math.round(percent * 1000) / 1000;
    this.pushAudit(
      actor,
      'ACQUIRING_PERCENT_PUTINTSEV_SBER_UPDATED',
      String(this.acquiringPercentPutintsevSber),
    );
    this.syncAcquiringProfilesJsonFromLegacyPercents();
    this.queueIncremental(() => this.persistIncrementalAcquiringConfig());
    return { percent: this.acquiringPercentPutintsevSber };
  }

  setAcquiringPercentLyokha(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercentLyokha = Math.round(percent * 1000) / 1000;
    this.pushAudit(actor, 'ACQUIRING_PERCENT_LYOKHA_UPDATED', String(this.acquiringPercentLyokha));
    this.syncAcquiringProfilesJsonFromLegacyPercents();
    this.queueIncremental(() => this.persistIncrementalAcquiringConfig());
    return { percent: this.acquiringPercentLyokha };
  }

  private syncAcquiringProfilesJsonFromLegacyPercents() {
    const profiles = this.getAcquiringProfiles();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    if (byId.has('putintsev-vtb')) {
      byId.get('putintsev-vtb')!.percent = this.acquiringPercent;
    }
    if (byId.has('detkov-vtb')) {
      byId.get('detkov-vtb')!.percent = this.acquiringPercentDetkov;
    }
    if (byId.has('putintsev-sber')) {
      byId.get('putintsev-sber')!.percent = this.acquiringPercentPutintsevSber;
    }
    if (byId.has('lyokha-rs')) {
      byId.get('lyokha-rs')!.percent = this.acquiringPercentLyokha;
    }
    this.acquiringProfilesJson = serializeAcquiringProfiles(
      profiles.map((p) => byId.get(p.id) ?? p),
    );
  }

  setFinanceAccountBalance(id: string, balance: number, actor = 'system') {
    if (!id || !Number.isFinite(balance) || balance < 0) {
      return null;
    }
    const account = this.financeAccounts.find((item) => item.id === id);
    if (!account) {
      return null;
    }
    account.balance = Math.round(balance * 100) / 100;
    this.pushAudit(actor, 'FINANCE_ACCOUNT_BALANCE_UPDATED', `${account.name}=${account.balance}`);
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalFinanceAccountBalance(account.id));
    return account;
  }

  addFinanceIncome(
    payload: {
      accountId: string;
      amount: number;
      workDay: string;
      comment?: string;
      incomeId?: string;
    },
    actor = 'system',
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.workDay)) {
      return null;
    }
    if (!payload.accountId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      return null;
    }
    const trimmedIncomeId =
      typeof payload.incomeId === 'string'
        ? payload.incomeId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;
    if (trimmedIncomeId) {
      const existing = this.financeIncomes.find((item) => item.id === trimmedIncomeId);
      if (existing) {
        return existing;
      }
    }
    const account = this.financeAccounts.find((item) => item.id === payload.accountId);
    if (!account) {
      return null;
    }
    const amount = Math.round(payload.amount * 100) / 100;
    account.balance = Math.round((account.balance + amount) * 100) / 100;
    const income: FinanceIncome = {
      id: trimmedIncomeId ?? `finc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      workDay: payload.workDay,
      amount,
      comment: payload.comment?.trim() || undefined,
      createdBy: actor,
      accountId: account.id,
      accountName: account.name,
    };
    this.financeIncomes.push(income);
    this.pushAudit(
      actor,
      'FINANCE_INCOME_ADDED',
      `day=${payload.workDay} ${account.name} +${amount}`,
    );
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalFinanceIncome(income));
    return income;
  }

  private static readonly AUTO_FINANCE_ACCOUNT_PREFIX = 'auto-';

  private static readonly AUTO_FINANCE_INCOME_ACCOUNT_BY_BUCKET: Record<string, string> = {
    'detkov-vtb': 'auto-fa-bank-extra',
    'putintsev-vtb': 'auto-fa-bank-main',
    'putintsev-sber': 'auto-fa-bank-putintsev-sber',
    'lyokha-rs': 'auto-fa-bank-lyokha',
    cash: 'auto-fa-cash-main',
    transfer: 'auto-fa-transfer',
  };

  private defaultAutoFinanceAccounts(): FinanceAccount[] {
    return this.defaultFinanceAccounts().map((item) => ({
      ...item,
      id: `${AuthService.AUTO_FINANCE_ACCOUNT_PREFIX}${item.id}`,
      balance: 0,
    }));
  }

  private serializeAutoFinanceState() {
    return JSON.stringify({
      accounts: this.autoFinanceAccounts,
      incomes: this.autoFinanceIncomes,
    });
  }

  private loadAutoFinanceStateFromJson(json: string | null | undefined) {
    this.autoFinanceAccounts = this.defaultAutoFinanceAccounts();
    this.autoFinanceIncomes = [];
    if (!json) {
      return;
    }
    try {
      const parsed = JSON.parse(json) as {
        accounts?: FinanceAccount[];
        incomes?: FinanceIncome[];
      };
      if (Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
        const canon = this.defaultAutoFinanceAccounts();
        const byId = new Map(parsed.accounts.map((a) => [a.id, a]));
        this.autoFinanceAccounts = canon.map((def) => {
          const cur = byId.get(def.id);
          return cur
            ? { ...def, balance: Math.round(Number(cur.balance) * 100) / 100 || 0 }
            : { ...def };
        });
      }
      if (Array.isArray(parsed.incomes)) {
        this.autoFinanceIncomes = parsed.incomes.filter(
          (item) => item && typeof item.id === 'string' && typeof item.accountId === 'string',
        );
      }
    } catch {
      this.autoFinanceAccounts = this.defaultAutoFinanceAccounts();
      this.autoFinanceIncomes = [];
    }
  }

  private queuePersistAutoFinanceState() {
    this.queueIncremental(() => this.persistAutoFinanceState());
  }

  private async persistAutoFinanceState() {
    await this.prisma.appState.upsert({
      where: { id: 1 },
      update: { autoFinanceStateJson: this.serializeAutoFinanceState() },
      create: {
        id: 1,
        autoFinanceStateJson: this.serializeAutoFinanceState(),
        acquiringPercent: this.acquiringPercent,
        acquiringPercentDetkov: this.acquiringPercentDetkov,
        acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
        acquiringPercentLyokha: this.acquiringPercentLyokha,
      },
    });
  }

  getAutoFinanceOpsSnapshot() {
    const accounts = this.autoFinanceAccounts
      .map((item) => ({ ...item }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'));
    const incomes = [...this.autoFinanceIncomes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const cashTotal = accounts
      .filter((item) => item.kind === 'CASH')
      .reduce((sum, item) => sum + item.balance, 0);
    const bankTotal = accounts
      .filter((item) => item.kind === 'BANK')
      .reduce((sum, item) => sum + item.balance, 0);
    const totalBalance = cashTotal + bankTotal;
    const incomeTotal = incomes.reduce((sum, item) => sum + item.amount, 0);
    return {
      accounts,
      expenses: [] as FinanceExpense[],
      incomes,
      categoryAmounts: [] as Array<{ title: string; amount: number }>,
      totals: {
        cash: Math.round(cashTotal * 100) / 100,
        bank: Math.round(bankTotal * 100) / 100,
        balance: Math.round(totalBalance * 100) / 100,
        expenses: 0,
        incomes: Math.round(incomeTotal * 100) / 100,
        categoryTotal: 0,
      },
    };
  }

  private manualAccountIdFromAuto(accountId: string) {
    return accountId.startsWith(AuthService.AUTO_FINANCE_ACCOUNT_PREFIX)
      ? accountId.slice(AuthService.AUTO_FINANCE_ACCOUNT_PREFIX.length)
      : accountId;
  }

  private autoAccountIdFromManual(accountId: string) {
    return accountId.startsWith(AuthService.AUTO_FINANCE_ACCOUNT_PREFIX)
      ? accountId
      : `${AuthService.AUTO_FINANCE_ACCOUNT_PREFIX}${accountId}`;
  }

  /** Убирает старые auto-sync приходы из ручной оперативки (однократно после обновления). */
  private async detachLegacyAutoIncomesFromManualLedger() {
    const legacy = this.financeIncomes.filter((item) => item.id.startsWith('auto-sync-'));
    if (legacy.length === 0) {
      return;
    }
    this.financeIncomes = this.financeIncomes.filter((item) => !item.id.startsWith('auto-sync-'));
    for (const income of legacy) {
      const account = this.financeAccounts.find((item) => item.id === income.accountId);
      if (account) {
        account.balance = Math.round((account.balance - income.amount) * 100) / 100;
      }
      const autoAccountId = this.autoAccountIdFromManual(income.accountId);
      const autoAccount = this.autoFinanceAccounts.find((item) => item.id === autoAccountId);
      if (!autoAccount) {
        continue;
      }
      const existingAuto = this.autoFinanceIncomes.find((item) => item.id === income.id);
      if (!existingAuto) {
        this.autoFinanceIncomes.push({
          ...income,
          accountId: autoAccountId,
          accountName: autoAccount.name,
        });
        autoAccount.balance = Math.round((autoAccount.balance + income.amount) * 100) / 100;
      }
    }
    if (this.persistenceEnabled) {
      await this.prisma.$transaction(async (tx) => {
        await tx.financeIncome.deleteMany({ where: { id: { startsWith: 'auto-sync-' } } });
        for (const account of this.financeAccounts) {
          await tx.financeAccount.update({
            where: { id: account.id },
            data: { balance: account.balance },
          });
        }
      });
      await this.persistAutoFinanceState();
    }
    this.pushAudit('system', 'FINANCE_AUTO_DETACHED_FROM_MANUAL', `moved=${legacy.length}`);
    this.invalidateDashboardCache();
  }

  private autoFinanceIncomeId(workDay: string, accountId: string) {
    return `auto-sync-${workDay}-${accountId}`;
  }

  private addAutoFinanceIncome(
    payload: {
      accountId: string;
      amount: number;
      workDay: string;
      comment?: string;
      incomeId?: string;
    },
    actor = 'system',
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.workDay)) {
      return null;
    }
    if (!payload.accountId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      return null;
    }
    const trimmedIncomeId =
      typeof payload.incomeId === 'string'
        ? payload.incomeId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;
    if (trimmedIncomeId) {
      const existing = this.autoFinanceIncomes.find((item) => item.id === trimmedIncomeId);
      if (existing) {
        return existing;
      }
    }
    const account = this.autoFinanceAccounts.find((item) => item.id === payload.accountId);
    if (!account) {
      return null;
    }
    const amount = Math.round(payload.amount * 100) / 100;
    account.balance = Math.round((account.balance + amount) * 100) / 100;
    const income: FinanceIncome = {
      id: trimmedIncomeId ?? `afinc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      workDay: payload.workDay,
      amount,
      comment: payload.comment?.trim() || undefined,
      createdBy: actor,
      accountId: account.id,
      accountName: account.name,
    };
    this.autoFinanceIncomes.push(income);
    this.pushAudit(
      actor,
      'AUTO_FINANCE_INCOME_ADDED',
      `day=${payload.workDay} ${account.name} +${amount}`,
    );
    this.queuePersistAutoFinanceState();
    return income;
  }

  /** Суммы приходов по счетам из продаж всех точек за календарный день (МСК). */
  computeFinanceIncomeBucketsFromSales(workDay: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDay)) {
      return [];
    }
    const profiles = this.getAcquiringProfiles();
    const buckets = new Map<string, number>();
    const add = (key: string, value: number) => {
      const prev = buckets.get(key) ?? 0;
      buckets.set(key, Math.round((prev + value) * 100) / 100);
    };

    for (const seller of this.sellerProfiles) {
      this.recomputeSeller(seller);
      const storeName = seller.storeName;
      for (const sale of seller.sales) {
        if (this.getStoreBusinessDayKey(sale.createdAt) !== workDay) {
          continue;
        }
        const amount = sale.totalAmount;
        if (sale.paymentType === 'TRANSFER') {
          add('transfer', amount);
          continue;
        }
        if (sale.paymentType !== 'NON_CASH') {
          add('cash', amount);
          continue;
        }
        const rate = percentForStore(storeName, profiles);
        const netAmount = amount - (amount * rate) / 100;
        add(profileIdForStore(storeName, profiles), netAmount);
      }
    }

    const order = [
      'putintsev-vtb',
      'detkov-vtb',
      'putintsev-sber',
      'lyokha-rs',
      'cash',
      'transfer',
    ] as const;

    return order
      .map((bucket) => {
        const amount = buckets.get(bucket) ?? 0;
        const accountId = AuthService.AUTO_FINANCE_INCOME_ACCOUNT_BY_BUCKET[bucket];
        const account = accountId
          ? this.autoFinanceAccounts.find((item) => item.id === accountId)
          : undefined;
        return {
          bucket,
          accountId: account?.id ?? accountId ?? '',
          accountName: account?.name ?? bucket,
          amount: Math.round(amount * 100) / 100,
        };
      })
      .filter((row) => row.accountId);
  }

  previewAutoFinanceIncomesFromSales(workDay: string) {
    const rows = this.computeFinanceIncomeBucketsFromSales(workDay);
    const existingByAccount = new Map(
      this.autoFinanceIncomes
        .filter((item) => item.workDay === workDay && item.id.startsWith(`auto-sync-${workDay}-`))
        .map((item) => [item.accountId, item]),
    );
    return {
      workDay,
      rows: rows.map((row) => ({
        ...row,
        alreadySynced: existingByAccount.has(row.accountId),
        previousAmount: existingByAccount.get(row.accountId)?.amount ?? 0,
      })),
      totalToSync: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    };
  }

  private upsertAutoFinanceIncomeFromSales(
    workDay: string,
    accountId: string,
    amount: number,
    actor: string,
  ) {
    const safeAmount = Math.round(amount * 100) / 100;
    if (!accountId || safeAmount <= 0) {
      return { income: null, created: false, updated: false, skipped: true as const };
    }
    const account = this.autoFinanceAccounts.find((item) => item.id === accountId);
    if (!account) {
      return { income: null, created: false, updated: false, skipped: true as const };
    }

    const incomeId = this.autoFinanceIncomeId(workDay, accountId);
    const comment = `Авто: продажи всех точек за ${workDay}`;
    const existing = this.autoFinanceIncomes.find((item) => item.id === incomeId);
    if (existing) {
      const delta = Math.round((safeAmount - existing.amount) * 100) / 100;
      if (Math.abs(delta) < 0.005) {
        return { income: existing, created: false, updated: false, skipped: false as const };
      }
      account.balance = Math.round((account.balance + delta) * 100) / 100;
      existing.amount = safeAmount;
      existing.comment = comment;
      this.pushAudit(
        actor,
        'AUTO_FINANCE_INCOME_UPDATED',
        `day=${workDay} ${account.name} →${safeAmount}`,
      );
      this.queuePersistAutoFinanceState();
      return { income: existing, created: false, updated: true, skipped: false as const };
    }

    const income = this.addAutoFinanceIncome(
      {
        accountId,
        amount: safeAmount,
        workDay,
        comment,
        incomeId,
      },
      actor,
    );
    return {
      income,
      created: Boolean(income),
      updated: false,
      skipped: !income,
    };
  }

  syncFinanceIncomesFromSales(workDay: string, actor = 'system') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDay)) {
      return null;
    }
    const rows = this.computeFinanceIncomeBucketsFromSales(workDay);
    const applied: Array<{
      accountId: string;
      accountName: string;
      amount: number;
      created: boolean;
      updated: boolean;
      skipped: boolean;
    }> = [];

    for (const row of rows) {
      const result = this.upsertAutoFinanceIncomeFromSales(workDay, row.accountId, row.amount, actor);
      applied.push({
        accountId: row.accountId,
        accountName: row.accountName,
        amount: row.amount,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      });
    }

    this.pushAudit(actor, 'AUTO_FINANCE_INCOMES_SYNCED', `day=${workDay} rows=${applied.length}`);
    return {
      workDay,
      applied,
      snapshot: this.getAutoFinanceOpsSnapshot(),
    };
  }

  addFinanceExpense(
    payload: {
      accountId: string;
      title: string;
      amount: number;
      comment?: string;
      expenseId?: string;
    },
    actor = 'system',
  ) {
    const title = payload.title?.trim();
    if (!payload.accountId || !title || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      return null;
    }
    const trimmedExpenseId =
      typeof payload.expenseId === 'string'
        ? payload.expenseId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;
    if (trimmedExpenseId) {
      const existingExp = this.financeExpenses.find((item) => item.id === trimmedExpenseId);
      if (existingExp) {
        return existingExp;
      }
    }
    const account = this.financeAccounts.find((item) => item.id === payload.accountId);
    if (!account) {
      return null;
    }
    const amount = Math.round(payload.amount * 100) / 100;
    const balanceCents = Math.round(account.balance * 100);
    const amountCents = Math.round(amount * 100);
    if (balanceCents < amountCents) {
      return null;
    }
    account.balance = Math.round((account.balance - amount) * 100) / 100;
    const expense: FinanceExpense = {
      id: trimmedExpenseId ?? `fexp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      title,
      amount,
      comment: payload.comment?.trim() || undefined,
      createdBy: actor,
      accountId: account.id,
      accountName: account.name,
    };
    this.financeExpenses.push(expense);
    const categoryKey = isFinanceExpenseCategoryLabel(title) ? title : 'Прочие траты';
    const prevCategory = this.financeExpenseCategoryAmounts[categoryKey] ?? 0;
    this.financeExpenseCategoryAmounts[categoryKey] =
      Math.round((prevCategory + amount) * 100) / 100;
    this.pushAudit(actor, 'FINANCE_EXPENSE_ADDED', `${title}: ${amount} from ${account.name}`);
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalFinanceExpense(expense));
    return expense;
  }

  /** Очистка оперативки: все приходы/расходы, статьи расходов → 0, остатки счетов обнуляются. */
  resetFinanceOps(actor = 'system') {
    const expenseCount = this.financeExpenses.length;
    const incomeCount = this.financeIncomes.length;
    this.financeExpenses = [];
    this.financeIncomes = [];
    this.financeExpenseCategoryAmounts = defaultFinanceCategoryAmounts();
    for (const account of this.financeAccounts) {
      account.balance = 0;
    }
    this.pushAudit(
      actor,
      'FINANCE_OPS_RESET',
      `expenses=${expenseCount} incomes=${incomeCount} balances=0`,
    );
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalFinanceReset());
    return this.getFinanceOpsSnapshot();
  }

  setProductProcurementCosts(
    updates: Array<{ name: string; cost: number }>,
    actor = 'system',
  ) {
    const validNames = new Set(this.productCatalog.map((item) => item.name));
    for (const row of updates) {
      const name = row.name?.trim();
      if (!name || !validNames.has(name)) {
        continue;
      }
      if (!Number.isFinite(row.cost) || row.cost < 0) {
        continue;
      }
      this.productProcurementCosts[name] = Math.round(row.cost * 100) / 100;
    }
    this.pushAudit(actor, 'PRODUCT_COSTS_UPDATED', `rows=${updates.length}`);
    this.syncProcurementKeysWithCatalog();
    this.queueIncremental(() => this.persistIncrementalProcurementCosts());
    return this.getProductProcurementCosts();
  }

  /** У каждого товара из каталога есть ключ закупки (иначе persist мог очистить таблицу). */
  private syncProcurementKeysWithCatalog() {
    for (const p of this.productCatalog) {
      const k = p.name.trim();
      if (!k) {
        continue;
      }
      if (!(k in this.productProcurementCosts)) {
        this.productProcurementCosts[k] = 0;
      }
    }
  }

  private defaultFinanceAccounts(): FinanceAccount[] {
    return [
      { id: 'fa-bank-extra', name: 'Р/с Д ВТБ', kind: 'BANK', balance: 0 },
      { id: 'fa-bank-main', name: 'Р/с П ВТБ', kind: 'BANK', balance: 0 },
      { id: 'fa-bank-putintsev-sber', name: 'Р/с П СБЕР', kind: 'BANK', balance: 0 },
      { id: 'fa-bank-lyokha', name: 'Р/с Лёха', kind: 'BANK', balance: 0 },
      { id: 'fa-transfer', name: 'Перевод', kind: 'BANK', balance: 0 },
      { id: 'fa-cash-main', name: 'Наличные', kind: 'CASH', balance: 0 },
    ];
  }

  /** Добавляет новые счета из эталона и приводит названия к актуальным подписи в UI. */
  private mergeFinanceAccountsWithDefaults(loaded: FinanceAccount[]): FinanceAccount[] {
    const canonical = this.defaultFinanceAccounts();
    const canonById = new Map(canonical.map((a) => [a.id, a]));
    const byId = new Map(loaded.map((a) => [a.id, { ...a }]));
    for (const [id, def] of canonById) {
      const cur = byId.get(id);
      if (!cur) {
        byId.set(id, { ...def });
      } else {
        cur.name = def.name;
        cur.kind = def.kind;
      }
    }
    const primaryOrder = canonical.map((a) => a.id);
    const ordered: FinanceAccount[] = [];
    for (const id of primaryOrder) {
      const acc = byId.get(id);
      if (acc) {
        ordered.push(acc);
        byId.delete(id);
      }
    }
    const rest = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'));
    return [...ordered, ...rest];
  }

  private demoUsers: DemoUser[] = [];
  private sellerProfiles: SellerProfile[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.persistenceEnabled) {
      this.loadDefaultState();
      this.logger.warn('DATABASE_URL is not set. Using in-memory fallback mode.');
      return;
    }
    await this.seedIfNeeded();
    await this.loadState();
  }

  login(nickname: string, password: string) {
    const user = this.demoUsers.find(
      (item) => item.nickname === nickname && item.password === password,
    );

    if (!user || !user.isActive) {
      return null;
    }

    return {
      token: this.createDemoToken(user),
      user: {
        id: user.id,
        nickname: user.nickname,
        fullName: user.fullName,
        role: user.role,
        storeName: user.storeName,
      },
    };
  }

  directorListDemoAccounts() {
    const allowedRoles: UserRole[] = ['DIRECTOR', 'ACCOUNTANT', 'MANAGER', 'ADMIN'];
    const roleRank = (role: UserRole) => {
      if (role === 'DIRECTOR') {
        return 0;
      }
      if (role === 'ACCOUNTANT') {
        return 1;
      }
      if (role === 'MANAGER') {
        return 2;
      }
      if (role === 'ADMIN') {
        return 3;
      }
      return 9;
    };
    return [...this.demoUsers]
      .filter((u) => u.isActive && allowedRoles.includes(u.role))
      .sort((a, b) => {
        const byRole = roleRank(a.role) - roleRank(b.role);
        if (byRole !== 0) {
          return byRole;
        }
        return a.nickname.localeCompare(b.nickname, 'ru-RU');
      })
      .map((u) => ({
        nickname: u.nickname,
        fullName: u.fullName,
        role: u.role,
        storeName: u.storeName,
        password: u.password,
      }));
  }

  directorSetDemoUserPassword(directorNickname: string, targetNickname: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
      return { ok: false as const, error: 'bad_password' };
    }
    const director = this.demoUsers.find((u) => u.nickname === directorNickname);
    if (!director || director.role !== 'DIRECTOR') {
      return { ok: false as const, error: 'forbidden' };
    }
    const target = this.demoUsers.find((u) => u.nickname === targetNickname);
    if (!target) {
      return { ok: false as const, error: 'not_found' };
    }
    if (
      target.role !== 'DIRECTOR' &&
      target.role !== 'ACCOUNTANT' &&
      target.role !== 'MANAGER' &&
      target.role !== 'ADMIN'
    ) {
      return { ok: false as const, error: 'role_not_allowed' };
    }
    target.password = newPassword;
    this.pushAudit(directorNickname, 'DIRECTOR_SET_USER_PASSWORD', `user=${targetNickname}`);
    this.queuePersist();
    return { ok: true as const };
  }

  getStoreNameForNickname(nickname: string): string | null {
    return this.demoUsers.find((u) => u.nickname === nickname)?.storeName ?? null;
  }

  getStoreEquipmentCustomTypes(): StoreEquipmentCustomTypeDto[] {
    return this.storeEquipmentCustomTypes.map((t) => ({ ...t }));
  }

  getStoreEquipmentForStore(storeName: string): StoreEquipmentCounts {
    const row = this.storeEquipmentByStore[storeName];
    if (!row) {
      return emptyStoreEquipmentCounts();
    }
    return {
      ...row,
      extra: { ...row.extra },
    };
  }

  getAllStoresEquipmentForAccountant(): Array<{ storeName: string } & StoreEquipmentCounts> {
    return DEMO_STORE_NAMES.map((sn) => ({
      storeName: sn,
      ...this.getStoreEquipmentForStore(sn),
    }));
  }

  addStoreEquipmentCustomType(
    label: string,
    actorNickname: string,
  ): StoreEquipmentCustomTypeDto | { error: string } {
    const trimmed = label.trim();
    if (!trimmed) {
      return { error: 'Укажите название' };
    }
    if (trimmed.length > 64) {
      return { error: 'Слишком длинное название' };
    }
    const exists = this.storeEquipmentCustomTypes.some(
      (t) => t.label.toLocaleLowerCase('ru-RU') === trimmed.toLocaleLowerCase('ru-RU'),
    );
    if (exists) {
      return { error: 'Такой вид техники уже есть' };
    }
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const created: StoreEquipmentCustomTypeDto = { id, label: trimmed };
    this.storeEquipmentCustomTypes.push(created);
    for (const sn of DEMO_STORE_NAMES) {
      const cur = this.getStoreEquipmentForStore(sn);
      this.storeEquipmentByStore[sn] = {
        ...cur,
        extra: { ...cur.extra, [id]: cur.extra[id] ?? 0 },
      };
    }
    this.pushAudit(actorNickname, 'STORE_EQUIPMENT_TYPE_ADDED', trimmed);
    this.queuePersist();
    return created;
  }

  updateStoreEquipmentByAccountant(
    storeName: string,
    patch: Partial<StoreEquipmentCounts> & { extra?: Record<string, number> },
    actorNickname: string,
  ): StoreEquipmentCounts | null {
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(storeName)) {
      return null;
    }
    const cur = this.getStoreEquipmentForStore(storeName);
    const next: StoreEquipmentCounts = {
      ...cur,
      extra: { ...cur.extra },
    };
    for (const k of STORE_EQUIPMENT_BUILTIN_KEYS) {
      if (patch[k] !== undefined) {
        next[k] = clampEquipmentInt(patch[k]);
      }
    }
    if (patch.extra !== undefined && typeof patch.extra === 'object') {
      for (const t of this.storeEquipmentCustomTypes) {
        if (patch.extra[t.id] !== undefined) {
          next.extra[t.id] = clampEquipmentInt(patch.extra[t.id]);
        }
      }
    }
    this.storeEquipmentByStore[storeName] = next;
    this.pushAudit(actorNickname, 'STORE_EQUIPMENT_UPDATED', storeName);
    this.queueIncremental(() => this.persistIncrementalStoreEquipment(storeName));
    return next;
  }

  parseToken(token: string): DemoTokenPayload | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const payload = JSON.parse(decoded) as DemoTokenPayload;
      if (!payload.nickname || !payload.role) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private getStoreRevenueForDay(storeName: string, dayKey: string): number {
    let revenue = 0;
    for (const p of this.sellerProfiles) {
      if (p.storeName !== storeName) {
        continue;
      }
      for (const sale of p.sales) {
        if (this.getStoreBusinessDayKey(sale.createdAt) !== dayKey) {
          continue;
        }
        revenue += sale.totalAmount;
      }
    }
    return revenue;
  }

  private managerPercentForStore(storeName: string): number {
    const raw = this.managerStoreCommissions[storeName];
    if (raw === undefined || raw === null || !Number.isFinite(raw)) {
      return 5;
    }
    return Math.max(0, Math.min(100, Math.round(raw * 1000) / 1000));
  }

  private managerSalaryForDay(dayKey: string): number {
    let total = 0;
    for (const store of DEMO_STORE_NAMES) {
      const pct = this.managerPercentForStore(store);
      if (pct <= 0) {
        continue;
      }
      const revenue = this.getStoreRevenueForDay(store, dayKey);
      total += Math.round((revenue * pct) / 100);
    }
    return total;
  }

  getManagerStoreCommissions() {
    return DEMO_STORE_NAMES.map((storeName) => ({
      storeName,
      percent: this.managerPercentForStore(storeName),
    }));
  }

  setManagerStoreCommissions(
    items: Array<{ storeName: string; percent: number }>,
    actor: string,
  ) {
    for (const item of items) {
      const storeName = item.storeName?.trim();
      if (!storeName || !(DEMO_STORE_NAMES as readonly string[]).includes(storeName)) {
        continue;
      }
      const pct = Number(item.percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        continue;
      }
      this.managerStoreCommissions[storeName] = Math.round(pct * 1000) / 1000;
    }
    this.pushAudit(actor, 'MANAGER_STORE_COMMISSIONS_UPDATED', 'rates');
    this.queuePersist();
    return this.getManagerStoreCommissions();
  }

  private invalidateDashboardCache() {
    this.dashboardOverviewCache = null;
  }

  private cacheDashboardOverview(nickname: string, payload: unknown) {
    if (payload) {
      this.dashboardOverviewCache = { nickname, at: Date.now(), payload };
    }
    return payload;
  }

  getDashboardOverview(nickname: string) {
    const user = this.demoUsers.find((item) => item.nickname === nickname);
    if (!user) {
      return null;
    }
    const cacheHit = this.dashboardOverviewCache;
    if (
      cacheHit &&
      cacheHit.nickname === nickname &&
      Date.now() - cacheHit.at < AuthService.DASHBOARD_OVERVIEW_CACHE_MS
    ) {
      return cacheHit.payload;
    }
    this.ensureActiveShiftForToday();

    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT') {
      let totalRevenue = 0;
      let totalSellerCommission = 0;
      for (const p of this.sellerProfiles) {
        this.recomputeSeller(p);
        totalRevenue += p.salesAmount;
        totalSellerCommission += p.commissionAmount;
      }
      this.syncRetoucherEarnings();
      let retoucherTotal = 0;
      for (const m of this.staff) {
        if (m.staffPosition !== 'RETOUCHER' || !m.isActive) {
          continue;
        }
        const u = this.demoUsers.find((d) => d.id === m.id);
        if (u?.isActive) {
          retoucherTotal += m.earningsAmount;
        }
      }
      const today = this.getStoreBusinessDayKey(new Date().toISOString());
      const managerSalaryToday = this.managerSalaryForDay(today);
      const totalCommission = totalSellerCommission + retoucherTotal + managerSalaryToday;
      const roughPurchases = Math.round(totalRevenue * 0.43);
      const netCompany = Math.max(0, Math.round(totalRevenue - roughPurchases - totalCommission));
      const storeRows = DEMO_STORE_NAMES.map((name) => {
        let rev = 0;
        let salaries = 0;
        for (const p of this.sellerProfiles) {
          if (p.storeName !== name) {
            continue;
          }
          this.recomputeSeller(p);
          rev += p.salesAmount;
          salaries += p.commissionAmount;
        }
        for (const m of this.staff) {
          if (m.staffPosition !== 'RETOUCHER' || !m.isActive) {
            continue;
          }
          const u = this.demoUsers.find((d) => d.id === m.id);
          if (u?.storeName === name && u.isActive) {
            salaries += m.earningsAmount;
          }
        }
        return {
          name,
          revenue: this.formatCurrency(rev),
          salaries: this.formatCurrency(salaries),
        };
      });
      return this.cacheDashboardOverview(nickname, {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: user.role === 'DIRECTOR' ? 'Сводка директора' : 'Сводка бухгалтера',
        metrics: [
          { label: 'Выручка (все точки)', value: this.formatCurrency(Math.round(totalRevenue)) },
          { label: 'Чистая прибыль (оценка)', value: this.formatCurrency(netCompany) },
          { label: 'Выплаты персоналу', value: this.formatCurrency(Math.round(totalCommission)) },
        ],
        stores: storeRows,
      });
    }

    if (user.role === 'MANAGER') {
      const today = this.getStoreBusinessDayKey(new Date().toISOString());
      const salaryToday = this.managerSalaryForDay(today);
      const planDayPlans = this.storeRevenuePlans[today] ?? {};
      const storeRows = DEMO_STORE_NAMES.map((name) => {
        const revenue = this.getStoreRevenueForDay(name, today);
        const pct = this.managerPercentForStore(name);
        const salary = pct <= 0 ? 0 : Math.round((revenue * pct) / 100);
        return {
          name,
          revenue: this.formatCurrency(Math.round(revenue)),
          salaries:
            pct <= 0
              ? `${this.formatCurrency(0)} (0%)`
              : `${this.formatCurrency(salary)} (${pct}%)`,
        };
      });
      const managerRevenuePlanCompliance = {
        dayKey: today,
        items: DEMO_STORE_NAMES.map((storeName) => {
          const rawPlan = planDayPlans[storeName];
          const hasPlan =
            typeof rawPlan === 'number' && Number.isFinite(rawPlan) && Math.round(rawPlan) > 0;
          const planRub = hasPlan ? Math.round(rawPlan) : 0;
          const actualRub = Math.round(this.getStoreRevenueForDay(storeName, today));
          const met = hasPlan && actualRub >= planRub;
          const progressPct = hasPlan ? Math.min(100, Math.round((actualRub / planRub) * 100)) : 0;
          return { storeName, planRub, actualRub, hasPlan, met, progressPct };
        }),
      };
      return this.cacheDashboardOverview(nickname, {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: 'Сводка управляющего',
        metrics: [
          { label: 'Зарплата управляющего (сегодня)', value: this.formatCurrency(salaryToday) },
          {
            label: 'Ставка',
            value: 'Процент с каждой точки (настраивает директор)',
          },
        ],
        stores: storeRows,
        managerRevenuePlanCompliance,
      });
    }

    if (user.role === 'ADMIN') {
      const storeName = user.storeName;
      const staffAtStoreIds = new Set(this.getStoreAssignedStaffIds(storeName));
      const openShift = this.shiftHistory.find((item) => item.status === 'OPEN');
      const inOpenShiftIds = openShift
        ? openShift.assignedSellerIds.filter((id) => staffAtStoreIds.has(id))
        : [];
      const openShiftsForStore = inOpenShiftIds.length > 0 ? 1 : 0;

      let storeRevenue = 0;
      let storeSalaries = 0;
      for (const p of this.sellerProfiles) {
        if (p.storeName !== user.storeName) {
          continue;
        }
        this.recomputeSeller(p);
        storeRevenue += p.salesAmount;
        storeSalaries += p.commissionAmount;
      }

      const today = this.getStoreBusinessDayKey(new Date().toISOString());
      let payCash = 0;
      let payAcquiring = 0;
      let payTransfer = 0;
      for (const p of this.sellerProfiles) {
        if (p.storeName !== user.storeName) {
          continue;
        }
        for (const sale of p.sales) {
          if (this.getStoreBusinessDayKey(sale.createdAt) !== today) {
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
      }

      this.syncRetoucherEarnings();
      for (const staffId of staffAtStoreIds) {
        const m = this.staff.find((item) => item.id === staffId);
        if (!m || m.staffPosition !== 'RETOUCHER' || !m.isActive) {
          continue;
        }
        storeSalaries += m.earningsAmount;
      }

      const sellerRegisterToday = (sellerId: number) => {
        let total = 0;
        for (const p of this.sellerProfiles) {
          if (p.id !== sellerId) {
            continue;
          }
          this.recomputeSeller(p);
          for (const sale of p.sales) {
            if (this.getStoreBusinessDayKey(sale.createdAt) !== today) {
              continue;
            }
            total += sale.totalAmount;
          }
        }
        return total;
      };
      const sellerRegister: Array<{ staffId: number; fullName: string; nickname: string; cash: string }> =
        inOpenShiftIds
          .map((staffId) => {
            const member = this.staff.find((m) => m.id === staffId);
            const profile = this.sellerProfiles.find((p) => p.id === staffId);
            const fullName = member?.fullName ?? profile?.fullName ?? `Сотрудник #${staffId}`;
            const nickname = member?.nickname ?? profile?.nickname ?? '';
            const cash =
              member?.staffPosition === 'RETOUCHER'
                ? this.formatCurrency(Math.round(member.earningsAmount))
                : this.formatCurrency(Math.round(sellerRegisterToday(staffId)));
            return { staffId, fullName, nickname, cash };
          })
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

      return this.cacheDashboardOverview(nickname, {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: user.storeName,
        metrics: [
          { label: 'Продажи (точка)', value: this.formatCurrency(Math.round(storeRevenue)) },
          { label: 'Открытые смены (точка)', value: String(openShiftsForStore) },
        ],
        stores: [
          {
            name: user.storeName,
            revenue: this.formatCurrency(Math.round(storeRevenue)),
            salaries: this.formatCurrency(Math.round(storeSalaries)),
            cash: this.formatCurrency(Math.round(payCash)),
            acquiring: this.formatCurrency(Math.round(payAcquiring)),
            transfer: this.formatCurrency(Math.round(payTransfer)),
          },
        ],
        sellerRegister,
      });
    }

    if (user.role === 'RETOUCHER') {
      this.syncRetoucherEarnings();
      const member = this.staff.find((m) => m.id === user.id);
      let storeRevenue = 0;
      for (const p of this.sellerProfiles) {
        if (p.storeName !== user.storeName) {
          continue;
        }
        this.recomputeSeller(p);
        storeRevenue += p.salesAmount;
      }
      const myEarn = member?.earningsAmount ?? 0;
      return {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: `Ретушёр — ${user.storeName}`,
        metrics: [
          { label: 'Выручка точки (сегодня)', value: this.formatCurrency(Math.round(storeRevenue)) },
          { label: 'Начислено (5% от выручки)', value: this.formatCurrency(Math.round(myEarn)) },
        ],
        stores: [
          {
            name: user.storeName,
            revenue: this.formatCurrency(Math.round(storeRevenue)),
            salaries: this.formatCurrency(Math.round(myEarn)),
          },
        ],
      };
    }

    if (user.role !== 'SELLER') {
      return null;
    }

    return {
      role: user.role,
      sellerDataManagedByAdmin: true,
      title: `Панель продавца (${user.storeName})`,
      metrics: (() => {
        const profile = this.sellerProfiles.find(
          (item) => item.nickname === user.nickname,
        );
        if (!profile) {
          return [
            { label: 'Продажи продавца', value: '0 ₽' },
            { label: 'Комиссия', value: '0 ₽' },
            { label: 'Чеков', value: '0' },
            { label: 'Начислено продавцу', value: '0 ₽' },
          ];
        }

        this.recomputeSeller(profile);
        return [
          { label: 'Продажи продавца', value: this.formatCurrency(profile.salesAmount) },
          { label: 'Чеков', value: String(profile.checksCount) },
          { label: 'Начислено продавцу', value: this.formatCurrency(profile.commissionAmount) },
          { label: 'Процент', value: `${profile.ratePercent}%` },
        ];
      })(),
      stores: (() => {
        const profile = this.sellerProfiles.find(
          (item) => item.nickname === user.nickname,
        );
        this.recomputeSeller(profile);
        if (!profile) {
          return [{ name: user.storeName, revenue: '0 ₽', salaries: '0 ₽' }];
        }
        return [
          {
            name: user.storeName,
            revenue: this.formatCurrency(profile.salesAmount),
            salaries: this.formatCurrency(profile.commissionAmount),
          },
        ];
      })(),
    };
  }

  getSellerProfiles() {
    return this.sellerProfiles
      .filter((item) => {
        const user = this.demoUsers.find((userItem) => userItem.id === item.id);
        return user?.isActive ?? true;
      })
      .map((item) => {
        this.recomputeSeller(item);
        const lifetimeSalesAmount = Math.round(
          item.sales.reduce((sum, sale) => sum + sale.totalAmount, 0) * 100,
        ) / 100;
        return {
          id: item.id,
          fullName: item.fullName,
          nickname: item.nickname,
          storeName: item.storeName,
          ratePercent: item.ratePercent,
          salesAmount: item.salesAmount,
          checksCount: item.checksCount,
          commissionAmount: item.commissionAmount,
          lifetimeSalesAmount,
        };
      });
  }

  getSalesSnapshot() {
    return this.sellerProfiles
      .flatMap((seller) => {
        this.recomputeSeller(seller);
        return seller.sales.map((sale) => ({
            id: sale.id,
            createdAt: sale.createdAt,
            sellerName: seller.fullName,
            sellerId: seller.id,
            totalAmount: sale.totalAmount,
            units: sale.units,
            items: sale.items,
            paymentType: sale.paymentType,
            goodsCost: this.saleGoodsCost(sale),
          }));
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  getSalesSnapshotForSession(requesterNickname: string) {
    const user = this.demoUsers.find((item) => item.nickname === requesterNickname);
    if (!user) {
      return [];
    }
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT' || user.role === 'MANAGER') {
      return this.getSalesSnapshot();
    }
    if (user.role === 'ADMIN') {
      return this.getSalesSnapshot().filter((sale) => {
        const seller = this.sellerProfiles.find((p) => p.id === sale.sellerId);
        return seller?.storeName === user.storeName;
      });
    }
    return [];
  }

  /**
   * Продажи для API: строки чека и goodsCost по актуальным данным из БД
   * (закупки и SaleItem), чтобы «потрачено на товар» не зависело от рассинхрона памяти.
   */
  async getSalesSnapshotForSessionEnriched(requesterNickname: string) {
    if (!this.persistenceEnabled) {
      return this.getSalesSnapshotForSession(requesterNickname);
    }
    const base = this.getSalesSnapshotForSession(requesterNickname);
    if (base.length === 0) {
      return base;
    }
    try {
      const costRows = await this.prisma.productProcurementCost.findMany();
      const costMap = new Map<string, number>();
      for (const row of costRows) {
        const k = this.normProcurementKey(row.name);
        const v = Number(row.cost);
        if (k && Number.isFinite(v)) {
          costMap.set(k, v);
        }
      }
      const saleIds = base.map((s) => s.id);
      const dbItems = await this.prisma.saleItem.findMany({
        where: { saleId: { in: saleIds } },
      });
      const itemsBySaleId = new Map<string, SaleLine[]>();
      for (const row of dbItems) {
        const cur = itemsBySaleId.get(row.saleId) ?? [];
        cur.push({ name: row.name.trim(), qty: row.qty });
        itemsBySaleId.set(row.saleId, cur);
      }
      return base.map((sale) => {
        const memLines = sale.items ?? [];
        const dbLines = itemsBySaleId.get(sale.id) ?? [];
        // Строки из БД надёжнее: в памяти иногда пустой items при живых SaleItem в PostgreSQL.
        const lines = dbLines.length > 0 ? dbLines : memLines;
        let gc = 0;
        for (const line of lines) {
          const nk = this.normProcurementKey(String(line.name));
          let unit = costMap.get(nk) ?? 0;
          if (unit === 0) {
            const cat = this.productCatalog.find((p) => this.normProcurementKey(p.name) === nk);
            if (cat) {
              unit = costMap.get(this.normProcurementKey(cat.name)) ?? 0;
            }
          }
          gc += unit * (Number(line.qty) || 0);
        }
        gc = Math.round(gc * 100) / 100;
        return {
          ...sale,
          items: lines,
          goodsCost: gc,
        };
      });
    } catch (error: unknown) {
      this.logger.error(
        'getSalesSnapshotForSessionEnriched failed, fallback to memory',
        error instanceof Error ? error.stack : String(error),
      );
      return this.getSalesSnapshotForSession(requesterNickname);
    }
  }

  getSellerProfilesForSession(requesterNickname: string) {
    const user = this.demoUsers.find((item) => item.nickname === requesterNickname);
    if (!user) {
      return [];
    }
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT' || user.role === 'MANAGER') {
      return this.getSellerProfiles();
    }
    if (user.role === 'ADMIN') {
      const assignedIds = new Set(this.getStoreAssignedStaffIds(user.storeName));
      return this.getSellerProfiles().filter(
        (row) => row.storeName === user.storeName || assignedIds.has(row.id),
      );
    }
    return [];
  }

  getCommissionChangeRequestsForSession(requesterNickname: string) {
    const all = this.getCommissionChangeRequests();
    const user = this.demoUsers.find((item) => item.nickname === requesterNickname);
    if (!user) {
      return [];
    }
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT' || user.role === 'MANAGER') {
      return all;
    }
    if (user.role === 'ADMIN') {
      const allowed = new Set(
        this.sellerProfiles
          .filter((p) => p.storeName === user.storeName)
          .map((p) => p.id),
      );
      return all.filter((item) => allowed.has(item.sellerId));
    }
    return [];
  }

  getStaffForSession(requesterNickname: string) {
    const all = this.getStaff();
    const user = this.demoUsers.find((item) => item.nickname === requesterNickname);
    if (!user) {
      return [];
    }
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT' || user.role === 'MANAGER') {
      return all;
    }
    if (user.role === 'ADMIN') {
      const store = user.storeName.trim();
      return all.filter((member) =>
        (member.assignedStores ?? []).includes(store),
      );
    }
    return [];
  }

  async setSellerPercentDirect(sellerId: number, ratePercent: number) {
    const pct = typeof ratePercent === 'number' ? ratePercent : Number(ratePercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return null;
    }
    const seller = this.sellerProfiles.find((item) => item.id === sellerId);
    if (seller) {
      seller.ratePercent = pct;
      this.recomputeSeller(seller);
      if (this.persistenceEnabled) {
        try {
          await this.prisma.sellerProfile.update({
            where: { id: sellerId },
            data: { ratePercent: pct },
          });
        } catch (error: unknown) {
          this.logger.warn(
            `sellerProfile.update(ratePercent) failed id=${sellerId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.queuePersist();
      await this.persistChain;
      return this.getSellerProfiles().find((item) => item.id === sellerId) ?? null;
    }
    const staffMember = this.staff.find((m) => m.id === sellerId && m.staffPosition === 'RETOUCHER');
    if (!staffMember) {
      return null;
    }
    staffMember.retoucherRatePercent = pct;
    this.syncRetoucherEarnings();
    if (this.persistenceEnabled) {
      try {
        await this.prisma.staffMember.update({
          where: { id: sellerId },
          data: { retoucherRatePercent: pct },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `staffMember.update(retoucherRatePercent) failed id=${sellerId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.queuePersist();
    await this.persistChain;
    const u = this.demoUsers.find((item) => item.id === staffMember.id);
    return {
      id: staffMember.id,
      fullName: staffMember.fullName,
      nickname: staffMember.nickname,
      storeName: u?.storeName ?? '',
      ratePercent: staffMember.retoucherRatePercent,
      salesAmount: 0,
      checksCount: 0,
      commissionAmount: 0,
    };
  }

  createCommissionChangeRequest(
    requesterNickname: string,
    sellerId: number,
    requestedPercent: number,
    comment?: string,
  ) {
    if (requestedPercent < 0 || requestedPercent > 100) {
      return null;
    }
    const seller = this.sellerProfiles.find((item) => item.id === sellerId);
    if (!seller) {
      return null;
    }
    const pending = this.commissionChangeRequests.find(
      (item) => item.sellerId === sellerId && item.status === 'PENDING',
    );
    if (pending) {
      return null;
    }
    const request: CommissionChangeRequest = {
      id: `creq-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sellerId,
      requestedByNickname: requesterNickname,
      requestedPercent,
      previousPercent: seller.ratePercent,
      status: 'PENDING',
      comment,
    };
    this.commissionChangeRequests.push(request);
    this.queuePersist();
    return request;
  }

  getCommissionChangeRequests() {
    return [...this.commissionChangeRequests].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async decideCommissionRequest(id: string, decision: 'APPROVE' | 'REJECT') {
    const request = this.commissionChangeRequests.find((item) => item.id === id);
    if (!request) {
      return null;
    }
    if (request.status !== 'PENDING') {
      return request.status === 'APPROVED' && decision === 'APPROVE'
        ? { request, seller: this.sellerProfiles.find((s) => s.id === request.sellerId) }
        : request;
    }
    if (decision === 'REJECT') {
      request.status = 'REJECTED';
      this.queuePersist();
      await this.persistChain;
      return request;
    }
    const applied = await this.setSellerPercentDirect(request.sellerId, request.requestedPercent);
    if (!applied) {
      return null;
    }
    request.status = 'APPROVED';
    this.queuePersist();
    await this.persistChain;
    return { request, seller: applied };
  }

  getDirectorControlRequestsSnapshot() {
    return [...this.directorApprovalRequests]
      .filter((r) => r.state === 'PENDING')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        kind: row.kind,
        state: row.state,
        requestedByNickname: row.requestedByNickname,
        storeName: row.storeName,
        payload: row.payload,
        summary: this.describeDirectorApproval(row),
      }));
  }

  private describeDirectorApproval(row: DirectorApprovalRequestMem): string {
    if (row.kind === 'SALE_DELETE') {
      const sid = row.payload.saleId ?? row.id;
      const store = row.storeName?.trim() || '—';
      const sellerName = row.payload.sellerName?.trim() || '';
      const sellerNick = row.payload.sellerNickname?.trim() || '';
      const sellerLabel = sellerName
        ? sellerNick
          ? `${sellerName} · ${sellerNick}`
          : sellerName
        : row.requestedByNickname;
      const amount =
        typeof row.payload.totalAmount === 'number'
          ? `${Math.round(row.payload.totalAmount).toLocaleString('ru-RU')} ₽`
          : null;
      const units =
        typeof row.payload.units === 'number' ? `${row.payload.units} шт.` : null;
      const parts = [`«${store}»`, `продавец: ${sellerLabel}`];
      if (amount) {
        parts.push(`сумма: ${amount}`);
      }
      if (units) {
        parts.push(`кол-во: ${units}`);
      }
      const lines = row.payload.items ?? [];
      if (lines.length > 0) {
        parts.push(
          lines.map((line) => `${line.name} × ${line.qty}`).join(', '),
        );
      }
      return `Отмена продажи — ${parts.join(' · ')}. Чек: ${sid}`;
    }
    const n = row.payload.name ?? '';
    const q = row.payload.qty ?? 0;
    const r = row.payload.reason ?? '';
    return `Списание — «${row.storeName}»: ${n} × ${q} шт. (${r}), заявил ${row.requestedByNickname}`;
  }

  private findAdminStoreSaleIndex(saleId: string, adminNickname: string): { seller: SellerProfile; idx: number } | null {
    const admin = this.demoUsers.find((u) => u.nickname === adminNickname);
    if (!admin || admin.role !== 'ADMIN') {
      return null;
    }
    const store = admin.storeName;
    for (const seller of this.sellerProfiles) {
      if (seller.storeName !== store) {
        continue;
      }
      const idx = seller.sales.findIndex((s) => s.id === saleId);
      if (idx >= 0) {
        return { seller, idx };
      }
    }
    return null;
  }

  private tryDecrementShiftCountersForDeletedSale(sale: SaleRecord, sellerId: number) {
    const saleDay = this.getStoreBusinessDayKey(sale.createdAt);
    const open = this.shiftHistory.find(
      (s) =>
        s.status === 'OPEN' &&
        this.getStoreBusinessDayKey(s.openedAt) === saleDay &&
        s.assignedSellerIds.includes(sellerId),
    );
    if (!open) {
      return;
    }
    open.checksCount = Math.max(0, open.checksCount - 1);
    open.itemsCount = Math.max(0, open.itemsCount - sale.units);
  }

  private applyApprovedSaleDeletion(saleId: string): boolean {
    let found: { seller: SellerProfile; idx: number } | null = null;
    for (const seller of this.sellerProfiles) {
      const idx = seller.sales.findIndex((s) => s.id === saleId);
      if (idx >= 0) {
        found = { seller, idx };
        break;
      }
    }
    if (!found) {
      return false;
    }
    const sale = found.seller.sales[found.idx];
    const storeKey = found.seller.storeName;
    for (const line of sale.items) {
      this.addStockDelta(storeKey, line.name, line.qty);
    }
    this.tryDecrementShiftCountersForDeletedSale(sale, found.seller.id);
    found.seller.sales.splice(found.idx, 1);
    this.recomputeSeller(found.seller);
    this.syncRetoucherEarnings();
    const allSales = this.sellerProfiles.flatMap((p) => p.sales);
    const newest = allSales.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    this.lastSaleAt = newest?.createdAt ?? null;
    return true;
  }

  updateAdminSalePaymentType(
    saleId: string,
    paymentType: SalePaymentType,
    actorNickname: string,
  ): SaleRecord | null {
    const admin = this.demoUsers.find((u) => u.nickname === actorNickname);
    if (!admin || admin.role !== 'ADMIN') {
      return null;
    }
    const sid = String(saleId ?? '').trim();
    if (!sid) {
      return null;
    }
    if (paymentType !== 'CASH' && paymentType !== 'NON_CASH' && paymentType !== 'TRANSFER') {
      return null;
    }
    const hit = this.findAdminStoreSaleIndex(sid, actorNickname);
    if (!hit) {
      return null;
    }
    const sale = hit.seller.sales[hit.idx];
    const today = this.getStoreBusinessDayKey(new Date().toISOString());
    if (this.getStoreBusinessDayKey(sale.createdAt) !== today) {
      return null;
    }
    if (sale.paymentType === paymentType) {
      return sale;
    }
    const prev = sale.paymentType;
    sale.paymentType = paymentType;
    this.pushAudit(
      actorNickname,
      'SALE_PAYMENT_TYPE_CHANGED',
      `sale=${sid}, store=${admin.storeName}, ${prev} -> ${paymentType}`,
    );
    this.queuePersist();
    return sale;
  }

  requestSaleDeletion(saleId: string, actorNickname: string): DirectorApprovalRequestMem | null {
    const admin = this.demoUsers.find((u) => u.nickname === actorNickname);
    if (!admin || admin.role !== 'ADMIN') {
      return null;
    }
    const sid = String(saleId ?? '').trim();
    if (!sid) {
      return null;
    }
    const hit = this.findAdminStoreSaleIndex(sid, actorNickname);
    if (!hit) {
      return null;
    }
    if (
      this.directorApprovalRequests.some(
        (r) => r.state === 'PENDING' && r.kind === 'SALE_DELETE' && r.payload.saleId === sid,
      )
    ) {
      return null;
    }
    const sale = hit.seller.sales[hit.idx];
    const row: DirectorApprovalRequestMem = {
      id: `dap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      kind: 'SALE_DELETE',
      state: 'PENDING',
      requestedByNickname: actorNickname,
      storeName: admin.storeName,
      payload: {
        saleId: sid,
        totalAmount: sale.totalAmount,
        units: sale.units,
        items: sale.items.map((line) => ({ name: line.name, qty: line.qty })),
        sellerId: hit.seller.id,
        sellerName: hit.seller.fullName,
        sellerNickname: hit.seller.nickname,
      },
    };
    this.directorApprovalRequests.unshift(row);
    this.pushAudit(actorNickname, 'SALE_DELETE_REQUESTED', `sale=${sid}, store=${admin.storeName}`);
    this.queuePersist();
    return row;
  }

  requestWriteOffApproval(
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
    actorNickname: string,
    optionalRequestId?: string,
  ): DirectorApprovalRequestMem | null {
    const validNames = new Set(this.productCatalog.map((item) => item.name));
    const nm = name?.trim();
    if (!nm || !validNames.has(nm) || qty <= 0) {
      return null;
    }
    const admin = this.demoUsers.find((u) => u.nickname === actorNickname);
    if (!admin || admin.role !== 'ADMIN') {
      return null;
    }
    const storeKey = admin.storeName;
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(storeKey)) {
      return null;
    }
    if (this.getStockQty(storeKey, nm) < qty) {
      return null;
    }
    const q = Math.round(qty);
    const trimmedRequestId =
      typeof optionalRequestId === 'string'
        ? optionalRequestId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;
    if (trimmedRequestId) {
      const existing = this.directorApprovalRequests.find((r) => r.id === trimmedRequestId);
      if (existing) {
        return existing;
      }
    }
    const row: DirectorApprovalRequestMem = {
      id: trimmedRequestId ?? `dap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      kind: 'WRITE_OFF',
      state: 'PENDING',
      requestedByNickname: actorNickname,
      storeName: storeKey,
      payload: { name: nm, qty: q, reason },
    };
    this.directorApprovalRequests.unshift(row);
    this.pushAudit(actorNickname, 'WRITE_OFF_REQUESTED', `${nm} qty=${q}, reason=${reason}`);
    this.queuePersist();
    return row;
  }

  async decideDirectorControlRequest(
    id: string,
    decision: 'APPROVE' | 'REJECT',
    directorNickname: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const req = this.directorApprovalRequests.find((r) => r.id === id);
    if (!req) {
      return { ok: false, error: 'not_found' };
    }
    if (req.state !== 'PENDING') {
      const sameDecision =
        (req.state === 'APPROVED' && decision === 'APPROVE') ||
        (req.state === 'REJECTED' && decision === 'REJECT');
      return sameDecision ? { ok: true } : { ok: false, error: 'not_found' };
    }
    if (decision === 'REJECT') {
      req.state = 'REJECTED';
      req.resolvedAt = new Date().toISOString();
      req.resolvedBy = directorNickname;
      this.pushAudit(directorNickname, 'DIRECTOR_CONTROL_REJECTED', `${req.kind} ${id}`);
      this.queuePersist();
      await this.persistChain;
      return { ok: true };
    }
    if (req.kind === 'SALE_DELETE') {
      const saleId = String(req.payload.saleId ?? '');
      const okDel = this.applyApprovedSaleDeletion(saleId);
      if (!okDel) {
        return { ok: false, error: 'sale_missing' };
      }
    } else {
      const p = req.payload;
      const qty = typeof p.qty === 'number' ? p.qty : 0;
      const nm = typeof p.name === 'string' ? p.name.trim() : '';
      const reason = p.reason === 'Поломка' ? 'Поломка' : 'Брак';
      if (!nm || qty <= 0) {
        return { ok: false, error: 'bad_payload' };
      }
      const applied = this.addWriteOff(nm, qty, reason, req.requestedByNickname);
      if (!applied) {
        return { ok: false, error: 'writeoff_failed' };
      }
    }
    req.state = 'APPROVED';
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = directorNickname;
    this.pushAudit(directorNickname, 'DIRECTOR_CONTROL_APPROVED', `${req.kind} ${id}`);
    this.queuePersist();
    await this.persistChain;
    return { ok: true };
  }

  async addAdminSale(
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    actor = 'system',
    paymentType: SalePaymentType = 'CASH',
    optionalSaleId?: string,
  ): Promise<SaleRecord | null> {
    const trimmedOptionalId =
      typeof optionalSaleId === 'string'
        ? optionalSaleId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;

    if (trimmedOptionalId) {
      for (const profile of this.sellerProfiles) {
        const existing = profile.sales.find((s) => s.id === trimmedOptionalId);
        if (existing) {
          return existing;
        }
      }
      if (this.persistenceEnabled) {
        const existingDb = await this.prisma.sale.findUnique({
          where: { id: trimmedOptionalId },
          include: { items: true },
        });
        if (existingDb) {
          return {
            id: existingDb.id,
            createdAt: existingDb.createdAt.toISOString(),
            items: existingDb.items.map((line) => ({
              name: line.name,
              qty: line.qty,
            })),
            totalAmount: existingDb.totalAmount,
            units: existingDb.units,
            paymentType: prismaPaymentTypeToInternal(existingDb.paymentType),
          };
        }
      }
    }

    this.ensureActiveShiftForToday();
    if (!this.currentShiftId) {
      return null;
    }

    const shiftOpen = this.shiftHistory.find(
      (item) => item.id === this.currentShiftId && item.status === 'OPEN',
    );
    if (!shiftOpen) {
      return null;
    }
    this.reconcileOpenShiftAssignees();
    if (!shiftOpen.assignedSellerIds.includes(sellerId)) {
      return null;
    }

    const seller = this.sellerProfiles.find((item) => item.id === sellerId);
    if (!seller) {
      return null;
    }
    const actorUser = this.demoUsers.find((item) => item.nickname === actor);
    if (actorUser?.role === 'ADMIN' && seller.storeName !== actorUser.storeName) {
      return null;
    }

    const validNames = new Set(this.productCatalog.map((item) => item.name));
    const lines: SaleLine[] = [];
    for (const line of items) {
      const nm = line.name?.trim();
      if (!nm) {
        return null;
      }
      if (!validNames.has(nm)) {
        return null;
      }
      if (!line.qty || line.qty <= 0) {
        continue;
      }
      lines.push({
        name: nm,
        qty: line.qty,
      });
    }

    if (lines.length === 0 || totalAmount <= 0) {
      return null;
    }

    const storeKey = seller.storeName;
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(storeKey)) {
      return null;
    }
    for (const line of lines) {
      if (this.getStockQty(storeKey, line.name) < line.qty) {
        return null;
      }
    }

    const units = lines.reduce((sum, line) => sum + line.qty, 0);
    const sale: SaleRecord = {
      id: trimmedOptionalId ?? `sale-${Date.now()}`,
      createdAt: new Date().toISOString(),
      items: lines,
      totalAmount,
      units,
      paymentType,
    };

    seller.sales.push(sale);
    this.recomputeSeller(seller);
    this.syncRetoucherEarnings();
    this.lastSaleAt = sale.createdAt;
    if (this.currentShiftId) {
      const shift = this.shiftHistory.find((item) => item.id === this.currentShiftId);
      if (shift && shift.status === 'OPEN') {
        shift.checksCount += 1;
        shift.itemsCount += units;
      }
    }
    for (const line of lines) {
      this.addStockDelta(storeKey, line.name, -line.qty);
    }
    this.pushAudit(
      actor,
      'SALE_CREATED',
      `sale=${sale.id}, seller=${seller.fullName}, total=${totalAmount}, pay=${paymentType}`,
    );
    this.invalidateDashboardCache();
    this.queueIncremental(() => this.persistIncrementalSale(sale, sellerId, storeKey));
    return sale;
  }

  addWriteOff(name: string, qty: number, reason: 'Брак' | 'Поломка', actor = 'system') {
    const validNames = new Set(this.productCatalog.map((item) => item.name));
    if (!validNames.has(name) || qty <= 0) {
      return null;
    }
    const storeKey = this.stockStoreKeyForActor(actor);
    if (!storeKey) {
      return null;
    }
    if (this.getStockQty(storeKey, name) < qty) {
      return null;
    }

    const writeOff: WriteOffItem = {
      id: `wo-${Date.now()}`,
      createdAt: new Date().toISOString(),
      name,
      qty: Math.round(qty),
      reason,
    };
    this.adminWriteOffs.push(writeOff);
    this.addStockDelta(storeKey, name, -writeOff.qty);
    this.pushAudit(actor, 'WRITE_OFF_CREATED', `${name} qty=${writeOff.qty}, reason=${reason}`);
    this.queueIncremental(() => this.persistIncrementalWriteOff(writeOff, storeKey));
    return writeOff;
  }

  updateWriteOff(id: string, qty: number, reason: 'Брак' | 'Поломка', actor = 'system') {
    const writeOff = this.adminWriteOffs.find((item) => item.id === id);
    if (!writeOff || qty <= 0) {
      return null;
    }
    const storeKey = this.stockStoreKeyForActor(actor);
    if (!storeKey) {
      return null;
    }
    const diff = Math.round(qty) - writeOff.qty;
    if (this.getStockQty(storeKey, writeOff.name) < diff) {
      return null;
    }
    writeOff.qty = Math.round(qty);
    writeOff.reason = reason;
    this.addStockDelta(storeKey, writeOff.name, -diff);
    this.pushAudit(actor, 'WRITE_OFF_UPDATED', `${writeOff.name} qty=${writeOff.qty}, reason=${reason}`);
    this.queuePersist();
    return writeOff;
  }

  deleteWriteOff(id: string, actor = 'system') {
    const index = this.adminWriteOffs.findIndex((item) => item.id === id);
    if (index < 0) {
      return false;
    }
    const deleted = this.adminWriteOffs[index];
    const storeKey = this.stockStoreKeyForActor(actor);
    if (storeKey) {
      this.addStockDelta(storeKey, deleted.name, deleted.qty);
    }
    this.adminWriteOffs.splice(index, 1);
    this.pushAudit(actor, 'WRITE_OFF_DELETED', `${deleted.name} qty=${deleted.qty}`);
    this.queuePersist();
    return true;
  }

  openShift(openedBy: string, assignedSellerIds: number[], optionalClientShiftId?: string) {
    this.ensureActiveShiftForToday();
    const trimmedShiftId =
      typeof optionalClientShiftId === 'string'
        ? optionalClientShiftId.trim().slice(0, 128).replace(/[^\w.-]/g, '') || undefined
        : undefined;
    if (trimmedShiftId) {
      const byId = this.shiftHistory.find((item) => item.id === trimmedShiftId);
      if (byId) {
        return byId;
      }
    }
    const opener = this.demoUsers.find((item) => item.nickname === openedBy);
    let allowedIds = [...new Set(assignedSellerIds)];
    if (opener?.role === 'ADMIN') {
      const inStore = new Set(this.getStoreAssignedStaffIds(opener.storeName));
      allowedIds = allowedIds.filter((id) => inStore.has(id));
    }
    const existingOpen = this.shiftHistory.find((item) => item.status === 'OPEN');
    if (existingOpen) {
      const merged = [
        ...new Set([...existingOpen.assignedSellerIds, ...allowedIds]),
      ];
      existingOpen.assignedSellerIds = merged;
      for (const member of this.staff) {
        if (merged.includes(member.id)) {
          member.assignedShiftId = existingOpen.id;
        } else if (member.assignedShiftId === existingOpen.id) {
          member.assignedShiftId = undefined;
        }
      }
      this.pushAudit(
        openedBy,
        'SHIFT_OPEN_ASSIGNEES',
        `shift=${existingOpen.id} sellers=${merged.join(',')}`,
      );
      this.reconcileOpenShiftAssignees();
      this.queueIncremental(() => this.persistIncrementalShiftState());
      return existingOpen;
    }
    const shift: Shift = {
      id: trimmedShiftId ?? `shift-${Date.now()}`,
      openedAt: new Date().toISOString(),
      openedBy,
      assignedSellerIds: allowedIds,
      checksCount: 0,
      itemsCount: 0,
      status: 'OPEN',
    };
    this.shiftHistory.push(shift);
    this.currentShiftId = shift.id;
    for (const member of this.staff) {
      member.assignedShiftId = allowedIds.includes(member.id) ? shift.id : undefined;
    }
    this.pushAudit(openedBy, 'SHIFT_OPENED', `shift=${shift.id}`);
    this.reconcileOpenShiftAssignees();
    this.queueIncremental(() => this.persistIncrementalShiftState());
    return shift;
  }

  closeShift(closedBy: string, assignedSellerIds: number[] = []) {
    this.ensureActiveShiftForToday();
    if (!this.currentShiftId) {
      return null;
    }
    const shift = this.shiftHistory.find((item) => item.id === this.currentShiftId);
    if (!shift || shift.status !== 'OPEN') {
      return null;
    }
    const selectedIds = [...new Set(assignedSellerIds)];
    if (selectedIds.length > 0) {
      shift.assignedSellerIds = shift.assignedSellerIds.filter((id) => !selectedIds.includes(id));
      for (const member of this.staff) {
        if (selectedIds.includes(member.id) && member.assignedShiftId === shift.id) {
          member.assignedShiftId = undefined;
        }
      }
      this.pushAudit(closedBy, 'SHIFT_PARTIAL_CLOSED', `shift=${shift.id} sellers=${selectedIds.join(',')}`);
      if (shift.assignedSellerIds.length > 0) {
        this.queueIncremental(() => this.persistIncrementalShiftState());
        return shift;
      }
    }
    shift.status = 'CLOSED';
    shift.closedAt = new Date().toISOString();
    shift.closedBy = closedBy;
    this.currentShiftId = null;
    for (const member of this.staff) {
      if (member.assignedShiftId === shift.id) {
        member.assignedShiftId = undefined;
      }
    }
    this.pushAudit(closedBy, 'SHIFT_CLOSED', `shift=${shift.id}`);
    this.queueIncremental(() => this.persistIncrementalShiftState());
    return shift;
  }

  /**
   * Keeps shift.assignedSellerIds and staff.assignedShiftId aligned for the open shift.
   */
  private reconcileOpenShiftAssignees(): boolean {
    const open = this.shiftHistory.find((item) => item.status === 'OPEN');
    if (!open) {
      return false;
    }
    let changed = false;
    for (const member of this.staff) {
      if (!member.isActive || member.staffPosition !== 'SALES') {
        continue;
      }
      if (member.assignedShiftId === open.id && !open.assignedSellerIds.includes(member.id)) {
        open.assignedSellerIds.push(member.id);
        changed = true;
      }
      if (open.assignedSellerIds.includes(member.id) && member.assignedShiftId !== open.id) {
        member.assignedShiftId = open.id;
        changed = true;
      }
    }
    return changed;
  }

  getShifts() {
    this.ensureActiveShiftForToday();
    this.reconcileOpenShiftAssignees();
    return [...this.shiftHistory].sort(
      (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
    );
  }

  addCashDisciplineEvent(type: CashEventType, comment: string, actor: string) {
    if (!comment.trim()) {
      return null;
    }
    const event: CashDisciplineEvent = {
      id: `cash-${Date.now()}`,
      createdAt: new Date().toISOString(),
      type,
      comment: comment.trim(),
      createdBy: actor,
    };
    this.cashDisciplineEvents.push(event);
    this.pushAudit(actor, 'CASH_DISCIPLINE_EVENT', `${type}: ${event.comment}`);
    this.queuePersist();
    return event;
  }

  getCashDisciplineEvents() {
    return [...this.cashDisciplineEvents].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getStaff() {
    this.syncRetoucherEarnings();
    this.reconcileOpenShiftAssignees();
    return this.staff.map((member) => {
      const u = this.demoUsers.find((d) => d.id === member.id);
      let assignedStores = this.storeStaffAssignments
        .filter((item) => item.staffId === member.id)
        .map((item) => item.storeName)
        .sort((a, b) => a.localeCompare(b, 'ru-RU'));
      if (assignedStores.length === 0) {
        const home = u?.storeName?.trim() ?? '';
        if (member.staffPosition === 'MANAGER' || member.nickname === MANAGER_USER_NICKNAME) {
          assignedStores = [...MANAGER_ASSIGNED_STORE_NAMES];
        } else if (this.storeStaffAssignments.length === 0 && home && home !== 'Все точки') {
          // Legacy fallback only: when assignment table is globally empty.
          // If specific staff was removed from a store, keep it removed.
          assignedStores = [home];
        }
      }
      return {
        id: member.id,
        fullName: member.fullName,
        nickname: member.nickname,
        isActive: member.isActive,
        assignedShiftId: member.assignedShiftId,
        staffPosition: member.staffPosition,
        storeName: u?.storeName ?? '',
        assignedStores,
        earningsAmount: member.staffPosition === 'RETOUCHER' ? member.earningsAmount : 0,
        retoucherRatePercent:
          member.staffPosition === 'RETOUCHER' ? member.retoucherRatePercent : undefined,
      };
    });
  }

  getGlobalEmployees() {
    const sellers = this.sellerProfiles.map((profile) => {
      const user = this.demoUsers.find((item) => item.id === profile.id);
      return {
        id: profile.id,
        fullName: profile.fullName,
        nickname: profile.nickname,
        homeStore: profile.storeName,
        isActive: user?.isActive ?? true,
      } satisfies GlobalEmployee;
    });
    const retouchers = this.demoUsers
      .filter((u) => u.role === 'RETOUCHER')
      .map(
        (u) =>
          ({
            id: u.id,
            fullName: u.fullName,
            nickname: u.nickname,
            homeStore: u.storeName,
            isActive: u.isActive,
          }) satisfies GlobalEmployee,
      );
    return [...sellers, ...retouchers].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));
  }

  addStaff(fullName: string, nickname: string, actor: string) {
    if (!fullName.trim() || !nickname.trim()) {
      return null;
    }
    const normalizedNickname = nickname.trim();
    const normalizedFullName = fullName.trim();
    const existingMember = this.staff.find((item) => item.nickname === normalizedNickname);
    if (existingMember) {
      existingMember.isActive = true;
      const demoUser = this.demoUsers.find((item) => item.id === existingMember.id);
      if (demoUser) {
        demoUser.isActive = true;
        demoUser.fullName = normalizedFullName;
      }
      const sellerProfile = this.sellerProfiles.find((item) => item.id === existingMember.id);
      if (sellerProfile) {
        sellerProfile.fullName = normalizedFullName;
      }
      this.pushAudit(
        actor,
        'STAFF_REACTIVATED',
        `${normalizedFullName} (${existingMember.nickname})`,
      );
      this.queuePersist();
      return existingMember;
    }
    const member: StaffMember = {
      id: this.getNextNumericId(),
      fullName: normalizedFullName,
      nickname: normalizedNickname,
      isActive: true,
      staffPosition: 'SALES',
      retoucherRatePercent: 5,
      earningsAmount: 0,
    };
    const storeForActor =
      this.demoUsers.find((item) => item.nickname === actor)?.storeName ?? DEMO_STORE_NAMES[0];
    this.staff.push(member);
    this.demoUsers.push({
      id: member.id,
      nickname: member.nickname,
      password: getDefaultDemoPassword(),
      fullName: member.fullName,
      role: 'SELLER',
      storeName: storeForActor,
      isActive: true,
    });
    this.sellerProfiles.push({
      id: member.id,
      fullName: member.fullName,
      nickname: member.nickname,
      storeName: storeForActor,
      ratePercent: 30,
      salesAmount: 0,
      checksCount: 0,
      sales: [],
      commissionAmount: 0,
    });
    this.attachStaffToStore(member.id, storeForActor);
    this.pushAudit(actor, 'STAFF_ADDED', `${member.fullName} (${member.nickname})`);
    this.queuePersist();
    return member;
  }

  deactivateStaff(id: number, actor: string) {
    const member = this.staff.find((item) => item.id === id);
    if (!member) {
      return null;
    }
    member.isActive = false;
    member.assignedShiftId = undefined;
    const demoUser = this.demoUsers.find((item) => item.id === id);
    if (demoUser) {
      demoUser.isActive = false;
    }
    this.pushAudit(actor, 'STAFF_DEACTIVATED', `${member.fullName}`);
    this.queuePersist();
    return member;
  }

  activateStaff(id: number, actor: string) {
    const member = this.staff.find((item) => item.id === id);
    if (!member) {
      return null;
    }
    member.isActive = true;
    const demoUser = this.demoUsers.find((item) => item.id === id);
    if (demoUser) {
      demoUser.isActive = true;
    }
    this.pushAudit(actor, 'STAFF_ACTIVATED', `${member.fullName}`);
    this.queuePersist();
    return member;
  }

  addStaffFromGlobal(employeeId: number, actor: string) {
    const seller = this.sellerProfiles.find((item) => item.id === employeeId);
    if (!seller) {
      return null;
    }
    const actorStoreName =
      this.demoUsers.find((item) => item.nickname === actor)?.storeName ?? DEMO_STORE_NAMES[0];
    const existing = this.staff.find((item) => item.id === employeeId);
    if (existing) {
      existing.isActive = true;
      this.attachStaffToStore(existing.id, actorStoreName);
      this.pushAudit(
        actor,
        'STAFF_ATTACHED_FROM_BASE',
        `${existing.fullName} (${existing.nickname})`,
      );
      return existing;
    }
    const member: StaffMember = {
      id: seller.id,
      fullName: seller.fullName,
      nickname: seller.nickname,
      isActive: true,
      staffPosition: 'SALES',
      retoucherRatePercent: 5,
      earningsAmount: 0,
    };
    this.staff.push(member);
    const demoUser = this.demoUsers.find((item) => item.id === seller.id);
    if (!demoUser) {
      this.demoUsers.push({
        id: seller.id,
        nickname: seller.nickname,
        password: getDefaultDemoPassword(),
        fullName: seller.fullName,
        role: 'SELLER',
        storeName: seller.storeName,
        isActive: true,
      });
    } else {
      demoUser.isActive = true;
    }
    this.attachStaffToStore(member.id, actorStoreName);
    this.pushAudit(
      actor,
      'STAFF_ATTACHED_FROM_BASE',
      `${member.fullName} (${member.nickname})`,
    );
    this.queuePersist();
    return member;
  }

  removeStaffFromStore(id: number, actor: string, requestedStoreName?: string) {
    const member = this.staff.find((item) => item.id === id);
    if (!member) {
      return null;
    }
    const targetUser = this.demoUsers.find((item) => item.id === id);
    if (targetUser?.role === 'MANAGER' || member.staffPosition === 'MANAGER') {
      return null;
    }
    const actorUser = this.demoUsers.find((item) => item.nickname === actor);
    const targetStoreName =
      actorUser?.role === 'ADMIN' ? actorUser.storeName : (requestedStoreName ?? actorUser?.storeName);
    if (!targetStoreName) {
      return null;
    }
    const hadStaffAssignments = this.storeStaffAssignments.some((item) => item.staffId === id);
    const beforeCount = this.storeStaffAssignments.length;
    this.storeStaffAssignments = this.storeStaffAssignments.filter(
      (item) => !(item.staffId === id && item.storeName === targetStoreName),
    );
    const removedDirectAssignment = this.storeStaffAssignments.length !== beforeCount;

    if (!removedDirectAssignment) {
      // Legacy fallback: old data may have no assignment rows for staff,
      // while UI still shows them by home store. Allow one-time removal.
      const sellerProfile = this.sellerProfiles.find((item) => item.id === id);
      const homeStore = targetUser?.storeName?.trim() ?? '';
      const sellerStore = sellerProfile?.storeName?.trim() ?? '';
      const matchesLegacyHome = homeStore === targetStoreName || sellerStore === targetStoreName;
      if (!hadStaffAssignments && matchesLegacyHome && targetUser) {
        targetUser.storeName = 'Все точки';
      } else {
        return null;
      }
    }
    for (const shift of this.shiftHistory) {
      if (shift.status !== 'OPEN') {
        continue;
      }
      shift.assignedSellerIds = shift.assignedSellerIds.filter((staffId) => staffId !== id);
    }
    member.assignedShiftId = undefined;
    this.pushAudit(
      actor,
      'STAFF_REMOVED_FROM_STORE',
      `${member.fullName} (${member.nickname}) -> ${targetStoreName}`,
    );
    this.queuePersist();
    return member;
  }

  /** Восстановление в точке: активировать учётку и добавить привязку к магазину. */
  restoreStaffToStore(staffId: number, storeName: string, actor: string) {
    const trimmed = storeName.trim();
    if (!(DEMO_STORE_NAMES as readonly string[]).includes(trimmed)) {
      return null;
    }
    const member = this.staff.find((item) => item.id === staffId);
    if (!member) {
      return null;
    }
    member.isActive = true;
    member.assignedShiftId = undefined;
    const demoUser = this.demoUsers.find((item) => item.id === staffId);
    if (demoUser) {
      demoUser.isActive = true;
      demoUser.storeName = trimmed;
    }
    const sellerProfile = this.sellerProfiles.find((item) => item.id === staffId);
    if (sellerProfile) {
      sellerProfile.storeName = trimmed;
    }
    this.attachStaffToStore(staffId, trimmed);
    this.pushAudit(
      actor,
      'STAFF_RESTORED_TO_STORE',
      `${member.fullName} (${member.nickname}) → ${trimmed}`,
    );
    this.queuePersist();
    return member;
  }

  assignStaffToShift(id: number, shiftId: string, actor: string) {
    const member = this.staff.find((item) => item.id === id);
    const shift = this.shiftHistory.find((item) => item.id === shiftId && item.status === 'OPEN');
    if (!member || !shift) {
      return null;
    }
    member.assignedShiftId = shift.id;
    if (!shift.assignedSellerIds.includes(member.id)) {
      shift.assignedSellerIds.push(member.id);
    }
    this.pushAudit(actor, 'STAFF_SHIFT_ASSIGNED', `${member.fullName} -> ${shift.id}`);
    this.queuePersist();
    return member;
  }

  getThresholdNotifications() {
    const notifications: ThresholdNotification[] = [];
    const now = Date.now();
    const lastSaleMs = this.lastSaleAt ? new Date(this.lastSaleAt).getTime() : null;
    const noSalesForHours = lastSaleMs ? (now - lastSaleMs) / (1000 * 60 * 60) : Infinity;
    const damagedCount = this.adminWriteOffs
      .filter((item) => item.reason === 'Брак')
      .reduce((sum, item) => sum + item.qty, 0);

    for (const [loc, mp] of Object.entries(this.productStockByLocation)) {
      const locLabel = this.stockLocationLabel(loc);
      for (const [name, qty] of Object.entries(mp)) {
        if (qty <= 10) {
          notifications.push({
            id: `low-${loc}-${name}`,
            type: 'LOW_STOCK',
            message: `Товар "${name}" (${locLabel}): осталось ${qty} шт.`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
    if (damagedCount >= 5) {
      notifications.push({
        id: 'damage-high',
        type: 'HIGH_DAMAGE_WRITE_OFF',
        message: `Много списаний по браку: ${damagedCount} шт.`,
        createdAt: new Date().toISOString(),
      });
    }
    if (noSalesForHours >= 3) {
      notifications.push({
        id: 'no-sales',
        type: 'NO_SALES',
        message: `Нет продаж более ${Math.floor(noSalesForHours)} часов.`,
        createdAt: new Date().toISOString(),
      });
    }

    return notifications;
  }

  getAuditLog() {
    return [...this.auditLog].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private createDemoToken(user: DemoUser) {
    const payload = {
      sub: user.id,
      nickname: user.nickname,
      role: user.role,
      exp: Date.now() + 1000 * 60 * 60 * 8,
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private recomputeSeller(seller: SellerProfile | undefined) {
    if (!seller) {
      return;
    }

    const today = this.getStoreBusinessDayKey(new Date().toISOString());
    const totals = seller.sales.reduce(
      (acc, sale) => {
        if (this.getStoreBusinessDayKey(sale.createdAt) !== today) {
          return acc;
        }
        return {
          sales: acc.sales + sale.totalAmount,
          checks: acc.checks + 1,
        };
      },
      { sales: 0, checks: 0 },
    );

    seller.salesAmount = totals.sales;
    seller.checksCount = totals.checks;
    seller.commissionAmount = Math.round(
      (seller.salesAmount * seller.ratePercent) / 100,
    );
  }

  private syncRetoucherEarnings() {
    for (const member of this.staff) {
      if (member.staffPosition !== 'RETOUCHER') {
        member.earningsAmount = 0;
        continue;
      }
      const u = this.demoUsers.find((d) => d.id === member.id);
      if (!u || u.role !== 'RETOUCHER' || !u.isActive || !member.isActive) {
        member.earningsAmount = 0;
        continue;
      }
      const store = u.storeName;
      let storeDayRevenue = 0;
      for (const p of this.sellerProfiles) {
        if (p.storeName !== store) {
          continue;
        }
        this.recomputeSeller(p);
        storeDayRevenue += p.salesAmount;
      }
      const rate =
        typeof member.retoucherRatePercent === 'number' &&
        Number.isFinite(member.retoucherRatePercent)
          ? member.retoucherRatePercent
          : 5;
      member.earningsAmount = Math.round((storeDayRevenue * rate) / 100);
    }
  }

  /** Ключ для сопоставления названия товара в чеке и в справочнике закупок (как в getSalesSnapshotForSessionEnriched). */
  private normProcurementKey(raw: string): string {
    return String(raw).normalize('NFC').trim().replace(/\s+/g, ' ');
  }

  /** Закупочная цена за единицу по справочнику в памяти (совпадает с логикой обогащённого снимка по БД). */
  private procurementUnitCost(productName: string): number {
    const nk = this.normProcurementKey(productName);
    if (!nk) {
      return 0;
    }
    for (const [storedName, cost] of Object.entries(this.productProcurementCosts)) {
      if (this.normProcurementKey(storedName) === nk) {
        return typeof cost === 'number' && Number.isFinite(cost) ? cost : 0;
      }
    }
    return 0;
  }

  /** Себестоимость проданных позиций по чеку. */
  private saleGoodsCost(sale: SaleRecord): number {
    let sum = 0;
    for (const line of sale.items ?? []) {
      const qty = Number.isFinite(line.qty) ? line.qty : 0;
      sum += this.procurementUnitCost(line.name) * qty;
    }
    return Math.round(sum * 100) / 100;
  }

  private formatCurrency(value: number) {
    return `${value.toLocaleString('ru-RU')} ₽`;
  }

  private pushAudit(actor: string, action: string, details: string) {
    this.auditLog.push({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      actor,
      action,
      details,
    });
    if (this.auditLog.length > AuthService.MAX_AUDIT_LOG_ITEMS) {
      this.auditLog.splice(0, this.auditLog.length - AuthService.MAX_AUDIT_LOG_ITEMS);
    }
  }

  private trimAuditLogInMemory() {
    if (this.auditLog.length > AuthService.MAX_AUDIT_LOG_ITEMS) {
      this.auditLog = this.auditLog.slice(-AuthService.MAX_AUDIT_LOG_ITEMS);
    }
  }

  private getStoreBusinessDayKey(valueIso: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(valueIso));
  }

  /**
   * Auto-closes open shift after day rollover.
   */
  private ensureActiveShiftForToday() {
    if (!this.currentShiftId) {
      return;
    }
    const shift = this.shiftHistory.find((item) => item.id === this.currentShiftId);
    if (!shift || shift.status !== 'OPEN') {
      this.currentShiftId = null;
      return;
    }
    const today = this.getStoreBusinessDayKey(new Date().toISOString());
    if (this.getStoreBusinessDayKey(shift.openedAt) === today) {
      return;
    }
    shift.status = 'CLOSED';
    shift.closedAt = new Date().toISOString();
    shift.closedBy = 'system@day-rollover';
    this.currentShiftId = null;
    for (const member of this.staff) {
      if (member.assignedShiftId === shift.id) {
        member.assignedShiftId = undefined;
      }
    }
    this.pushAudit('system', 'SHIFT_AUTO_CLOSED_DAY_ROLLOVER', `shift=${shift.id}`);
    this.queuePersist();
  }

  private getNextNumericId() {
    const userIds = this.demoUsers.map((user) => user.id);
    const staffIds = this.staff.map((member) => member.id);
    const maxId = Math.max(0, ...userIds, ...staffIds);
    return maxId + 1;
  }

  private getStoreAssignedStaffIds(storeName: string) {
    return this.storeStaffAssignments
      .filter((item) => item.storeName === storeName)
      .map((item) => item.staffId);
  }

  private attachStaffToStore(staffId: number, storeName: string) {
    const exists = this.storeStaffAssignments.some(
      (item) => item.staffId === staffId && item.storeName === storeName,
    );
    if (!exists) {
      this.storeStaffAssignments.push({ staffId, storeName });
    }
  }

  /** Лёгкая запись в БД без полного снапшота (продажи, смена, спецтехника). */
  private queueIncremental(job: () => Promise<void>) {
    if (!this.persistenceEnabled) {
      return;
    }
    this.persistChain = this.persistChain.then(job).catch((error: unknown) => {
      this.logger.error('Incremental persist failed', error as Error);
    });
  }

  private async persistAppStateSlice(tx: Prisma.TransactionClient) {
    await tx.appState.upsert({
      where: { id: 1 },
      update: {
        currentShiftId: this.currentShiftId,
        lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
      },
      create: {
        id: 1,
        currentShiftId: this.currentShiftId,
        lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
        acquiringPercent: this.acquiringPercent,
        acquiringPercentDetkov: this.acquiringPercentDetkov,
        acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
        acquiringPercentLyokha: this.acquiringPercentLyokha,
        acquiringProfilesJson: this.acquiringProfilesJson,
        financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
          this.financeExpenseCategoryAmounts,
        ),
      },
    });
  }

  private async persistLatestAuditEntry() {
    const item = this.auditLog[this.auditLog.length - 1];
    if (!item) {
      return;
    }
    await this.prisma.auditLogItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        createdAt: new Date(item.createdAt),
        actor: item.actor,
        action: item.action,
        details: item.details,
      },
      update: {
        actor: item.actor,
        action: item.action,
        details: item.details,
      },
    });
  }

  private async persistIncrementalSale(sale: SaleRecord, sellerId: number, storeKey: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findUnique({ where: { id: sale.id }, select: { id: true } });
      if (existing) {
        return;
      }
      await tx.sale.create({
        data: {
          id: sale.id,
          createdAt: new Date(sale.createdAt),
          totalAmount: sale.totalAmount,
          units: sale.units,
          sellerId,
          paymentType: internalPaymentTypeToPrisma(sale.paymentType),
          items: {
            create: sale.items.map((line, index) => ({
              id: `${sale.id}-${index}`,
              name: line.name.trim(),
              qty: line.qty,
            })),
          },
        },
      });
      await this.persistAppStateSlice(tx);
      if (this.currentShiftId) {
        const shift = this.shiftHistory.find((item) => item.id === this.currentShiftId);
        if (shift) {
          await tx.shift.update({
            where: { id: shift.id },
            data: {
              checksCount: shift.checksCount,
              itemsCount: shift.itemsCount,
            },
          });
        }
      }
      for (const line of sale.items) {
        const productName = line.name.trim();
        const qty = this.getStockQty(storeKey, productName);
        await tx.productStockLocation.upsert({
          where: {
            locationKey_productName: { locationKey: storeKey, productName },
          },
          create: { locationKey: storeKey, productName, qty },
          update: { qty },
        });
      }
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalShiftState() {
    await this.prisma.$transaction(async (tx) => {
      await this.persistAppStateSlice(tx);
      const open = this.shiftHistory.find((item) => item.status === 'OPEN');
      if (open) {
        await tx.shift.upsert({
          where: { id: open.id },
          create: {
            id: open.id,
            openedAt: new Date(open.openedAt),
            openedBy: open.openedBy,
            checksCount: open.checksCount,
            itemsCount: open.itemsCount,
            status: ShiftStatus.OPEN,
          },
          update: {
            checksCount: open.checksCount,
            itemsCount: open.itemsCount,
            status: ShiftStatus.OPEN,
            closedAt: null,
            closedBy: null,
          },
        });
        await tx.shiftAssignment.deleteMany({ where: { shiftId: open.id } });
        if (open.assignedSellerIds.length > 0) {
          await tx.shiftAssignment.createMany({
            data: open.assignedSellerIds.map((sellerId) => ({
              shiftId: open.id,
              sellerId,
            })),
          });
        }
      }
      for (const member of this.staff) {
        await tx.staffMember.updateMany({
          where: { id: member.id },
          data: { assignedShiftId: member.assignedShiftId ?? null },
        });
      }
      const closedToday = this.shiftHistory.filter((item) => item.status === 'CLOSED' && item.closedAt);
      const lastClosed = closedToday.sort(
        (a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime(),
      )[0];
      if (lastClosed && !open) {
        await tx.shift.update({
          where: { id: lastClosed.id },
          data: {
            status: ShiftStatus.CLOSED,
            closedAt: lastClosed.closedAt ? new Date(lastClosed.closedAt) : new Date(),
            closedBy: lastClosed.closedBy ?? null,
            checksCount: lastClosed.checksCount,
            itemsCount: lastClosed.itemsCount,
          },
        });
        await tx.shiftAssignment.deleteMany({ where: { shiftId: lastClosed.id } });
      }
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalStoreEquipment(storeName: string) {
    const e = this.storeEquipmentByStore[storeName] ?? emptyStoreEquipmentCounts();
    await this.prisma.storeEquipment.upsert({
      where: { storeName },
      create: {
        storeName,
        pc: e.pc,
        camera: e.camera,
        printer: e.printer,
        sdCard: e.sdCard,
        monitor: e.monitor,
        mouse: e.mouse,
        keyboard: e.keyboard,
        cardReader: e.cardReader,
        extra: e.extra ?? {},
      },
      update: {
        pc: e.pc,
        camera: e.camera,
        printer: e.printer,
        sdCard: e.sdCard,
        monitor: e.monitor,
        mouse: e.mouse,
        keyboard: e.keyboard,
        cardReader: e.cardReader,
        extra: e.extra ?? {},
      },
    });
    await this.persistLatestAuditEntry();
  }

  private async persistFinanceAppStateSlice(tx: Prisma.TransactionClient) {
    await tx.appState.upsert({
      where: { id: 1 },
      update: {
        acquiringPercent: this.acquiringPercent,
        acquiringPercentDetkov: this.acquiringPercentDetkov,
        acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
        acquiringPercentLyokha: this.acquiringPercentLyokha,
        acquiringProfilesJson: this.acquiringProfilesJson,
        financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
          this.financeExpenseCategoryAmounts,
        ),
      },
      create: {
        id: 1,
        currentShiftId: this.currentShiftId,
        lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
        acquiringPercent: this.acquiringPercent,
        acquiringPercentDetkov: this.acquiringPercentDetkov,
        acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
        acquiringPercentLyokha: this.acquiringPercentLyokha,
        acquiringProfilesJson: this.acquiringProfilesJson,
        financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
          this.financeExpenseCategoryAmounts,
        ),
      },
    });
  }

  private async persistFinanceIncomeAmountUpdate(income: FinanceIncome) {
    await this.prisma.$transaction(async (tx) => {
      await tx.financeIncome.update({
        where: { id: income.id },
        data: {
          amount: income.amount,
          comment: income.comment ?? null,
          accountName: income.accountName,
        },
      });
      const account = this.financeAccounts.find((a) => a.id === income.accountId)!;
      await tx.financeAccount.upsert({
        where: { id: account.id },
        create: {
          id: account.id,
          name: account.name,
          kind: account.kind === 'CASH' ? PrismaFinanceAccountKind.CASH : PrismaFinanceAccountKind.BANK,
          balance: account.balance,
        },
        update: { balance: account.balance },
      });
      await this.persistFinanceAppStateSlice(tx);
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalFinanceIncome(income: FinanceIncome) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.financeIncome.findUnique({ where: { id: income.id }, select: { id: true } });
      if (existing) {
        return;
      }
      await tx.financeIncome.create({
        data: {
          id: income.id,
          createdAt: new Date(income.createdAt),
          workDay: income.workDay,
          accountId: income.accountId,
          accountName: income.accountName,
          amount: income.amount,
          comment: income.comment ?? null,
          createdBy: income.createdBy,
        },
      });
      const account = this.financeAccounts.find((a) => a.id === income.accountId)!;
      await tx.financeAccount.upsert({
        where: { id: account.id },
        create: {
          id: account.id,
          name: account.name,
          kind: account.kind === 'CASH' ? PrismaFinanceAccountKind.CASH : PrismaFinanceAccountKind.BANK,
          balance: account.balance,
        },
        update: { balance: account.balance },
      });
      await this.persistFinanceAppStateSlice(tx);
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalFinanceExpense(expense: FinanceExpense) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.financeExpense.findUnique({
        where: { id: expense.id },
        select: { id: true },
      });
      if (existing) {
        return;
      }
      await tx.financeExpense.create({
        data: {
          id: expense.id,
          createdAt: new Date(expense.createdAt),
          title: expense.title,
          amount: expense.amount,
          comment: expense.comment ?? null,
          createdBy: expense.createdBy,
          accountId: expense.accountId,
          accountName: expense.accountName,
        },
      });
      const account = this.financeAccounts.find((a) => a.id === expense.accountId)!;
      await tx.financeAccount.upsert({
        where: { id: account.id },
        create: {
          id: account.id,
          name: account.name,
          kind: account.kind === 'CASH' ? PrismaFinanceAccountKind.CASH : PrismaFinanceAccountKind.BANK,
          balance: account.balance,
        },
        update: { balance: account.balance },
      });
      await this.persistFinanceAppStateSlice(tx);
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalFinanceAccountBalance(accountId: string) {
    const account = this.financeAccounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    await this.prisma.financeAccount.update({
      where: { id: accountId },
      data: { balance: account.balance },
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalFinanceCategoryAmounts() {
    await this.persistFinanceAppStateSlice(this.prisma);
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalAcquiringConfig() {
    await this.persistFinanceAppStateSlice(this.prisma);
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalFinanceReset() {
    await this.prisma.$transaction(async (tx) => {
      await tx.financeExpense.deleteMany();
      await tx.financeIncome.deleteMany();
      for (const account of this.financeAccounts) {
        await tx.financeAccount.upsert({
          where: { id: account.id },
          create: {
            id: account.id,
            name: account.name,
            kind: account.kind === 'CASH' ? PrismaFinanceAccountKind.CASH : PrismaFinanceAccountKind.BANK,
            balance: 0,
          },
          update: { balance: 0 },
        });
      }
      await this.persistFinanceAppStateSlice(tx);
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalProcurementCosts() {
    const rows = Object.entries(this.productProcurementCosts).map(([name, cost]) => ({
      name,
      cost,
    }));
    await this.prisma.$transaction(async (tx) => {
      await tx.productProcurementCost.deleteMany();
      if (rows.length > 0) {
        await tx.productProcurementCost.createMany({ data: rows });
      }
    });
    await this.persistLatestAuditEntry();
  }

  private async persistIncrementalWriteOff(writeOff: WriteOffItem, storeKey: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.writeOff.findUnique({ where: { id: writeOff.id }, select: { id: true } });
      if (!existing) {
        await tx.writeOff.create({
          data: {
            id: writeOff.id,
            createdAt: new Date(writeOff.createdAt),
            name: writeOff.name,
            qty: writeOff.qty,
            reason: writeOff.reason === 'Брак' ? WriteOffReason.BRAK : WriteOffReason.POLOMKA,
          },
        });
      }
      const productName = writeOff.name.trim();
      const qty = this.getStockQty(storeKey, productName);
      await tx.productStockLocation.upsert({
        where: {
          locationKey_productName: { locationKey: storeKey, productName },
        },
        create: { locationKey: storeKey, productName, qty },
        update: { qty },
      });
    });
    await this.persistLatestAuditEntry();
  }

  private queuePersist() {
    if (!this.persistenceEnabled) {
      return;
    }
    if (this.persistDebounceTimer) {
      return;
    }
    this.persistFlushScheduled = true;
    this.persistDebounceTimer = setTimeout(() => {
      this.persistDebounceTimer = null;
      if (!this.persistFlushScheduled) {
        return;
      }
      this.persistFlushScheduled = false;
      this.flushPersistNow();
    }, AuthService.PERSIST_DEBOUNCE_MS);
  }

  private flushPersistNow() {
    this.persistChain = this.persistChain
      .then(async () => this.persistState())
      .catch((error: unknown) => {
        this.logger.error('Failed to persist auth state', error as Error);
      });
  }

  private async seedIfNeeded() {
    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      await migrateLegacyDemoNicknames(this.prisma);
      await ensureRetoucherUsersIfMissing(this.prisma);
      await ensureManagerUserIfMissing(this.prisma);
      await ensureManagerStaffAndAssignments(this.prisma);
      return;
    }
    await ensureDemoData(this.prisma);
  }

  private loadDefaultState() {
    this.productCatalog = [
      { name: 'Магнит', price: 200 },
      { name: 'Рамка А4', price: 500 },
      { name: 'Декоративная рамка', price: 800 },
      { name: 'Бамбуковая рамка', price: 900 },
      { name: 'электронный вариант и фото', price: 1500 },
      { name: 'Рамка А6', price: 300 },
    ];
    this.productProcurementCosts = Object.fromEntries(
      this.productCatalog.map((item) => [item.name.trim(), 0]),
    );
    this.syncProcurementKeysWithCatalog();
    this.storeRevenuePlans = {};
    this.managerStoreCommissions = Object.fromEntries(
      DEMO_STORE_NAMES.map((storeName) => [
        storeName,
        storeName === 'Сады морей Тех. зона' || storeName === 'Метрополь' ? 0 : 5,
      ]),
    );
    this.demoUsers = buildDefaultDemoUserRows();
    this.sellerProfiles = buildDefaultSellerProfileRows().map((row) => ({
      id: row.id,
      fullName: row.fullName,
      nickname: row.nickname,
      storeName: row.storeName,
      ratePercent: row.ratePercent,
      salesAmount: 0,
      checksCount: 0,
      sales: [],
      commissionAmount: 0,
    }));
    this.staff = buildDefaultStaffRows().map((row) => ({
      id: row.id,
      fullName: row.fullName,
      nickname: row.nickname,
      isActive: row.isActive,
      staffPosition: row.staffPosition,
      retoucherRatePercent: 5,
      earningsAmount: 0,
    }));
    this.storeStaffAssignments = this.staff
      .filter((member) => member.staffPosition !== 'MANAGER')
      .map((member) => ({
        staffId: member.id,
        storeName:
          this.demoUsers.find((user) => user.id === member.id)?.storeName ?? DEMO_STORE_NAMES[0],
      }));
    const managerMember = this.staff.find((member) => member.staffPosition === 'MANAGER');
    if (managerMember) {
      for (const row of buildDefaultManagerStoreAssignments(managerMember.id)) {
        this.attachStaffToStore(row.staffId, row.storeName);
      }
    }
    const seedWarehouse: Record<string, number> = {
      Магнит: 35,
      'Рамка А4': 18,
      'Декоративная рамка': 12,
      'Бамбуковая рамка': 9,
      'электронный вариант и фото': 30,
      'Рамка А6': 22,
    };
    this.productStockByLocation = {};
    for (const loc of this.allStockLocationKeys()) {
      this.productStockByLocation[loc] = {};
      for (const p of this.productCatalog) {
        const nm = p.name;
        this.productStockByLocation[loc][nm] =
          loc === WAREHOUSE_SADY_KEY ? (seedWarehouse[nm] ?? 0) : 0;
      }
    }
    this.adminWriteOffs = [
      {
        id: 'wo-1',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
        name: 'Рамка А4',
        qty: 2,
        reason: 'Брак',
      },
      {
        id: 'wo-2',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        name: 'Магнит',
        qty: 5,
        reason: 'Поломка',
      },
      {
        id: 'wo-3',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        name: 'Рамка А6',
        qty: 1,
        reason: 'Брак',
      },
    ];
    this.commissionChangeRequests = [];
    this.directorApprovalRequests = [];
    this.shiftHistory = [];
    this.cashDisciplineEvents = [];
    this.auditLog = [];
    this.financeAccounts = this.defaultFinanceAccounts();
    this.financeExpenses = [];
    this.financeIncomes = [];
    this.autoFinanceAccounts = this.defaultAutoFinanceAccounts();
    this.autoFinanceIncomes = [];
    this.financeExpenseCategoryAmounts = defaultFinanceCategoryAmounts();
    this.currentShiftId = null;
    this.lastSaleAt = null;
    this.acquiringPercent = 1.8;
    this.acquiringPercentDetkov = 1.8;
    this.acquiringPercentPutintsevSber = 1.8;
    this.acquiringPercentLyokha = 1.8;
    this.acquiringProfilesJson = serializeAcquiringProfiles(defaultAcquiringProfiles());
    this.storeEquipmentByStore = {};
    this.storeEquipmentCustomTypes = [];
    for (const sn of DEMO_STORE_NAMES) {
      this.storeEquipmentByStore[sn] = emptyStoreEquipmentCounts();
    }
  }

  private async loadState() {
    const [
      users,
      sellerProfiles,
      sales,
      writeOffs,
      shifts,
      shiftAssignments,
      cashEvents,
      staff,
      storeStaffAssignments,
      products,
      stock,
      procurementCosts,
      storePlans,
      requests,
      audit,
      financeAccounts,
      financeExpenses,
      financeIncomes,
      appState,
      directorApprovals,
      storeEquipmentRows,
      storeEquipmentCustomTypeRows,
      managerCommissionRows,
    ] = await this.prisma.$transaction([
      this.prisma.user.findMany(),
      this.prisma.sellerProfile.findMany(),
      this.prisma.sale.findMany({
        where: {
          createdAt: {
            gte: new Date(
              Date.now() - AuthService.salesMemoryDays() * 24 * 60 * 60 * 1000,
            ),
          },
        },
        include: { items: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.writeOff.findMany(),
      this.prisma.shift.findMany(),
      this.prisma.shiftAssignment.findMany(),
      this.prisma.cashDisciplineEvent.findMany(),
      this.prisma.staffMember.findMany(),
      this.prisma.storeStaffAssignment.findMany(),
      this.prisma.productCatalog.findMany(),
      this.prisma.productStockLocation.findMany(),
      this.prisma.productProcurementCost.findMany(),
      this.prisma.storeRevenuePlan.findMany(),
      this.prisma.commissionChangeRequest.findMany(),
      this.prisma.auditLogItem.findMany({
        orderBy: { createdAt: 'desc' },
        take: AuthService.MAX_AUDIT_LOG_ITEMS,
      }),
      this.prisma.financeAccount.findMany(),
      this.prisma.financeExpense.findMany(),
      this.prisma.financeIncome.findMany(),
      this.prisma.appState.findUnique({ where: { id: 1 } }),
      this.prisma.directorApprovalRequest.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.storeEquipment.findMany(),
      this.prisma.storeEquipmentCustomType.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.managerStoreCommission.findMany(),
    ]);

    const salesBySellerId = new Map<number, SaleRecord[]>();
    for (const sale of sales) {
      const lines: SaleLine[] = (sale.items ?? []).map((row) => ({
        name: row.name.trim(),
        qty: row.qty,
      }));
      const current = salesBySellerId.get(sale.sellerId) ?? [];
      current.push({
        id: sale.id,
        createdAt: sale.createdAt.toISOString(),
        items: lines,
        totalAmount: sale.totalAmount,
        units: sale.units,
        paymentType: prismaPaymentTypeToInternal(sale.paymentType),
      });
      salesBySellerId.set(sale.sellerId, current);
    }

    const userById = new Map(users.map((user) => [user.id, user]));
    this.demoUsers = users.map((user) => ({
      id: user.id,
      nickname: user.nickname,
      password: user.password,
      fullName: user.fullName,
      role: user.role as UserRole,
      storeName: user.storeName,
      isActive: user.isActive,
    }));
    this.sellerProfiles = sellerProfiles.map((profile) => {
      const user = userById.get(profile.id);
      const rp = Number(profile.ratePercent);
      return {
        id: profile.id,
        fullName: user?.fullName ?? '',
        nickname: user?.nickname ?? '',
        storeName: profile.storeName,
        ratePercent: Number.isFinite(rp) ? rp : 0,
        salesAmount: 0,
        checksCount: 0,
        sales: (salesBySellerId.get(profile.id) ?? []).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
        commissionAmount: 0,
      };
    });
    this.adminWriteOffs = writeOffs.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      name: item.name,
      qty: item.qty,
      reason: item.reason === WriteOffReason.BRAK ? 'Брак' : 'Поломка',
    }));
    const assignedByShiftId = new Map<string, number[]>();
    for (const assignment of shiftAssignments) {
      const current = assignedByShiftId.get(assignment.shiftId) ?? [];
      current.push(assignment.sellerId);
      assignedByShiftId.set(assignment.shiftId, current);
    }
    this.shiftHistory = shifts.map((shift) => ({
      id: shift.id,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString(),
      openedBy: shift.openedBy,
      closedBy: shift.closedBy ?? undefined,
      assignedSellerIds: assignedByShiftId.get(shift.id) ?? [],
      checksCount: shift.checksCount,
      itemsCount: shift.itemsCount,
      status: shift.status === ShiftStatus.OPEN ? 'OPEN' : 'CLOSED',
    }));
    this.cashDisciplineEvents = cashEvents.map((event) => ({
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      type: event.type as CashEventType,
      comment: event.comment,
      createdBy: event.createdBy,
    }));
    this.staff = staff.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      nickname: member.nickname,
      isActive: member.isActive,
      assignedShiftId: member.assignedShiftId ?? undefined,
      staffPosition:
        member.staffPosition === StaffPosition.RETOUCHER
          ? 'RETOUCHER'
          : member.staffPosition === StaffPosition.MANAGER
            ? 'MANAGER'
            : 'SALES',
      retoucherRatePercent:
        typeof member.retoucherRatePercent === 'number' && Number.isFinite(member.retoucherRatePercent)
          ? member.retoucherRatePercent
          : 5,
      earningsAmount: 0,
    }));
    this.storeStaffAssignments = storeStaffAssignments.map((item) => ({
      storeName: item.storeName,
      staffId: item.staffId,
    }));
    if (this.storeStaffAssignments.length === 0) {
      this.storeStaffAssignments = this.staff.map((member) => ({
        staffId: member.id,
        storeName:
          this.demoUsers.find((user) => user.id === member.id)?.storeName ?? DEMO_STORE_NAMES[0],
      }));
    }
    this.productCatalog = products.map((item) => ({ name: item.name, price: item.price }));
    this.productStockByLocation = {};
    for (const row of stock) {
      this.ensureStockCell(row.locationKey, row.productName);
      this.productStockByLocation[row.locationKey][row.productName] = row.qty;
    }
    this.migrateLegacyCentralWarehouse();
    this.syncStockWithCatalog();
    this.productProcurementCosts = {};
    for (const item of procurementCosts) {
      const key = item.name.trim();
      if (key) {
        this.productProcurementCosts[key] = item.cost;
      }
    }
    this.syncProcurementKeysWithCatalog();
    this.storeRevenuePlans = {};
    for (const item of storePlans) {
      const dayPlans = this.storeRevenuePlans[item.dayKey] ?? {};
      dayPlans[item.storeName] = item.planRevenue;
      this.storeRevenuePlans[item.dayKey] = dayPlans;
    }
    this.managerStoreCommissions = {};
    for (const row of managerCommissionRows) {
      this.managerStoreCommissions[row.storeName] = row.percent;
    }
    for (const storeName of DEMO_STORE_NAMES) {
      if (this.managerStoreCommissions[storeName] === undefined) {
        this.managerStoreCommissions[storeName] = 5;
      }
    }
    this.commissionChangeRequests = requests.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      sellerId: item.sellerId,
      requestedByNickname: item.requestedByNickname,
      requestedPercent: item.requestedPercent,
      previousPercent: item.previousPercent,
      status: item.status as CommissionRequestStatus,
      comment: item.comment ?? undefined,
    }));
    this.directorApprovalRequests = directorApprovals.map((item) => {
      const raw = item.payload;
      const payload =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as DirectorApprovalPayloadMem)
          : ({} as DirectorApprovalPayloadMem);
      return {
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        kind: item.kind === PrismaDirectorApprovalKind.SALE_DELETE ? 'SALE_DELETE' : 'WRITE_OFF',
        state:
          item.state === PrismaDirectorApprovalState.PENDING
            ? 'PENDING'
            : item.state === PrismaDirectorApprovalState.APPROVED
              ? 'APPROVED'
              : 'REJECTED',
        requestedByNickname: item.requestedByNickname,
        storeName: item.storeName,
        payload,
        resolvedAt: item.resolvedAt?.toISOString(),
        resolvedBy: item.resolvedBy ?? undefined,
      };
    });
    this.auditLog = audit
      .map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        actor: item.actor,
        action: item.action,
        details: item.details,
      }))
      .reverse();
    this.trimAuditLogInMemory();
    this.financeAccounts = financeAccounts.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind === PrismaFinanceAccountKind.CASH ? 'CASH' : 'BANK',
      balance: item.balance,
    }));
    if (this.financeAccounts.length === 0) {
      this.financeAccounts = this.defaultFinanceAccounts();
    } else {
      this.financeAccounts = this.mergeFinanceAccountsWithDefaults(this.financeAccounts);
    }
    this.financeExpenses = financeExpenses.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      title: item.title,
      amount: item.amount,
      comment: item.comment ?? undefined,
      createdBy: item.createdBy,
      accountId: item.accountId,
      accountName: item.accountName,
    }));
    this.financeIncomes = financeIncomes.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      workDay: item.workDay,
      amount: item.amount,
      comment: item.comment ?? undefined,
      createdBy: item.createdBy,
      accountId: item.accountId,
      accountName: item.accountName,
    }));
    this.loadAutoFinanceStateFromJson(appState?.autoFinanceStateJson);
    await this.detachLegacyAutoIncomesFromManualLedger();
    this.currentShiftId = appState?.currentShiftId ?? null;
    this.lastSaleAt = appState?.lastSaleAt?.toISOString() ?? null;
    this.acquiringPercent =
      appState?.acquiringPercent !== undefined && appState.acquiringPercent !== null
        ? appState.acquiringPercent
        : 1.8;
    this.acquiringPercentDetkov =
      appState?.acquiringPercentDetkov !== undefined && appState.acquiringPercentDetkov !== null
        ? appState.acquiringPercentDetkov
        : 1.8;
    this.acquiringPercentPutintsevSber =
      appState?.acquiringPercentPutintsevSber != null
        ? appState.acquiringPercentPutintsevSber
        : 1.8;
    this.acquiringPercentLyokha =
      appState?.acquiringPercentLyokha != null ? appState.acquiringPercentLyokha : 1.8;
    this.acquiringProfilesJson = appState?.acquiringProfilesJson ?? null;
    if (appState?.financeExpenseCategoryAmountsJson) {
      try {
        this.financeExpenseCategoryAmounts = normalizeFinanceCategoryAmounts(
          JSON.parse(appState.financeExpenseCategoryAmountsJson),
        );
      } catch {
        this.financeExpenseCategoryAmounts = defaultFinanceCategoryAmounts();
      }
    } else {
      this.financeExpenseCategoryAmounts = defaultFinanceCategoryAmounts();
    }
    if (!this.acquiringProfilesJson) {
      this.acquiringProfilesJson = serializeAcquiringProfiles(
        defaultAcquiringProfiles({
          putintsevVtb: this.acquiringPercent,
          detkovVtb: this.acquiringPercentDetkov,
          putintsevSber: this.acquiringPercentPutintsevSber,
          lyokhaRs: this.acquiringPercentLyokha,
        }),
      );
    }

    this.storeEquipmentCustomTypes = storeEquipmentCustomTypeRows.map((row) => ({
      id: row.id,
      label: row.label,
    }));

    this.storeEquipmentByStore = {};
    for (const sn of DEMO_STORE_NAMES) {
      this.storeEquipmentByStore[sn] = emptyStoreEquipmentCounts();
    }
    for (const row of storeEquipmentRows) {
      if (this.storeEquipmentByStore[row.storeName] !== undefined) {
        const extra = parseStoreEquipmentExtra(row.extra);
        for (const t of this.storeEquipmentCustomTypes) {
          if (extra[t.id] === undefined) {
            extra[t.id] = 0;
          }
        }
        this.storeEquipmentByStore[row.storeName] = {
          pc: row.pc,
          camera: row.camera,
          printer: row.printer,
          sdCard: row.sdCard,
          monitor: row.monitor,
          mouse: row.mouse,
          keyboard: row.keyboard,
          cardReader: row.cardReader,
          extra,
        };
      }
    }
  }

  private async persistState() {
    await this.prisma.$transaction(async (tx) => {
      await tx.appState.upsert({
        where: { id: 1 },
        update: {
          currentShiftId: this.currentShiftId,
          lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
          acquiringPercent: this.acquiringPercent,
          acquiringPercentDetkov: this.acquiringPercentDetkov,
          acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
          acquiringPercentLyokha: this.acquiringPercentLyokha,
          acquiringProfilesJson: this.acquiringProfilesJson,
          financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
            this.financeExpenseCategoryAmounts,
          ),
        },
        create: {
          id: 1,
          currentShiftId: this.currentShiftId,
          lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
          acquiringPercent: this.acquiringPercent,
          acquiringPercentDetkov: this.acquiringPercentDetkov,
          acquiringPercentPutintsevSber: this.acquiringPercentPutintsevSber,
          acquiringPercentLyokha: this.acquiringPercentLyokha,
          acquiringProfilesJson: this.acquiringProfilesJson,
          financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
            this.financeExpenseCategoryAmounts,
          ),
        },
      });

      await tx.financeExpense.deleteMany();
      await tx.financeIncome.deleteMany();
      await tx.financeAccount.deleteMany();
      if (this.financeAccounts.length > 0) {
        await tx.financeAccount.createMany({
          data: this.financeAccounts.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind === 'CASH' ? PrismaFinanceAccountKind.CASH : PrismaFinanceAccountKind.BANK,
            balance: item.balance,
          })),
        });
      }
      if (this.financeExpenses.length > 0) {
        await tx.financeExpense.createMany({
          data: this.financeExpenses.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            title: item.title,
            amount: item.amount,
            comment: item.comment ?? null,
            createdBy: item.createdBy,
            accountId: item.accountId,
            accountName: item.accountName,
          })),
        });
      }
      if (this.financeIncomes.length > 0) {
        await tx.financeIncome.createMany({
          data: this.financeIncomes.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            workDay: item.workDay,
            accountId: item.accountId,
            accountName: item.accountName,
            amount: item.amount,
            comment: item.comment ?? null,
            createdBy: item.createdBy,
          })),
        });
      }

      await tx.user.deleteMany();
      await tx.user.createMany({
        data: this.demoUsers.map((user) => ({
          id: user.id,
          nickname: user.nickname,
          password: user.password,
          fullName: user.fullName,
          role: user.role as PrismaUserRole,
          storeName: user.storeName,
          isActive: user.isActive,
        })),
      });

      await tx.sellerProfile.deleteMany();
      await tx.sellerProfile.createMany({
        data: this.sellerProfiles.map((seller) => ({
          id: seller.id,
          storeName: seller.storeName,
          ratePercent: seller.ratePercent,
        })),
      });

      await tx.staffMember.deleteMany();
      await tx.storeStaffAssignment.deleteMany();
      if (this.staff.length > 0) {
        await tx.staffMember.createMany({
          data: this.staff.map((member) => ({
            id: member.id,
            fullName: member.fullName,
            nickname: member.nickname,
            isActive: member.isActive,
            assignedShiftId: member.assignedShiftId ?? null,
            staffPosition:
              member.staffPosition === 'RETOUCHER'
                ? StaffPosition.RETOUCHER
                : member.staffPosition === 'MANAGER'
                  ? StaffPosition.MANAGER
                  : StaffPosition.SALES,
            retoucherRatePercent: member.retoucherRatePercent,
          })),
        });
      }
      if (this.storeStaffAssignments.length > 0) {
        await tx.storeStaffAssignment.createMany({
          data: this.storeStaffAssignments.map((item) => ({
            storeName: item.storeName,
            staffId: item.staffId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.saleItem.deleteMany();
      await tx.sale.deleteMany();
      const salesFlat = this.sellerProfiles.flatMap((seller) =>
        seller.sales.map((sale) => ({
          id: sale.id,
          createdAt: new Date(sale.createdAt),
          totalAmount: sale.totalAmount,
          units: sale.units,
          sellerId: seller.id,
          paymentType: internalPaymentTypeToPrisma(sale.paymentType),
        })),
      );
      if (salesFlat.length > 0) {
        await tx.sale.createMany({ data: salesFlat });
      }
      const saleItemsFlat = this.sellerProfiles.flatMap((seller) =>
        seller.sales.flatMap((sale) =>
          sale.items.map((item, index) => ({
            id: `${sale.id}-${index}`,
            saleId: sale.id,
            name: item.name.trim(),
            qty: item.qty,
          })),
        ),
      );
      if (saleItemsFlat.length > 0) {
        await tx.saleItem.createMany({ data: saleItemsFlat });
      }

      await tx.writeOff.deleteMany();
      if (this.adminWriteOffs.length > 0) {
        await tx.writeOff.createMany({
          data: this.adminWriteOffs.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            name: item.name,
            qty: item.qty,
            reason: item.reason === 'Брак' ? WriteOffReason.BRAK : WriteOffReason.POLOMKA,
          })),
        });
      }

      await tx.shiftAssignment.deleteMany();
      await tx.shift.deleteMany();
      if (this.shiftHistory.length > 0) {
        await tx.shift.createMany({
          data: this.shiftHistory.map((shift) => ({
            id: shift.id,
            openedAt: new Date(shift.openedAt),
            closedAt: shift.closedAt ? new Date(shift.closedAt) : null,
            openedBy: shift.openedBy,
            closedBy: shift.closedBy ?? null,
            checksCount: shift.checksCount,
            itemsCount: shift.itemsCount,
            status: shift.status === 'OPEN' ? ShiftStatus.OPEN : ShiftStatus.CLOSED,
          })),
        });
        const assignments = this.shiftHistory.flatMap((shift) =>
          shift.assignedSellerIds.map((sellerId) => ({
            shiftId: shift.id,
            sellerId,
          })),
        );
        if (assignments.length > 0) {
          await tx.shiftAssignment.createMany({ data: assignments });
        }
      }

      await tx.cashDisciplineEvent.deleteMany();
      if (this.cashDisciplineEvents.length > 0) {
        await tx.cashDisciplineEvent.createMany({
          data: this.cashDisciplineEvents.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            type: item.type as PrismaCashEventType,
            comment: item.comment,
            createdBy: item.createdBy,
          })),
        });
      }

      await tx.commissionChangeRequest.deleteMany();
      if (this.commissionChangeRequests.length > 0) {
        await tx.commissionChangeRequest.createMany({
          data: this.commissionChangeRequests.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            sellerId: item.sellerId,
            requestedByNickname: item.requestedByNickname,
            requestedPercent: item.requestedPercent,
            previousPercent: item.previousPercent,
            status: item.status as PrismaCommissionRequestStatus,
            comment: item.comment ?? null,
          })),
        });
      }

      await tx.directorApprovalRequest.deleteMany();
      if (this.directorApprovalRequests.length > 0) {
        await tx.directorApprovalRequest.createMany({
          data: this.directorApprovalRequests.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            kind:
              item.kind === 'SALE_DELETE'
                ? PrismaDirectorApprovalKind.SALE_DELETE
                : PrismaDirectorApprovalKind.WRITE_OFF,
            state:
              item.state === 'PENDING'
                ? PrismaDirectorApprovalState.PENDING
                : item.state === 'APPROVED'
                  ? PrismaDirectorApprovalState.APPROVED
                  : PrismaDirectorApprovalState.REJECTED,
            requestedByNickname: item.requestedByNickname,
            storeName: item.storeName,
            payload: item.payload as object,
            resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : null,
            resolvedBy: item.resolvedBy ?? null,
          })),
        });
      }

      await tx.productCatalog.deleteMany();
      if (this.productCatalog.length > 0) {
        await tx.productCatalog.createMany({ data: this.productCatalog });
      }
      await tx.productStockLocation.deleteMany();
      const stockRows = Object.entries(this.productStockByLocation).flatMap(([locationKey, mp]) =>
        Object.entries(mp).map(([productName, qty]) => ({ locationKey, productName, qty })),
      );
      if (stockRows.length > 0) {
        await tx.productStockLocation.createMany({ data: stockRows });
      }
      await tx.productProcurementCost.deleteMany();
      const procurementRows = Object.entries(this.productProcurementCosts).map(([name, cost]) => ({
        name,
        cost,
      }));
      if (procurementRows.length > 0) {
        await tx.productProcurementCost.createMany({ data: procurementRows });
      }
      await tx.storeRevenuePlan.deleteMany();
      const planRows = Object.entries(this.storeRevenuePlans).flatMap(([dayKey, plans]) =>
        Object.entries(plans).map(([storeName, planRevenue]) => ({
          dayKey,
          storeName,
          planRevenue,
        })),
      );
      if (planRows.length > 0) {
        await tx.storeRevenuePlan.createMany({ data: planRows });
      }

      await tx.managerStoreCommission.deleteMany();
      await tx.managerStoreCommission.createMany({
        data: DEMO_STORE_NAMES.map((storeName) => ({
          storeName,
          percent: this.managerPercentForStore(storeName),
        })),
      });

      await tx.storeEquipmentCustomType.deleteMany();
      if (this.storeEquipmentCustomTypes.length > 0) {
        await tx.storeEquipmentCustomType.createMany({
          data: this.storeEquipmentCustomTypes.map((t, index) => ({
            id: t.id,
            label: t.label,
            sortOrder: index,
          })),
        });
      }

      await tx.storeEquipment.deleteMany();
      const equipmentRows = DEMO_STORE_NAMES.map((sn) => {
        const e = this.storeEquipmentByStore[sn] ?? emptyStoreEquipmentCounts();
        return {
          storeName: sn,
          pc: e.pc,
          camera: e.camera,
          printer: e.printer,
          sdCard: e.sdCard,
          monitor: e.monitor,
          mouse: e.mouse,
          keyboard: e.keyboard,
          cardReader: e.cardReader,
          extra: e.extra ?? {},
        };
      });
      await tx.storeEquipment.createMany({ data: equipmentRows });

      await tx.auditLogItem.deleteMany();
      if (this.auditLog.length > 0) {
        await tx.auditLogItem.createMany({
          data: this.auditLog.map((item) => ({
            id: item.id,
            createdAt: new Date(item.createdAt),
            actor: item.actor,
            action: item.action,
            details: item.details,
          })),
        });
      }
    });
  }

  /** Синхронизирует demoUsers с продавцами/персоналом перед persistState (иначе FK User/SellerProfile). */
  private syncDemoUsersForRenderMigration(
    sellers: Array<{ id: number; fullName: string; nickname: string; storeName: string }>,
    staff: StaffMember[],
  ): void {
    const byId = new Map<number, DemoUser>();
    const byNick = new Map<string, DemoUser>();
    const defaultPwd = getDefaultDemoPassword();

    const put = (user: DemoUser) => {
      byId.set(user.id, user);
      byNick.set(user.nickname, user);
    };

    for (const user of this.demoUsers) {
      if (['DIRECTOR', 'ACCOUNTANT', 'MANAGER', 'ADMIN'].includes(user.role)) {
        put(user);
      }
    }

    const ensure = (row: {
      id: number;
      nickname: string;
      fullName: string;
      role: UserRole;
      storeName: string;
      isActive?: boolean;
    }) => {
      const existing = byId.get(row.id) ?? byNick.get(row.nickname);
      put({
        id: row.id,
        nickname: row.nickname,
        password: existing?.password ?? defaultPwd,
        fullName: row.fullName,
        role: row.role,
        storeName: row.storeName,
        isActive: row.isActive ?? true,
      });
    };

    for (const seller of sellers) {
      ensure({
        id: seller.id,
        nickname: seller.nickname,
        fullName: seller.fullName,
        role: 'SELLER',
        storeName: seller.storeName,
      });
    }

    for (const member of staff) {
      const row = member as StaffMigrationRow;
      const role: UserRole =
        member.staffPosition === 'RETOUCHER'
          ? 'RETOUCHER'
          : member.staffPosition === 'MANAGER'
            ? 'MANAGER'
            : 'SELLER';
      const stores = staffStoresFromMigrationRow(row);
      const storeName =
        stores[0] ??
        sellers.find((s) => s.id === member.id)?.storeName ??
        byId.get(member.id)?.storeName ??
        DEMO_STORE_NAMES[0];
      ensure({
        id: member.id,
        nickname: member.nickname,
        fullName: member.fullName,
        role,
        storeName,
        isActive: member.isActive,
      });
    }

    this.demoUsers = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }

  /** Перенос снимка с Render (HTTP) → PostgreSQL на Timeweb. */
  async applyRenderMigrationSnapshot(snapshot: {
    financeOps?: {
      accounts?: Array<{ id: string; name: string; kind: 'CASH' | 'BANK'; balance: number }>;
      expenses?: Array<{
        id: string;
        createdAt: string;
        title: string;
        amount: number;
        comment?: string;
        createdBy: string;
        accountId: string;
        accountName: string;
      }>;
      incomes?: Array<{
        id: string;
        createdAt: string;
        workDay: string;
        amount: number;
        comment?: string;
        createdBy: string;
        accountId: string;
        accountName: string;
      }>;
      categoryAmounts?: Array<{ title: string; amount: number }>;
    };
    sales?: Array<{
      id: string;
      createdAt: string;
      sellerId: number;
      totalAmount: number;
      units: number;
      items?: Array<{ name: string; qty: number }>;
      paymentType?: SalePaymentType;
    }>;
    sellers?: Array<{
      id: number;
      fullName: string;
      nickname: string;
      storeName: string;
      ratePercent: number;
    }>;
    staff?: StaffMember[];
    shifts?: Shift[];
    writeOffs?: WriteOffItem[];
    products?: Array<{ name: string; price: number }>;
    procurementCosts?: Array<{ name: string; cost: number }>;
  }): Promise<{ sales: number; expenses: number; incomes: number }> {
    if (!this.persistenceEnabled) {
      throw new Error('DATABASE_URL is required for migration');
    }
    const fo = snapshot.financeOps;
    if (fo?.accounts?.length) {
      this.financeAccounts = fo.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        balance: Number(a.balance) || 0,
      }));
    }
    if (fo?.expenses) {
      this.financeExpenses = fo.expenses.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        title: e.title,
        amount: Number(e.amount) || 0,
        comment: e.comment,
        createdBy: e.createdBy,
        accountId: e.accountId,
        accountName: e.accountName,
      }));
    }
    if (fo?.incomes) {
      this.financeIncomes = fo.incomes.map((i) => ({
        id: i.id,
        createdAt: i.createdAt,
        workDay: i.workDay,
        amount: Number(i.amount) || 0,
        comment: i.comment,
        createdBy: i.createdBy,
        accountId: i.accountId,
        accountName: i.accountName,
      }));
    }
    if (fo?.categoryAmounts?.length) {
      const map: Record<string, number> = {};
      for (const row of fo.categoryAmounts) {
        if (isFinanceExpenseCategoryLabel(row.title)) {
          map[row.title] = Number(row.amount) || 0;
        }
      }
      this.financeExpenseCategoryAmounts = normalizeFinanceCategoryAmounts(map);
    }

    const salesBySeller = new Map<number, SaleRecord[]>();
    for (const sale of snapshot.sales ?? []) {
      const sellerId = Number(sale.sellerId);
      if (!Number.isFinite(sellerId)) {
        continue;
      }
      const pt: SalePaymentType =
        sale.paymentType === 'NON_CASH' || sale.paymentType === 'TRANSFER'
          ? sale.paymentType
          : 'CASH';
      const list = salesBySeller.get(sellerId) ?? [];
      list.push({
        id: String(sale.id),
        createdAt: String(sale.createdAt),
        items: (sale.items ?? []).map((line) => ({
          name: String(line.name).trim(),
          qty: Number(line.qty) || 0,
        })),
        totalAmount: Number(sale.totalAmount) || 0,
        units: Number(sale.units) || 0,
        paymentType: pt,
      });
      salesBySeller.set(sellerId, list);
    }

    const sellers = snapshot.sellers ?? [];
    this.sellerProfiles = sellers.map((s) => {
      const sales = (salesBySeller.get(s.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const profile: SellerProfile = {
        id: s.id,
        fullName: s.fullName,
        nickname: s.nickname,
        storeName: s.storeName,
        ratePercent: Number(s.ratePercent) || 0,
        salesAmount: 0,
        checksCount: 0,
        sales,
        commissionAmount: 0,
      };
      this.recomputeSeller(profile);
      return profile;
    });

    if (snapshot.staff?.length) {
      this.staff = snapshot.staff.map((m) => ({
        ...m,
        earningsAmount: m.earningsAmount ?? 0,
      }));
    }
    if (snapshot.shifts?.length) {
      this.shiftHistory = snapshot.shifts;
      const open = this.shiftHistory.find((s) => s.status === 'OPEN');
      this.currentShiftId = open?.id ?? null;
    }
    if (snapshot.writeOffs?.length) {
      this.adminWriteOffs = snapshot.writeOffs;
    }
    if (snapshot.products?.length) {
      this.productCatalog = snapshot.products.map((p) => ({
        name: String(p.name).trim(),
        price: Number(p.price) || 0,
      }));
    }
    if (snapshot.procurementCosts?.length) {
      const map: Record<string, number> = {};
      for (const row of snapshot.procurementCosts) {
        const name = String(row.name).trim();
        if (name) {
          map[name] = Number(row.cost) || 0;
        }
      }
      this.productProcurementCosts = map;
    }

    this.syncDemoUsersForRenderMigration(sellers, this.staff);
    const staffRows = (snapshot.staff ?? []) as StaffMigrationRow[];
    this.storeStaffAssignments = [];
    for (const row of staffRows) {
      for (const storeName of staffStoresFromMigrationRow(row)) {
        const exists = this.storeStaffAssignments.some(
          (item) => item.staffId === row.id && item.storeName === storeName,
        );
        if (!exists) {
          this.storeStaffAssignments.push({ staffId: row.id, storeName });
        }
      }
    }

    this.dashboardOverviewCache = null;
    await this.persistState();
    await this.loadState();

    return {
      sales: (snapshot.sales ?? []).length,
      expenses: this.financeExpenses.length,
      incomes: this.financeIncomes.length,
    };
  }
}
