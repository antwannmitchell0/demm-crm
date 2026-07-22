-- CreateEnum
CREATE TYPE "OfferLifecycleState" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "MarketingServiceStatus" AS ENUM ('PENDING_ONBOARDING', 'ACTIVE', 'AT_RISK', 'PAUSED', 'CHURNED');

-- CreateEnum
CREATE TYPE "MarketingOnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "industryContext" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "setupFee" DECIMAL(12,2),
    "includedServices" TEXT[],
    "excludedServices" TEXT[],
    "onboardingRequirements" TEXT[],
    "supportBoundaries" TEXT NOT NULL,
    "reportingCadence" TEXT NOT NULL,
    "cancellationTerms" TEXT NOT NULL,
    "expectedLaunchTime" TEXT NOT NULL,
    "lifecycleState" "OfferLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "isPubliclyAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferSnapshot" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "setupFee" DECIMAL(12,2),
    "includedServices" TEXT[],
    "excludedServices" TEXT[],
    "onboardingRequirements" TEXT[],
    "supportBoundaries" TEXT NOT NULL,
    "reportingCadence" TEXT NOT NULL,
    "cancellationTerms" TEXT NOT NULL,
    "expectedLaunchTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAccount" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "companyId" TEXT,
    "primaryContactId" TEXT NOT NULL,
    "acquisitionOpportunityId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerSnapshotId" TEXT NOT NULL,
    "serviceStatus" "MarketingServiceStatus" NOT NULL DEFAULT 'PENDING_ONBOARDING',
    "onboardingState" "MarketingOnboardingState" NOT NULL DEFAULT 'NOT_STARTED',
    "renewalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCommercialStateChange" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCommercialStateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionIdempotencyKey" (
    "key" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionIdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Offer_businessUnitId_lifecycleState_idx" ON "Offer"("businessUnitId", "lifecycleState");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_businessUnitId_key_version_key" ON "Offer"("businessUnitId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_acquisitionOpportunityId_key" ON "ClientAccount"("acquisitionOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_offerSnapshotId_key" ON "ClientAccount"("offerSnapshotId");

-- CreateIndex
CREATE INDEX "ClientAccount_businessUnitId_serviceStatus_idx" ON "ClientAccount"("businessUnitId", "serviceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_businessUnitId_companyId_key" ON "ClientAccount"("businessUnitId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_businessUnitId_primaryContactId_key" ON "ClientAccount"("businessUnitId", "primaryContactId");

-- CreateIndex
CREATE INDEX "ClientCommercialStateChange_clientAccountId_field_createdAt_idx" ON "ClientCommercialStateChange"("clientAccountId", "field", "createdAt");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferSnapshot" ADD CONSTRAINT "OfferSnapshot_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_acquisitionOpportunityId_fkey" FOREIGN KEY ("acquisitionOpportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_offerSnapshotId_fkey" FOREIGN KEY ("offerSnapshotId") REFERENCES "OfferSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCommercialStateChange" ADD CONSTRAINT "ClientCommercialStateChange_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCommercialStateChange" ADD CONSTRAINT "ClientCommercialStateChange_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionIdempotencyKey" ADD CONSTRAINT "ConversionIdempotencyKey_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
