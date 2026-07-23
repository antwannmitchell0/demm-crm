import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Matches,
} from 'class-validator';

/**
 * Contract/payment state is manually recorded until real Stripe/DocuSign
 * integrations exist (design doc "Known Limitations"). No fixed set of
 * values is specified anywhere in the governing docs -- only illustrative
 * examples ("SIGNED_MANUAL", "DEPOSIT_PAID_MANUAL") -- so this validates
 * the *shape* (uppercase, underscore-separated, `_MANUAL`-suffixed) rather
 * than a closed enum, keeping the `_MANUAL` suffix enforced in the data
 * itself rather than only in UI copy, without inventing a specific
 * business taxonomy that was never approved.
 */
const MANUAL_STATE_PATTERN = /^[A-Z][A-Z_]*_MANUAL$/;

export class ConvertLeadDto {
  @IsString()
  @IsNotEmpty()
  offerId: string;

  @IsOptional()
  @IsString()
  @Matches(MANUAL_STATE_PATTERN, {
    message:
      'contractState must be uppercase and end in _MANUAL (e.g. SIGNED_MANUAL)',
  })
  contractState?: string;

  @IsOptional()
  @IsString()
  @Matches(MANUAL_STATE_PATTERN, {
    message:
      'paymentState must be uppercase and end in _MANUAL (e.g. DEPOSIT_PAID_MANUAL)',
  })
  paymentState?: string;

  /**
   * The real dollar amount recorded alongside paymentState, if known --
   * e.g. a $99 deposit on a $299/mo plan. Optional and independent of
   * paymentState's presence: a state can be recorded without a dollar
   * figure (honest "we don't know the exact amount yet"), but an amount
   * without a state is meaningless, so the service only persists this
   * when paymentState is also supplied.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  paymentAmount?: number;

  /**
   * Overrides the Contact's existing companyId as the client entity, if
   * supplied. Must belong to the same workspace as the Contact being
   * converted (enforced in ClientAccountService.convert).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  companyId?: string;
}
