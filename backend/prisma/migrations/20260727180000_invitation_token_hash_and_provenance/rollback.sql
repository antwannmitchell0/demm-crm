-- Rollback for 20260727180000_invitation_token_hash_and_provenance
--
-- THIS ROLLBACK LOSES THE TOKENS AND CANNOT DO OTHERWISE.
--
-- Forward is non-destructive: "token" is hashed into "tokenHash" and every row
-- survives, so links already in people's inboxes keep working. Backward is not
-- symmetrical, because SHA-256 cannot be reversed. Restoring a plaintext
-- "token" COLUMN is possible; restoring the VALUES in it is not.
--
-- The rows are therefore KEPT and their tokens invalidated, rather than the
-- rows being deleted. An administrator can still see who was invited, to what,
-- by whom, and when -- and can re-issue. Deleting would destroy that record as
-- well as the credential: strictly more loss than necessary.
--
-- ORDER MATTERS. Run the steps in sequence.

-- Step 1 (REQUIRED). Restore the column, nullable, before anything is written.
ALTER TABLE "Invitation" ADD COLUMN "token" TEXT;

-- Step 2. Give every row a unique, unusable placeholder. The 'rolled-back:'
-- prefix makes these obvious in any inspection, and gen_random_uuid() is built
-- into PostgreSQL 13+ so no extension is required. The value is deliberately
-- NOT derivable from anything a recipient holds, so no old link can match it.
UPDATE "Invitation"
SET "token" = 'rolled-back:' || gen_random_uuid()::text
WHERE "token" IS NULL;

ALTER TABLE "Invitation" ALTER COLUMN "token" SET NOT NULL;
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- Step 3 (REQUIRED). Move every still-open invitation to a terminal state.
-- Two reasons, both load-bearing:
--   a) its placeholder token can never be accepted, so leaving it PENDING would
--      show the administrator a queue item that can never resolve;
--   b) rolling back re-deploys code whose InvitationStatus enum has no
--      'REVOKED' member, and Prisma Client fails to deserialize a row holding
--      an enum value it does not know about -- breaking every read of this
--      table.
-- EXPIRED is the closest pre-existing terminal state. Lossy in MEANING: a
-- revoked invitation becomes indistinguishable from a lapsed one. The
-- distinction survives in AuditLog 'team.invitation.revoked' rows, untouched here.
UPDATE "Invitation" SET "status" = 'EXPIRED'
WHERE "status" IN ('PENDING', 'REVOKED');

-- Step 4. Drop the forward structures.
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_acceptedById_fkey";
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_invitedById_fkey";
DROP INDEX IF EXISTS "Invitation_email_idx";
DROP INDEX IF EXISTS "Invitation_workspaceId_status_idx";
DROP INDEX IF EXISTS "Invitation_tokenHash_key";
ALTER TABLE "Invitation"
  DROP COLUMN IF EXISTS "tokenHash",
  DROP COLUMN IF EXISTS "invitedById",
  DROP COLUMN IF EXISTS "acceptedById",
  DROP COLUMN IF EXISTS "acceptedAt";

-- Step 5 (NOT PERFORMED -- read this before assuming the rollback is complete).
-- PostgreSQL cannot remove a value from an enum type, so 'REVOKED' remains a
-- member of "InvitationStatus". Harmless: step 3 guarantees no row carries it
-- and the rolled-back application never writes it. Removing it would require
-- recreating the type and every column using it -- larger and riskier than the
-- problem justifies.
--
-- AFTER ROLLING BACK: every outstanding invitation must be re-issued. Tell the
-- affected people; their existing links are dead.
