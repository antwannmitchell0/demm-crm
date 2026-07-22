import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
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
    const subject = await this.getOrCreateSubject(
      businessUnitId,
      subjectType,
      subjectRefId,
    );

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

  /**
   * A Contact/Company id is caller-supplied. Without validating it belongs to
   * a Workspace inside the CALLER's own Business Unit, any authenticated user
   * could link an arbitrary Contact/Company from a different Business Unit --
   * or a different Organization entirely -- into their own Relationship
   * Brain, permanently. This check is the only thing standing between
   * DOM26-R and that cross-tenant leak.
   */
  private async getOrCreateSubject(
    businessUnitId: string,
    subjectType: SubjectType,
    subjectRefId: string,
  ) {
    if (subjectType === SubjectType.CONTACT) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: subjectRefId, workspace: { businessUnitId } },
        select: { id: true },
      });
      if (!contact) {
        throw new ForbiddenException(
          'Contact does not belong to this Business Unit',
        );
      }

      const existing = await this.prisma.relationshipSubject.findUnique({
        where: { contactId: subjectRefId },
      });
      if (existing) return existing;
      return this.prisma.relationshipSubject.create({
        data: { type: subjectType, contactId: subjectRefId },
      });
    }

    if (subjectType === SubjectType.COMPANY) {
      const company = await this.prisma.company.findFirst({
        where: { id: subjectRefId, workspace: { businessUnitId } },
        select: { id: true },
      });
      if (!company) {
        throw new ForbiddenException(
          'Company does not belong to this Business Unit',
        );
      }

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
