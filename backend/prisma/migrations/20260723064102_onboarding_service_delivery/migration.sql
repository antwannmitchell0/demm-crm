/*
  Warnings:

  - The `onboardingState` column on the `ClientAccount` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "OnboardingPlanState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'BLOCKED', 'READY_FOR_LAUNCH', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'BLOCKED', 'SUBMITTED', 'COMPLETE', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistResponsibility" AS ENUM ('DEMM', 'CLIENT');

-- CreateEnum
CREATE TYPE "ServiceDeliverableCadence" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "ServiceDeliverableStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'WAITING_ON_CLIENT', 'DELIVERED', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- AlterTable
-- Safe cast instead of Prisma's default DROP/ADD COLUMN (which would silently
-- reset every existing row to the new column's default, losing any non-default
-- onboardingState). OnboardingPlanState's first three values are name-identical
-- to MarketingOnboardingState's only three values, so this cast is lossless.
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" DROP DEFAULT;
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" TYPE "OnboardingPlanState" USING ("onboardingState"::text::"OnboardingPlanState");
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" SET DEFAULT 'NOT_STARTED';

-- DropEnum
DROP TYPE "MarketingOnboardingState";

-- CreateTable
CREATE TABLE "OnboardingPlan" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "offerSnapshotId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT,
    "targetLaunchDate" TIMESTAMP(3),
    "actualLaunchDate" TIMESTAMP(3),
    "state" "OnboardingPlanState" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingChecklistItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceCapability" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "responsibility" "ChecklistResponsibility" NOT NULL,
    "assignedOwnerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "dependsOnItemId" TEXT,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidence" TEXT,
    "clientSubmission" JSONB,
    "blockerReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingChecklistItemHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "oldStatus" "ChecklistItemStatus" NOT NULL,
    "newStatus" "ChecklistItemStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingChecklistItemHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchGateOverride" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "affectedGates" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchGateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDeliverable" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "offerSnapshotId" TEXT NOT NULL,
    "sourceCapability" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cadence" "ServiceDeliverableCadence" NOT NULL,
    "cadenceDetail" TEXT,
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ServiceDeliverableStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidence" TEXT,
    "clientApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "clientApprovedAt" TIMESTAMP(3),
    "blockerReason" TEXT,
    "outsideScope" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDeliverableHistory" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "oldStatus" "ServiceDeliverableStatus" NOT NULL,
    "newStatus" "ServiceDeliverableStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceDeliverableHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingPlan_clientAccountId_key" ON "OnboardingPlan"("clientAccountId");

-- CreateIndex
CREATE INDEX "OnboardingChecklistItem_planId_status_idx" ON "OnboardingChecklistItem"("planId", "status");

-- CreateIndex
CREATE INDEX "OnboardingChecklistItemHistory_itemId_createdAt_idx" ON "OnboardingChecklistItemHistory"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "LaunchGateOverride_planId_createdAt_idx" ON "LaunchGateOverride"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceDeliverable_clientAccountId_status_idx" ON "ServiceDeliverable"("clientAccountId", "status");

-- CreateIndex
CREATE INDEX "ServiceDeliverableHistory_deliverableId_createdAt_idx" ON "ServiceDeliverableHistory"("deliverableId", "createdAt");

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_offerSnapshotId_fkey" FOREIGN KEY ("offerSnapshotId") REFERENCES "OfferSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklistItem" ADD CONSTRAINT "OnboardingChecklistItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OnboardingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklistItem" ADD CONSTRAINT "OnboardingChecklistItem_assignedOwnerId_fkey" FOREIGN KEY ("assignedOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklistItem" ADD CONSTRAINT "OnboardingChecklistItem_dependsOnItemId_fkey" FOREIGN KEY ("dependsOnItemId") REFERENCES "OnboardingChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklistItem" ADD CONSTRAINT "OnboardingChecklistItem_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklistItemHistory" ADD CONSTRAINT "OnboardingChecklistItemHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OnboardingChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchGateOverride" ADD CONSTRAINT "LaunchGateOverride_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OnboardingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliverable" ADD CONSTRAINT "ServiceDeliverable_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliverable" ADD CONSTRAINT "ServiceDeliverable_offerSnapshotId_fkey" FOREIGN KEY ("offerSnapshotId") REFERENCES "OfferSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliverable" ADD CONSTRAINT "ServiceDeliverable_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliverableHistory" ADD CONSTRAINT "ServiceDeliverableHistory_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "ServiceDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
