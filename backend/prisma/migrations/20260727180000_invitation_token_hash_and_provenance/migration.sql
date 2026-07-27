-- Invitation: hash the token at rest, record provenance, allow revocation.
--
-- WHY THE TOKEN IS HASHED
--
-- An invitation token is a bearer credential: whoever holds it joins a
-- workspace with the role the invitation names. Stored in plaintext, any read
-- of this table -- a backup, a support query, a logged statement -- hands over
-- every pending invitation. It is now stored as SHA-256, exactly like
-- RefreshToken.hashedToken.
--
-- NO DATA IS DELETED. An earlier draft of this migration ran
-- `DELETE FROM "Invitation"` on the reasoning that a plaintext token could not
-- become a hash and stay verifiable. That reasoning was WRONG. The RECIPIENT
-- holds the raw token; the server hashes whatever is presented at acceptance
-- and compares it against the stored hash. Hashing the existing plaintext
-- column in place therefore preserves every invitation exactly -- links already
-- sitting in people's inboxes keep working across the migration.
--
-- WHY sha256() AND NOT pgcrypto's digest()
--
-- `sha256(bytea)` is built into PostgreSQL 11+ and needs no extension, so this
-- cannot fail on a managed instance where CREATE EXTENSION requires privileges
-- the migration role does not hold. Verified against the application's own hash
-- before this was written:
--
--   psql:  SELECT encode(sha256('sample-token-abc'::bytea),'hex')
--   node:  crypto.createHash('sha256').update('sample-token-abc').digest('hex')
--   both:  38237eac08c3e071bf183dca2941b8a5396e95e5fa93c2869bd1d2548c3d5013

-- Step 1. Add the new column NULLABLE, so the backfill has somewhere to land.
ALTER TABLE "Invitation" ADD COLUMN "tokenHash" TEXT;

-- Step 2. Backfill from the plaintext column. `convert_to(...,'UTF8')` makes the
-- text-to-bytea conversion explicit rather than leaving it to the database's
-- client encoding, so the digest is identical regardless of server settings.
UPDATE "Invitation"
SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "tokenHash" IS NULL;

-- Step 3. Only now is NOT NULL safe. If the backfill missed a row this fails
-- loudly HERE, while the plaintext column still exists and the value is still
-- recoverable.
ALTER TABLE "Invitation" ALTER COLUMN "tokenHash" SET NOT NULL;

-- Step 4. Uniqueness. "token" was already unique, so equal hashes are
-- impossible; this can only fail if the backfill were wrong.
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- Step 5. Provenance. Without these, an invitation that granted access leaves
-- no record of who authorised it or who consumed it.
ALTER TABLE "Invitation"
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedById" TEXT,
  ADD COLUMN "invitedById" TEXT;

-- SET NULL rather than CASCADE: deleting the administrator who issued an
-- invitation must not delete the record that the invitation existed.
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 6. The plaintext token goes LAST, after every dependent structure is in
-- place and verified. Dropping it earlier would make a failure at any later
-- step unrecoverable.
DROP INDEX "Invitation_token_key";
ALTER TABLE "Invitation" DROP COLUMN "token";

-- Step 7. Supporting indexes: the administrator's pending list, and the
-- duplicate check performed before issuing a new invitation.
CREATE INDEX "Invitation_workspaceId_status_idx" ON "Invitation"("workspaceId", "status");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- Step 8. REVOKED is distinct from EXPIRED on purpose: expiry is the passage of
-- time, revocation is a decision by an administrator, and an audit cannot tell
-- them apart if both collapse to one value.
--
-- Last because ALTER TYPE ... ADD VALUE carries transaction restrictions on
-- older PostgreSQL. Nothing above depends on it and the new value is not USED
-- here, only declared.
ALTER TYPE "InvitationStatus" ADD VALUE 'REVOKED';
