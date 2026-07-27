-- RefreshToken.revokedAt: tell a concurrent presentation apart from a replay.
--
-- Rotation revokes a token and issues a successor. A second browser tab sharing
-- the same httpOnly cookie can present the old token milliseconds later, and
-- that is legitimate. Without knowing WHEN the row was revoked, that case is
-- indistinguishable from a thief replaying a stolen token -- so the account gets
-- signed out of every device over ordinary multi-tab use.
--
-- Observed intermittently in the workspace-switching suite before this existed:
-- eight concurrent switches occasionally finished with ZERO live tokens,
-- because one late arrival read the already-revoked row, classified it as
-- theft, and revoked the whole family including the winner's new session.
--
-- Purely additive and nullable. Rows revoked before this column existed keep
-- NULL and are still treated as theft, so the behaviour change fails closed.
ALTER TABLE "RefreshToken" ADD COLUMN "revokedAt" TIMESTAMP(3);

-- Supports the "is this revocation recent?" lookup on the replay path.
CREATE INDEX "RefreshToken_userId_revoked_idx" ON "RefreshToken"("userId", "revoked");
