-- Rollback for 20260723064102_onboarding_service_delivery
-- Reverses the ClientAccount.onboardingState type change, then drops the
-- new tables/enums. Fails safely if any row holds one of the four
-- OnboardingPlanState values that don't exist in MarketingOnboardingState
-- (WAITING_ON_CLIENT/BLOCKED/READY_FOR_LAUNCH/CANCELLED) -- that is
-- intentional, matching the existing rollback.sql convention in this repo
-- (see 20260723053752_offer_optional_operational_fields/rollback.sql): it
-- forces a conscious decision about what to backfill rather than silently
-- coercing to a value that never happened.
CREATE TYPE "MarketingOnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" DROP DEFAULT;
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" TYPE "MarketingOnboardingState" USING ("onboardingState"::text::"MarketingOnboardingState");
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" SET DEFAULT 'NOT_STARTED';

DROP TABLE IF EXISTS "ServiceDeliverableHistory";
DROP TABLE IF EXISTS "ServiceDeliverable";
DROP TABLE IF EXISTS "LaunchGateOverride";
DROP TABLE IF EXISTS "OnboardingChecklistItemHistory";
DROP TABLE IF EXISTS "OnboardingChecklistItem";
DROP TABLE IF EXISTS "OnboardingPlan";

DROP TYPE IF EXISTS "ServiceDeliverableStatus";
DROP TYPE IF EXISTS "ServiceDeliverableCadence";
DROP TYPE IF EXISTS "ChecklistResponsibility";
DROP TYPE IF EXISTS "ChecklistItemStatus";
DROP TYPE IF EXISTS "OnboardingPlanState";
