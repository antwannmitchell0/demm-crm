-- Rollback for 20260723113536_client_health_and_revenue_amount
-- Purely additive migration (new nullable column + three new tables), so
-- rollback is a straightforward reversal with no data-loss risk beyond the
-- Client Health history itself (acceptable: it is diagnostic, not
-- commercial record).
DROP TABLE IF EXISTS "ClientHealthHistory";
DROP TABLE IF EXISTS "ClientHealthOverride";
DROP TABLE IF EXISTS "ClientHealth";

ALTER TABLE "ClientCommercialStateChange" DROP COLUMN IF EXISTS "amount";

DROP TYPE IF EXISTS "ClientHealthState";
