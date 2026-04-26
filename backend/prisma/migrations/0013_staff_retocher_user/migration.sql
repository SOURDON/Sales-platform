-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'RETOUCHER';

-- CreateEnum
CREATE TYPE "StaffPosition" AS ENUM ('SALES', 'RETOUCHER');

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "staffPosition" "StaffPosition" NOT NULL DEFAULT 'SALES';
