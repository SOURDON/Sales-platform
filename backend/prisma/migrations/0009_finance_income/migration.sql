CREATE TABLE "FinanceIncome" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "workDay" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "FinanceIncome_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FinanceIncome" ADD CONSTRAINT "FinanceIncome_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
