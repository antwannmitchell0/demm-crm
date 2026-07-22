import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';

/**
 * A lead is a Contact + acquisition Opportunity + a "Follow up" Task created
 * together (see LeadService.createLead). Company is optional -- either an
 * existing Company is referenced (`companyId`) or a new one is found/created
 * by name (`companyName`), or neither is supplied and the Contact is created
 * without a company (e.g. an individual/consumer lead).
 */
export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsArray()
  @IsString({ each: true })
  emails: string[];

  @IsArray()
  @IsString({ each: true })
  phones: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  companyName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  companyId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  source?: string;

  /**
   * Temp qualification context used when the Company is unknown -- also used
   * as the `industry` on a newly find-or-created Company when `companyName`
   * is supplied without an existing `companyId` (see Opportunity.industryContext
   * schema comment).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  industryContext?: string;

  @IsString()
  @IsNotEmpty()
  pipelineId: string;

  @IsString()
  @IsNotEmpty()
  stageId: string;

  @IsNumber()
  @Min(0)
  expectedValue: number;
}
