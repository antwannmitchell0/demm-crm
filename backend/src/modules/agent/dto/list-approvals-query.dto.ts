import { ApprovalStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Query string of `GET /agent/approvals`.
 *
 * Bound as a DTO so the global ValidationPipe runs on it. Without this an
 * unrecognised `?status=BANANA` would reach Prisma as a filter value and either
 * throw a 500 or -- worse -- be dropped, returning the FULL list while the
 * caller believes they are looking at a filtered one. An approval queue that
 * silently ignores its own filter is exactly the kind of thing an operator
 * trusts and should not.
 */
export class ListApprovalsQueryDto {
  @IsOptional()
  @IsEnum(ApprovalStatus, {
    message: `status must be one of ${Object.values(ApprovalStatus).join(', ')}`,
  })
  status?: ApprovalStatus;
}
