-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('INQUIRY', 'QUOTE_SENT', 'CONTRACT_SENT', 'DEPOSIT_PAID', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MemoryForm" AS ENUM ('SEMANTIC', 'EPISODIC', 'PROCEDURAL', 'WORKING', 'GOVERNANCE');

-- CreateEnum
CREATE TYPE "MemoryTopic" AS ENUM ('IDENTITY', 'RELATIONSHIP', 'PREFERENCE', 'JOURNEY', 'MILESTONE', 'COMMITMENT', 'SERVICE_CONTEXT', 'ISSUE_AND_RESOLUTION');

-- CreateEnum
CREATE TYPE "TruthClassification" AS ENUM ('CONFIRMED', 'OBSERVED', 'INFERRED', 'EXPIRED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SensitivityClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "EngramState" AS ENUM ('ACTIVE', 'EXPIRED', 'DISPUTED', 'DELETED');

-- CreateEnum
CREATE TYPE "PulseState" AS ENUM ('NEW', 'ACTIVE', 'GROWING', 'AT_RISK', 'INACTIVE', 'RETURNING', 'ADVOCATE');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('CONTACT', 'COMPANY');

-- CreateEnum
CREATE TYPE "CandidateState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('AGENT', 'MANUAL', 'EVENT');

-- CreateEnum
CREATE TYPE "SeverityState" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SignalState" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('WEB', 'MOBILE', 'EMAIL', 'IN_PERSON');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "businessUnitId" TEXT;

-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "packageSelected" TEXT NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "depositPaid" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "status" "BookingStatus" NOT NULL DEFAULT 'INQUIRY',
    "workspaceId" TEXT NOT NULL,
    "operatorId" TEXT,
    "wtaeEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastInspection" TIMESTAMP(3),
    "nextInspection" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEquipment" (
    "bookingId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,

    CONSTRAINT "BookingEquipment_pkey" PRIMARY KEY ("bookingId","equipmentId")
);

-- CreateTable
CREATE TABLE "WtaeEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "organizerName" TEXT NOT NULL,
    "organizerEmail" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WtaeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoAsset" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "wtaeEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeRegistration" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "sessionCode" TEXT NOT NULL,
    "wtaeEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "attendeeRegistrationId" TEXT NOT NULL,
    "wtaeEventId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "photoParticipation" BOOLEAN NOT NULL DEFAULT false,
    "communicationsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "crossBusinessAllowed" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalState" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentClaim" (
    "id" TEXT NOT NULL,
    "photoAssetId" TEXT NOT NULL,
    "attendeeRegistrationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flower" (
    "id" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "wtaeEventId" TEXT NOT NULL,
    "momentClaimId" TEXT,
    "category" TEXT NOT NULL,
    "moderationState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipSubject" (
    "id" TEXT NOT NULL,
    "type" "SubjectType" NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipProfile" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "pulse" "PulseState" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseChangeHistory" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "oldPulse" "PulseState" NOT NULL,
    "newPulse" "PulseState" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PulseChangeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engram" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "form" "MemoryForm" NOT NULL,
    "topic" "MemoryTopic" NOT NULL,
    "truthClassification" "TruthClassification" NOT NULL,
    "sensitivity" "SensitivityClassification" NOT NULL DEFAULT 'INTERNAL',
    "state" "EngramState" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT NOT NULL,
    "structuredContent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Engram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngramSource" (
    "id" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "referenceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngramSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngramEvidence" (
    "id" TEXT NOT NULL,
    "engramId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngramEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngramGraphEdge" (
    "id" TEXT NOT NULL,
    "sourceEngramId" TEXT NOT NULL,
    "targetEngramId" TEXT,
    "bookingId" TEXT,
    "wtaeEventId" TEXT,
    "relationshipType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngramGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCandidate" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "form" "MemoryForm" NOT NULL,
    "topic" "MemoryTopic" NOT NULL,
    "proposedTruth" "TruthClassification" NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "sensitivity" "SensitivityClassification" NOT NULL,
    "consentBasis" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB,
    "expiresAt" TIMESTAMP(3),
    "status" "CandidateState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEvidence" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryApproval" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "CandidateState" NOT NULL,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCorrection" (
    "id" TEXT NOT NULL,
    "engramId" TEXT NOT NULL,
    "previousSummary" TEXT NOT NULL,
    "previousContent" JSONB,
    "correctedSummary" TEXT NOT NULL,
    "correctedContent" JSONB,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryAccessPolicy" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "allowedForms" "MemoryForm"[],
    "allowedTopics" "MemoryTopic"[],
    "allowedSensitivities" "SensitivityClassification"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryAccessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "profileId" TEXT,
    "engramId" TEXT,
    "candidateId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentDirective" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "originatingBusinessId" TEXT NOT NULL,
    "destinationBusinessId" TEXT,
    "dataCategory" "MemoryTopic" NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    "supersedingDirectiveId" TEXT,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipSignal" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "severity" "SeverityState" NOT NULL,
    "state" "SignalState" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvidence" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "engramId" TEXT NOT NULL,

    CONSTRAINT "SignalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipBrief" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "briefText" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sensitivity" "SensitivityClassification" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "RelationshipBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefEvidence" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "engramId" TEXT NOT NULL,

    CONSTRAINT "BriefEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_organizationId_key_key" ON "BusinessUnit"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_wtaeEventId_key" ON "Booking"("wtaeEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_serialNumber_key" ON "Equipment"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WtaeEvent_slug_key" ON "WtaeEvent"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AttendeeRegistration_sessionCode_key" ON "AttendeeRegistration"("sessionCode");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipSubject_contactId_key" ON "RelationshipSubject"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipSubject_companyId_key" ON "RelationshipSubject"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipProfile_subjectId_businessUnitId_key" ON "RelationshipProfile"("subjectId", "businessUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "EngramEvidence_engramId_sourceId_key" ON "EngramEvidence"("engramId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEvidence_candidateId_sourceId_key" ON "CandidateEvidence"("candidateId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SignalEvidence_signalId_engramId_key" ON "SignalEvidence"("signalId", "engramId");

-- CreateIndex
CREATE UNIQUE INDEX "BriefEvidence_briefId_engramId_key" ON "BriefEvidence"("briefId", "engramId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEquipment" ADD CONSTRAINT "BookingEquipment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEquipment" ADD CONSTRAINT "BookingEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WtaeEvent" ADD CONSTRAINT "WtaeEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAsset" ADD CONSTRAINT "PhotoAsset_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeRegistration" ADD CONSTRAINT "AttendeeRegistration_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_attendeeRegistrationId_fkey" FOREIGN KEY ("attendeeRegistrationId") REFERENCES "AttendeeRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentClaim" ADD CONSTRAINT "MomentClaim_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "PhotoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentClaim" ADD CONSTRAINT "MomentClaim_attendeeRegistrationId_fkey" FOREIGN KEY ("attendeeRegistrationId") REFERENCES "AttendeeRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flower" ADD CONSTRAINT "Flower_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "AttendeeRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flower" ADD CONSTRAINT "Flower_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AttendeeRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flower" ADD CONSTRAINT "Flower_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flower" ADD CONSTRAINT "Flower_momentClaimId_fkey" FOREIGN KEY ("momentClaimId") REFERENCES "MomentClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipSubject" ADD CONSTRAINT "RelationshipSubject_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipSubject" ADD CONSTRAINT "RelationshipSubject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipProfile" ADD CONSTRAINT "RelationshipProfile_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RelationshipSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipProfile" ADD CONSTRAINT "RelationshipProfile_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseChangeHistory" ADD CONSTRAINT "PulseChangeHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RelationshipProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engram" ADD CONSTRAINT "Engram_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RelationshipProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engram" ADD CONSTRAINT "Engram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engram" ADD CONSTRAINT "Engram_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engram" ADD CONSTRAINT "Engram_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramEvidence" ADD CONSTRAINT "EngramEvidence_engramId_fkey" FOREIGN KEY ("engramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramEvidence" ADD CONSTRAINT "EngramEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EngramSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramGraphEdge" ADD CONSTRAINT "EngramGraphEdge_sourceEngramId_fkey" FOREIGN KEY ("sourceEngramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramGraphEdge" ADD CONSTRAINT "EngramGraphEdge_targetEngramId_fkey" FOREIGN KEY ("targetEngramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramGraphEdge" ADD CONSTRAINT "EngramGraphEdge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngramGraphEdge" ADD CONSTRAINT "EngramGraphEdge_wtaeEventId_fkey" FOREIGN KEY ("wtaeEventId") REFERENCES "WtaeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RelationshipProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEvidence" ADD CONSTRAINT "CandidateEvidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "MemoryCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEvidence" ADD CONSTRAINT "CandidateEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EngramSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryApproval" ADD CONSTRAINT "MemoryApproval_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "MemoryCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryApproval" ADD CONSTRAINT "MemoryApproval_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCorrection" ADD CONSTRAINT "MemoryCorrection_engramId_fkey" FOREIGN KEY ("engramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAccessPolicy" ADD CONSTRAINT "MemoryAccessPolicy_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentDirective" ADD CONSTRAINT "ConsentDirective_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RelationshipSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentDirective" ADD CONSTRAINT "ConsentDirective_originatingBusinessId_fkey" FOREIGN KEY ("originatingBusinessId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentDirective" ADD CONSTRAINT "ConsentDirective_destinationBusinessId_fkey" FOREIGN KEY ("destinationBusinessId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipSignal" ADD CONSTRAINT "RelationshipSignal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RelationshipProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "RelationshipSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_engramId_fkey" FOREIGN KEY ("engramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipBrief" ADD CONSTRAINT "RelationshipBrief_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RelationshipProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefEvidence" ADD CONSTRAINT "BriefEvidence_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "RelationshipBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefEvidence" ADD CONSTRAINT "BriefEvidence_engramId_fkey" FOREIGN KEY ("engramId") REFERENCES "Engram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
