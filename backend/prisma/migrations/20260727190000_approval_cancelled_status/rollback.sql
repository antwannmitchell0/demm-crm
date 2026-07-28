-- Rollback for 20260727190000_approval_cancelled_status
--
-- ORDER MATTERS. Run step 1 BEFORE re-deploying the older application code.

-- Step 1 (REQUIRED IF ANY APPROVAL WAS CANCELLED).
-- Rolling back re-deploys code whose ApprovalStatus enum has no 'CANCELLED'
-- member. Prisma Client fails to deserialize a row holding an enum value it
-- does not know about, so any row left at 'CANCELLED' would break every read of
-- the AgentApproval table.
--
-- These rows collapse onto REJECTED, which is LOSSY IN MEANING: a request the
-- requester withdrew becomes indistinguishable from one an approver declined.
-- The distinction survives in the AuditLog 'APPROVAL_CANCELLED' rows, which are
-- not touched here. `resolvedById` stays NULL on those rows, which is the only
-- remaining signal that no approver acted.
UPDATE "AgentApproval" SET "status" = 'REJECTED' WHERE "status" = 'CANCELLED';

-- Step 2 (NOT PERFORMED -- read this before assuming the rollback is complete).
-- PostgreSQL cannot remove a value from an enum type. 'CANCELLED' remains a
-- member of "ApprovalStatus". That is harmless: step 1 guarantees no row
-- carries it and the rolled-back code never writes it. Removing it would
-- require recreating the type and every column using it, which is larger and
-- riskier than the problem justifies.
