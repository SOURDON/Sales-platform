-- Глобальная ставка эквайринга для финотчёта (директор / бухгалтер)
ALTER TABLE "AppState" ADD COLUMN IF NOT EXISTS "acquiringPercent" DOUBLE PRECISION NOT NULL DEFAULT 1.8;
