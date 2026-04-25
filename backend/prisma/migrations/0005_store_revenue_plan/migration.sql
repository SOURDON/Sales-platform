CREATE TABLE "StoreRevenuePlan" (
    "dayKey" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "planRevenue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "StoreRevenuePlan_pkey" PRIMARY KEY ("dayKey","storeName")
);
