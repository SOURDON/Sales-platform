-- CreateTable
CREATE TABLE "ProductStockLocation" (
    "locationKey" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ProductStockLocation_pkey" PRIMARY KEY ("locationKey","productName")
);

-- CreateIndex
CREATE INDEX "ProductStockLocation_locationKey_idx" ON "ProductStockLocation"("locationKey");

-- Перенос бывшего глобального остатка в центральный склад
INSERT INTO "ProductStockLocation" ("locationKey", "productName", "qty")
SELECT '__WAREHOUSE__', "name", "qty" FROM "ProductStock";

-- Нулевые остатки по каждой точке (каталог × точки)
INSERT INTO "ProductStockLocation" ("locationKey", "productName", "qty")
SELECT s.store_name, c."name", 0
FROM (
    VALUES
        ('Сады морей Тех. зона'),
        ('Сады морей Пляж'),
        ('Метрополь'),
        ('Багамы'),
        ('Спортивнй'),
        ('Центр пляж'),
        ('Центр Тех. зона'),
        ('Дельфин Тех. зона')
) AS s(store_name)
CROSS JOIN "ProductCatalog" c;

-- DropTable
DROP TABLE "ProductStock";
