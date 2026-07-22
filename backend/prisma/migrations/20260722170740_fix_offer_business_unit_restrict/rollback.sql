-- Revert Offer.businessUnitId FK from Restrict back to Cascade
ALTER TABLE "Offer" DROP CONSTRAINT IF EXISTS "Offer_businessUnitId_fkey";

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
