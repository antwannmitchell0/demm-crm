-- Invitation: hash the token, record provenance, allow revocation.
--
-- WHY THE TOKEN COLUMN IS REPLACED RATHER THAN KEPT
--
-- An invitation token is a bearer credential: whoever holds it can join a
-- workspace with the role the invitation names. Storing it in plaintext means
-- any read of this table -- a backup, a support query, a logged statement --
-- hands over every pending invitation. It is now stored as a SHA-256 hash,
-- exactly like RefreshToken.hashedToken, and the raw value is shown to the
-- inviter once at creation and is not recoverable afterwards.
--
-- DATA LOSS, STATED PLAINLY: existing rows are deleted below. A plaintext
-- token cannot be migrated into a hash-only column and still be usable -- the
-- hash could be computed, but the recipient's copy would then be the only
-- plaintext in existence with no way to verify it was ever issued. Deleting is
-- honest: those invitations must be re-issued. This is safe here because no
-- code path in this repository has ever created an Invitation row (the model
-- existed with zero references), so the table is empty in every environment.
-- The DELETE is kept anyway so the migration is deterministic rather than
-- dependent on that claim being true.

DELETE FROM "Invitation";

-- AlterEnum
-- REVOKED is distinct from EXPIRED on purpose: expiry is the passage of time,
-- revocation is a decision by an administrator, and an audit cannot tell them
-- apart if both collapse to one value.
ALTER TYPE "InvitationStatus" ADD VALUE 'REVOKED';

-- DropIndex
DROP INDEX "Invitation_token_key";

-- AlterTable
ALTER TABLE "Invitation" DROP COLUMN "token",
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
-- Supports the administrator's "pending invitations for this workspace" list.
CREATE INDEX "Invitation_workspaceId_status_idx" ON "Invitation"("workspaceId", "status");

-- CreateIndex
-- Supports the duplicate check performed before issuing a new invitation.
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- AddForeignKey
-- SET NULL rather than CASCADE: deleting the administrator who issued an
-- invitation must not delete the record that the invitation existed.
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
