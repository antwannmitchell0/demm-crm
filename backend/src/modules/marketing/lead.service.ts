import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  Prisma,
  ContactStatus,
  OpportunityStatus,
  TaskStatus,
} from '@prisma/client';
import { CreateLeadDto } from './dto/lead.dto';

/**
 * Strips whitespace and lowercases an email so formatting differences
 * ("Foo@Bar.com " vs "foo@bar.com") don't defeat duplicate detection.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalizes a phone number so formatting differences don't defeat
 * duplicate detection. Strips all non-digits, then -- NANP/US-focused --
 * drops a leading country-code `1` from an 11-digit result so the same US
 * number matches whether it was entered with or without `+1`
 * ("+1 (555) 123-4567" and "555-123-4567" both -> "5551234567"). Deliberately
 * does not attempt to canonicalize other international formats.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

@Injectable()
export class LeadService {
  constructor(private prisma: PrismaService) {}

  /**
   * Mirrors ContactService/OpportunityService's relation-hijacking guard --
   * every foreign key on the new lead's Contact/Opportunity must belong to
   * the SAME workspace as the caller, never silently accepted from another
   * tenant.
   */
  private async validateRelations(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    relations: { companyId?: string; pipelineId?: string; stageId?: string },
  ) {
    if (relations.companyId) {
      const company = await tx.company.findFirst({
        where: { id: relations.companyId, workspaceId },
      });
      if (!company) {
        throw new ForbiddenException(
          'Relation violation: Company does not belong to this workspace',
        );
      }
    }

    if (relations.pipelineId) {
      const pipeline = await tx.pipeline.findFirst({
        where: { id: relations.pipelineId, workspaceId },
      });
      if (!pipeline) {
        throw new ForbiddenException(
          'Relation violation: Pipeline does not belong to this workspace',
        );
      }
    }

    if (relations.stageId) {
      const stage = await tx.stage.findFirst({
        where: { id: relations.stageId, pipeline: { workspaceId } },
      });
      if (!stage) {
        throw new ForbiddenException(
          'Relation violation: Stage does not belong to this workspace',
        );
      }
    }
  }

  /**
   * Leads are Contacts with status=LEAD that have NOT yet converted to a
   * ClientAccount. `Contact.clientAccounts` and `Company.clientAccounts`
   * are back-relation ARRAYS (not a singular optional relation) -- Prisma
   * requires a single-column unique for a true 1:1, which conflicts with
   * ClientAccount's deliberate `@@unique([businessUnitId, primaryContactId])`
   * scoping. So "already converted" is expressed as a relation-count filter
   * (`clientAccounts: { none: { businessUnitId } }`) rather than a null check.
   * Scoping the exclusion to the caller's businessUnitId (not just "any
   * ClientAccount at all") matches the schema: a BusinessUnit can have many
   * Workspaces, and ClientAccount itself is businessUnitId-scoped, so a
   * Contact converted under a DIFFERENT Business Unit should not silently
   * disappear from THIS Business Unit's lead list.
   */
  async findAllLeads(workspaceId: string, businessUnitId: string) {
    return this.prisma.contact.findMany({
      where: {
        workspaceId,
        status: ContactStatus.LEAD,
        clientAccounts: { none: { businessUnitId } },
      },
      include: {
        company: true,
        owner: true,
        tasks: {
          where: { status: TaskStatus.PENDING },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        opportunities: {
          where: { status: OpportunityStatus.OPEN },
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { stage: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Read-only, non-blocking duplicate check: scans the workspace's existing
   * Contacts for a normalized email/phone match. Runs OUTSIDE the creation
   * transaction (it's informational, not a constraint) and never throws --
   * the caller decides what "warn + allow" means for the response.
   *
   * This is a full workspace scan rather than an indexed lookup because
   * `emails`/`phones` are stored as raw, un-normalized string arrays; there
   * is no normalized column to query against directly. Acceptable at this
   * stage's scale -- revisit with a normalized/indexed column if workspace
   * contact volume becomes a performance concern.
   */
  private async findDuplicateContact(
    workspaceId: string,
    emails: string[],
    phones: string[],
  ) {
    const normalizedEmails = new Set(
      emails.map(normalizeEmail).filter((e) => e.length > 0),
    );
    const normalizedPhones = new Set(
      phones.map(normalizePhone).filter((p) => p.length > 0),
    );

    if (normalizedEmails.size === 0 && normalizedPhones.size === 0) {
      return null;
    }

    const candidates = await this.prisma.contact.findMany({
      where: { workspaceId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        emails: true,
        phones: true,
      },
    });

    return (
      candidates.find(
        (c) =>
          c.emails.some((e) => normalizedEmails.has(normalizeEmail(e))) ||
          c.phones.some((p) => normalizedPhones.has(normalizePhone(p))),
      ) ?? null
    );
  }

  /**
   * Creates a lead: an optional find-or-create Company, a Contact
   * (status=LEAD), the acquisition Opportunity (source/industryContext on
   * pipeline/stage), and the designated primary "Follow up" Task -- all in
   * one transaction so a partial lead never lands if any step fails.
   *
   * Duplicate detection is advisory only: a normalized-email/phone match
   * against an existing Contact in the workspace is surfaced via
   * `duplicateWarning` on the response, but creation proceeds regardless
   * (warn + allow, never block).
   */
  async createLead(workspaceId: string, dto: CreateLeadDto) {
    const duplicate = await this.findDuplicateContact(
      workspaceId,
      dto.emails,
      dto.phones,
    );
    const duplicateWarning = duplicate
      ? `Possible duplicate: matches existing contact ${duplicate.firstName} ${duplicate.lastName} (${duplicate.id}) by normalized email/phone`
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      await this.validateRelations(tx, workspaceId, {
        companyId: dto.companyId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
      });

      let companyId = dto.companyId;

      if (!companyId && dto.companyName) {
        const existingCompany = await tx.company.findFirst({
          where: {
            workspaceId,
            name: { equals: dto.companyName, mode: 'insensitive' },
          },
        });

        companyId = existingCompany
          ? existingCompany.id
          : (
              await tx.company.create({
                data: {
                  workspaceId,
                  name: dto.companyName,
                  industry: dto.industryContext,
                },
              })
            ).id;
      }

      const contact = await tx.contact.create({
        data: {
          workspaceId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          emails: dto.emails,
          phones: dto.phones,
          status: ContactStatus.LEAD,
          source: dto.source,
          companyId,
        },
        include: { company: true },
      });

      const opportunity = await tx.opportunity.create({
        data: {
          name: `${dto.firstName} ${dto.lastName}`,
          value: new Prisma.Decimal(dto.expectedValue),
          workspaceId,
          pipelineId: dto.pipelineId,
          stageId: dto.stageId,
          contactId: contact.id,
          source: dto.source,
          industryContext: dto.industryContext,
        },
        include: { pipeline: true, stage: true },
      });

      const task = await tx.task.create({
        data: {
          title: 'Follow up',
          workspaceId,
          contactId: contact.id,
          opportunityId: opportunity.id,
        },
      });

      return { contact, opportunity, task };
    });

    return { ...result, duplicateWarning };
  }
}
