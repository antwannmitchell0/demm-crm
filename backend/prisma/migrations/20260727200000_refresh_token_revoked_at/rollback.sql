-- Rollback for 20260727200000_refresh_token_revoked_at
--
-- Fully reversible with no data loss of consequence. The column is advisory:
-- it records WHEN a revocation happened and is read only to decide whether a
-- presented-but-revoked token is a benign concurrent retry or a replay.
--
-- WHAT ROLLING BACK COSTS: the grace window disappears, so two browser tabs
-- refreshing milliseconds apart are once again both classified as theft and the
-- account is signed out everywhere. That is the pre-existing behaviour, not a
-- new fault, but it will be user-visible as intermittent unexplained logouts.
--
-- No row is deleted and no session is affected by running this.
DROP INDEX IF EXISTS "RefreshToken_userId_revoked_idx";
ALTER TABLE "RefreshToken" DROP COLUMN IF EXISTS "revokedAt";
