import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * The invitation-acceptance capability.
 *
 * WHY A SEPARATE STRATEGY AND NOT A WIDER JwtAuthGuard
 *
 * A person invited to their first workspace holds no membership, so
 * issueTokensForMembership() will not mint them a session -- they can never
 * satisfy JwtAuthGuard. The obvious fix, letting JwtAuthGuard through without a
 * workspace, would hand every workspace-less caller a general-purpose bearer
 * token good against every guarded route in the application.
 *
 * This is the narrow alternative. The capability authorizes ONE operation on
 * ONE named invitation and nothing else. It is a separate passport strategy, so
 * the two token classes cannot be confused for each other: JwtStrategy rejects
 * anything carrying a `purpose` (see jwt.strategy.ts), and this one rejects
 * anything that is not exactly an invitation-acceptance capability.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not read the database. validate() returns the two identifiers the
 * token itself asserts, and the service re-reads and re-authorizes both. A
 * capability is a claim to be checked, not a conclusion.
 *
 * It carries no role, workspace or email claim -- adding one would create a
 * second, unverified source of truth for an authorization decision the service
 * already makes from the invitation row.
 */
@Injectable()
export class InvitationCapabilityStrategy extends PassportStrategy(
  Strategy,
  'invitation-capability',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  validate(payload: {
    sub?: string;
    tokenType?: string;
    purpose?: string;
    invitationId?: string;
  }) {
    // Every condition is required. A token that is merely signed by us is not a
    // capability -- an access token, a workspace-selection token and a
    // capability all carry the same signature.
    if (
      payload.tokenType !== 'pre-session' ||
      payload.purpose !== 'invitation-acceptance' ||
      typeof payload.sub !== 'string' ||
      typeof payload.invitationId !== 'string'
    ) {
      throw new UnauthorizedException('Invalid token');
    }

    return { userId: payload.sub, invitationId: payload.invitationId };
  }
}
