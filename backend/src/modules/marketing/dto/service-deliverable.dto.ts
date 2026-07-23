import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
} from 'class-validator';
import {
  ServiceDeliverableStatus,
  ServiceDeliverableCadence,
} from '@prisma/client';

export class UpdateDeliverableDto {
  @IsOptional()
  @IsEnum(ServiceDeliverableStatus)
  status?: ServiceDeliverableStatus;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsString()
  blockerReason?: string;

  @IsOptional()
  @IsDateString()
  clientApprovedAt?: string;

  // Added for the Marketing Dashboard's "overdue service deliverables" KPI.
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CreateOutsideScopeDeliverableDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ServiceDeliverableCadence)
  cadence: ServiceDeliverableCadence;

  @IsOptional()
  @IsString()
  cadenceDetail?: string;
}
