import { IsEnum } from 'class-validator';

/**
 * The only two decisions that may resolve a staged high-risk approval.
 *
 * This exists as a RUNTIME enum, not a TypeScript union, because the union
 * `'APPROVE' | 'REJECT'` is erased at compile time and validated nothing at the
 * HTTP boundary. The service treats REJECT as one branch and routes every other
 * value through the APPROVE path, so before this type existed a misspelled
 * action ("APROVE") silently approved a high-risk action and returned 201.
 */
export enum ApprovalResolutionAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ResolveApprovalDto {
  /**
   * `@IsEnum` performs an exact membership test, so it rejects misspellings,
   * different casing, whitespace-padded values, empty strings, numbers,
   * booleans, objects, arrays, null and a missing property alike. Combined with
   * the global ValidationPipe's `whitelist` + `forbidNonWhitelisted`, an
   * unknown extra body property is rejected too rather than silently stripped.
   */
  @IsEnum(ApprovalResolutionAction, {
    message: "action must be exactly 'APPROVE' or 'REJECT'",
  })
  action: ApprovalResolutionAction;
}
