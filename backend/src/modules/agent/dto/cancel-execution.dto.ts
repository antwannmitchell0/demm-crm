import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /agent/execute/cancel`.
 *
 * `cancelExecution` registers a pre-emptive abort for any session id it has not
 * seen, so an absent id previously registered an abort under the key
 * `undefined` and returned 201 CANCELLED. The caller was told a cancellation
 * succeeded when nothing had been cancelled, and the bogus entry stayed in the
 * in-memory map. Requiring a non-empty string closes that.
 */
export class CancelExecutionDto {
  @IsString({ message: 'sessionId must be a string' })
  @MinLength(1, { message: 'sessionId must not be empty' })
  @MaxLength(200)
  sessionId: string;
}
