-- Отдельная ставка эквайринга для группы магазинов "Детков"
ALTER TABLE "AppState"
ADD COLUMN IF NOT EXISTS "acquiringPercentDetkov" DOUBLE PRECISION NOT NULL DEFAULT 1.8;
