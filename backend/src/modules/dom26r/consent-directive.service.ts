import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Dom26rAuditService } from './dom26r-audit.service';
import { MemoryTopic, ConsentChannel, ConsentStatus } from '@prisma/client';

interface CreateConsentInput {
  subjectId: string;
  destinationBusinessId?: string;
  dataCategory: MemoryTopic;
  purpose: string;
  channel: ConsentChannel;
  noticeVersion: string;
  effectiveDate: Date;
  expirationDate?: Date;
}

@Injectable()
export class ConsentDirectiveService {
  constructor(
    private prisma: PrismaService,
    private audit: Dom26rAuditService,
  ) {}

  /** A Business Unit may only originate consent on its own behalf. Sharing TO
   * another business is the one place cross-BU reference is legitimate.
   *
   * A Business Unit may only RECORD consent for a subject it already has a
   * relationship with (a RelationshipProfile). Without this check, any
   * authenticated caller could fabricate a GRANTED consent directive for a
   * person their Business Unit has never actually interacted with -- a
   * forged compliance record, not a data leak, but just as dangerous the
   * moment anything (e.g. isSharingAllowed) acts on it. */
  async create(
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    correlationId: string,
    input: CreateConsentInput,
  ) {
    const profile = await this.prisma.relationshipProfile.findUnique({
      where: {
        subjectId_businessUnitId: {
          subjectId: input.subjectId,
          businessUnitId,
        },
      },
    });
    if (!profile) {
      throw new BadRequestException(
        'No relationship exists between this Business Unit and this subject; consent cannot be recorded for an unrelated person',
      );
    }

    const directive = await this.prisma.consentDirective.create({
      data: {
        subjectId: input.subjectId,
        originatingBusinessId: businessUnitId,
        destinationBusinessId: input.destinationBusinessId,
        dataCategory: input.dataCategory,
        purpose: input.purpose,
        channel: input.channel,
        noticeVersion: input.noticeVersion,
        effectiveDate: input.effectiveDate,
        expirationDate: input.expirationDate,
        status: ConsentStatus.GRANTED,
      },
    });

    await this.audit.record({
      organizationId,
      businessUnitId,
      actorId,
      action: 'CONSENT_GRANT',
      purpose: input.purpose,
      outcome: 'SUCCESS',
      correlationId,
      metadata: {
        subjectId: input.subjectId,
        destinationBusinessId: input.destinationBusinessId,
      },
    });

    return directive;
  }

  async findAll(businessUnitId: string) {
    return this.prisma.consentDirective.findMany({
      where: {
        OR: [
          { originatingBusinessId: businessUnitId },
          { destinationBusinessId: businessUnitId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async withdraw(
    organizationId: string,
    businessUnitId: string,
    id: string,
    actorId: string,
    correlationId: string,
  ) {
    const directive = await this.prisma.consentDirective.findFirst({
      where: { id, originatingBusinessId: businessUnitId },
    });
    if (!directive) {
      throw new NotFoundException(
        'Consent directive not found for this Business Unit',
      );
    }
    if (directive.status === ConsentStatus.WITHDRAWN) {
      throw new ForbiddenException('Consent directive already withdrawn');
    }

    const updated = await this.prisma.consentDirective.update({
      where: { id: directive.id },
      data: {
        withdrawn: true,
        withdrawnAt: new Date(),
        status: ConsentStatus.WITHDRAWN,
      },
    });

    await this.audit.record({
      organizationId,
      businessUnitId,
      actorId,
      action: 'CONSENT_WITHDRAW',
      purpose: 'SUBJECT_REQUEST',
      outcome: 'SUCCESS',
      correlationId,
      metadata: { subjectId: directive.subjectId },
    });

    return updated;
  }

  /** Denied by default: only an unexpired, non-withdrawn GRANTED directive permits sharing. */
  async isSharingAllowed(
    businessUnitId: string,
    subjectId: string,
    dataCategory: MemoryTopic,
  ) {
    const directive = await this.prisma.consentDirective.findFirst({
      where: {
        subjectId,
        originatingBusinessId: businessUnitId,
        dataCategory,
        status: ConsentStatus.GRANTED,
        withdrawn: false,
        OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
      },
    });
    return Boolean(directive);
  }
}
