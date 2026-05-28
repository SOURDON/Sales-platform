ALTER TABLE "AppState" ADD COLUMN "financeExpenseCategoryAmountsJson" TEXT;

-- Одноразовая очистка оперативки при применении миграции
DELETE FROM "FinanceExpense";
DELETE FROM "FinanceIncome";
UPDATE "FinanceAccount" SET "balance" = 0;

UPDATE "AppState"
SET "financeExpenseCategoryAmountsJson" = '{"Аренда":0,"Налоги":0,"ЗП":0,"Расходка":0,"Ремонт":0,"Техника":0,"Хоз-товары":0,"Попилили":0,"Прочие траты":0}'
WHERE "id" = 1;
