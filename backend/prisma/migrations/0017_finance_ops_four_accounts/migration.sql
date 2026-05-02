-- Четыре счёта оперативных финансов: Д ВТБ, П ВТБ, П СБЕР, наличные
UPDATE "FinanceAccount" SET "name" = 'Наличные', "updatedAt" = NOW() WHERE "id" = 'fa-cash-main';
UPDATE "FinanceAccount" SET "name" = 'Р/с Д ВТБ', "updatedAt" = NOW() WHERE "id" = 'fa-bank-extra';
UPDATE "FinanceAccount" SET "name" = 'Р/с П ВТБ', "updatedAt" = NOW() WHERE "id" = 'fa-bank-main';

INSERT INTO "FinanceAccount" ("id", "name", "kind", "balance", "updatedAt")
VALUES ('fa-bank-putintsev-sber', 'Р/с П СБЕР', 'BANK', 0, NOW())
ON CONFLICT ("id") DO NOTHING;
