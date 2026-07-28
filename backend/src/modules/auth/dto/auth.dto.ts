import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  passwordPlain: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsNotEmpty()
  workspaceName: string;

  @IsString()
  @IsNotEmpty()
  subdomain: string;
}

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  passwordPlain: string;
}

export class SelectWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  workspaceId: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

/**
 * Body of `POST /api/auth/switch-workspace`.
 *
 * Both fields are required. `workspaceId` is the workspace to move INTO and is
 * untrusted: the service resolves it against the caller's memberships and
 * answers a non-member with the same generic 401 as any other failure, so this
 * cannot be used to probe which workspace ids exist.
 */
export class SwitchWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;

  @IsString()
  @IsNotEmpty()
  workspaceId: string;
}

/**
 * Exchanging possession of an invitation link for a capability.
 *
 * The RAW TOKEN IS THE ONLY FIELD. Who the caller is comes from the pre-session
 * token in the Authorization header, and which invitation is being accepted is
 * resolved from the token hash -- never from the body. With
 * `forbidNonWhitelisted`, a request that tries to supply a userId, invitationId,
 * role, workspaceId or email is rejected outright rather than having those
 * fields quietly ignored, so an attempt to steer the decision is visible as a
 * 400 instead of passing silently.
 */
export class MintInvitationCapabilityDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

/**
 * Creating an account BECAUSE you were invited.
 *
 * No workspaceName and no subdomain, unlike RegisterDto -- the whole point is
 * that this person is joining an existing workspace, not founding one. Those
 * two fields are what make ordinary registration create an Organization and a
 * Workspace, so their absence here is the contract, not an omission.
 */
export class RegisterInvitedDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  passwordPlain: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;
}
