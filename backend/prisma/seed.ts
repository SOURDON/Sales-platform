/**
 * Точка входа Prisma seed: вызывает общий идемпотентный сид (см. src/database/ensure-demo-data.ts).
 */
import { PrismaClient } from '@prisma/client';
import { ensureDemoData } from '../src/database/ensure-demo-data';

const prisma = new PrismaClient();

async function main() {
  await ensureDemoData(prisma);
  console.log('Prisma seed: демо-данные синхронизированы (без удаления продаж и истории).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
