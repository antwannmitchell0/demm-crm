import { IsString, IsNotEmpty } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  subdomain: string;

  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
