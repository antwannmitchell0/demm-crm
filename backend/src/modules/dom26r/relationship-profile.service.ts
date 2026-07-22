import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SubjectType } from '@prisma/client';

@Injectable()
export class RelationshipProfileService {
  constructor(private prisma: PrismaService) {}

  /**
   * Finds or creates the RelationshipSubject + RelationshipProfile for a
   * given Contact/Company within a Business Unit. Profiles are per-subject,
   * per-Business-Unit by design (RelationshipProfile @@unique([subjectId,
   * businessUnitId])) so the same person never blends memory across
   * businesses without going through ConsentDirective.
   */
  async getOrCreateProfile(
    businessUnitId: string,
    subjectType: SubjectType,
    subjectRefId: string,
  ) {
    const subject = await this.getOrCreateSubject(subjectType, subjectRefId);

    const existing = await this.prisma.relationshipProfile.findUnique({
      where: {
        subjectId_businessUnitId: {
          subjectId: subject.id,
          businessUnitId,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.relationshipProfile.create({
      data: { subjectId: subject.id, businessUnitId },
    });
  }

  private async getOrCreateSubject(
    subjectType: SubjectType,
    subjectRefId: string,
  ) {
    if (subjectType === SubjectType.CONTACT) {
      const existing = await this.prisma.relationshipSubject.findUnique({
        where: { contactId: subjectRefId },
      });
      if (existing) return existing;
      return this.prisma.relationshipSubject.create({
        data: { type: subjectType, contactId: subjectRefId },
      });
    }

    if (subjectType === SubjectType.COMPANY) {
      const existing = await this.prisma.relationshipSubject.findUnique({
        where: { companyId: subjectRefId },
      });
      if (existing) return existing;
      return this.prisma.relationshipSubject.create({
        data: { type: subjectType, companyId: subjectRefId },
      });
    }

    throw new BadRequestException(
      `Unsupported subject type: ${String(subjectType)}`,
    );
  }

  async findProfileScoped(businessUnitId: string, profileId: string) {
    return this.prisma.relationshipProfile.findFirst({
      where: { id: profileId, businessUnitId },
    });
  }
}
