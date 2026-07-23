-- AlterTable
ALTER TABLE "Offer" ALTER COLUMN "supportBoundaries" DROP NOT NULL,
ALTER COLUMN "reportingCadence" DROP NOT NULL,
ALTER COLUMN "cancellationTerms" DROP NOT NULL,
ALTER COLUMN "expectedLaunchTime" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OfferSnapshot" ALTER COLUMN "supportBoundaries" DROP NOT NULL,
ALTER COLUMN "reportingCadence" DROP NOT NULL,
ALTER COLUMN "cancellationTerms" DROP NOT NULL,
ALTER COLUMN "expectedLaunchTime" DROP NOT NULL;
