-- Pure index rollback: zero data loss risk. Dropping any of these only
-- reverts affected queries to a sequential scan, never breaks correctness.
DROP INDEX IF EXISTS "CandidateEvidence_sourceId_idx";
DROP INDEX IF EXISTS "ConsentDirective_subjectId_originatingBusinessId_status_idx";
DROP INDEX IF EXISTS "ConsentDirective_destinationBusinessId_idx";
DROP INDEX IF EXISTS "ConsentDirective_expirationDate_idx";
DROP INDEX IF EXISTS "Engram_businessUnitId_state_idx";
DROP INDEX IF EXISTS "Engram_profileId_state_idx";
DROP INDEX IF EXISTS "Engram_businessUnitId_truthClassification_idx";
DROP INDEX IF EXISTS "Engram_businessUnitId_expiresAt_idx";
DROP INDEX IF EXISTS "EngramEvidence_sourceId_idx";
DROP INDEX IF EXISTS "MemoryAuditEvent_engramId_createdAt_idx";
DROP INDEX IF EXISTS "MemoryAuditEvent_candidateId_createdAt_idx";
DROP INDEX IF EXISTS "MemoryAuditEvent_profileId_createdAt_idx";
DROP INDEX IF EXISTS "MemoryAuditEvent_businessUnitId_createdAt_idx";
DROP INDEX IF EXISTS "MemoryAuditEvent_correlationId_idx";
DROP INDEX IF EXISTS "MemoryCandidate_profileId_status_idx";
DROP INDEX IF EXISTS "RelationshipProfile_businessUnitId_idx";
DROP INDEX IF EXISTS "RelationshipSignal_profileId_state_idx";
