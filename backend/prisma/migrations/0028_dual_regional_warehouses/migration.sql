-- Два региональных склада вместо одного __WAREHOUSE__
INSERT INTO "ProductStockLocation" ("locationKey", "productName", "qty")
SELECT '__WAREHOUSE_SADY__', "productName", "qty"
FROM "ProductStockLocation"
WHERE "locationKey" = '__WAREHOUSE__'
ON CONFLICT ("locationKey", "productName") DO UPDATE SET "qty" = EXCLUDED."qty";

INSERT INTO "ProductStockLocation" ("locationKey", "productName", "qty")
SELECT '__WAREHOUSE_CENTER__', "name", 0
FROM "ProductCatalog"
ON CONFLICT ("locationKey", "productName") DO NOTHING;
