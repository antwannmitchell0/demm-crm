import {
  Injectable,
  NotFoundException,
  ForbiddenException,
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
  Prisma,
} from '@prisma/client';

/**
 * Either the top-level PrismaService or a caller's own transaction client.
 * Passing `tx` lets Task 7's atomic Lead->Client conversion create the
 * conversion-fact engram in the SAME transaction as the rest of the
 * conversion, instead of opening a second, independently-committable one.
 */
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

interface CreateEngramInput {
  subjectType: SubjectType;
  subjectRefId: string;
  form: MemoryForm;
  topic: MemoryTopic;
  truthClassification: TruthClassification;
  sensitivity?: SensitivityClassification;
  summary: string;
  structuredContent?: any;
  sources: Array<{ type: SourceType; referenceId?: string; actorId?: string }>;
}

@Injectable()
export class EngramService {
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
    input: CreateEngramInput,
    tx?: Prisma.TransactionClient,
  ) {
    const profile = await this.profiles.getOrCreateProfile(
      businessUnitId,
      input.subjectType,
      input.subjectRefId,
    );

    const runCreate = async (client: PrismaClientLike) => {
      const created = await client.engram.create({
        data: {
          profileId: profile.id,
          organizationId,
          businessUnitId,
          workspaceId: workspaceId || undefined,
          form: input.form,
          topic: input.topic,
          truthClassification: input.truthClassification,
          sensitivity: input.sensitivity || SensitivityClassification.INTERNAL,
          summary: input.summary,
          structuredContent: input.structuredContent,
          state: 'ACTIVE',
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
        await client.engramEvidence.create({
          data: { engramId: created.id, sourceId: source.id },
        });
      }

      return client.engram.findUniqueOrThrow({
        where: { id: created.id },
        include: { evidence: { include: { source: true } } },
      });
    };

    const engram = tx
      ? await runCreate(tx)
      : await this.prisma.$transaction((t) => runCreate(t));

    await this.audit.record(
      {
        organizationId,
        businessUnitId,
        workspaceId,
        profileId: profile.id,
        engramId: engram.id,
        actorId,
        action: 'ENGRAM_CREATE',
        purpose: 'MEMORY_CAPTURE',
        outcome: 'SUCCESS',
        correlationId,
        metadata: { sourceCount: input.sources.length },
      },
      tx,
    );

    return engram;
  }

  async findAll(businessUnitId: string, profileId?: string) {
    return this.prisma.engram.findMany({
      where: {
        businessUnitId,
        ...(profileId ? { profileId } : {}),
        state: { not: 'DELETED' },
      },
      include: { evidence: { include: { source: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdScoped(businessUnitId: string, id: string) {
    const engram = await this.prisma.engram.findFirst({
      where: { id, businessUnitId },
      include: { evidence: { include: { source: true } }, corrections: true },
    });
    if (!engram)
      throw new NotFoundException('Engram not found in this Business Unit');
    return engram;
  }

  async correct(
    businessUnitId: string,
    id: string,
    actorId: string,
    correlationId: string,
    correctedSummary: string,
    correctedContent: any,
    reason: string,
  ) {
    const engram = await this.findByIdScoped(businessUnitId, id);

    if (engram.state === 'DELETED') {
      // A forgotten engram's redaction is the guarantee, not a draft state --
      // "correcting" it would silently un-redact private content and defeat
      // the right-to-be-forgotten workflow.
      throw new ForbiddenException(
        'This engram has been forgotten and cannot be corrected',
      );
    }

    const [correction, updated] = await this.prisma.$transaction([
      this.prisma.memoryCorrection.create({
        data: {
          engramId: engram.id,
          previousSummary: engram.summary,
          previousContent: engram.structuredContent ?? undefined,
          correctedSummary,
          correctedContent,
          actorId,
          reason,
        },
      }),
      this.prisma.engram.update({
        where: { id: engram.id },
        data: {
          summary: correctedSummary,
          structuredContent: correctedContent,
          lastConfirmedAt: new Date(),
        },
      }),
    ]);

    await this.audit.record({
      organizationId: engram.organizationId,
      businessUnitId,
      workspaceId: engram.workspaceId,
      profileId: engram.profileId,
      engramId: engram.id,
      actorId,
      action: 'ENGRAM_CORRECT',
      purpose: reason,
      outcome: 'SUCCESS',
      correlationId,
      metadata: { correctionId: correction.id },
    });

    return updated;
  }

  /** Customer right-to-be-forgotten: wipes private content, keeps an audit tombstone. */
  async forget(
    businessUnitId: string,
    id: string,
    actorId: string,
    correlationId: string,
  ) {
    const engram = await this.findByIdScoped(businessUnitId, id);

    const redacted = await this.prisma.engram.update({
      where: { id: engram.id },
      data: {
        summary: 'REDACTED / FORGOTTEN',
        structuredContent: null as any,
        state: 'DELETED',
      },
    });

    await this.audit.record({
      organizationId: engram.organizationId,
      businessUnitId,
      workspaceId: engram.workspaceId,
      profileId: engram.profileId,
      engramId: engram.id,
      actorId,
      action: 'SUPPRESSION_FORGET',
      purpose: 'CUSTOMER_RIGHT_TO_BE_FORGOTTEN',
      outcome: 'SUCCESS',
      correlationId,
      metadata: { status: 'DELETED' },
    });

    return redacted;
  }
}
