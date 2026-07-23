import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsIn,
  Matches,
} from 'class-validator';

const MANUAL_STATE_PATTERN = /^[A-Z][A-Z_]*_MANUAL$/;

export class RecordCommercialStateChangeDto {
  @IsString()
  @IsIn(['CONTRACT', 'PAYMENT'])
  field: 'CONTRACT' | 'PAYMENT';

  @IsString()
  @IsNotEmpty()
  @Matches(MANUAL_STATE_PATTERN, {
    message:
      'newValue must be uppercase and end in _MANUAL (e.g. FULL_PAID_MANUAL)',
  })
  newValue: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}
