import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { GRANTABLE_ROLES } from '../role-hierarchy';

/**
 * `@IsIn(GRANTABLE_ROLES)` rather than `@IsEnum(Role)`.
 *
 * The Role enum contains SUPERADMIN and AGENT. SUPERADMIN crosses organization
 * boundaries, so granting it from inside one workspace would let a workspace
 * administrator escape their own tenant; AGENT is a machine identity the
 * approval path treats specially, not a seat a person occupies. Validating
 * against the enum would accept both and leave the refusal entirely to the
 * service. Rejecting them here means they never reach it.
 */
export class InviteMemberDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(320)
  email: string;

  @IsIn(GRANTABLE_ROLES as Role[], {
    message: `role must be one of ${GRANTABLE_ROLES.join(', ')}`,
  })
  role: Role;
}

export class ChangeRoleDto {
  @IsIn(GRANTABLE_ROLES as Role[], {
    message: `role must be one of ${GRANTABLE_ROLES.join(', ')}`,
  })
  role: Role;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(32, { message: 'That invitation link is not valid.' })
  @MaxLength(200)
  token: string;
}
