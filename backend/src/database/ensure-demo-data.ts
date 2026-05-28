import type { PrismaClient } from '@prisma/client';
import { StaffPosition, UserRole, WriteOffReason } from '@prisma/client';
import {
  buildDefaultDemoUserRows,
  buildDefaultManagerStoreAssignments,
  buildDefaultSellerProfileRows,
  buildDefaultStaffRows,
} from '../auth/build-demo-entities';
import { getDefaultDemoPassword } from '../auth/demo-password';
import {
  DEMO_STORE_NAMES,
  MANAGER_ASSIGNED_STORE_NAMES,
  MANAGER_USER_NICKNAME,
  WAREHOUSE_KEYS,
} from '../auth/demo-stores';
import { migrateLegacyDemoNicknames } from './migrate-demo-nicknames';

function toPrismaUserRole(role: ReturnType<typeof buildDefaultDemoUserRows>[0]['role']): UserRole {
  switch (role) {
    case 'DIRECTOR':
      return UserRole.DIRECTOR;
    case 'MANAGER':
      return UserRole.MANAGER;
    case 'ADMIN':
      return UserRole.ADMIN;
    case 'SELLER':
      return UserRole.SELLER;
    case 'ACCOUNTANT':
      return UserRole.ACCOUNTANT;
    case 'RETOUCHER':
      return UserRole.RETOUCHER;
    default: {
      const _x: never = role;
      return _x;
    }
  }
}

async function nextUserId(prisma: PrismaClient): Promise<number> {
  const m = await prisma.user.aggregate({ _max: { id: true } });
  return (m._max.id ?? 0) + 1;
}

async function ensureDemoUsers(prisma: PrismaClient) {
  const rows = buildDefaultDemoUserRows();
  for (const row of rows) {
    const existing = await prisma.user.findUnique({ where: { nickname: row.nickname } });
    if (existing) {
      const forcePwd = process.env.FORCE_RESET_DEMO_PASSWORDS === '1';
      await prisma.user.update({
        where: { nickname: row.nickname },
        data: {
          fullName: row.fullName,
          role: toPrismaUserRole(row.role),
          storeName: row.storeName,
          isActive: row.isActive,
          ...(forcePwd ? { password: row.password } : {}),
        },
      });
    } else {
      const id = await nextUserId(prisma);
      await prisma.user.create({
        data: {
          id,
          nickname: row.nickname,
          password: row.password,
          fullName: row.fullName,
          role: toPrismaUserRole(row.role),
          storeName: row.storeName,
          isActive: row.isActive,
        },
      });
    }
  }
}

async function ensureSellerProfiles(prisma: PrismaClient) {
  const templateByNick = new Map(buildDefaultSellerProfileRows().map((p) => [p.nickname, p]));
  const sellers = await prisma.user.findMany({ where: { role: UserRole.SELLER } });
  for (const u of sellers) {
    const template = templateByNick.get(u.nickname);
    const ratePercent = template?.ratePercent ?? 5;
    await prisma.sellerProfile.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        storeName: u.storeName,
        ratePercent,
      },
      update: {
        // Синхронизируем магазин с пользователем, но не трогаем ratePercent:
        // иначе каждый seed / db:sync сбрасывал бы процент, выставленный директором.
        storeName: u.storeName,
      },
    });
  }
}

async function ensureStaffMembers(prisma: PrismaClient) {
  for (const row of buildDefaultStaffRows()) {
    const u = await prisma.user.findUnique({ where: { nickname: row.nickname } });
    if (!u) {
      continue;
    }
    const position =
      row.staffPosition === 'RETOUCHER'
        ? StaffPosition.RETOUCHER
        : row.staffPosition === 'MANAGER'
          ? StaffPosition.MANAGER
          : StaffPosition.SALES;
    await prisma.staffMember.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        fullName: row.fullName,
        nickname: row.nickname,
        isActive: row.isActive,
        staffPosition: position,
      },
      update: {
        fullName: row.fullName,
        nickname: row.nickname,
        isActive: row.isActive,
        staffPosition: position,
      },
    });
  }
}

async function ensureProductCatalog(prisma: PrismaClient) {
  await prisma.productCatalog.createMany({
    data: [
      { name: 'Магнит', price: 200 },
      { name: 'Рамка А4', price: 500 },
      { name: 'Декоративная рамка', price: 800 },
      { name: 'Бамбуковая рамка', price: 900 },
      { name: 'электронный вариант и фото', price: 1500 },
      { name: 'Рамка А6', price: 300 },
    ],
    skipDuplicates: true,
  });
}

async function ensureProductStockLocations(prisma: PrismaClient) {
  const catalog = await prisma.productCatalog.findMany({ select: { name: true } });
  if (catalog.length === 0) {
    return;
  }
  for (const warehouseKey of WAREHOUSE_KEYS) {
    await prisma.productStockLocation.createMany({
      data: catalog.map((c) => ({
        locationKey: warehouseKey,
        productName: c.name,
        qty: 0,
      })),
      skipDuplicates: true,
    });
  }
  for (const storeName of DEMO_STORE_NAMES) {
    await prisma.productStockLocation.createMany({
      data: catalog.map((c) => ({
        locationKey: storeName,
        productName: c.name,
        qty: 0,
      })),
      skipDuplicates: true,
    });
  }
}

async function ensureProductProcurementCosts(prisma: PrismaClient) {
  const catalog = await prisma.productCatalog.findMany();
  await prisma.productProcurementCost.createMany({
    data: catalog.map((item) => ({
      name: item.name,
      cost: 0,
    })),
    skipDuplicates: true,
  });
}

async function ensureDemoWriteOffsIfEmpty(prisma: PrismaClient) {
  const n = await prisma.writeOff.count();
  if (n > 0) {
    return;
  }
  const now = Date.now();
  await prisma.writeOff.createMany({
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
}

async function ensureManagerStoreCommissions(prisma: PrismaClient) {
  const defaultPercent: Record<string, number> = {
    'Сады морей Тех. зона': 0,
    'Метрополь': 0,
  };
  for (const storeName of DEMO_STORE_NAMES) {
    await prisma.managerStoreCommission.upsert({
      where: { storeName },
      create: { storeName, percent: defaultPercent[storeName] ?? 5 },
      update: {},
    });
  }
}

async function ensureAppState(prisma: PrismaClient) {
  await prisma.appState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      currentShiftId: null,
      lastSaleAt: null,
    },
    update: {},
  });
}

/**
 * Добавляет учётки ретушёров по одной на точку, если их ещё нет (обновление БД с прежним сидом).
 */
export async function ensureRetoucherUsersIfMissing(prisma: PrismaClient) {
  const pwd = getDefaultDemoPassword();
  for (let i = 0; i < DEMO_STORE_NAMES.length; i += 1) {
    const storeName = DEMO_STORE_NAMES[i];
    const nickname = `r${i + 1}`;
    const existing = await prisma.user.findUnique({ where: { nickname } });
    if (existing) {
      continue;
    }
    let id = 19 + i;
    const idTaken = await prisma.user.findUnique({ where: { id } });
    if (idTaken) {
      const m = await prisma.user.aggregate({ _max: { id: true } });
      id = (m._max.id ?? 0) + 1;
    }
    const fullName = `Ретушёр — ${storeName}`;
    await prisma.user.create({
      data: {
        id,
        nickname,
        password: pwd,
        fullName,
        role: UserRole.RETOUCHER,
        storeName,
        isActive: true,
      },
    });
    await prisma.staffMember.upsert({
      where: { id },
      create: {
        id,
        fullName,
        nickname,
        isActive: true,
        staffPosition: StaffPosition.RETOUCHER,
      },
      update: {
        fullName,
        staffPosition: StaffPosition.RETOUCHER,
      },
    });
  }
}

/**
 * Добавляет учётку управляющего, если БД была создана до появления этой роли.
 */
export async function ensureManagerUserIfMissing(prisma: PrismaClient) {
  const pwd = getDefaultDemoPassword();
  const nickname = 'manager';
  const existing = await prisma.user.findUnique({ where: { nickname } });
  if (existing) {
    await prisma.user.update({
      where: { nickname },
      data: {
        fullName: 'Управляющий',
        password: pwd,
        role: UserRole.MANAGER,
        storeName: 'Все точки',
        isActive: true,
      },
    });
    await ensureManagerStaffAndAssignments(prisma);
    return;
  }
  let id = 27;
  const idTaken = await prisma.user.findUnique({ where: { id } });
  if (idTaken) {
    const m = await prisma.user.aggregate({ _max: { id: true } });
    id = (m._max.id ?? 0) + 1;
  }
  await prisma.user.create({
    data: {
      id,
      nickname,
      password: pwd,
      fullName: 'Управляющий',
      role: UserRole.MANAGER,
      storeName: 'Все точки',
      isActive: true,
    },
  });
  await ensureManagerStaffAndAssignments(prisma);
}

/**
 * Управляющий в staff и привязки к точкам «Центра» (для блока сотрудников).
 */
export async function ensureManagerStaffAndAssignments(prisma: PrismaClient) {
  const managerUser =
    (await prisma.user.findUnique({ where: { nickname: MANAGER_USER_NICKNAME } })) ??
    (await prisma.user.findFirst({ where: { role: UserRole.MANAGER } }));
  if (!managerUser) {
    return;
  }
  await prisma.staffMember.upsert({
    where: { id: managerUser.id },
    create: {
      id: managerUser.id,
      fullName: managerUser.fullName,
      nickname: managerUser.nickname,
      isActive: managerUser.isActive,
      staffPosition: StaffPosition.MANAGER,
    },
    update: {
      fullName: managerUser.fullName,
      nickname: managerUser.nickname,
      isActive: managerUser.isActive,
      staffPosition: StaffPosition.MANAGER,
    },
  });
  for (const row of buildDefaultManagerStoreAssignments(managerUser.id)) {
    await prisma.storeStaffAssignment.upsert({
      where: {
        storeName_staffId: { storeName: row.storeName, staffId: row.staffId },
      },
      create: { storeName: row.storeName, staffId: row.staffId },
      update: {},
    });
  }
  const allowed = new Set<string>(MANAGER_ASSIGNED_STORE_NAMES);
  await prisma.storeStaffAssignment.deleteMany({
    where: {
      staffId: managerUser.id,
      storeName: { notIn: [...MANAGER_ASSIGNED_STORE_NAMES] },
    },
  });
}

/**
 * Идемпотентно приводит демо-пользователей и справочники к актуальному виду.
 * Не удаляет продажи, смены и прочие операционные данные.
 */
export async function ensureDemoData(prisma: PrismaClient) {
  await migrateLegacyDemoNicknames(prisma);
  await ensureDemoUsers(prisma);
  await ensureManagerUserIfMissing(prisma);
  await ensureSellerProfiles(prisma);
  await ensureStaffMembers(prisma);
  await ensureManagerStaffAndAssignments(prisma);
  await ensureProductCatalog(prisma);
  await ensureProductStockLocations(prisma);
  await ensureProductProcurementCosts(prisma);
  await ensureManagerStoreCommissions(prisma);
  await ensureDemoWriteOffsIfEmpty(prisma);
  await ensureAppState(prisma);
}
