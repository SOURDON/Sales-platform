CREATE TABLE "ManagerStoreCommission" (
    "storeName" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 5,
    CONSTRAINT "ManagerStoreCommission_pkey" PRIMARY KEY ("storeName")
);

INSERT INTO "ManagerStoreCommission" ("storeName", "percent")
VALUES
  ('Сады морей Тех. зона', 0),
  ('Сады морей Пляж', 5),
  ('Метрополь', 0),
  ('Багамы', 5),
  ('Спортивнй', 5),
  ('Центр пляж', 5),
  ('Центр Тех. зона', 5),
  ('Дельфин Тех. зона', 5);
