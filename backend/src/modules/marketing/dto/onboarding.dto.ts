import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChecklistItemStatus } from '@prisma/client';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsEnum(ChecklistItemStatus)
  status?: ChecklistItemStatus;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsObject()
  clientSubmission?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  blockerReason?: string;
}

export class ActivateOverrideDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ActivateClientDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ActivateOverrideDto)
  override?: ActivateOverrideDto;
}
