import { Injectable } from '@nestjs/common';

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

interface SaleRecord {
  id: string;
  createdAt: string;
  items: SaleLine[];
  totalAmount: number;
  units: number;
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
export class AuthService {
  public readonly productCatalog: Array<{ name: string; price: number }> = [
    { name: 'Магнит', price: 200 },
    { name: 'Рамка А4', price: 500 },
    { name: 'Декоративная рамка', price: 800 },
    { name: 'Бамбуковая рамка', price: 900 },
    { name: 'электронный вариант и фото', price: 1500 },
    { name: 'Рамка А6', price: 300 },
  ];

  private commissionChangeRequests: CommissionChangeRequest[] = [];
  private currentShiftId: string | null = null;
  private lastSaleAt: string | null = null;
  private shiftHistory: Shift[] = [];
  private cashDisciplineEvents: CashDisciplineEvent[] = [];
  private staff: StaffMember[] = [
    { id: 3, fullName: 'Cashier Seller', nickname: 'seller1', isActive: true },
    { id: 4, fullName: 'Anna Romanova', nickname: 'seller2', isActive: true },
  ];
  private productStock: Record<string, number> = {
    Магнит: 35,
    'Рамка А4': 18,
    'Декоративная рамка': 12,
    'Бамбуковая рамка': 9,
    'электронный вариант и фото': 30,
    'Рамка А6': 22,
  };
  private auditLog: AuditLogItem[] = [];
  private readonly adminWriteOffs: WriteOffItem[] = [
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

  private readonly demoUsers: DemoUser[] = [
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

  private readonly sellerProfiles: SellerProfile[] = [
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
      return request;
    }
    const applied = this.setSellerPercentDirect(request.sellerId, request.requestedPercent);
    if (!applied) {
      return null;
    }
    request.status = 'APPROVED';
    return { request, seller: applied };
  }

  addAdminSale(
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
    actor = 'system',
  ) {
    if (!this.currentShiftId) {
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
    this.pushAudit(actor, 'SALE_CREATED', `sale=${sale.id}, seller=${seller.fullName}, total=${totalAmount}`);
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
    return true;
  }

  openShift(openedBy: string, assignedSellerIds: number[]) {
    const existingOpen = this.shiftHistory.find((item) => item.status === 'OPEN');
    if (existingOpen) {
      return null;
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
      return existingMember;
    }
    const member: StaffMember = {
      id: Date.now(),
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
}
