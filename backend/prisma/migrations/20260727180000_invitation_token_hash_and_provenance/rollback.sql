-- Rollback for 20260727180000_invitation_token_hash_and_provenance
--
-- THE FORWARD MIGRATION IS NOT LOSSLESS AND THIS ROLLBACK CANNOT MAKE IT SO.
--
-- Forward, "Invitation"."token" (plaintext) was dropped and replaced by
-- "tokenHash" (SHA-256). A hash cannot be reversed, so no rollback can restore
-- a working plaintext token for any invitation issued after the forward
-- migration ran. Those invitations are unusable once rolled back and must be
-- re-issued by an administrator after rolling forward again.
--
-- Every invitation row is therefore DELETED below rather than left in a state
-- where "token" holds a placeholder that no recipient's link will ever match.
-- A row that looks valid but can never be accepted is worse than no row: it
-- appears in the administrator's pending list and never resolves.
--
-- ORDER MATTERS. Run the steps in sequence.

-- Step 1 (REQUIRED). Remove rows before dropping the column they depend on.
-- Also removes any row at status 'REVOKED': rolling back re-deploys code whose
-- InvitationStatus enum has no such member, and Prisma Client fails to
-- deserialize a row holding an enum value it does not know about, which would
-- break every read of this table.
DELETE FROM "Invitation";

-- Step 2. Drop the foreign keys added forward.
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_acceptedById_fkey";
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_invitedById_fkey";

-- Step 3. Drop the indexes added forward.
DROP INDEX IF EXISTS "Invitation_email_idx";
DROP INDEX IF EXISTS "Invitation_workspaceId_status_idx";
DROP INDEX IF EXISTS "Invitation_tokenHash_key";

-- Step 4. Restore the original column shape.
ALTER TABLE "Invitation" DROP COLUMN IF EXISTS "tokenHash",
DROP COLUMN IF EXISTS "invitedById",
DROP COLUMN IF EXISTS "acceptedById",
DROP COLUMN IF EXISTS "acceptedAt",
ADD COLUMN     "token" TEXT NOT NULL;

CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- Step 5 (NOT PERFORMED -- read this before assuming the rollback is complete).
-- PostgreSQL cannot remove a value from an enum type. 'REVOKED' remains a
-- member of "InvitationStatus" after this rollback. That is harmless: step 1
-- guarantees no row carries it, and the rolled-back application code never
-- writes it. Fully removing it would require recreating the type and every
-- column that uses it, which is a larger and riskier operation than the
-- problem justifies.
