import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Dom26rAuditService } from './dom26r-audit.service';
import { SensitivityClassification } from '@prisma/client';

interface GenerateBriefInput {
  profileId: string;
  briefText: string;
  generator: string;
  version: string;
  sensitivity: SensitivityClassification;
  engramIds: string[];
}

type BriefVisibility = 'INTERNAL_AGENT' | 'CUSTOMER_VISIBLE';

@Injectable()
export class RelationshipBriefService {
  constructor(
    private prisma: PrismaService,
    private audit: Dom26rAuditService,
  ) {}

  async generate(
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    correlationId: string,
    input: GenerateBriefInput,
  ) {
    const profile = await this.prisma.relationshipProfile.findFirst({
      where: { id: input.profileId, businessUnitId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Relationship profile not found in this Business Unit',
      );
    }

    // Every engram cited as evidence must belong to the SAME profile as the
    // brief -- not merely the same Business Unit. Without this, a brief about
    // one person could cite another person's memory just because they share
    // a Business Unit, which is a real cross-person data leak, not a
    // Business Unit boundary issue.
    const engrams = await this.prisma.engram.findMany({
      where: {
        id: { in: input.engramIds },
        businessUnitId,
        profileId: profile.id,
      },
    });
    if (engrams.length !== input.engramIds.length) {
      throw new ForbiddenException(
        'One or more evidence engrams are outside this Business Unit or belong to a different relationship profile',
      );
    }

    const brief = await this.prisma.$transaction(async (tx) => {
      const created = await tx.relationshipBrief.create({
        data: {
          profileId: profile.id,
          briefText: input.briefText,
          generator: input.generator,
          version: input.version,
          sensitivity: input.sensitivity,
        },
      });
      for (const engramId of input.engramIds) {
        await tx.briefEvidence.create({
          data: { briefId: created.id, engramId },
        });
      }
      return created;
    });

    await this.audit.record({
      organizationId,
      businessUnitId,
      profileId: profile.id,
      actorId,
      action: 'BRIEF_GENERATE',
      purpose: 'RELATIONSHIP_SUMMARY',
      outcome: 'SUCCESS',
      correlationId,
      metadata: { evidenceCount: input.engramIds.length },
    });

    return brief;
  }

  async findAll(businessUnitId: string, profileId?: string) {
    return this.prisma.relationshipBrief.findMany({
      where: {
        profile: { businessUnitId },
        ...(profileId ? { profileId } : {}),
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  /** Internal view returns full provenance/metadata; customer view returns
   * only the brief text — sensitivity classification, generator, version,
   * and evidence chain never leave the internal boundary. */
  async getFormatted(
    businessUnitId: string,
    id: string,
    visibility: BriefVisibility,
  ) {
    const brief = await this.prisma.relationshipBrief.findFirst({
      where: { id, profile: { businessUnitId } },
      include: { evidence: true },
    });
    if (!brief)
      throw new NotFoundException('Brief not found in this Business Unit');

    if (visibility === 'CUSTOMER_VISIBLE') {
      if (brief.sensitivity !== SensitivityClassification.PUBLIC) {
        throw new ForbiddenException(
          'This brief is not classified for customer visibility',
        );
      }
      return { briefText: brief.briefText, generatedAt: brief.generatedAt };
    }

    return brief;
  }
}
