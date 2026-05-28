/**
 * Одноразовая очистка оперативки в БД:
 * все приходы/расходы, нулевые остатки счетов, суммы по статьям → 0.
 *
 * Запуск: cd backend && DATABASE_URL="..." npm run finance:reset-ops-once
 */
import { PrismaClient } from '@prisma/client';
import {
  defaultFinanceCategoryAmounts,
  serializeFinanceCategoryAmounts,
} from '../src/finance/expense-categories';

async function main() {
  const prisma = new PrismaClient();
  try {
    const [expenses, incomes, accounts] = await Promise.all([
      prisma.financeExpense.deleteMany(),
      prisma.financeIncome.deleteMany(),
      prisma.financeAccount.updateMany({ data: { balance: 0 } }),
    ]);
    await prisma.appState.upsert({
      where: { id: 1 },
      update: {
        financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
          defaultFinanceCategoryAmounts(),
        ),
      },
      create: {
        id: 1,
        financeExpenseCategoryAmountsJson: serializeFinanceCategoryAmounts(
          defaultFinanceCategoryAmounts(),
        ),
      },
    });
    console.log(
      `Finance ops reset: deleted ${expenses.count} expenses, ${incomes.count} incomes; zeroed ${accounts.count} account balances; category amounts cleared.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
