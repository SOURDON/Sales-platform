/** Мутации в outbox (ADMIN + DIRECTOR + ACCOUNTANT). */
export type OutboxMutationType =
  | 'ADMIN_SALE'
  | 'ADMIN_WRITE_OFF'
  | 'ADMIN_SHIFT_OPEN'
  | 'ADMIN_SHIFT_CLOSE'
  | 'ADMIN_STAFF_ADD'
  | 'ADMIN_STAFF_FROM_BASE'
  | 'ADMIN_STAFF_REMOVE'
  | 'ADMIN_STAFF_RESTORE'
  | 'FINANCE_INCOME'
  | 'FINANCE_EXPENSE'
  | 'FINANCE_ACCOUNT_BALANCE'
  | 'DIRECTOR_COMMISSION_DECISION'
  | 'DIRECTOR_CONTROL_DECISION'
  | 'DIRECTOR_SET_PERCENT'
  | 'DIRECTOR_DEMO_PASSWORD'
  | 'MANAGER_REVENUE_PLANS';

export type AdminSaleOutboxPayload = {
  saleId: string;
  sellerId: number;
  items: Array<{ name: string; qty: number }>;
  totalAmount: number;
  paymentType: 'CASH' | 'NON_CASH' | 'TRANSFER';
  createdAt: string;
};

export type AdminWriteOffOutboxPayload = {
  requestId: string;
  name: string;
  qty: number;
  reason: 'Брак' | 'Поломка';
  createdAt: string;
};

export type AdminShiftOpenOutboxPayload = {
  clientShiftId: string;
  assignedSellerIds: number[];
  createdAt: string;
};

export type AdminShiftCloseOutboxPayload = {
  assignedSellerIds: number[];
  createdAt: string;
};

export type AdminStaffAddOutboxPayload = {
  clientMemberId: string;
  fullName: string;
  nickname: string;
  createdAt: string;
};

export type AdminStaffFromBaseOutboxPayload = {
  employeeId: number;
  createdAt: string;
};

export type AdminStaffRemoveOutboxPayload = {
  staffId: number;
  storeName?: string;
  createdAt: string;
};

export type AdminStaffRestoreOutboxPayload = {
  staffId: number;
  storeName: string;
  createdAt: string;
};

export type FinanceIncomeOutboxPayload = {
  incomeId: string;
  accountId: string;
  amount: number;
  workDay: string;
  comment?: string;
  createdAt: string;
};

export type FinanceExpenseOutboxPayload = {
  expenseId: string;
  accountId: string;
  title: string;
  amount: number;
  comment?: string;
  createdAt: string;
};

export type FinanceAccountBalanceOutboxPayload = {
  patchId: string;
  accountId: string;
  balance: number;
  createdAt: string;
};

export type DirectorCommissionDecisionPayload = {
  requestId: string;
  decision: 'APPROVE' | 'REJECT';
  createdAt: string;
};

export type DirectorControlDecisionPayload = {
  requestId: string;
  decision: 'APPROVE' | 'REJECT';
  createdAt: string;
};

export type DirectorSetPercentPayload = {
  clientId: string;
  sellerId: number;
  ratePercent: number;
  createdAt: string;
};

export type DirectorDemoPasswordPayload = {
  patchId: string;
  nickname: string;
  password: string;
  createdAt: string;
};

export type ManagerRevenuePlansPayload = {
  patchId: string;
  dayKey: string;
  items: Array<{ storeName: string; planRevenue: number }>;
  createdAt: string;
};

/** Payload по типу мутации (для сужения типов в flush handlers). */
export type OutboxPayloadByType = {
  ADMIN_SALE: AdminSaleOutboxPayload;
  ADMIN_WRITE_OFF: AdminWriteOffOutboxPayload;
  ADMIN_SHIFT_OPEN: AdminShiftOpenOutboxPayload;
  ADMIN_SHIFT_CLOSE: AdminShiftCloseOutboxPayload;
  ADMIN_STAFF_ADD: AdminStaffAddOutboxPayload;
  ADMIN_STAFF_FROM_BASE: AdminStaffFromBaseOutboxPayload;
  ADMIN_STAFF_REMOVE: AdminStaffRemoveOutboxPayload;
  ADMIN_STAFF_RESTORE: AdminStaffRestoreOutboxPayload;
  FINANCE_INCOME: FinanceIncomeOutboxPayload;
  FINANCE_EXPENSE: FinanceExpenseOutboxPayload;
  FINANCE_ACCOUNT_BALANCE: FinanceAccountBalanceOutboxPayload;
  DIRECTOR_COMMISSION_DECISION: DirectorCommissionDecisionPayload;
  DIRECTOR_CONTROL_DECISION: DirectorControlDecisionPayload;
  DIRECTOR_SET_PERCENT: DirectorSetPercentPayload;
  DIRECTOR_DEMO_PASSWORD: DirectorDemoPasswordPayload;
  MANAGER_REVENUE_PLANS: ManagerRevenuePlansPayload;
};

export type OutboxPayload = OutboxPayloadByType[OutboxMutationType];

export type OutboxEntry = {
  id: string;
  userId: number;
  type: OutboxMutationType;
  payload: OutboxPayload;
  createdAt: string;
};

export type OfflineQueuedSale = AdminSaleOutboxPayload;

export type AdminCacheKey =
  | 'products'
  | 'sellers'
  | 'staff'
  | 'shifts'
  | 'storeInventory'
  | 'sales'
  | 'globalEmployees';

export type FinanceCacheKey =
  | 'dashboard'
  | 'financeOps'
  | 'inventoryOverview'
  | 'commissionRequests'
  | 'revenuePlansByDay'
  | 'storeEquipment';

export type SyncCacheKey = AdminCacheKey | FinanceCacheKey;

export type SyncCacheRow = {
  key: string;
  userId: number;
  cacheKey: SyncCacheKey;
  data: unknown;
  updatedAt: string;
};

/** @deprecated use SyncCacheRow */
export type AdminCacheRow = SyncCacheRow;
