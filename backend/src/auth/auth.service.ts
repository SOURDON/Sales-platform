import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CashEventType as PrismaCashEventType,
  CommissionRequestStatus as PrismaCommissionRequestStatus,
  PaymentType as PrismaPaymentType,
  ShiftStatus,
  UserRole as PrismaUserRole,
  WriteOffReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type UserRole = 'DIRECTOR' | 'ADMIN' | 'SELLER';

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

type SalePaymentType = 'CASH' | 'NON_CASH';

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

interface StaffMember {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
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

@Injectable()
export class AuthService implements OnModuleInit {
  public productCatalog: Array<{ name: string; price: number }> = [];

  private readonly logger = new Logger(AuthService.name);
  private readonly persistenceEnabled = Boolean(process.env.DATABASE_URL);
  private persistChain: Promise<void> = Promise.resolve();

  private commissionChangeRequests: CommissionChangeRequest[] = [];
  private currentShiftId: string | null = null;
  private lastSaleAt: string | null = null;
  private shiftHistory: Shift[] = [];
  private cashDisciplineEvents: CashDisciplineEvent[] = [];
  private staff: StaffMember[] = [];
  private productStock: Record<string, number> = {};
  private auditLog: AuditLogItem[] = [];
  private adminWriteOffs: WriteOffItem[] = [];

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

    if (user.role === 'DIRECTOR') {
      return {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: 'Сводка директора',
        metrics: [
          { label: 'Выручка сегодня', value: '486 200 ₽' },
          { label: 'Чистая прибыль', value: '151 430 ₽' },
          { label: 'Закупки', value: '207 000 ₽' },
          { label: 'Выплаты продавцам', value: '24 310 ₽' },
        ],
        stores: [
          { name: 'Store #1', revenue: '188 400 ₽', netProfit: '58 200 ₽' },
          { name: 'Store #2', revenue: '164 600 ₽', netProfit: '49 700 ₽' },
          { name: 'Store #3', revenue: '133 200 ₽', netProfit: '43 530 ₽' },
        ],
      };
    }

    if (user.role === 'ADMIN') {
      const totalWriteOffUnits = this.adminWriteOffs.reduce(
        (sum, item) => sum + item.qty,
        0,
      );
      return {
        role: user.role,
        sellerDataManagedByAdmin: true,
        title: `Панель администратора (${user.storeName})`,
        metrics: [
          { label: 'Продажи смены', value: '78 420 ₽' },
          { label: 'Открытые смены', value: '3' },
          { label: 'Списания (товар)', value: `${totalWriteOffUnits} шт.` },
        ],
        writeOffs: this.adminWriteOffs,
        stores: [{ name: user.storeName, revenue: '188 400 ₽' }],
      };
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
          return [{ name: user.storeName, revenue: '0 ₽', netProfit: '0 ₽' }];
        }
        return [
          {
            name: user.storeName,
            revenue: this.formatCurrency(profile.salesAmount),
            netProfit: this.formatCurrency(Math.round(profile.salesAmount * 0.32)),
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
        }));
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  setSellerPercentDirect(sellerId: number, ratePercent: number) {
    if (ratePercent < 0 || ratePercent > 100) {
      return null;
    }
    const seller = this.sellerProfiles.find((item) => item.id === sellerId);
    if (!seller) {
      return null;
    }
    seller.ratePercent = ratePercent;
    this.recomputeSeller(seller);
    this.queuePersist();
    return this.getSellerProfiles().find((item) => item.id === sellerId) ?? null;
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

  decideCommissionRequest(id: string, decision: 'APPROVE' | 'REJECT') {
    const request = this.commissionChangeRequests.find((item) => item.id === id);
    if (!request || request.status !== 'PENDING') {
      return null;
    }
    if (decision === 'REJECT') {
      request.status = 'REJECTED';
      this.queuePersist();
      return request;
    }
    const applied = this.setSellerPercentDirect(request.sellerId, request.requestedPercent);
    if (!applied) {
      return null;
    }
    request.status = 'APPROVED';
    this.queuePersist();
    return { request, seller: applied };
  }

  addAdminSale(
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    actor = 'system',
    paymentType: SalePaymentType = 'CASH',
  ) {
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

    const validNames = new Set(this.productCatalog.map((item) => item.name));
    const lines: SaleLine[] = [];
    for (const line of items) {
      if (!line.name) {
        return null;
      }
      if (!validNames.has(line.name)) {
        return null;
      }
      if (!line.qty || line.qty <= 0) {
        continue;
      }
      lines.push({
        name: line.name,
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
    const existingOpen = this.shiftHistory.find((item) => item.status === 'OPEN');
    if (existingOpen) {
      const merged = [
        ...new Set([...existingOpen.assignedSellerIds, ...assignedSellerIds]),
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
      assignedSellerIds,
      checksCount: 0,
      itemsCount: 0,
      status: 'OPEN',
    };
    this.shiftHistory.push(shift);
    this.currentShiftId = shift.id;
    for (const member of this.staff) {
      member.assignedShiftId = assignedSellerIds.includes(member.id) ? shift.id : undefined;
    }
    this.pushAudit(openedBy, 'SHIFT_OPENED', `shift=${shift.id}`);
    this.queuePersist();
    return shift;
  }

  closeShift(closedBy: string) {
    if (!this.currentShiftId) {
      return null;
    }
    const shift = this.shiftHistory.find((item) => item.id === this.currentShiftId);
    if (!shift || shift.status !== 'OPEN') {
      return null;
    }
    shift.status = 'CLOSED';
    shift.closedAt = new Date().toISOString();
    shift.closedBy = closedBy;
    this.currentShiftId = null;
    for (const member of this.staff) {
      member.assignedShiftId = undefined;
    }
    this.pushAudit(closedBy, 'SHIFT_CLOSED', `shift=${shift.id}`);
    this.queuePersist();
    return shift;
  }

  getShifts() {
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
    return [...this.staff];
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
    return sellers.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru-RU'));
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
    };
    this.staff.push(member);
    this.demoUsers.push({
      id: member.id,
      nickname: member.nickname,
      password: '123456',
      fullName: member.fullName,
      role: 'SELLER',
      storeName: 'Store #1',
      isActive: true,
    });
    this.sellerProfiles.push({
      id: member.id,
      fullName: member.fullName,
      nickname: member.nickname,
      storeName: 'Store #1',
      ratePercent: 3,
      salesAmount: 0,
      checksCount: 0,
      sales: [],
      commissionAmount: 0,
    });
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
    const existing = this.staff.find((item) => item.id === employeeId);
    if (existing) {
      existing.isActive = true;
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
    this.pushAudit(
      actor,
      'STAFF_ATTACHED_FROM_BASE',
      `${member.fullName} (${member.nickname})`,
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

    const totals = seller.sales.reduce(
      (acc, sale) => {
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

  private getNextNumericId() {
    const userIds = this.demoUsers.map((user) => user.id);
    const staffIds = this.staff.map((member) => member.id);
    const maxId = Math.max(0, ...userIds, ...staffIds);
    return maxId + 1;
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
      return;
    }
    const now = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: 1,
            nickname: 'director',
            password: '123456',
            fullName: 'Director User',
            role: PrismaUserRole.DIRECTOR,
            storeName: 'All Stores',
            isActive: true,
          },
          {
            id: 2,
            nickname: 'admin1',
            password: '123456',
            fullName: 'Store Admin',
            role: PrismaUserRole.ADMIN,
            storeName: 'Store #1',
            isActive: true,
          },
          {
            id: 3,
            nickname: 'seller1',
            password: '123456',
            fullName: 'Cashier Seller',
            role: PrismaUserRole.SELLER,
            storeName: 'Store #1',
            isActive: true,
          },
          {
            id: 4,
            nickname: 'seller2',
            password: '123456',
            fullName: 'Anna Romanova',
            role: PrismaUserRole.SELLER,
            storeName: 'Store #1',
            isActive: true,
          },
        ],
      });
      await tx.sellerProfile.createMany({
        data: [
          { id: 3, storeName: 'Store #1', ratePercent: 5 },
          { id: 4, storeName: 'Store #1', ratePercent: 4 },
        ],
      });
      await tx.staffMember.createMany({
        data: [
          { id: 3, fullName: 'Cashier Seller', nickname: 'seller1', isActive: true },
          { id: 4, fullName: 'Anna Romanova', nickname: 'seller2', isActive: true },
        ],
      });
      await tx.productCatalog.createMany({
        data: [
          { name: 'Магнит', price: 200 },
          { name: 'Рамка А4', price: 500 },
          { name: 'Декоративная рамка', price: 800 },
          { name: 'Бамбуковая рамка', price: 900 },
          { name: 'электронный вариант и фото', price: 1500 },
          { name: 'Рамка А6', price: 300 },
        ],
      });
      await tx.productStock.createMany({
        data: [
          { name: 'Магнит', qty: 35 },
          { name: 'Рамка А4', qty: 18 },
          { name: 'Декоративная рамка', qty: 12 },
          { name: 'Бамбуковая рамка', qty: 9 },
          { name: 'электронный вариант и фото', qty: 30 },
          { name: 'Рамка А6', qty: 22 },
        ],
      });
      await tx.writeOff.createMany({
        data: [
          {
            id: 'wo-1',
            createdAt: new Date(now - 1000 * 60 * 60 * 8),
            name: 'Рамка А4',
            qty: 2,
            reason: WriteOffReason.BRAK,
          },
          {
            id: 'wo-2',
            createdAt: new Date(now - 1000 * 60 * 60 * 4),
            name: 'Магнит',
            qty: 5,
            reason: WriteOffReason.POLOMKA,
          },
          {
            id: 'wo-3',
            createdAt: new Date(now - 1000 * 60 * 60 * 2),
            name: 'Рамка А6',
            qty: 1,
            reason: WriteOffReason.BRAK,
          },
        ],
      });
      await tx.appState.create({
        data: {
          id: 1,
          currentShiftId: null,
          lastSaleAt: null,
        },
      });
    });
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
    this.demoUsers = [
      {
        id: 1,
        nickname: 'director',
        password: '123456',
        fullName: 'Director User',
        role: 'DIRECTOR',
        storeName: 'All Stores',
        isActive: true,
      },
      {
        id: 2,
        nickname: 'admin1',
        password: '123456',
        fullName: 'Store Admin',
        role: 'ADMIN',
        storeName: 'Store #1',
        isActive: true,
      },
      {
        id: 3,
        nickname: 'seller1',
        password: '123456',
        fullName: 'Cashier Seller',
        role: 'SELLER',
        storeName: 'Store #1',
        isActive: true,
      },
      {
        id: 4,
        nickname: 'seller2',
        password: '123456',
        fullName: 'Anna Romanova',
        role: 'SELLER',
        storeName: 'Store #1',
        isActive: true,
      },
    ];
    this.sellerProfiles = [
      {
        id: 3,
        fullName: 'Cashier Seller',
        nickname: 'seller1',
        storeName: 'Store #1',
        ratePercent: 5,
        salesAmount: 0,
        checksCount: 0,
        sales: [],
        commissionAmount: 0,
      },
      {
        id: 4,
        fullName: 'Anna Romanova',
        nickname: 'seller2',
        storeName: 'Store #1',
        ratePercent: 4,
        salesAmount: 0,
        checksCount: 0,
        sales: [],
        commissionAmount: 0,
      },
    ];
    this.staff = [
      { id: 3, fullName: 'Cashier Seller', nickname: 'seller1', isActive: true },
      { id: 4, fullName: 'Anna Romanova', nickname: 'seller2', isActive: true },
    ];
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
    this.currentShiftId = null;
    this.lastSaleAt = null;
  }

  private async loadState() {
    const [
      users,
      sellerProfiles,
      sales,
      saleItems,
      writeOffs,
      shifts,
      shiftAssignments,
      cashEvents,
      staff,
      products,
      stock,
      requests,
      audit,
      appState,
    ] = await this.prisma.$transaction([
      this.prisma.user.findMany(),
      this.prisma.sellerProfile.findMany(),
      this.prisma.sale.findMany(),
      this.prisma.saleItem.findMany(),
      this.prisma.writeOff.findMany(),
      this.prisma.shift.findMany(),
      this.prisma.shiftAssignment.findMany(),
      this.prisma.cashDisciplineEvent.findMany(),
      this.prisma.staffMember.findMany(),
      this.prisma.productCatalog.findMany(),
      this.prisma.productStock.findMany(),
      this.prisma.commissionChangeRequest.findMany(),
      this.prisma.auditLogItem.findMany(),
      this.prisma.appState.findUnique({ where: { id: 1 } }),
    ]);

    const saleItemsBySaleId = new Map<string, SaleLine[]>();
    for (const item of saleItems) {
      const current = saleItemsBySaleId.get(item.saleId) ?? [];
      current.push({ name: item.name, qty: item.qty });
      saleItemsBySaleId.set(item.saleId, current);
    }

    const salesBySellerId = new Map<number, SaleRecord[]>();
    for (const sale of sales) {
      const current = salesBySellerId.get(sale.sellerId) ?? [];
      current.push({
        id: sale.id,
        createdAt: sale.createdAt.toISOString(),
        items: saleItemsBySaleId.get(sale.id) ?? [],
        totalAmount: sale.totalAmount,
        units: sale.units,
        paymentType: sale.paymentType === PrismaPaymentType.NON_CASH ? 'NON_CASH' : 'CASH',
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
    }));
    this.productCatalog = products.map((item) => ({ name: item.name, price: item.price }));
    this.productStock = Object.fromEntries(stock.map((item) => [item.name, item.qty]));
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
    this.currentShiftId = appState?.currentShiftId ?? null;
    this.lastSaleAt = appState?.lastSaleAt?.toISOString() ?? null;
  }

  private async persistState() {
    await this.prisma.$transaction(async (tx) => {
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
        },
      });

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
      if (this.staff.length > 0) {
        await tx.staffMember.createMany({
          data: this.staff.map((member) => ({
            id: member.id,
            fullName: member.fullName,
            nickname: member.nickname,
            isActive: member.isActive,
            assignedShiftId: member.assignedShiftId ?? null,
          })),
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
          paymentType:
            sale.paymentType === 'NON_CASH' ? PrismaPaymentType.NON_CASH : PrismaPaymentType.CASH,
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
            name: item.name,
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
