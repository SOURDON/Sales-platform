-- Rename main bank account label to match business naming
UPDATE "FinanceAccount" SET "name" = 'Р/с Путинцев' WHERE "id" = 'fa-bank-main';
UPDATE "FinanceExpense" SET "accountName" = 'Р/с Путинцев' WHERE "accountId" = 'fa-bank-main';
UPDATE "FinanceIncome" SET "accountName" = 'Р/с Путинцев' WHERE "accountId" = 'fa-bank-main';
