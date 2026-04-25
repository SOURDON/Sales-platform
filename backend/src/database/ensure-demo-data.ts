import type { PrismaClient } from '@prisma/client';
import { UserRole, WriteOffReason } from '@prisma/client';
import {
  buildDefaultDemoUserRows,
  buildDefaultSellerProfileRows,
  buildDefaultStaffRows,
} from '../auth/build-demo-entities';

function toPrismaUserRole(role: ReturnType<typeof buildDefaultDemoUserRows>[0]['role']): UserRole {
  switch (role) {
    case 'DIRECTOR':
      return UserRole.DIRECTOR;
    case 'ADMIN':
      return UserRole.ADMIN;
    case 'SELLER':
      return UserRole.SELLER;
    case 'ACCOUNTANT':
      return UserRole.ACCOUNTANT;
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
      await prisma.user.update({
        where: { nickname: row.nickname },
        data: {
          fullName: row.fullName,
          role: toPrismaUserRole(row.role),
          storeName: row.storeName,
          password: row.password,
          isActive: row.isActive,
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
        storeName: u.storeName,
        ratePercent,
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
    await prisma.staffMember.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        fullName: row.fullName,
        nickname: row.nickname,
        isActive: row.isActive,
      },
      update: {
        fullName: row.fullName,
        nickname: row.nickname,
        isActive: row.isActive,
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

async function ensureProductStock(prisma: PrismaClient) {
  await prisma.productStock.createMany({
    data: [
      { name: 'Магнит', qty: 35 },
      { name: 'Рамка А4', qty: 18 },
      { name: 'Декоративная рамка', qty: 12 },
      { name: 'Бамбуковая рамка', qty: 9 },
      { name: 'электронный вариант и фото', qty: 30 },
      { name: 'Рамка А6', qty: 22 },
    ],
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
 * Идемпотентно приводит демо-пользователей и справочники к актуальному виду.
 * Не удаляет продажи, смены и прочие операционные данные.
 */
export async function ensureDemoData(prisma: PrismaClient) {
  await ensureDemoUsers(prisma);
  await ensureSellerProfiles(prisma);
  await ensureStaffMembers(prisma);
  await ensureProductCatalog(prisma);
  await ensureProductStock(prisma);
  await ensureDemoWriteOffsIfEmpty(prisma);
  await ensureAppState(prisma);
}
