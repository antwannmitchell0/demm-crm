import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    workspaceId?: string;
    tokenType?: string;
    purpose?: string;
  }) {
    // TOKEN CLASS ENFORCEMENT.
    //
    // This strategy used to check only the signature, the expiry, and that the
    // subject existed. Every pre-session credential is signed with the SAME
    // secret and carries a valid `sub`, so it satisfied all three and passed
    // JwtAuthGuard on ordinary routes. Measured before this guard existed, a
    // five-minute `workspace-selection` token -- issued BEFORE any
    // password-verified session -- returned HTTP 200 on /api/auth/memberships,
    // /team/members, /team/invitations, /agent/tools, /agent/approvals and
    // /contacts.
    //
    // A signature proves who MINTED a token, never what it is FOR. Purpose has
    // to be checked explicitly, and it has to be checked here: adding a second
    // guard per route would mean every future route is insecure until somebody
    // remembers to add it.
    if (payload.purpose) {
      throw new UnauthorizedException('Invalid token');
    }

    // LEGACY ALLOWANCE -- REMOVE AFTER 2026-08-04.
    //
    // `tokenType` is required going forward. `undefined` is accepted only for
    // access tokens minted by the build that shipped before the claim existed.
    // They carry no `purpose`, so the check above already covers the dangerous
    // case, and they expire 15 minutes after the last old instance stops
    // serving.
    //
    // The removal is dated, not "eventually": staging deploys 2026-07-28, so
    // any legacy token is dead by 2026-07-28 + 15 minutes. The date above
    // leaves a week of margin and is the point at which this branch and its
    // two test assertions (test-token-purpose.ts, 19c) are deleted and the
    // condition becomes `payload.tokenType !== 'access'`.
    //
    // Leaving it indefinitely would mean a token class with no declared type
    // is permanently valid, which is the same "absence of a claim is an
    // answer" mistake this whole change exists to remove.
    if (payload.tokenType !== undefined && payload.tokenType !== 'access') {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    // The workspace the user authenticated into (set by selectWorkspace/
    // refreshToken, and only after verifying real membership at issuance
    // time). WorkspaceGuard treats this as a fallback when no per-request
    // x-workspace-id header is sent -- it is re-validated against current
    // membership state on every request, never trusted blindly.
    return { ...user, tokenWorkspaceId: payload.workspaceId };
  }
}
