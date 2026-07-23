import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  ContactStatus,
  OpportunityStatus,
  MarketingServiceStatus,
  SubjectType,
  Prisma,
} from '@prisma/client';
import { OfferService } from './offer.service';
import { MarketingRelationshipService } from './marketing-relationship.service';
import { Dom26rAuditService } from '../dom26r/dom26r-audit.service';
import { RelationshipProfileService } from '../dom26r/relationship-profile.service';
import { RelationshipBriefService } from '../dom26r/relationship-brief.service';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { OnboardingService } from './onboarding.service';
import { ServiceDeliverableService } from './service-deliverable.service';

@Injectable()
export class ClientAccountService {
  constructor(
    private prisma: PrismaService,
    private offers: OfferService,
    private marketingRelationship: MarketingRelationshipService,
    private dom26rAudit: Dom26rAuditService,
    private profiles: RelationshipProfileService,
    private briefs: RelationshipBriefService,
    private onboarding: OnboardingService,
    private deliverables: ServiceDeliverableService,
  ) {}

  async findByIdScoped(businessUnitId: string, id: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id, businessUnitId },
      include: {
        offer: true,
        offerSnapshot: true,
        primaryContact: true,
        company: true,
        commercialChanges: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    return clientAccount;
  }

  /**
   * The current contract/payment state is derived as the most recent
   * change of each `field` -- `commercialChanges` is already loaded
   * newest-first (see findByIdScoped), so the first row per field wins.
   */
  private deriveCurrentCommercialState(
    commercialChanges: { field: string; newValue: string }[],
  ) {
    let contractState: string | null = null;
    let paymentState: string | null = null;
    for (const change of commercialChanges) {
      if (change.field === 'CONTRACT' && contractState === null) {
        contractState = change.newValue;
      }
      if (change.field === 'PAYMENT' && paymentState === null) {
        paymentState = change.newValue;
      }
    }
    return { contractState, paymentState };
  }

  /**
   * Client detail: the ClientAccount + its immutable OfferSnapshot, the
   * derived current commercial state, and the most recent Marketing
   * Relationship Brief for this client's DOM26-R profile (INTERNAL_HUMAN
   * tier), if one has been generated. No brief is auto-generated here --
   * brief authoring (composing `briefText`) is a separate, explicit action.
   */
  async getClientDetail(businessUnitId: string, id: string) {
    const clientAccount = await this.findByIdScoped(businessUnitId, id);
    const currentCommercialState = this.deriveCurrentCommercialState(
      clientAccount.commercialChanges,
    );

    const subjectType = clientAccount.companyId
      ? SubjectType.COMPANY
      : SubjectType.CONTACT;
    const subjectRefId =
      clientAccount.companyId ?? clientAccount.primaryContactId;

    const profile = await this.profiles.getOrCreateProfile(
      businessUnitId,
      subjectType,
      subjectRefId,
    );
    const existingBriefs = await this.briefs.findAll(
      businessUnitId,
      profile.id,
    );
    const brief = existingBriefs[0]
      ? await this.briefs.getFormatted(
          businessUnitId,
          existingBriefs[0].id,
          'INTERNAL_HUMAN',
        )
      : null;

    // .catch(() => null/[]): a client converted before Sub-project 2 shipped
    // (or one whose generation somehow failed) may not have a plan yet --
    // this endpoint degrades gracefully rather than 500ing.
    const onboarding = await this.onboarding
      .getPlanDetail(businessUnitId, id)
      .catch(() => null);
    const deliverables = await this.deliverables
      .findAll(businessUnitId, id)
      .catch(() => []);

    return {
      ...clientAccount,
      currentCommercialState,
      brief,
      onboarding,
      deliverables,
    };
  }

  /**
   * Atomic, idempotent Lead -> Client conversion. Every write (ClientAccount,
   * OfferSnapshot, Opportunity WON, Contact CUSTOMER, onboarding Task, audit
   * events, DOM26-R candidates + milestone engram, manually-recorded
   * commercial state, idempotency key) happens inside ONE
   * `prisma.$transaction` -- a failure anywhere rolls back everything, so a
   * partial ClientAccount/snapshot/WON-status can never leak.
   */
  async convert(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string,
    actorId: string,
    correlationId: string,
    contactId: string,
    idempotencyKey: string | undefined,
    dto: ConvertLeadDto,
  ) {
    if (idempotencyKey) {
      const existingKey = await this.prisma.conversionIdempotencyKey.findUnique(
        {
          where: { key: idempotencyKey },
          include: { clientAccount: true },
        },
      );
      if (existingKey) {
        return existingKey.clientAccount;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Step 1: resolve the Contact in scope.
        const contact = await tx.contact.findFirst({
          where: { id: contactId, workspaceId },
        });
        if (!contact) {
          throw new ForbiddenException(
            'Contact does not belong to this workspace',
          );
        }

        // Step 2: resolve the acquisition Opportunity + Company in scope.
        const opportunity = await tx.opportunity.findFirst({
          where: {
            contactId: contact.id,
            workspaceId,
            status: OpportunityStatus.OPEN,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!opportunity) {
          throw new NotFoundException(
            'No open acquisition Opportunity found for this Contact',
          );
        }

        // Validate BOTH the explicitly-supplied dto.companyId AND the
        // fallback contact.companyId against the caller's workspace --
        // nothing in the schema guarantees a Contact's companyId already
        // points to a Company in the same workspace (LeadService always
        // creates them together, but that's a convention, not a
        // constraint), so trusting the fallback unvalidated would let a
        // pre-existing data inconsistency silently attach a foreign
        // Company to this ClientAccount and this client's DOM26-R profile.
        const companyId = dto.companyId ?? contact.companyId ?? null;
        if (companyId) {
          const company = await tx.company.findFirst({
            where: { id: companyId, workspaceId },
          });
          if (!company) {
            throw new ForbiddenException(
              'Company does not belong to this workspace',
            );
          }
        }

        // Step 3: the Offer being sold must actually be sellable right now.
        const offer = await this.offers.assertSellable(
          tx,
          businessUnitId,
          dto.offerId,
        );

        // Step 4: duplicate-conversion guard (BU-scoped uniqueness).
        const existingByContact = await tx.clientAccount.findUnique({
          where: {
            businessUnitId_primaryContactId: {
              businessUnitId,
              primaryContactId: contact.id,
            },
          },
        });
        if (existingByContact) {
          throw new ConflictException(
            'This Contact has already been converted to a Client in this Business Unit',
          );
        }
        if (companyId) {
          const existingByCompany = await tx.clientAccount.findUnique({
            where: {
              businessUnitId_companyId: { businessUnitId, companyId },
            },
          });
          if (existingByCompany) {
            throw new ConflictException(
              'This Company has already been converted to a Client in this Business Unit',
            );
          }
        }

        // Step 6 (executed before 5 -- ClientAccount.offerSnapshotId is a
        // required, non-nullable FK, so the snapshot must exist first):
        // write the immutable OfferSnapshot, freezing exactly what's sold.
        const offerSnapshot = await tx.offerSnapshot.create({
          data: {
            offerId: offer.id,
            offerVersion: offer.version,
            key: offer.key,
            name: offer.name,
            price: offer.price,
            setupFee: offer.setupFee,
            includedServices: offer.includedServices,
            excludedServices: offer.excludedServices,
            onboardingRequirements: offer.onboardingRequirements,
            supportBoundaries: offer.supportBoundaries,
            reportingCadence: offer.reportingCadence,
            cancellationTerms: offer.cancellationTerms,
            expectedLaunchTime: offer.expectedLaunchTime,
            trialEligible: offer.trialEligible,
            trialDays: offer.trialDays,
          },
        });

        // Step 5: create the ClientAccount.
        const clientAccount = await tx.clientAccount.create({
          data: {
            businessUnitId,
            companyId,
            primaryContactId: contact.id,
            acquisitionOpportunityId: opportunity.id,
            offerId: offer.id,
            offerSnapshotId: offerSnapshot.id,
            serviceStatus: MarketingServiceStatus.PENDING_ONBOARDING,
          },
        });

        // Step 5b: generate the onboarding plan + service deliverables from
        // the OfferSnapshot just frozen above -- inside the same
        // transaction, so a client can never exist at PENDING_ONBOARDING
        // without a plan.
        await this.onboarding.generateForClient(
          tx,
          organizationId,
          businessUnitId,
          workspaceId,
          actorId,
          correlationId,
          clientAccount.id,
        );

        // Step 7: mark the acquisition Opportunity WON.
        await tx.opportunity.update({
          where: { id: opportunity.id },
          data: { status: OpportunityStatus.WON },
        });

        // Step 8: Contact lifecycle -- LEAD -> CUSTOMER.
        await tx.contact.update({
          where: { id: contact.id },
          data: { status: ContactStatus.CUSTOMER },
        });

        // Step 9: onboarding kickoff Task -- the designated primary
        // next-action for the newly converted client.
        await tx.task.create({
          data: {
            title: `Onboarding kickoff: ${contact.firstName} ${contact.lastName}`,
            workspaceId,
            contactId: contact.id,
          },
        });

        // Step 10: audit trail -- AuditLog (workspace-facing) + a
        // tx-aware DOM26-R MemoryAuditEvent for the conversion action
        // itself (distinct from the per-candidate/engram events step 11
        // writes internally).
        await tx.auditLog.create({
          data: {
            actorType: 'USER',
            actorId,
            action: 'convertLeadToClient',
            payload: {
              contactId: contact.id,
              offerId: offer.id,
              companyId,
            },
            response: {
              clientAccountId: clientAccount.id,
            },
            workspaceId,
            userId: actorId,
          },
        });
        await this.dom26rAudit.record(
          {
            organizationId,
            businessUnitId,
            workspaceId,
            actorId,
            action: 'CLIENT_CONVERSION',
            purpose: 'LEAD_TO_CLIENT_CONVERSION',
            outcome: 'SUCCESS',
            correlationId,
            metadata: { clientAccountId: clientAccount.id, offerId: offer.id },
          },
          tx,
        );

        // Manually-recorded contract/payment state, if supplied.
        if (dto.contractState) {
          await tx.clientCommercialStateChange.create({
            data: {
              clientAccountId: clientAccount.id,
              field: 'CONTRACT',
              newValue: dto.contractState,
              recordedById: actorId,
              source: 'MANUAL',
            },
          });
        }
        if (dto.paymentState) {
          await tx.clientCommercialStateChange.create({
            data: {
              clientAccountId: clientAccount.id,
              field: 'PAYMENT',
              newValue: dto.paymentState,
              amount: dto.paymentAmount ?? null,
              recordedById: actorId,
              source: 'MANUAL',
            },
          });
        }

        // Step 11: DOM26-R controlled candidates + the conversion
        // milestone engram. "The client entity is the Company when known"
        // (design doc) -- so relationship facts attach to the Company's
        // profile when a Company is linked, otherwise to the Contact's
        // (sole-proprietor path).
        await this.marketingRelationship.recordConversionFacts(
          tx,
          organizationId,
          businessUnitId,
          workspaceId,
          actorId,
          correlationId,
          {
            subjectType: companyId ? SubjectType.COMPANY : SubjectType.CONTACT,
            subjectRefId: companyId ?? contact.id,
            clientAccountId: clientAccount.id,
            acquisitionSource: opportunity.source ?? contact.source ?? null,
            confirmedBusinessContext: opportunity.industryContext ?? null,
            offerId: offer.id,
            offerName: offer.name,
          },
        );

        // Step 11b: write the idempotency key LAST. Its `@id` uniqueness
        // on `key` is what catches a duplicate submit racing this exact
        // transaction -- the loser's insert throws P2002, caught below.
        if (idempotencyKey) {
          await tx.conversionIdempotencyKey.create({
            data: { key: idempotencyKey, clientAccountId: clientAccount.id },
          });
        }

        return clientAccount;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        if (idempotencyKey) {
          // Lost a race on the SAME idempotency key: the winner's row is
          // already committed, so return its ClientAccount instead of
          // surfacing an opaque 500 for what is actually a successful
          // duplicate-submit case.
          const winningKey =
            await this.prisma.conversionIdempotencyKey.findUnique({
              where: { key: idempotencyKey },
              include: { clientAccount: true },
            });
          if (winningKey) return winningKey.clientAccount;
        }
        // No idempotency key (or the key lookup somehow came up empty):
        // this is a genuine race on ClientAccount's own BU-scoped
        // uniqueness -- two concurrent conversions for the same
        // Contact/Company both passed the advisory step-4 check before
        // either committed. The loser's whole transaction has already
        // rolled back at this point (Postgres aborts the full transaction
        // on any statement error), so there's no partial data to clean up
        // -- just report it as the conflict it is instead of a 500.
        throw new ConflictException(
          'This Contact or Company has already been converted to a Client in this Business Unit',
        );
      }
      throw err;
    }
  }

  /**
   * Records an ADDITIONAL contract/payment state change after conversion --
   * e.g. month 2's payment, or a contract renewal. Deliberately separate
   * from the convert() transaction (which only records the state supplied
   * at conversion time): ongoing revenue tracking needs a way to log
   * further manually-recorded events over a client's lifetime, and this is
   * new functionality, not a modification of convert()'s existing behavior.
   */
  async recordCommercialStateChange(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    field: 'CONTRACT' | 'PAYMENT',
    newValue: string,
    amount?: number,
  ) {
    const clientAccount = await this.findByIdScoped(
      businessUnitId,
      clientAccountId,
    );
    return this.prisma.clientCommercialStateChange.create({
      data: {
        clientAccountId: clientAccount.id,
        field,
        newValue,
        amount: amount ?? null,
        recordedById: actorId,
        source: 'MANUAL',
      },
    });
  }
}
