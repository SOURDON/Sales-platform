-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'NON_CASH');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "paymentType" "PaymentType" NOT NULL DEFAULT 'CASH';
