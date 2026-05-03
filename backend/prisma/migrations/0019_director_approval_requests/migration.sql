-- CreateEnum
CREATE TYPE "DirectorApprovalKind" AS ENUM ('SALE_DELETE', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "DirectorApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "DirectorApprovalRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "DirectorApprovalKind" NOT NULL,
    "state" "DirectorApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedByNickname" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "DirectorApprovalRequest_pkey" PRIMARY KEY ("id")
);
