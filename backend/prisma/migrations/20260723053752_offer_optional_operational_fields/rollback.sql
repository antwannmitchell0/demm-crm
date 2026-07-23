-- Rollback for 20260723053752_offer_optional_operational_fields
-- Re-applies NOT NULL. Any row with a NULL value in these columns must be
-- backfilled first, or this will fail -- that is intentional: it forces a
-- conscious decision about what to backfill rather than silently coercing
-- to an empty string.
ALTER TABLE "Offer" ALTER COLUMN "supportBoundaries" SET NOT NULL,
ALTER COLUMN "reportingCadence" SET NOT NULL,
ALTER COLUMN "cancellationTerms" SET NOT NULL,
ALTER COLUMN "expectedLaunchTime" SET NOT NULL;

ALTER TABLE "OfferSnapshot" ALTER COLUMN "supportBoundaries" SET NOT NULL,
ALTER COLUMN "reportingCadence" SET NOT NULL,
ALTER COLUMN "cancellationTerms" SET NOT NULL,
ALTER COLUMN "expectedLaunchTime" SET NOT NULL;
