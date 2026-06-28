/** Мутации в outbox (ADMIN + DIRECTOR + ACCOUNTANT). */
export type OutboxMutationType =
  | 'ADMIN_SALE'
  | 'ADMIN_SALE_DELETE_REQUEST'
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
  | 'MANAGER_REVENUE_PLANS'
  | 'FINANCE_INCOME_UPDATE'
  | 'FINANCE_EXPENSE_UPDATE'
  | 'FINANCE_INCOME_DELETE'
  | 'FINANCE_EXPENSE_DELETE'
  | 'FINANCE_EXPENSE_CATEGORY'
  | 'MANAGER_STORE_COMMISSIONS'
  | 'ACQUIRING_PROFILES'
  | 'PROCUREMENT_COSTS';

export type AdminSaleDeleteRequestOutboxPayload = {
  requestId: string;
  saleId: string;
  reason: string;
  storeName?: string;
  sellerName?: string;
  totalAmount?: number;
  items?: Array<{ name: string; qty: number }>;
  createdAt: string;
};

export type AdminSaleOutboxPayload = {
  saleId: string;
  sellerId: number;
  /** Магазин на момент продажи — не зависит от последующего переноса продавца. */
  storeName?: string;
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
  storeName?: string;
  staffPosition?: 'SALES' | 'RETOUCHER' | 'MANAGER';
  retoucherRatePercent?: number;
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

export type FinanceIncomeUpdateOutboxPayload = {
  updateId: string;
  incomeId: string;
  accountId: string;
  amount: number;
  workDay: string;
  comment?: string;
  createdAt: string;
};

export type FinanceExpenseUpdateOutboxPayload = {
  updateId: string;
  expenseId: string;
  accountId: string;
  title: string;
  amount: number;
  workDay?: string;
  comment?: string;
  createdAt: string;
};

export type FinanceIncomeDeleteOutboxPayload = {
  deleteId: string;
  incomeId: string;
  createdAt: string;
};

export type FinanceExpenseDeleteOutboxPayload = {
  deleteId: string;
  expenseId: string;
  createdAt: string;
};

export type FinanceExpenseCategoryOutboxPayload = {
  patchId: string;
  title: string;
  amount: number;
  createdAt: string;
};

export type ManagerStoreCommissionsOutboxPayload = {
  patchId: string;
  items: Array<{ storeName: string; percent: number }>;
  createdAt: string;
};

export type AcquiringProfilesOutboxPayload = {
  patchId: string;
  profiles: Array<{ id: string; percent: number }>;
  createdAt: string;
};

export type ProcurementCostsOutboxPayload = {
  patchId: string;
  items: Array<{ name: string; cost: number }>;
  createdAt: string;
};

/** Payload по типу мутации (для сужения типов в flush handlers). */
export type OutboxPayloadByType = {
  ADMIN_SALE: AdminSaleOutboxPayload;
  ADMIN_SALE_DELETE_REQUEST: AdminSaleDeleteRequestOutboxPayload;
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
  FINANCE_INCOME_UPDATE: FinanceIncomeUpdateOutboxPayload;
  FINANCE_EXPENSE_UPDATE: FinanceExpenseUpdateOutboxPayload;
  FINANCE_INCOME_DELETE: FinanceIncomeDeleteOutboxPayload;
  FINANCE_EXPENSE_DELETE: FinanceExpenseDeleteOutboxPayload;
  FINANCE_EXPENSE_CATEGORY: FinanceExpenseCategoryOutboxPayload;
  MANAGER_STORE_COMMISSIONS: ManagerStoreCommissionsOutboxPayload;
  ACQUIRING_PROFILES: AcquiringProfilesOutboxPayload;
  PROCUREMENT_COSTS: ProcurementCostsOutboxPayload;
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
  | 'globalEmployees'
  | 'procurementCosts'
  | 'acquiringProfiles'
  | 'managerStoreCommissions'
  | 'saleDeleteJournal';

export type FinanceCacheKey =
  | 'dashboard'
  | 'financeOps'
  | 'inventoryOverview'
  | 'commissionRequests'
  | 'controlRequests'
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
