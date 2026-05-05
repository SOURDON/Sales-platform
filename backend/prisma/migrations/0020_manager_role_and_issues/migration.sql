-- Add manager role
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

-- Issue categories for store appeals to manager
CREATE TYPE "ManagerIssueCategory" AS ENUM (
  'PERSONNEL',
  'INSPECTION',
  'GOODS',
  'EQUIPMENT_BREAKDOWN',
  'NEEDS'
);

CREATE TABLE "ManagerIssue" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storeName" TEXT NOT NULL,
  "createdByNickname" TEXT NOT NULL,
  "category" "ManagerIssueCategory" NOT NULL,
  "message" TEXT NOT NULL,
  CONSTRAINT "ManagerIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagerIssue_createdAt_idx" ON "ManagerIssue"("createdAt");
