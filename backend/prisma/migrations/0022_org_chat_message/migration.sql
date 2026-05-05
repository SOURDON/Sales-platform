-- CreateTable
CREATE TABLE "OrgChatMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT NOT NULL,
    "senderRole" "UserRole" NOT NULL,
    "senderDisplay" TEXT NOT NULL,
    "authorNickname" TEXT NOT NULL,

    CONSTRAINT "OrgChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgChatMessage_createdAt_idx" ON "OrgChatMessage"("createdAt");
