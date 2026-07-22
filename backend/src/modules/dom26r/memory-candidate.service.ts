import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Dom26rAuditService } from './dom26r-audit.service';
import { RelationshipProfileService } from './relationship-profile.service';
import {
  MemoryForm,
  MemoryTopic,
  TruthClassification,
  SensitivityClassification,
  SourceType,
  SubjectType,
  CandidateState,
  Prisma,
} from '@prisma/client';

/**
 * Either the top-level PrismaService or a caller's own transaction client.
 * Passing `tx` lets a caller (e.g. Task 7's conversion flow) create a
 * candidate in the SAME transaction as the rest of its work.
 */
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

interface CreateCandidateInput {
  subjectType: SubjectType;
  subjectRefId: string;
  form: MemoryForm;
  topic: MemoryTopic;
  proposedTruth: TruthClassification;
  confidence: number;
  sensitivity: SensitivityClassification;
  consentBasis: string;
  summary: string;
  content?: any;
  sources: Array<{ type: SourceType; referenceId?: string; actorId?: string }>;
}

@Injectable()
export class MemoryCandidateService {
  constructor(
    private prisma: PrismaService,
    private audit: Dom26rAuditService,
    private profiles: RelationshipProfileService,
  ) {}

  async create(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    input: CreateCandidateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const profile = await this.profiles.getOrCreateProfile(
      businessUnitId,
      input.subjectType,
      input.subjectRefId,
    );

    const runCreate = async (client: PrismaClientLike) => {
      const created = await client.memoryCandidate.create({
        data: {
          profileId: profile.id,
          organizationId,
          workspaceId: workspaceId || undefined,
          form: input.form,
          topic: input.topic,
          proposedTruth: input.proposedTruth,
          confidence: input.confidence,
          sensitivity: input.sensitivity,
          consentBasis: input.consentBasis,
          summary: input.summary,
          content: input.content,
          status: CandidateState.PENDING,
        },
      });

      for (const src of input.sources) {
        const source = await client.engramSource.create({
          data: {
            type: src.type,
            referenceId: src.referenceId,
            actorId: src.actorId,
          },
        });
        await client.candidateEvidence.create({
          data: { candidateId: created.id, sourceId: source.id },
        });
      }

      return client.memoryCandidate.findUniqueOrThrow({
        where: { id: created.id },
        include: { evidence: { include: { source: true } } },
      });
    };

    const candidate = tx
      ? await runCreate(tx)
      : await this.prisma.$transaction((t) => runCreate(t));

    await this.audit.record(
      {
        organizationId,
        businessUnitId,
        workspaceId,
        profileId: profile.id,
        candidateId: candidate.id,
        actorId,
        action: 'CANDIDATE_CREATE',
        purpose: 'MEMORY_PROPOSAL',
        outcome: 'SUCCESS',
        correlationId,
        metadata: { sourceCount: input.sources.length },
      },
      tx,
    );

    return candidate;
  }

  async findAll(businessUnitId: string, status?: CandidateState) {
    return this.prisma.memoryCandidate.findMany({
      where: {
        profile: { businessUnitId },
        ...(status ? { status } : {}),
      },
      include: { evidence: { include: { source: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdScoped(businessUnitId: string, id: string) {
    const candidate = await this.prisma.memoryCandidate.findFirst({
      where: { id, profile: { businessUnitId } },
      include: { evidence: { include: { source: true } } },
    });
    if (!candidate) {
      throw new NotFoundException(
        'Memory candidate not found in this Business Unit',
      );
    }
    return candidate;
  }

  /** Promotes an approved candidate into a durable Engram, carrying forward all evidence sources. */
  async approve(
    businessUnitId: string,
    id: string,
    actorId: string,
    correlationId: string,
  ) {
    const candidate = await this.findByIdScoped(businessUnitId, id);
    if (candidate.status !== CandidateState.PENDING) {
      throw new BadRequestException(`Candidate is already ${candidate.status}`);
    }

    const engram = await this.prisma.$transaction(async (tx) => {
      await tx.memoryApproval.create({
        data: {
          candidateId: candidate.id,
          status: CandidateState.APPROVED,
          resolvedById: actorId,
        },
      });
      await tx.memoryCandidate.update({
        where: { id: candidate.id },
        data: { status: CandidateState.APPROVED },
      });

      const created = await tx.engram.create({
        data: {
          profileId: candidate.profileId,
          organizationId: candidate.organizationId,
          businessUnitId,
          workspaceId: candidate.workspaceId || undefined,
          form: candidate.form,
          topic: candidate.topic,
          truthClassification: candidate.proposedTruth,
          sensitivity: candidate.sensitivity,
          summary: candidate.summary,
          structuredContent: candidate.content ?? undefined,
          state: 'ACTIVE',
        },
      });

      for (const ev of candidate.evidence) {
        await tx.engramEvidence.create({
          data: { engramId: created.id, sourceId: ev.sourceId },
        });
      }

      return created;
    });

    await this.audit.record({
      organizationId: candidate.organizationId,
      businessUnitId,
      workspaceId: candidate.workspaceId,
      profileId: candidate.profileId,
      candidateId: candidate.id,
      engramId: engram.id,
      actorId,
      action: 'CANDIDATE_APPROVE_PROMOTE',
      purpose: 'MEMORY_PROMOTION',
      outcome: 'SUCCESS',
      correlationId,
      metadata: { evidenceCount: candidate.evidence.length },
    });

    return engram;
  }

  async reject(
    businessUnitId: string,
    id: string,
    actorId: string,
    reason: string,
    correlationId: string,
  ) {
    const candidate = await this.findByIdScoped(businessUnitId, id);
    if (candidate.status !== CandidateState.PENDING) {
      throw new BadRequestException(`Candidate is already ${candidate.status}`);
    }

    await this.prisma.$transaction([
      this.prisma.memoryApproval.create({
        data: {
          candidateId: candidate.id,
          status: CandidateState.REJECTED,
          resolvedById: actorId,
        },
      }),
      this.prisma.memoryCandidate.update({
        where: { id: candidate.id },
        data: { status: CandidateState.REJECTED },
      }),
    ]);

    await this.audit.record({
      organizationId: candidate.organizationId,
      businessUnitId,
      workspaceId: candidate.workspaceId,
      profileId: candidate.profileId,
      candidateId: candidate.id,
      actorId,
      action: 'CANDIDATE_REJECT',
      purpose: reason,
      outcome: 'SUCCESS',
      correlationId,
    });

    return { id: candidate.id, status: CandidateState.REJECTED };
  }
}
