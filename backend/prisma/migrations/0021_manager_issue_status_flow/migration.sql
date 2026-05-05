CREATE TYPE "ManagerIssueStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');

ALTER TABLE "ManagerIssue"
ADD COLUMN "status" "ManagerIssueStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "startedBy" TEXT,
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "completedBy" TEXT;
