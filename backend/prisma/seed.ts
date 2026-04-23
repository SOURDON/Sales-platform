import { PrismaClient, UserRole, WriteOffReason } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const usersCount = await prisma.user.count();
  if (usersCount > 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [
        {
          id: 1,
          nickname: 'director',
          password: '123456',
          fullName: 'Director User',
          role: UserRole.DIRECTOR,
          storeName: 'All Stores',
          isActive: true,
        },
        {
          id: 2,
          nickname: 'admin1',
          password: '123456',
          fullName: 'Store Admin',
          role: UserRole.ADMIN,
          storeName: 'Store #1',
          isActive: true,
        },
        {
          id: 3,
          nickname: 'seller1',
          password: '123456',
          fullName: 'Cashier Seller',
          role: UserRole.SELLER,
          storeName: 'Store #1',
          isActive: true,
        },
        {
          id: 4,
          nickname: 'seller2',
          password: '123456',
          fullName: 'Anna Romanova',
          role: UserRole.SELLER,
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
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8),
          name: 'Рамка А4',
          qty: 2,
          reason: WriteOffReason.BRAK,
        },
        {
          id: 'wo-2',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4),
          name: 'Магнит',
          qty: 5,
          reason: WriteOffReason.POLOMKA,
        },
        {
          id: 'wo-3',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
