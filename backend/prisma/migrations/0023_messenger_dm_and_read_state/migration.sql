-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT NOT NULL,
    "senderNickname" TEXT NOT NULL,
    "recipientNickname" TEXT NOT NULL,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserChatReadState" (
    "userNickname" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChatReadState_pkey" PRIMARY KEY ("userNickname","threadKey")
);

-- CreateTable
CREATE TABLE "UserMessengerBootstrap" (
    "userNickname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMessengerBootstrap_pkey" PRIMARY KEY ("userNickname")
);

-- CreateIndex
CREATE INDEX "DirectMessage_senderNickname_recipientNickname_createdAt_idx" ON "DirectMessage"("senderNickname", "recipientNickname", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_recipientNickname_createdAt_idx" ON "DirectMessage"("recipientNickname", "createdAt");

-- CreateIndex
CREATE INDEX "UserChatReadState_userNickname_idx" ON "UserChatReadState"("userNickname");
