/*
  Warnings:

  - Added the required column `trialDays` to the `OfferSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trialEligible` to the `OfferSnapshot` table without a default value. This is not possible if the table is not empty.

  Hand-adjusted (2026-07-23): existing OfferSnapshot rows are backfilled via a
  temporary DEFAULT (false / 0) that is dropped immediately after, so the
  final column definition matches the schema exactly (NOT NULL, no default)
  while not losing or blocking on the pre-existing row(s). Non-destructive.

*/
-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "BillingCheckoutStatus" AS ENUM ('PENDING', 'CREATED', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookProcessingState" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentReversalState" AS ENUM ('NONE', 'PARTIAL_REFUND', 'FULL_REFUND');

-- DropForeignKey
ALTER TABLE "ClientCommercialStateChange" DROP CONSTRAINT "ClientCommercialStateChange_recordedById_fkey";

-- AlterTable
ALTER TABLE "ClientAccount" ADD COLUMN     "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "ClientCommercialStateChange" ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trialEligible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- trialDays/trialEligible are added with a temporary DEFAULT to backfill the
-- existing row(s), then the DEFAULT is dropped so the final state matches
-- the schema (NOT NULL, no default) -- see note in Warnings block above.
ALTER TABLE "OfferSnapshot" ADD COLUMN     "stripePriceMappingId" TEXT,
ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trialEligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OfferSnapshot" ALTER COLUMN "trialDays" DROP DEFAULT;
ALTER TABLE "OfferSnapshot" ALTER COLUMN "trialEligible" DROP DEFAULT;

-- CreateTable
CREATE TABLE "StripePriceMapping" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "billingInterval" TEXT NOT NULL DEFAULT 'month',
    "environment" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "stripeProductId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripePriceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "stripePriceMappingId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCheckoutSession" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "offerSnapshotId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "status" "BillingCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "checkoutUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "BillingCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPaymentRecord" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "billingSubscriptionId" TEXT,
    "stripeInvoiceId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "amountPaid" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "taxAmount" DECIMAL(12,2),
    "creditAmount" DECIMAL(12,2),
    "billingPeriodStart" TIMESTAMP(3),
    "billingPeriodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3) NOT NULL,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reversalState" "PaymentReversalState" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processingState" "WebhookProcessingState" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "eventCreatedAt" TIMESTAMP(3) NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "correlationId" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripePriceMapping_environment_livemode_idx" ON "StripePriceMapping"("environment", "livemode");

-- CreateIndex
CREATE UNIQUE INDEX "StripePriceMapping_offerId_offerVersion_environment_livemod_key" ON "StripePriceMapping"("offerId", "offerVersion", "environment", "livemode");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_stripeSubscriptionId_key" ON "BillingSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_clientAccountId_createdAt_idx" ON "BillingSubscription"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingSubscription_stripeCustomerId_idx" ON "BillingSubscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckoutSession_idempotencyKey_key" ON "BillingCheckoutSession"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingCheckoutSession_clientAccountId_createdAt_idx" ON "BillingCheckoutSession"("clientAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPaymentRecord_stripeInvoiceId_key" ON "BillingPaymentRecord"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "BillingPaymentRecord_clientAccountId_paidAt_idx" ON "BillingPaymentRecord"("clientAccountId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processingState_receivedAt_idx" ON "StripeWebhookEvent"("processingState", "receivedAt");

-- AddForeignKey
ALTER TABLE "OfferSnapshot" ADD CONSTRAINT "OfferSnapshot_stripePriceMappingId_fkey" FOREIGN KEY ("stripePriceMappingId") REFERENCES "StripePriceMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCommercialStateChange" ADD CONSTRAINT "ClientCommercialStateChange_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePriceMapping" ADD CONSTRAINT "StripePriceMapping_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_stripePriceMappingId_fkey" FOREIGN KEY ("stripePriceMappingId") REFERENCES "StripePriceMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckoutSession" ADD CONSTRAINT "BillingCheckoutSession_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckoutSession" ADD CONSTRAINT "BillingCheckoutSession_offerSnapshotId_fkey" FOREIGN KEY ("offerSnapshotId") REFERENCES "OfferSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPaymentRecord" ADD CONSTRAINT "BillingPaymentRecord_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPaymentRecord" ADD CONSTRAINT "BillingPaymentRecord_billingSubscriptionId_fkey" FOREIGN KEY ("billingSubscriptionId") REFERENCES "BillingSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
