import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authorizes a caller holding an invitation-acceptance capability.
 *
 * Deliberately NOT composed with JwtAuthGuard. The two accept disjoint token
 * classes -- JwtStrategy refuses anything carrying a `purpose`, and
 * InvitationCapabilityStrategy refuses anything without the right one -- so a
 * route wearing this guard cannot also be reached with an ordinary session, and
 * a session route cannot be reached with a capability.
 */
@Injectable()
export class InvitationCapabilityGuard extends AuthGuard(
  'invitation-capability',
) {}
