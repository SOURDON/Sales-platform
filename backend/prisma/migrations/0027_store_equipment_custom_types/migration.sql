CREATE TABLE "StoreEquipmentCustomType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "StoreEquipmentCustomType_label_key" ON "StoreEquipmentCustomType"("label");

ALTER TABLE "StoreEquipment" ADD COLUMN "extra" TEXT NOT NULL DEFAULT '{}';
