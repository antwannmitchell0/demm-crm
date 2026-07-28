import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Role, InvitationStatus } from '@prisma/client';
import { redactAuditPayload } from '../../common/utils/audit-redactor';

/**
 * Both outcomes are successes. CREATED means this call made the account;
 * ALREADY_REGISTERED means an earlier call did and this one verified the
 * caller owns it. The caller continues to invitation acceptance either way,
 * which is what makes a lost response recoverable by pressing the button
 * again.
 */
export interface InvitedRegistrationResult {
  outcome: 'CREATED' | 'ALREADY_REGISTERED';
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

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

  /**
   * Creates an account for somebody holding an invitation link.
   *
   * CREATES A USER ROW AND NOTHING ELSE. register() also creates an
   * Organization, a Workspace and an ORG_OWNER membership, which is right for
   * somebody founding their own company and wrong for somebody joining one:
   * every invited person would end up owning an empty organization they never
   * asked for, cannot use, and cannot leave -- and would then appear in billing
   * and tenant counts as a customer.
   *
   * It grants NO membership either. Registering proves who you are; accepting
   * the invitation is a separate, auditable act, and collapsing the two would
   * mean an account came into existence already inside somebody\'s workspace.
   *
   * Possession of the link is necessary but not sufficient: the address being
   * registered must be the one the invitation was issued to, so a forwarded
   * link cannot be redeemed by whoever receives it.
   */
  async registerInvited(data: {
    token: string;
    email: string;
    passwordPlain: string;
    firstName: string;
    lastName: string;
  }): Promise<InvitedRegistrationResult> {
    const normalizedEmail = data.email.trim().toLowerCase();

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.hashToken(data.token) },
    });

    // ONE message for every "this link is not usable by you" case: no such
    // invitation, issued to a different address, withdrawn, or already spent
    // by somebody else. Distinguishing them would let the holder of a stray
    // link learn which addresses are real accounts and which invitations exist.
    if (!invitation || invitation.email !== normalizedEmail) {
      throw new NotFoundException('Invitation not found.');
    }

    // REVOKED is checked, not assumed. Before this, an invitation an
    // administrator had explicitly withdrawn still created an account --
    // revocation that does not stop the thing it revokes is worse than no
    // revocation, because it is believed.
    if (invitation.status === InvitationStatus.REVOKED) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired.');
    }

    // IDEMPOTENT RETRY, evaluated before anything is written.
    //
    // The account may already exist because the previous attempt committed and
    // its HTTP response was lost, or because the recipient double-submitted.
    // Answering "User with this email already exists" was true, useless, and a
    // dead end: their account existed and they had no way forward.
    //
    // Proving the password is what makes this safe to answer. Without it this
    // endpoint would confirm, to anybody holding a link, whether a given
    // address has an account.
    const already = await this.resolveExistingRegistration(
      normalizedEmail,
      data.passwordPlain,
    );
    if (already) return already;

    // ORDER MATTERS. This is checked only AFTER the retry path above, and only
    // when no account exists.
    //
    // An ACCEPTED invitation is legitimate for exactly one person: the one
    // already registered against it, retrying. For anybody else it is spent,
    // and creating an account against it would produce a login that can never
    // join anything -- a dead account the product would then have to explain.
    // Checking status first would have broken the retry; checking it here
    // would have been skipped entirely if placed after the write.
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is no longer valid.');
    }

    // Hashing is deliberately OUTSIDE the transaction: bcrypt at cost 10 takes
    // tens of milliseconds, and holding a write transaction open across it
    // would serialise unrelated registrations behind it.
    const passwordHash = await bcrypt.hash(data.passwordPlain, 10);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the invitation may have been revoked
        // between the checks above and here.
        const current = await tx.invitation.findUnique({
          where: { id: invitation.id },
        });
        if (!current || current.status === InvitationStatus.REVOKED) {
          throw new NotFoundException('Invitation not found.');
        }

        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        });

        // Attributed to the workspace that invited them -- the account has no
        // workspace of its own, and an administrator there is who needs to see
        // it. redactAuditPayload strips the password and the raw token.
        //
        // In the SAME transaction as the user on purpose. Separately, a failed
        // audit insert left an account behind whose origin nothing recorded.
        await tx.auditLog.create({
          data: {
            actorType: 'USER',
            actorId: user.id,
            action: 'register-invited',
            payload: redactAuditPayload(data),
            workspaceId: current.workspaceId,
            userId: user.id,
          },
        });

        return {
          outcome: 'CREATED' as const,
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        };
      });
    } catch (error: unknown) {
      // A concurrent submission won the race between the existence check above
      // and this insert. That is not an error the caller did anything about,
      // and the raw P2002 would surface as a 500 carrying a Prisma error code
      // and a constraint name.
      //
      // Re-entering resolves it through the idempotent path: the winner's row
      // now exists, so the password is checked and ALREADY_REGISTERED is
      // returned. Exactly one call reports CREATED.
      if (this.isUniqueEmailConflict(error)) {
        const winner = await this.resolveExistingRegistration(
          normalizedEmail,
          data.passwordPlain,
        );
        if (winner) return winner;
        // The row that caused the conflict is not resolvable as this caller's
        // account. Nothing actionable to report, and the Prisma code must not
        // escape.
        throw new BadRequestException('That account could not be created.');
      }
      throw error;
    }
  }

  /**
   * The truthful answer when the account already exists.
   *
   * Reached two ways: the recipient re-submitted after a lost response, or a
   * concurrent submission won the insert race. Both are the same situation
   * from the caller's side, so both get the same answer.
   *
   * Proving the password is what makes it safe to answer at all -- without it
   * this endpoint would confirm to anybody holding a link whether a given
   * address has an account. Returns null when no such account exists.
   */
  private async resolveExistingRegistration(
    normalizedEmail: string,
    passwordPlain: string,
  ): Promise<InvitedRegistrationResult | null> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!existingUser) return null;

    const matches = await bcrypt.compare(
      passwordPlain,
      existingUser.passwordHash,
    );
    if (!matches) {
      // Deliberately the same message login() gives. It must not reveal that
      // the address exists, nor that it was previously registered here.
      throw new UnauthorizedException('Invalid email or password');
    }

    // Nothing is rewritten -- not the password, not the name, not roles, not
    // memberships. A retry reports what is already true and lets the caller
    // continue to acceptance.
    return {
      outcome: 'ALREADY_REGISTERED',
      userId: existingUser.id,
      email: existingUser.email,
      firstName: existingUser.firstName,
      lastName: existingUser.lastName,
    };
  }

  /**
   * A unique-constraint violation on User.email, whatever wrapper it arrives
   * in. Matched on the code rather than the message: Prisma's phrasing has
   * changed across versions, and the adapter can rethrow it wrapped.
   */
  private isUniqueEmailConflict(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    if (code !== 'P2002' && code !== '23505') return false;
    const target = (error as { meta?: { target?: unknown } })?.meta?.target;
    const fields = Array.isArray(target)
      ? target.join(',')
      : String(target ?? '');
    // An empty target still counts: the only unique constraint this statement
    // can violate is the email one.
    return fields === '' || fields.toLowerCase().includes('email');
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
      {
        sub: user.id,
        tokenType: 'pre-session',
        purpose: 'workspace-selection',
      },
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
    let preAuthPayload: {
      sub: string;
      purpose?: string;
      tokenType?: string;
    };
    try {
      preAuthPayload = this.jwtService.verify(preAuthToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired pre-auth token');
    }
    // BOTH claims, not just purpose. A token's class and its errand are
    // separate facts, and checking only the errand would accept anything that
    // happened to carry the right purpose string -- including a future token
    // class that reuses it. This is the mirror of the check JwtStrategy makes.
    if (
      preAuthPayload.tokenType !== 'pre-session' ||
      preAuthPayload.purpose !== 'workspace-selection'
    ) {
      throw new UnauthorizedException('Invalid pre-auth token');
    }

    return this.issueTokensForMembership(preAuthPayload.sub, workspaceId);
  }

  /**
   * Exchanges (proof of password) + (possession of the invitation link) for a
   * capability that authorizes accepting that ONE invitation.
   *
   * WHY THIS EXISTS. A person invited to their first workspace holds no
   * membership, so selectWorkspace() cannot mint them a session and the
   * ordinary accept endpoint is unreachable. The alternative -- a session
   * without a workspace -- would be a general-purpose bearer token for an
   * account that has not yet been granted access to anything.
   *
   * NOTHING HERE IS TAKEN FROM THE CALLER'S BODY. The user is whoever the
   * pre-session token says, which is only ever minted by login() against a
   * verified password. The invitation is whichever row the presented token
   * hashes to. A caller cannot name a different user, a different invitation,
   * a different role or a different workspace, because no such input is read.
   *
   * NO REFRESH-TOKEN ROW IS CREATED. This is not a session and must not
   * survive as one; the capability expires in two minutes, well inside the
   * five-minute ceiling, because the BFF consumes it in the next hop.
   */
  async mintInvitationCapability(preAuthToken: string, rawToken: string) {
    let payload: { sub: string; purpose?: string; tokenType?: string };
    try {
      payload = this.jwtService.verify(preAuthToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired pre-auth token');
    }
    if (
      payload.tokenType !== 'pre-session' ||
      payload.purpose !== 'workspace-selection'
    ) {
      throw new UnauthorizedException('Invalid pre-auth token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid pre-auth token');
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    // ONE message for "no such invitation" and "issued to somebody else".
    // Distinguishing them would confirm to the holder of a stray link that it
    // is a real invitation, and that the address it names is a real account.
    if (!invitation || invitation.email !== user.email.trim().toLowerCase()) {
      throw new NotFoundException('Invitation not found.');
    }

    // STATUS POLICY, stated explicitly because two of the four values are
    // allowed and the reason differs for each.
    //
    //   PENDING  -- the ordinary case.
    //   ACCEPTED -- allowed ONLY for the account that accepted it, and only so
    //               a retry can complete. The BFF chain is four hops; if the
    //               last one fails the caller must be able to run it again,
    //               and acceptance itself is idempotent, so re-minting grants
    //               nothing new. Anyone else gets the same 404 as a stray link.
    //   REVOKED  -- refused. An administrator withdrew it.
    //   EXPIRED  -- refused, as is any invitation past expiresAt regardless of
    //               the stored status, since the sweep to EXPIRED is lazy.
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired.');
    }
    if (
      invitation.status === InvitationStatus.REVOKED ||
      invitation.status === InvitationStatus.EXPIRED
    ) {
      throw new NotFoundException('Invitation not found.');
    }
    if (
      invitation.status === InvitationStatus.ACCEPTED &&
      invitation.acceptedById !== user.id
    ) {
      throw new NotFoundException('Invitation not found.');
    }

    return {
      capabilityToken: this.jwtService.sign(
        {
          sub: user.id,
          tokenType: 'pre-session',
          purpose: 'invitation-acceptance',
          invitationId: invitation.id,
        },
        { expiresIn: '2m' },
      ),
    };
  }

  // Issues real access/refresh tokens for an ALREADY-VERIFIED (userId,
  // workspaceId) pair -- callers must have independently proven the caller
  // is that user (selectWorkspace via preAuthToken; refreshToken via a
  // possessed, hashed, unexpired refresh token). Never call this with a
  // client-supplied userId that hasn't been through one of those checks.
  private async issueTokensForMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, workspaceId },
      // workspace/organization are joined so the session payload can NAME the
      // active workspace. It previously carried workspaceId and role only, so
      // after a refresh the sidebar had an id and nothing to display.
      include: { user: true, workspace: true, organization: true },
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
      // Explicit class. Without it, "is this a session token?" is answered by
      // the absence of other claims, which is not an answer.
      tokenType: 'access' as const,
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
        workspaceName: membership.workspace?.name ?? '',
        organizationName: membership.organization.name,
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
      data: { revoked: true, revokedAt: new Date() },
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
  /**
   * Consumes a presented refresh token atomically and returns the row it
   * claimed.
   *
   * Extracted so that rotation and workspace switching share ONE
   * implementation of replay detection, expiry handling and the concurrent
   * claim. Two copies of this logic would drift, and the half that drifted
   * would be the one an attacker uses.
   */
  /**
   * True when an already-revoked token was revoked SO RECENTLY that the caller
   * is almost certainly a legitimate second tab, not a thief.
   *
   * THE PROBLEM. Rotation revokes a token and issues a successor. The refresh
   * cookie is shared by every tab in the browser, so two tabs can present the
   * same token milliseconds apart. The first wins the claim; the second reads a
   * row that is now revoked and -- before this existed -- was answered with
   * full family revocation, signing the account out of every device. Measured:
   * eight concurrent workspace switches intermittently ended with ZERO live
   * tokens, the winner's brand-new session included.
   *
   * WHY A TIME WINDOW IS A SOUND DISCRIMINATOR, not just a convenient one.
   * To actually USE a stolen token an attacker must present it while it is
   * still live -- and that is STATE 4, where the atomic claim already decides a
   * single winner. Presenting an ALREADY-SPENT token gains an attacker nothing
   * whatever the response is; they get a 401 either way. So the only thing
   * suppressed inside this window is the family revocation, and the only
   * attacker it helps is one who has already failed. Meanwhile the case it
   * protects -- a legitimate racing tab -- is real, common, and otherwise
   * produces an unexplained logout.
   *
   * Outside the window, replay is still treated as theft and still revokes the
   * whole family. A `revokedAt` of NULL means the row predates this column, and
   * is treated as theft, so the change fails closed.
   */
  private isBenignConcurrentPresentation(
    stored: { revokedAt: Date | null },
    requestStartedAt: Date,
  ): boolean {
    if (!stored.revokedAt) return false;
    // CAUSAL, not durational. The question is not "was this recent?" but "was
    // this request already in flight when the rotation committed?" -- which is
    // precisely what makes a caller a concurrent loser rather than a replayer.
    return (
      requestStartedAt.getTime() <
      stored.revokedAt.getTime() + AuthService.CLOCK_SKEW_ALLOWANCE_MS
    );
  }

  /**
   * Tolerance for CLOCK SKEW ONLY -- not a grace period.
   *
   * WHAT THIS REPLACED, AND WHY. The first fix used a flat two-second window:
   * any presentation within 2s of revocation was benign. That closed the
   * multi-tab logout bug but opened a real hole, correctly identified in
   * review. Suppose an attacker steals a live token and WINS the claim. The
   * victim's next refresh presents a spent token, and that presentation is the
   * signal that detects the theft and kills every session -- including the
   * attacker's. A durational window suppresses that signal for anyone who
   * happens to arrive inside it, so an attacker who struck moments earlier kept
   * their session. Duration cannot tell the two cases apart, because "recent"
   * is not the property that distinguishes them.
   *
   * The property that DOES distinguish them is causal: a concurrent loser's
   * request was already in flight when the rotation committed; a replayer's
   * request began afterwards, presenting a token it should already have
   * discarded. So each caller now records when its request STARTED, before it
   * reads anything, and that instant is compared against the row's revokedAt:
   *
   *   requestStartedAt <  revokedAt  ->  in flight already   ->  concurrency
   *   requestStartedAt >= revokedAt  ->  began after the spend -> replay
   *
   * The attack above is now classified as theft however quickly the victim
   * refreshes, because the victim's request necessarily began after the
   * attacker's commit. And a legitimately slow tab is still benign however
   * long it takes, because it started first. Duration is no longer part of the
   * decision at all.
   *
   * This allowance exists only because the two timestamps can be produced by
   * different application instances behind a load balancer, whose clocks are
   * NTP-disciplined but not identical. It is sized for that and nothing else:
   * 250ms is orders of magnitude above observed inter-instance NTP skew, and
   * an attacker cannot exploit it without also winning a sub-250ms race that
   * the atomic claim already arbitrates.
   */
  private static readonly CLOCK_SKEW_ALLOWANCE_MS = 250;

  private async claimRefreshToken(
    rawRefreshToken: string,
    // Captured by the CALLER before any work begins. Taking it here would be
    // too late: the read below is what establishes whether the row was already
    // revoked, and the instant that matters is when the request entered the
    // system, not when it reached this line.
    requestStartedAt: Date,
  ) {
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

    // STATE 2 -- KNOWN but already REVOKED. Either a replay, or a legitimate
    // second tab that lost a race by a few milliseconds. Those two look
    // identical without a timestamp, and treating them alike signs a real user
    // out of every device for the crime of using two tabs.
    if (stored.revoked) {
      if (this.isBenignConcurrentPresentation(stored, requestStartedAt)) {
        // Refused, but NOT treated as theft: no family revocation. The caller
        // still receives the same generic 401 as every other failure, so this
        // branch is invisible from outside and cannot be probed.
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
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
      data: { revoked: true, revokedAt: new Date() },
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
    return stored;
  }

  /**
   * Issues a session for a claimed token, converting the one refusal that would
   * otherwise leak information.
   *
   * A membership that no longer exists must not answer differently from any
   * other refusal. The raw ForbiddenException ("User is not a member of this
   * workspace") confirms to the caller that the token itself was otherwise
   * valid -- an oracle. Only that case is converted; anything else (a real
   * database fault) propagates untouched so it cannot be silently swallowed as
   * an auth failure.
   */
  private async issueForClaimedToken(userId: string, workspaceId: string) {
    try {
      return await this.issueTokensForMembership(userId, workspaceId);
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      throw error;
    }
  }

  async refreshToken(rawRefreshToken: string, requestStartedAt = new Date()) {
    const stored = await this.claimRefreshToken(
      rawRefreshToken,
      requestStartedAt,
    );

    if (!stored.workspaceId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Possession of a valid, unexpired, unrevoked refresh token already IS
    // proof of identity -- no pre-auth token needed here. Membership is still
    // re-verified inside issueTokensForMembership, so access removed after the
    // token was minted stops working immediately.
    return this.issueForClaimedToken(stored.userId, stored.workspaceId);
  }

  /**
   * Moves an existing session into another workspace the SAME user belongs to,
   * without a password.
   *
   * Switching previously required a full re-authentication: the only route to a
   * second workspace was login() -> preAuthToken -> selectWorkspace(). That is
   * not a security property, it is a missing endpoint -- the user has already
   * proven who they are, and the authority that matters is the membership,
   * which is re-checked below.
   *
   * Built on the same claim as rotation rather than on the access token,
   * deliberately:
   *
   *  - the old session's refresh token is SPENT by switching, so a user cannot
   *    accumulate one live token per workspace they visit;
   *  - eight concurrent switches of one token produce one session, not eight;
   *  - replaying a spent token is still theft and still revokes the family.
   *
   * The target workspace is caller-supplied and therefore untrusted. It is not
   * validated here at all: issueTokensForMembership looks up
   * (userId, workspaceId) and refuses when no membership joins them, and that
   * refusal is converted to the same generic 401 as every other failure, so
   * this route cannot be used to probe which workspace ids exist.
   */
  async switchWorkspace(
    rawRefreshToken: string,
    targetWorkspaceId: string,
    requestStartedAt = new Date(),
  ) {
    const stored = await this.claimRefreshToken(
      rawRefreshToken,
      requestStartedAt,
    );
    return this.issueForClaimedToken(stored.userId, targetWorkspaceId);
  }

  /**
   * The workspaces the authenticated caller may enter.
   *
   * `userId` comes from the verified JWT subject in the controller, never from
   * a parameter or body, so one user cannot enumerate another's workspaces.
   * Before this existed the client learned its workspace list exactly once --
   * in the login response -- and had no way to ask again, which is why a picker
   * could only be shown immediately after a password.
   */
  async listMemberships(userId: string) {
    // `Membership.workspaceId` is nullable -- an organization-level membership
    // grants standing without naming a workspace. Those are excluded here
    // rather than rendered as "Organization Level" (which is what the login
    // response does): every entry this endpoint returns is meant to be a
    // switch target, and a row whose id is null cannot be switched into. A
    // picker showing an unusable option is worse than showing one fewer.
    const memberships = await this.prisma.membership.findMany({
      where: { userId, workspaceId: { not: null } },
      include: { workspace: true, organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      memberships: memberships.map((m) => ({
        workspaceId: m.workspaceId as string,
        workspaceName: m.workspace?.name ?? '',
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        role: m.role,
      })),
    };
  }

  // 4. Logout single session
  async logout(rawRefreshToken: string) {
    const hashedToken = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { hashedToken },
      data: { revoked: true, revokedAt: new Date() },
    });
    return { status: 'SUCCESS', message: 'Logged out successfully.' };
  }

  // 5. Logout all devices
  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
    return { status: 'SUCCESS', message: 'Logged out of all sessions.' };
  }
}
