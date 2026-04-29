import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CashEventType as PrismaCashEventType,
  CommissionRequestStatus as PrismaCommissionRequestStatus,
  FinanceAccountKind as PrismaFinanceAccountKind,
  PaymentType as PrismaPaymentType,
  StaffPosition,
  ShiftStatus,
  UserRole as PrismaUserRole,
  WriteOffReason,
} from '@prisma/client';
import { ensureDemoData, ensureRetoucherUsersIfMissing } from '../database/ensure-demo-data';
import { PrismaService } from '../prisma/prisma.service';
import { buildDefaultDemoUserRows, buildDefaultSellerProfileRows, buildDefaultStaffRows } from './build-demo-entities';
import { DEMO_STORE_NAMES } from './demo-stores';

export type UserRole = 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';

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

type StaffPositionKind = 'SALES' | 'RETOUCHER';

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
  private persistChain: Promise<void> = Promise.resolve();

  private commissionChangeRequests: CommissionChangeRequest[] = [];
  private currentShiftId: string | null = null;
  private lastSaleAt: string | null = null;
  private acquiringPercent = 1.8;
  private acquiringPercentDetkov = 1.8;
  private shiftHistory: Shift[] = [];
  private cashDisciplineEvents: CashDisciplineEvent[] = [];
  private staff: StaffMember[] = [];
  private storeStaffAssignments: StoreStaffAssignment[] = [];
  private productStock: Record<string, number> = {};
  private productProcurementCosts: Record<string, number> = {};
  private storeRevenuePlans: Record<string, Record<string, number>> = {};
  private auditLog: AuditLogItem[] = [];
  private adminWriteOffs: WriteOffItem[] = [];
  private financeAccounts: FinanceAccount[] = [];
  private financeExpenses: FinanceExpense[] = [];
  private financeIncomes: FinanceIncome[] = [];

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
    return {
      accounts,
      expenses,
      incomes,
      totals: {
        cash: Math.round(cashTotal * 100) / 100,
        bank: Math.round(bankTotal * 100) / 100,
        balance: Math.round(totalBalance * 100) / 100,
        expenses: Math.round(expenseTotal * 100) / 100,
        incomes: Math.round(incomeTotal * 100) / 100,
      },
    };
  }

  setAcquiringPercent(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercent = Math.round(percent * 1000) / 1000;
    this.pushAudit(actor, 'ACQUIRING_PERCENT_UPDATED', String(this.acquiringPercent));
    this.queuePersist();
    return { percent: this.acquiringPercent };
  }

  setAcquiringPercentDetkov(percent: number, actor = 'system') {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    this.acquiringPercentDetkov = Math.round(percent * 1000) / 1000;
    this.pushAudit(actor, 'ACQUIRING_PERCENT_DETKOV_UPDATED', String(this.acquiringPercentDetkov));
    this.queuePersist();
    return { percent: this.acquiringPercentDetkov };
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
    this.queuePersist();
    return account;
  }

  addFinanceIncome(
    payload: { accountId: string; amount: number; workDay: string; comment?: string },
    actor = 'system',
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.workDay)) {
      return null;
    }
    if (!payload.accountId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      return null;
    }
    const account = this.financeAccounts.find((item) => item.id === payload.accountId);
    if (!account) {
      return null;
    }
    const amount = Math.round(payload.amount * 100) / 100;
    account.balance = Math.round((account.balance + amount) * 100) / 100;
    const income: FinanceIncome = {
      id: `finc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    this.queuePersist();
    return income;
  }

  addFinanceExpense(
    payload: { accountId: string; title: string; amount: number; comment?: string },
    actor = 'system',
  ) {
    const title = payload.title?.trim();
    if (!payload.accountId || !title || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      return null;
    }
    const account = this.financeAccounts.find((item) => item.id === payload.accountId);
    if (!account) {
      return null;
    }
    const amount = Math.round(payload.amount * 100) / 100;
    account.balance = Math.max(0, Math.round((account.balance - amount) * 100) / 100);
    const expense: FinanceExpense = {
      id: `fexp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      title,
      amount,
      comment: payload.comment?.trim() || undefined,
      createdBy: actor,
      accountId: account.id,
      accountName: account.name,
    };
    this.financeExpenses.push(expense);
    this.pushAudit(actor, 'FINANCE_EXPENSE_ADDED', `${title}: ${amount} from ${account.name}`);
    this.queuePersist();
    return expense;
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
    this.queuePersist();
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
      { id: 'fa-cash-main', name: 'Наличка', kind: 'CASH', balance: 0 },
      { id: 'fa-bank-main', name: 'Р/с Путинцев', kind: 'BANK', balance: 0 },
      { id: 'fa-bank-extra', name: 'Р/с (Детков)', kind: 'BANK', balance: 0 },
    ];
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

  getDashboardOverview(nickname: string) {
    const user = this.demoUsers.find((item) => item.nickname === nickname);
    if (!user) {
      return null;
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
      const totalCommission = totalSellerCommission + retoucherTotal;
      const openShifts = this.shiftHistory.filter((s) => s.status === 'OPEN').length;
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
      return {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: user.role === 'DIRECTOR' ? 'Сводка директора' : 'Сводка бухгалтера',
        metrics: [
          { label: 'Выручка (все точки)', value: this.formatCurrency(Math.round(totalRevenue)) },
          { label: 'Чистая прибыль (оценка)', value: this.formatCurrency(netCompany) },
          { label: 'Закупки (оценка)', value: this.formatCurrency(roughPurchases) },
          { label: 'Выплаты персоналу', value: this.formatCurrency(Math.round(totalCommission)) },
          { label: 'Открытые смены', value: String(openShifts) },
        ],
        stores: storeRows,
      };
    }

    if (user.role === 'ADMIN') {
      const openShiftsForStore = this.shiftHistory.filter((shift) => {
        if (shift.status !== 'OPEN') {
          return false;
        }
        return shift.assignedSellerIds.some((sellerId) => {
          const profile = this.sellerProfiles.find((p) => p.id === sellerId);
          return profile?.storeName === user.storeName;
        });
      }).length;

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
      for (const m of this.staff) {
        if (m.staffPosition !== 'RETOUCHER' || !m.isActive) {
          continue;
        }
        const u = this.demoUsers.find((d) => d.id === m.id);
        if (u?.storeName === user.storeName && u.isActive) {
          storeSalaries += m.earningsAmount;
        }
      }

      const sellerRegister: Array<{ fullName: string; salary: string }> = this.sellerProfiles
        .filter((p) => p.storeName === user.storeName)
        .map((p) => {
          this.recomputeSeller(p);
          return {
            fullName: p.fullName,
            salary: this.formatCurrency(Math.round(p.commissionAmount)),
          };
        });
      for (const m of this.staff) {
        if (m.staffPosition !== 'RETOUCHER' || !m.isActive) {
          continue;
        }
        const u = this.demoUsers.find((d) => d.id === m.id);
        if (u?.storeName === user.storeName && u.isActive) {
          sellerRegister.push({
            fullName: m.fullName,
            salary: this.formatCurrency(Math.round(m.earningsAmount)),
          });
        }
      }
      sellerRegister.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));

      return {
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
      };
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
        return {
          id: item.id,
          fullName: item.fullName,
          nickname: item.nickname,
          storeName: item.storeName,
          ratePercent: item.ratePercent,
          salesAmount: item.salesAmount,
          checksCount: item.checksCount,
          commissionAmount: item.commissionAmount,
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
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT') {
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
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT') {
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
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT') {
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
    if (user.role === 'DIRECTOR' || user.role === 'ACCOUNTANT') {
      return all;
    }
    if (user.role === 'ADMIN') {
      const assignedIds = new Set(this.getStoreAssignedStaffIds(user.storeName));
      return all.filter((member) => assignedIds.has(member.id));
    }
    return [];
  }

  async setSellerPercentDirect(sellerId: number, ratePercent: number) {
    if (ratePercent < 0 || ratePercent > 100) {
      return null;
    }
    const seller = this.sellerProfiles.find((item) => item.id === sellerId);
    if (seller) {
      seller.ratePercent = ratePercent;
      this.recomputeSeller(seller);
      this.queuePersist();
      await this.persistChain;
      return this.getSellerProfiles().find((item) => item.id === sellerId) ?? null;
    }
    const staffMember = this.staff.find((m) => m.id === sellerId && m.staffPosition === 'RETOUCHER');
    if (!staffMember) {
      return null;
    }
    staffMember.retoucherRatePercent = ratePercent;
    this.syncRetoucherEarnings();
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
    if (!request || request.status !== 'PENDING') {
      return null;
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

  addAdminSale(
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    actor = 'system',
    paymentType: SalePaymentType = 'CASH',
  ) {
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

    const units = lines.reduce((sum, line) => sum + line.qty, 0);
    const sale: SaleRecord = {
      id: `sale-${Date.now()}`,
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
      this.productStock[line.name] = Math.max(0, (this.productStock[line.name] ?? 0) - line.qty);
    }
    this.pushAudit(
      actor,
      'SALE_CREATED',
      `sale=${sale.id}, seller=${seller.fullName}, total=${totalAmount}, pay=${paymentType}`,
    );
    this.queuePersist();
    return sale;
  }

  addWriteOff(name: string, qty: number, reason: 'Брак' | 'Поломка', actor = 'system') {
    const validNames = new Set(this.productCatalog.map((item) => item.name));
    if (!validNames.has(name) || qty <= 0) {
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
    this.productStock[name] = Math.max(0, (this.productStock[name] ?? 0) - writeOff.qty);
    this.pushAudit(actor, 'WRITE_OFF_CREATED', `${name} qty=${writeOff.qty}, reason=${reason}`);
    this.queuePersist();
    return writeOff;
  }

  updateWriteOff(id: string, qty: number, reason: 'Брак' | 'Поломка', actor = 'system') {
    const writeOff = this.adminWriteOffs.find((item) => item.id === id);
    if (!writeOff || qty <= 0) {
      return null;
    }
    const diff = Math.round(qty) - writeOff.qty;
    writeOff.qty = Math.round(qty);
    writeOff.reason = reason;
    this.productStock[writeOff.name] = Math.max(
      0,
      (this.productStock[writeOff.name] ?? 0) - diff,
    );
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
    this.productStock[deleted.name] = (this.productStock[deleted.name] ?? 0) + deleted.qty;
    this.adminWriteOffs.splice(index, 1);
    this.pushAudit(actor, 'WRITE_OFF_DELETED', `${deleted.name} qty=${deleted.qty}`);
    this.queuePersist();
    return true;
  }

  openShift(openedBy: string, assignedSellerIds: number[]) {
    this.ensureActiveShiftForToday();
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
      this.queuePersist();
      return existingOpen;
    }
    const shift: Shift = {
      id: `shift-${Date.now()}`,
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
    this.queuePersist();
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
        this.queuePersist();
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
    this.queuePersist();
    return shift;
  }

  getShifts() {
    this.ensureActiveShiftForToday();
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
    return this.staff.map((member) => {
      const u = this.demoUsers.find((d) => d.id === member.id);
      const assignedStores = this.storeStaffAssignments
        .filter((item) => item.staffId === member.id)
        .map((item) => item.storeName)
        .sort((a, b) => a.localeCompare(b, 'ru-RU'));
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
      password: '123456',
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
        password: '123456',
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
    const actorUser = this.demoUsers.find((item) => item.nickname === actor);
    const targetStoreName =
      actorUser?.role === 'ADMIN' ? actorUser.storeName : (requestedStoreName ?? actorUser?.storeName);
    if (!targetStoreName) {
      return null;
    }
    const beforeCount = this.storeStaffAssignments.length;
    this.storeStaffAssignments = this.storeStaffAssignments.filter(
      (item) => !(item.staffId === id && item.storeName === targetStoreName),
    );
    if (this.storeStaffAssignments.length === beforeCount) {
      return null;
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

    for (const [name, qty] of Object.entries(this.productStock)) {
      if (qty <= 10) {
        notifications.push({
          id: `low-${name}`,
          type: 'LOW_STOCK',
          message: `Товар "${name}" заканчивается: осталось ${qty} шт.`,
          createdAt: new Date().toISOString(),
        });
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

  private queuePersist() {
    if (!this.persistenceEnabled) {
      return;
    }
    this.persistChain = this.persistChain
      .then(async () => this.persistState())
      .catch((error: unknown) => {
        this.logger.error('Failed to persist auth state', error as Error);
      });
  }

  private async seedIfNeeded() {
    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      await ensureRetoucherUsersIfMissing(this.prisma);
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
    this.storeStaffAssignments = this.staff.map((member) => ({
      staffId: member.id,
      storeName:
        this.demoUsers.find((user) => user.id === member.id)?.storeName ?? DEMO_STORE_NAMES[0],
    }));
    this.productStock = {
      Магнит: 35,
      'Рамка А4': 18,
      'Декоративная рамка': 12,
      'Бамбуковая рамка': 9,
      'электронный вариант и фото': 30,
      'Рамка А6': 22,
    };
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
    this.shiftHistory = [];
    this.cashDisciplineEvents = [];
    this.auditLog = [];
    this.financeAccounts = this.defaultFinanceAccounts();
    this.financeExpenses = [];
    this.financeIncomes = [];
    this.currentShiftId = null;
    this.lastSaleAt = null;
    this.acquiringPercent = 1.8;
    this.acquiringPercentDetkov = 1.8;
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
    ] = await this.prisma.$transaction([
      this.prisma.user.findMany(),
      this.prisma.sellerProfile.findMany(),
      this.prisma.sale.findMany({
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
      this.prisma.productStock.findMany(),
      this.prisma.productProcurementCost.findMany(),
      this.prisma.storeRevenuePlan.findMany(),
      this.prisma.commissionChangeRequest.findMany(),
      this.prisma.auditLogItem.findMany(),
      this.prisma.financeAccount.findMany(),
      this.prisma.financeExpense.findMany(),
      this.prisma.financeIncome.findMany(),
      this.prisma.appState.findUnique({ where: { id: 1 } }),
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
      return {
        id: profile.id,
        fullName: user?.fullName ?? '',
        nickname: user?.nickname ?? '',
        storeName: profile.storeName,
        ratePercent: profile.ratePercent,
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
      staffPosition: member.staffPosition === StaffPosition.RETOUCHER ? 'RETOUCHER' : 'SALES',
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
    this.productStock = Object.fromEntries(stock.map((item) => [item.name, item.qty]));
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
    this.auditLog = audit.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      actor: item.actor,
      action: item.action,
      details: item.details,
    }));
    this.financeAccounts = financeAccounts.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind === PrismaFinanceAccountKind.CASH ? 'CASH' : 'BANK',
      balance: item.balance,
    }));
    if (this.financeAccounts.length === 0) {
      this.financeAccounts = this.defaultFinanceAccounts();
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
        },
        create: {
          id: 1,
          currentShiftId: this.currentShiftId,
          lastSaleAt: this.lastSaleAt ? new Date(this.lastSaleAt) : null,
          acquiringPercent: this.acquiringPercent,
          acquiringPercentDetkov: this.acquiringPercentDetkov,
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
            staffPosition: member.staffPosition === 'RETOUCHER' ? StaffPosition.RETOUCHER : StaffPosition.SALES,
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

      await tx.productCatalog.deleteMany();
      if (this.productCatalog.length > 0) {
        await tx.productCatalog.createMany({ data: this.productCatalog });
      }
      await tx.productStock.deleteMany();
      const stockRows = Object.entries(this.productStock).map(([name, qty]) => ({ name, qty }));
      if (stockRows.length > 0) {
        await tx.productStock.createMany({ data: stockRows });
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
}
