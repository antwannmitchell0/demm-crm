-- 1. Drop Foreign Keys and Tables (children before parents)
DROP TABLE IF EXISTS "ConversionIdempotencyKey" CASCADE;
DROP TABLE IF EXISTS "ClientCommercialStateChange" CASCADE;
DROP TABLE IF EXISTS "ClientAccount" CASCADE;
DROP TABLE IF EXISTS "OfferSnapshot" CASCADE;
DROP TABLE IF EXISTS "Offer" CASCADE;

-- 2. Drop Columns
ALTER TABLE "Opportunity" DROP COLUMN IF EXISTS "source";
ALTER TABLE "Opportunity" DROP COLUMN IF EXISTS "industryContext";

-- 3. Drop Custom Enums
DROP TYPE IF EXISTS "OfferLifecycleState";
DROP TYPE IF EXISTS "MarketingServiceStatus";
DROP TYPE IF EXISTS "MarketingOnboardingState";
