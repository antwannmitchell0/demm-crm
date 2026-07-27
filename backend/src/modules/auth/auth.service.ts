import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Role } from '@prisma/client';
import { redactAuditPayload } from '../../common/utils/audit-redactor';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async register(data: {
    email: string;
    passwordPlain: string;
    firstName: string;
    lastName: string;
    workspaceName: string;
    subdomain: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(data.passwordPlain, saltRounds);

    const organization = await this.prisma.organization.create({
      data: {
        name: `${data.firstName}'s Organization`,
      },
    });

    const workspace = await this.prisma.workspace.create({
      data: {
        name: data.workspaceName,
        subdomain: data.subdomain,
        organizationId: organization.id,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });

    await this.prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        workspaceId: workspace.id,
        role: Role.ORG_OWNER,
        permissions: ['*'],
      },
    });

    // Account creation is a security-relevant event -- log it the same way
    // agent.service.ts logs tool executions. Password is stripped by
    // redactAuditPayload before it ever reaches the audit table.
    await this.prisma.auditLog.create({
      data: {
        actorType: 'USER',
        actorId: user.id,
        action: 'register',
        payload: redactAuditPayload(data),
        workspaceId: workspace.id,
        userId: user.id,
      },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      workspaceId: workspace.id,
      organizationId: organization.id,
    };
  }

  // 1. Initial login: returns user info + accessible workspaces
  async login(data: { email: string; passwordPlain: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          include: { workspace: true, organization: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(data.passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const availableWorkspaces = user.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      workspaceName: m.workspace?.name || 'Organization Level',
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
    }));

    // Short-lived, single-purpose token proving the caller just presented
    // a correct password for THIS user. selectWorkspace() requires it and
    // derives userId from it -- it never trusts a userId supplied in the
    // request body. Without this, select-workspace was a full account
    // takeover: anyone who learned any user's id (e.g. from a register()
    // response) could mint that user's real access + refresh tokens with
    // no credentials at all.
    const preAuthToken = this.jwtService.sign(
      { sub: user.id, purpose: 'workspace-selection' },
      { expiresIn: '5m' },
    );

    return {
      message: 'Login successful. Please select a workspace context.',
      preAuthToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      workspaces: availableWorkspaces,
    };
  }

  // 2. Select workspace & generate Access (15m) + Refresh (7d) tokens.
  // `preAuthToken` must be the token minted by login() above -- it is the
  // only source of truth for who the caller is here, never a client-
  // supplied userId.
  async selectWorkspace(preAuthToken: string, workspaceId: string) {
    let preAuthPayload: { sub: string; purpose: string };
    try {
      preAuthPayload = this.jwtService.verify(preAuthToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired pre-auth token');
    }
    if (preAuthPayload.purpose !== 'workspace-selection') {
      throw new UnauthorizedException('Invalid pre-auth token');
    }

    return this.issueTokensForMembership(preAuthPayload.sub, workspaceId);
  }

  // Issues real access/refresh tokens for an ALREADY-VERIFIED (userId,
  // workspaceId) pair -- callers must have independently proven the caller
  // is that user (selectWorkspace via preAuthToken; refreshToken via a
  // possessed, hashed, unexpired refresh token). Never call this with a
  // client-supplied userId that hasn't been through one of those checks.
  private async issueTokensForMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, workspaceId },
      include: { user: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'Access Denied: User is not a member of this workspace',
      );
    }

    const accessTokenPayload = {
      sub: membership.userId,
      email: membership.user.email,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const accessToken = this.jwtService.sign(accessTokenPayload, {
      expiresIn: '15m',
    });
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedToken = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        hashedToken,
        userId,
        workspaceId,
        expiresAt,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      token_type: 'Bearer',
      expires_in: 900, // 15 minutes
      user: {
        id: membership.userId,
        email: membership.user.email,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        role: membership.role,
        workspaceId: membership.workspaceId,
      },
    };
  }

  /**
   * Handles a refresh token that is KNOWN to this system but was already
   * revoked -- i.e. someone presented a token that rotation had retired.
   *
   * The legitimate holder discards a token the moment it is exchanged, so a
   * replay is evidence that a copy exists somewhere it should not. The response
   * is to end every live session for that account, forcing re-authentication.
   *
   * Ordering is deliberate and security-first: revocation is committed BEFORE
   * the audit write and independently of it. If auditing were bundled into the
   * same transaction, a failed audit would roll back the revocation and leave a
   * suspected-stolen session alive -- trading a real security action for a
   * bookkeeping one. The audit is therefore best-effort, consistent with the
   * Phase 0 position already documented in agent.service.ts, and Phase 5's
   * transactional outbox is what makes the pair atomic.
   */
  private async handleSuspectedTokenReuse(stored: {
    userId: string;
    workspaceId: string | null;
  }) {
    // Same shape as logoutAll(): scoped to THIS user only. An unknown token can
    // never reach here, so no caller can revoke a stranger's sessions.
    const revocation = await this.prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revoked: false },
      data: { revoked: true },
    });

    // AuditLog.workspaceId is a required FK, while RefreshToken.workspaceId is
    // nullable. A token minted by issueTokensForMembership always carries one,
    // but if it is somehow absent the event is skipped rather than attributed
    // to a fabricated workspace.
    if (!stored.workspaceId) return;

    try {
      await this.prisma.auditLog.create({
        data: {
          // SYSTEM, not USER: the system detected this. We cannot know whether
          // the legitimate account holder or a thief presented the token, so
          // the account is recorded as AFFECTED, never as the actor-in-fault.
          actorType: 'SYSTEM',
          actorId: stored.userId,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          // No token, no token hash, no credentials, no secrets, no
          // infrastructure detail -- only the security outcome.
          payload: redactAuditPayload({
            reason: 'ROTATED_REFRESH_TOKEN_REPLAYED',
            outcome: 'ALL_ACTIVE_SESSIONS_REVOKED',
            affectedUserId: stored.userId,
            revokedActiveTokenCount: revocation.count,
          }),
          workspaceId: stored.workspaceId,
          userId: stored.userId,
        },
      });
    } catch (error: unknown) {
      // Never let an audit failure undo or mask the revocation above, and never
      // let it change the 401 the caller receives. Surface it instead of
      // swallowing it silently.
      console.error(
        'REFRESH_TOKEN_REUSE_DETECTED audit write failed; sessions were still revoked:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // 3. Rotate Refresh Token
  async refreshToken(rawRefreshToken: string) {
    const hashedToken = this.hashToken(rawRefreshToken);
    // Deliberately NOT filtered by `revoked`/`expiresAt`. The row must be read
    // in whatever state it is in, because telling "this token never existed"
    // apart from "this token existed and was rotated away" is the entire basis
    // of replay detection. Lookup stays keyed on the SHA-256 hash; no plaintext
    // token is ever stored or queried.
    const stored = await this.prisma.refreshToken.findUnique({
      where: { hashedToken },
    });

    // Every branch below returns the SAME message. Distinguishing them to the
    // caller would turn this endpoint into an oracle for which tokens once
    // existed.

    // STATE 1 -- UNKNOWN. No owner can be established, so no user-scoped action
    // is safe: reacting here would let anyone revoke a victim's sessions by
    // posting random strings.
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // STATE 2 -- KNOWN but already REVOKED: suspected reuse after rotation.
    if (stored.revoked) {
      await this.handleSuspectedTokenReuse(stored);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // STATE 3 -- KNOWN and unrevoked but EXPIRED: ordinary lifecycle end, not
    // evidence of theft. Existing behaviour is preserved unchanged.
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // STATE 4 -- valid AT READ TIME. That is not the same as "still valid", so
    // the rotation below is a conditional CLAIM rather than a plain update.
    //
    // WHY (Phase 0C-R). The previous code read the row, then issued an
    // unconditional `update` keyed only on `id`. Two requests carrying the same
    // token could both pass the read (both saw revoked=false), both "succeed"
    // at the write, and both mint a session. Measured against real PostgreSQL
    // with 8 concurrent callers: 8 succeeded and 8 live tokens existed
    // afterwards. One refresh token amplified into N sessions.
    //
    // `WHERE id = ? AND revoked = false` makes the database the arbiter:
    // exactly one caller can transition the row, and `count` tells us whether
    // we were that caller.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revoked: false },
      data: { revoked: true },
    });

    if (claim.count !== 1) {
      // We lost the race: the row was unrevoked when we read it and revoked by
      // the time we wrote, a window only concurrent use can produce.
      //
      // Deliberately NOT treated as suspected theft. A thief holding a stolen
      // token has no reason to race the victim -- presenting it alone succeeds
      // uncontested -- so losing a claim is evidence of concurrency, not of
      // compromise. The real theft signal is presenting a token that was
      // ALREADY rotated away, which STATE 2 above still catches and still
      // answers with full family revocation.
      //
      // Revoking here instead would kill the winner's brand-new session too,
      // logging out a legitimate user whose second tab merely refreshed at the
      // same moment, while giving an attacker nothing they could not already do.
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // From here the claim is ours and the old token is spent.

    if (!stored.workspaceId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Possession of a valid, unexpired, unrevoked refresh token already IS
    // proof of identity -- no pre-auth token needed here. Membership is still
    // re-verified inside issueTokensForMembership, so access removed after the
    // token was minted stops working immediately.
    try {
      return await this.issueTokensForMembership(
        stored.userId,
        stored.workspaceId,
      );
    } catch (error: unknown) {
      // A membership that no longer exists must not answer differently from any
      // other refusal. The old ForbiddenException ("User is not a member of
      // this workspace") confirmed to the caller that the token itself was
      // otherwise valid -- an oracle. Only that case is converted; anything
      // else (a real database fault) propagates untouched so it cannot be
      // silently swallowed as an auth failure.
      if (error instanceof ForbiddenException) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      throw error;
    }
  }

  // 4. Logout single session
  async logout(rawRefreshToken: string) {
    const hashedToken = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { hashedToken },
      data: { revoked: true },
    });
    return { status: 'SUCCESS', message: 'Logged out successfully.' };
  }

  // 5. Logout all devices
  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    return { status: 'SUCCESS', message: 'Logged out of all sessions.' };
  }
}
