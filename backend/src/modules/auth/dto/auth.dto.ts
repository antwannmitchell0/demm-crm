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
