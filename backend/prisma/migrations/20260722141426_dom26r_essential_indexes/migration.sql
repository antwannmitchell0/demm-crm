-- CreateIndex
CREATE INDEX "CandidateEvidence_sourceId_idx" ON "CandidateEvidence"("sourceId");

-- CreateIndex
CREATE INDEX "ConsentDirective_subjectId_originatingBusinessId_status_idx" ON "ConsentDirective"("subjectId", "originatingBusinessId", "status");

-- CreateIndex
CREATE INDEX "ConsentDirective_destinationBusinessId_idx" ON "ConsentDirective"("destinationBusinessId");

-- CreateIndex
CREATE INDEX "ConsentDirective_expirationDate_idx" ON "ConsentDirective"("expirationDate");

-- CreateIndex
CREATE INDEX "Engram_businessUnitId_state_idx" ON "Engram"("businessUnitId", "state");

-- CreateIndex
CREATE INDEX "Engram_profileId_state_idx" ON "Engram"("profileId", "state");

-- CreateIndex
CREATE INDEX "Engram_businessUnitId_truthClassification_idx" ON "Engram"("businessUnitId", "truthClassification");

-- CreateIndex
CREATE INDEX "Engram_businessUnitId_expiresAt_idx" ON "Engram"("businessUnitId", "expiresAt");

-- CreateIndex
CREATE INDEX "EngramEvidence_sourceId_idx" ON "EngramEvidence"("sourceId");

-- CreateIndex
CREATE INDEX "MemoryAuditEvent_engramId_createdAt_idx" ON "MemoryAuditEvent"("engramId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAuditEvent_candidateId_createdAt_idx" ON "MemoryAuditEvent"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAuditEvent_profileId_createdAt_idx" ON "MemoryAuditEvent"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAuditEvent_businessUnitId_createdAt_idx" ON "MemoryAuditEvent"("businessUnitId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAuditEvent_correlationId_idx" ON "MemoryAuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "MemoryCandidate_profileId_status_idx" ON "MemoryCandidate"("profileId", "status");

-- CreateIndex
CREATE INDEX "RelationshipProfile_businessUnitId_idx" ON "RelationshipProfile"("businessUnitId");

-- CreateIndex
CREATE INDEX "RelationshipSignal_profileId_state_idx" ON "RelationshipSignal"("profileId", "state");
