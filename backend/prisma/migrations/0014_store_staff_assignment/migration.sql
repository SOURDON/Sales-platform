-- CreateTable
CREATE TABLE "StoreStaffAssignment" (
    "storeName" TEXT NOT NULL,
    "staffId" INTEGER NOT NULL,
    CONSTRAINT "StoreStaffAssignment_pkey" PRIMARY KEY ("storeName","staffId")
);

-- AddForeignKey
ALTER TABLE "StoreStaffAssignment"
ADD CONSTRAINT "StoreStaffAssignment_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed initial assignments by home store for existing staff
INSERT INTO "StoreStaffAssignment" ("storeName", "staffId")
SELECT u."storeName", s."id"
FROM "StaffMember" s
JOIN "User" u ON u."id" = s."id"
ON CONFLICT ("storeName", "staffId") DO NOTHING;
