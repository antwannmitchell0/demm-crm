-- CreateEnum
CREATE TYPE "ClientHealthState" AS ENUM ('HEALTHY', 'WATCH', 'AT_RISK', 'CRITICAL', 'PAUSED', 'CHURNED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ClientCommercialStateChange" ADD COLUMN     "amount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "ClientHealth" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "state" "ClientHealthState" NOT NULL DEFAULT 'UNKNOWN',
    "computedState" "ClientHealthState" NOT NULL DEFAULT 'UNKNOWN',
    "overrideState" "ClientHealthState",
    "factors" JSONB NOT NULL,
    "missingData" TEXT[],
    "recommendedAction" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientHealthOverride" (
    "id" TEXT NOT NULL,
    "healthId" TEXT NOT NULL,
    "state" "ClientHealthState" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientHealthOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientHealthHistory" (
    "id" TEXT NOT NULL,
    "healthId" TEXT NOT NULL,
    "oldState" "ClientHealthState" NOT NULL,
    "newState" "ClientHealthState" NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientHealthHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientHealth_clientAccountId_key" ON "ClientHealth"("clientAccountId");

-- CreateIndex
CREATE INDEX "ClientHealthOverride_healthId_createdAt_idx" ON "ClientHealthOverride"("healthId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientHealthHistory_healthId_createdAt_idx" ON "ClientHealthHistory"("healthId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientHealth" ADD CONSTRAINT "ClientHealth_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHealthOverride" ADD CONSTRAINT "ClientHealthOverride_healthId_fkey" FOREIGN KEY ("healthId") REFERENCES "ClientHealth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHealthHistory" ADD CONSTRAINT "ClientHealthHistory_healthId_fkey" FOREIGN KEY ("healthId") REFERENCES "ClientHealth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
