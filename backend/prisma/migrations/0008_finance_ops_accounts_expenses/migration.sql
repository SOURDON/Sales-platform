CREATE TYPE "FinanceAccountKind" AS ENUM ('CASH', 'BANK');

CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceAccountKind" NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceExpense" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdBy" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    CONSTRAINT "FinanceExpense_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FinanceExpense"
ADD CONSTRAINT "FinanceExpense_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
