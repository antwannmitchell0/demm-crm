import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  Min,
} from 'class-validator';
import { OfferLifecycleState } from '@prisma/client';

export class CreateOfferDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  setupFee?: number;

  @IsArray()
  @IsString({ each: true })
  includedServices: string[];

  @IsArray()
  @IsString({ each: true })
  excludedServices: string[];

  @IsArray()
  @IsString({ each: true })
  onboardingRequirements: string[];

  // Nullable by design (2026-07-23 Commercial Truth Lock): these four have
  // no confirmed answer for most tiers yet. Omitting them leaves the Offer
  // honestly "not yet defined" instead of forcing a fabricated promise.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  supportBoundaries?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reportingCadence?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cancellationTerms?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  expectedLaunchTime?: string;

  @IsOptional()
  @IsBoolean()
  isPubliclyAvailable?: boolean;
}

/**
 * All fields optional -- partial update. Which fields are "material" (trigger
 * a version bump when applied to an ACTIVE offer) vs safe to mutate in place
 * is decided in OfferService.update, not here; this DTO only validates shape.
 */
export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  setupFee?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includedServices?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedServices?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  onboardingRequirements?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  supportBoundaries?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reportingCadence?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cancellationTerms?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  expectedLaunchTime?: string;

  @IsOptional()
  @IsBoolean()
  isPubliclyAvailable?: boolean;
}

export class SetOfferLifecycleDto {
  @IsEnum(OfferLifecycleState)
  state: OfferLifecycleState;
}
