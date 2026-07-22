import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

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

  async record(params: AuditParams) {
    return this.prisma.memoryAuditEvent.create({
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
