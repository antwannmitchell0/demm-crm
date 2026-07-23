import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { ClientHealthState } from '@prisma/client';

export class OverrideHealthDto {
  @IsEnum(ClientHealthState)
  state: ClientHealthState;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
