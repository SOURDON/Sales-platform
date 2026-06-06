import { loadAdminCache, saveAdminCache } from '../cache';
import type {
  AdminSaleOutboxPayload,
  AdminShiftCloseOutboxPayload,
  AdminShiftOpenOutboxPayload,
  AdminStaffAddOutboxPayload,
  AdminStaffFromBaseOutboxPayload,
  AdminStaffRemoveOutboxPayload,
  AdminStaffRestoreOutboxPayload,
  AdminWriteOffOutboxPayload,
  OutboxMutationType,
  OutboxPayload,
} from '../types';

type SellerLike = {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
  salesAmount: number;
  checksCount: number;
  commissionAmount: number;
};

type StaffLike = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
  staffPosition?: string;
  retoucherRatePercent?: number;
  earningsAmount?: number;
};

type ShiftLike = {
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

type StoreInventoryLike = {
  storeName: string;
  warehouseKey: string;
  warehouseLabel?: string;
  products: Array<{
    name: string;
    price: number;
    qtyInStore: number;
    qtyOnWarehouse: number;
  }>;
};

export async function applyOptimisticOutbox(
  userId: number,
  type: OutboxMutationType,
  payload: OutboxPayload,
): Promise<void> {
  switch (type) {
    case 'ADMIN_WRITE_OFF':
      await applyWriteOff(userId, payload as AdminWriteOffOutboxPayload);
      break;
    case 'ADMIN_SHIFT_OPEN':
      await applyShiftOpen(userId, payload as AdminShiftOpenOutboxPayload);
      break;
    case 'ADMIN_SHIFT_CLOSE':
      await applyShiftClose(userId, payload as AdminShiftCloseOutboxPayload);
      break;
    case 'ADMIN_STAFF_ADD':
      await applyStaffAdd(userId, payload as AdminStaffAddOutboxPayload);
      break;
    case 'ADMIN_STAFF_FROM_BASE':
      await applyStaffFromBase(userId, payload as AdminStaffFromBaseOutboxPayload);
      break;
    case 'ADMIN_STAFF_REMOVE':
      await applyStaffRemove(userId, payload as AdminStaffRemoveOutboxPayload);
      break;
    case 'ADMIN_STAFF_RESTORE':
      await applyStaffRestore(userId, payload as AdminStaffRestoreOutboxPayload);
      break;
    case 'ADMIN_SALE':
      await applySaleStock(userId, payload as AdminSaleOutboxPayload);
      break;
    default:
      break;
  }
}

async function applyWriteOff(userId: number, payload: AdminWriteOffOutboxPayload): Promise<void> {
  const inv = await loadAdminCache<StoreInventoryLike | null>(userId, 'storeInventory');
  if (!inv?.products) {
    return;
  }
  const products = inv.products.map((p) =>
    p.name === payload.name
      ? { ...p, qtyInStore: Math.max(0, p.qtyInStore - payload.qty) }
      : p,
  );
  await saveAdminCache(userId, 'storeInventory', { ...inv, products });
}

async function applySaleStock(userId: number, payload: AdminSaleOutboxPayload): Promise<void> {
  const inv = await loadAdminCache<StoreInventoryLike | null>(userId, 'storeInventory');
  if (!inv?.products) {
    return;
  }
  const products = inv.products.map((p) => {
    const line = payload.items.find((i) => i.name === p.name);
    if (!line) {
      return p;
    }
    return { ...p, qtyInStore: Math.max(0, p.qtyInStore - line.qty) };
  });
  await saveAdminCache(userId, 'storeInventory', { ...inv, products });
}

export async function revertSaleStock(userId: number, payload: AdminSaleOutboxPayload): Promise<void> {
  const inv = await loadAdminCache<StoreInventoryLike | null>(userId, 'storeInventory');
  if (!inv?.products) {
    return;
  }
  const products = inv.products.map((p) => {
    const line = payload.items.find((i) => i.name === p.name);
    if (!line) {
      return p;
    }
    return { ...p, qtyInStore: p.qtyInStore + line.qty };
  });
  await saveAdminCache(userId, 'storeInventory', { ...inv, products });
}

async function applyShiftOpen(userId: number, payload: AdminShiftOpenOutboxPayload): Promise<void> {
  const shifts = (await loadAdminCache<ShiftLike[]>(userId, 'shifts')) ?? [];
  const existingOpen = shifts.find((s) => s.status === 'OPEN');
  const mergedIds = existingOpen
    ? [...new Set([...existingOpen.assignedSellerIds, ...payload.assignedSellerIds])]
    : [...payload.assignedSellerIds];
  const shiftId = existingOpen?.id ?? payload.clientShiftId;
  const nextShifts = existingOpen
    ? shifts.map((s) =>
        s.id === existingOpen.id ? { ...s, assignedSellerIds: mergedIds } : s,
      )
    : [
        ...shifts.filter((s) => s.status !== 'OPEN'),
        {
          id: payload.clientShiftId,
          openedAt: payload.createdAt,
          openedBy: 'offline',
          assignedSellerIds: mergedIds,
          checksCount: 0,
          itemsCount: 0,
          status: 'OPEN' as const,
        },
      ];
  await saveAdminCache(userId, 'shifts', nextShifts);
  const staff = (await loadAdminCache<StaffLike[]>(userId, 'staff')) ?? [];
  const updatedStaff = staff.map((m) =>
    mergedIds.includes(m.id) ? { ...m, assignedShiftId: shiftId } : m,
  );
  await saveAdminCache(userId, 'staff', updatedStaff);
}

async function applyShiftClose(userId: number, payload: AdminShiftCloseOutboxPayload): Promise<void> {
  const shifts = (await loadAdminCache<ShiftLike[]>(userId, 'shifts')) ?? [];
  const open = shifts.find((s) => s.status === 'OPEN');
  if (!open) {
    return;
  }
  const remaining = open.assignedSellerIds.filter((id) => !payload.assignedSellerIds.includes(id));
  let nextShifts: ShiftLike[];
  if (remaining.length === 0) {
    nextShifts = shifts.map((s) =>
      s.id === open.id
        ? {
            ...s,
            status: 'CLOSED' as const,
            closedAt: payload.createdAt,
            closedBy: 'offline',
            assignedSellerIds: [],
          }
        : s,
    );
  } else {
    nextShifts = shifts.map((s) =>
      s.id === open.id ? { ...s, assignedSellerIds: remaining } : s,
    );
  }
  await saveAdminCache(userId, 'shifts', nextShifts);
  const staff = (await loadAdminCache<StaffLike[]>(userId, 'staff')) ?? [];
  await saveAdminCache(
    userId,
    'staff',
    staff.map((m) =>
      payload.assignedSellerIds.includes(m.id) ? { ...m, assignedShiftId: undefined } : m,
    ),
  );
}

async function applyStaffAdd(userId: number, payload: AdminStaffAddOutboxPayload): Promise<void> {
  const staff = (await loadAdminCache<StaffLike[]>(userId, 'staff')) ?? [];
  const sellers = (await loadAdminCache<SellerLike[]>(userId, 'sellers')) ?? [];
  const tempId = hashTempId(payload.clientMemberId);
  const storeName = sellers[0]?.storeName ?? '';
  if (staff.some((m) => m.nickname === payload.nickname)) {
    return;
  }
  const member: StaffLike = {
    id: tempId,
    fullName: payload.fullName,
    nickname: payload.nickname,
    isActive: true,
    staffPosition: 'SALES',
    retoucherRatePercent: 5,
    earningsAmount: 0,
  };
  await saveAdminCache(userId, 'staff', [...staff, member]);
  await saveAdminCache(userId, 'sellers', [
    ...sellers,
    {
      id: tempId,
      fullName: payload.fullName,
      nickname: payload.nickname,
      storeName,
      ratePercent: 30,
      salesAmount: 0,
      checksCount: 0,
      commissionAmount: 0,
    },
  ]);
}

async function applyStaffFromBase(
  userId: number,
  payload: AdminStaffFromBaseOutboxPayload,
): Promise<void> {
  const globalEmployees =
    (await loadAdminCache<Array<{ id: number; fullName: string; nickname: string }>>(
      userId,
      'globalEmployees',
    )) ?? [];
  const emp = globalEmployees.find((e) => e.id === payload.employeeId);
  if (!emp) {
    return;
  }
  const staff = (await loadAdminCache<StaffLike[]>(userId, 'staff')) ?? [];
  if (staff.some((m) => m.id === payload.employeeId)) {
    await saveAdminCache(
      userId,
      'staff',
      staff.map((m) => (m.id === payload.employeeId ? { ...m, isActive: true } : m)),
    );
    return;
  }
  await saveAdminCache(userId, 'staff', [
    ...staff,
    {
      id: emp.id,
      fullName: emp.fullName,
      nickname: emp.nickname,
      isActive: true,
      staffPosition: 'SALES',
      retoucherRatePercent: 5,
      earningsAmount: 0,
    },
  ]);
}

async function applyStaffRemove(
  userId: number,
  payload: AdminStaffRemoveOutboxPayload,
): Promise<void> {
  const staff = (await loadAdminCache<StaffLike[]>(userId, 'staff')) ?? [];
  await saveAdminCache(
    userId,
    'staff',
    staff.filter((m) => m.id !== payload.staffId),
  );
}

async function applyStaffRestore(
  userId: number,
  payload: AdminStaffRestoreOutboxPayload,
): Promise<void> {
  const globalEmployees =
    (await loadAdminCache<Array<{ id: number; fullName: string; nickname: string }>>(
      userId,
      'globalEmployees',
    )) ?? [];
  const emp = globalEmployees.find((e) => e.id === payload.staffId);
  if (!emp) {
    return;
  }
  await applyStaffFromBase(userId, { employeeId: payload.staffId, createdAt: payload.createdAt });
}

function hashTempId(clientMemberId: string): number {
  let h = 0;
  for (let i = 0; i < clientMemberId.length; i += 1) {
    h = (h * 31 + clientMemberId.charCodeAt(i)) | 0;
  }
  return -Math.abs(h || 1);
}
