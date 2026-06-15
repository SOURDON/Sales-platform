import { loadAdminCache, saveAdminCache } from './sync/cache';
import { readOfflineStoreSettings } from './offlineStoreSettings';

const SEED_KEY = 'sales-platform-offline-store-seeded-v1';

type StaffSeedRow = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  storeName: string;
  assignedStores: string[];
  staffPosition: 'SALES' | 'RETOUCHER' | 'MANAGER';
  retoucherRatePercent?: number;
  earningsAmount: number;
};

function readSeedFlag(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(SEED_KEY) === '1';
}

function writeSeedFlag(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SEED_KEY, '1');
  }
}

export async function ensureOfflineStoreDefaults(userId: number): Promise<void> {
  const staff = (await loadAdminCache<StaffSeedRow[]>(userId, 'staff')) ?? [];
  const hasRetoucher = staff.some(
    (member: StaffSeedRow) => member.staffPosition === 'RETOUCHER' && member.isActive,
  );
  if (hasRetoucher) {
    if (!readSeedFlag()) {
      writeSeedFlag();
    }
    return;
  }

  const storeName = readOfflineStoreSettings().storeName;
  const retoucher: StaffSeedRow = {
    id: 900_101,
    fullName: 'Ретушёр',
    nickname: 'Ретушёр',
    isActive: true,
    storeName,
    assignedStores: [storeName],
    staffPosition: 'RETOUCHER',
    retoucherRatePercent: 5,
    earningsAmount: 0,
  };

  const nextStaff = staff.some((member: StaffSeedRow) => member.id === retoucher.id)
    ? staff.map((member: StaffSeedRow) => (member.id === retoucher.id ? retoucher : member))
    : [...staff, retoucher];

  await saveAdminCache(userId, 'staff', nextStaff);
  writeSeedFlag();
}

export async function renameOfflineStoreAssignments(
  userId: number,
  oldName: string,
  newName: string,
): Promise<void> {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) {
    return;
  }
  const staff = (await loadAdminCache<StaffSeedRow[]>(userId, 'staff')) ?? [];
  if (staff.length > 0) {
    await saveAdminCache(
      userId,
      'staff',
      staff.map((member) => {
        const assigned = member.assignedStores ?? [];
        const nextAssigned = assigned.map((name) => (name === from ? to : name));
        const storeName = member.storeName === from ? to : member.storeName;
        return {
          ...member,
          storeName,
          assignedStores: nextAssigned.length > 0 ? nextAssigned : [to],
        };
      }),
    );
  }
  const sellers =
    (await loadAdminCache<
      Array<{
        id: number;
        fullName: string;
        nickname: string;
        storeName: string;
        ratePercent: number;
        salesAmount: number;
        checksCount: number;
        commissionAmount: number;
      }>
    >(userId, 'sellers')) ?? [];
  if (sellers.length > 0) {
    await saveAdminCache(
      userId,
      'sellers',
      sellers.map((seller) => ({
        ...seller,
        storeName: seller.storeName === from ? to : seller.storeName,
      })),
    );
  }
  const commissions =
    (await loadAdminCache<Array<{ storeName: string; percent: number }>>(
      userId,
      'managerStoreCommissions',
    )) ?? [];
  if (commissions.length > 0) {
    await saveAdminCache(
      userId,
      'managerStoreCommissions',
      commissions.map((row) => ({
        ...row,
        storeName: row.storeName === from ? to : row.storeName,
      })),
    );
  }
}

export async function saveOfflineManagerCommission(
  userId: number,
  storeName: string,
  percent: number,
): Promise<void> {
  const rows =
    (await loadAdminCache<Array<{ storeName: string; percent: number }>>(
      userId,
      'managerStoreCommissions',
    )) ?? [];
  const trimmed = storeName.trim();
  const pct = Math.max(0, Math.min(100, percent));
  const next = rows.some((row: { storeName: string; percent: number }) => row.storeName === trimmed)
    ? rows.map((row: { storeName: string; percent: number }) =>
        row.storeName === trimmed ? { ...row, percent: pct } : row,
      )
    : [...rows, { storeName: trimmed, percent: pct }];
  await saveAdminCache(userId, 'managerStoreCommissions', next);
}
