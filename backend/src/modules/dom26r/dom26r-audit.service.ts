import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Either the top-level PrismaService or a caller's own transaction client.
 * When a caller passes their `tx`, the audit write commits/rolls back
 * together with the rest of their transaction -- otherwise a rollback after
 * the audit write already landed would leave a false "SUCCESS" audit event
 * for a mutation that never actually happened, which the append-only audit
 * doctrine cannot tolerate.
 */
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

interface AuditParams {
  organizationId: string;
  businessUnitId: string;
  workspaceId?: string | null;
  profileId?: string;
  engramId?: string;
  candidateId?: string;
  actorId?: string;
  action: string;
  purpose: string;
  outcome: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class Dom26rAuditService {
  constructor(private prisma: PrismaService) {}

  async record(params: AuditParams, client: PrismaClientLike = this.prisma) {
    return client.memoryAuditEvent.create({
      data: {
        organizationId: params.organizationId,
        businessUnitId: params.businessUnitId,
        workspaceId: params.workspaceId || undefined,
        profileId: params.profileId,
        engramId: params.engramId,
        candidateId: params.candidateId,
        actorType: params.actorId ? 'USER' : 'AGENT',
        actorId: params.actorId,
        action: params.action,
        purpose: params.purpose,
        outcome: params.outcome,
        correlationId: params.correlationId,
        metadata: params.metadata as any,
      },
    });
  }
}
