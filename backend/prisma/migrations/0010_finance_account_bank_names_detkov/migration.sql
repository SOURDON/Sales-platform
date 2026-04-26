-- Align built-in bank account labels with the acquiring split (default vs Detkov).
UPDATE "FinanceAccount" SET "name" = 'Р/с (основной)' WHERE "id" = 'fa-bank-main';
UPDATE "FinanceAccount" SET "name" = 'Р/с (Детков)' WHERE "id" = 'fa-bank-extra';

UPDATE "FinanceExpense" SET "accountName" = 'Р/с (основной)' WHERE "accountId" = 'fa-bank-main';
UPDATE "FinanceExpense" SET "accountName" = 'Р/с (Детков)' WHERE "accountId" = 'fa-bank-extra';

UPDATE "FinanceIncome" SET "accountName" = 'Р/с (основной)' WHERE "accountId" = 'fa-bank-main';
UPDATE "FinanceIncome" SET "accountName" = 'Р/с (Детков)' WHERE "accountId" = 'fa-bank-extra';
