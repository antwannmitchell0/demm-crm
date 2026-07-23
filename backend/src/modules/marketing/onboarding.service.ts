import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  Prisma,
  ChecklistItemStatus,
  ChecklistResponsibility,
  ServiceDeliverableCadence,
  OnboardingPlanState,
  MarketingServiceStatus,
} from '@prisma/client';
import { Dom26rAuditService } from '../dom26r/dom26r-audit.service';
import { MarketingRelationshipService } from './marketing-relationship.service';
import { SubjectType } from '@prisma/client';

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private dom26rAudit: Dom26rAuditService,
    private marketingRelationship: MarketingRelationshipService,
  ) {}

  /**
   * Idempotent: returns the existing plan unchanged if one already exists
   * for this ClientAccount. Safe to call automatically from
   * ClientAccountService.convert AND manually via the repair endpoint.
   * Generates BOTH the OnboardingPlan+checklist and the ServiceDeliverables
   * in one pass, from the ClientAccount's OfferSnapshot -- never the live
   * Offer.
   */
  async generateForClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
  ) {
    const existing = await tx.onboardingPlan.findUnique({
      where: { clientAccountId },
      include: { items: true },
    });
    if (existing) return existing;

    const clientAccount = await tx.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    const snapshot = clientAccount.offerSnapshot;

    const plan = await tx.onboardingPlan.create({
      data: {
        clientAccountId,
        offerSnapshotId: snapshot.id,
        state: OnboardingPlanState.NOT_STARTED,
      },
    });

    // Checklist generation: one required, DEMM-owned item per
    // onboardingRequirements entry (verbatim, directly traceable to the
    // snapshot) plus exactly one required, CLIENT-owned scaffolding item
    // every onboarding needs regardless of plan. Nothing else is invented.
    const itemsData: Prisma.OnboardingChecklistItemCreateManyInput[] =
      snapshot.onboardingRequirements.map((requirement) => ({
        planId: plan.id,
        title: requirement,
        sourceCapability: requirement,
        required: true,
        responsibility: ChecklistResponsibility.DEMM,
      }));
    itemsData.push({
      planId: plan.id,
      title:
        'Confirm business details and provide access/assets needed for onboarding',
      sourceCapability: null,
      required: true,
      responsibility: ChecklistResponsibility.CLIENT,
    });
    await tx.onboardingChecklistItem.createMany({ data: itemsData });

    // Deliverable generation: one per includedServices entry, verbatim.
    // RECURRING because every capability in a monthly-billed plan is
    // ongoing service, not a one-off. cadenceDetail stays null -- undecided,
    // mirrors OfferSnapshot.reportingCadence being null.
    const deliverablesData: Prisma.ServiceDeliverableCreateManyInput[] =
      snapshot.includedServices.map((service) => ({
        clientAccountId,
        offerSnapshotId: snapshot.id,
        sourceCapability: service,
        name: service,
        cadence: ServiceDeliverableCadence.RECURRING,
        outsideScope: false,
      }));
    await tx.serviceDeliverable.createMany({ data: deliverablesData });

    await tx.clientAccount.update({
      where: { id: clientAccountId },
      data: { onboardingState: OnboardingPlanState.NOT_STARTED },
    });

    await this.dom26rAudit.record(
      {
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        action: 'ONBOARDING_PLAN_GENERATED',
        purpose: 'CLIENT_ONBOARDING',
        outcome: 'SUCCESS',
        correlationId,
        metadata: {
          clientAccountId,
          planId: plan.id,
          offerSnapshotId: snapshot.id,
        },
      },
      tx,
    );

    const subjectType = clientAccount.companyId
      ? SubjectType.COMPANY
      : SubjectType.CONTACT;
    const subjectRefId =
      clientAccount.companyId ?? clientAccount.primaryContactId;
    await this.marketingRelationship.recordOnboardingMilestone(
      tx,
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType,
        subjectRefId,
        clientAccountId,
        summary: `Onboarding plan generated for offer "${snapshot.name}"`,
        structuredContent: { planId: plan.id, offerSnapshotId: snapshot.id },
      },
    );

    return tx.onboardingPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { items: true },
    });
  }

  async prismaTransactionGenerate(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
  ) {
    return this.prisma.$transaction((tx) =>
      this.generateForClient(
        tx,
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        correlationId,
        clientAccountId,
      ),
    );
  }

  async checkLaunchReadiness(planId: string) {
    const items = await this.prisma.onboardingChecklistItem.findMany({
      where: { planId, required: true },
    });
    const blockingItems = items.filter(
      (item) =>
        item.status !== ChecklistItemStatus.COMPLETE &&
        item.status !== ChecklistItemStatus.WAIVED,
    );
    return { ready: blockingItems.length === 0, blockingItems };
  }

  async getPlanDetail(businessUnitId: string, clientAccountId: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    const plan = await this.prisma.onboardingPlan.findUnique({
      where: { clientAccountId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        overrides: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!plan) {
      throw new NotFoundException('No onboarding plan for this client');
    }
    const requiredItems = plan.items.filter((i) => i.required);
    const completeOrWaived = requiredItems.filter(
      (i) =>
        i.status === ChecklistItemStatus.COMPLETE ||
        i.status === ChecklistItemStatus.WAIVED,
    );
    const progressPercentage =
      requiredItems.length === 0
        ? 100
        : Math.round((completeOrWaived.length / requiredItems.length) * 100);
    const blockers = plan.items.filter(
      (i) => i.status === ChecklistItemStatus.BLOCKED,
    );
    const launchReadiness = completeOrWaived.length === requiredItems.length;

    return { ...plan, progressPercentage, blockers, launchReadiness };
  }

  async updateItem(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    itemId: string,
    dto: {
      status?: ChecklistItemStatus;
      evidence?: string;
      clientSubmission?: Record<string, unknown>;
      blockerReason?: string;
    },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    const item = await this.prisma.onboardingChecklistItem.findFirst({
      where: { id: itemId, plan: { clientAccountId } },
    });
    if (!item) {
      throw new NotFoundException('Checklist item not found for this client');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.OnboardingChecklistItemUpdateInput = {
        evidence: dto.evidence,
        clientSubmission: dto.clientSubmission as Prisma.InputJsonValue,
        blockerReason: dto.blockerReason,
      };
      if (dto.status && dto.status !== item.status) {
        data.status = dto.status;
        if (dto.status === ChecklistItemStatus.COMPLETE) {
          data.completedAt = new Date();
        }
        await tx.onboardingChecklistItemHistory.create({
          data: {
            itemId,
            oldStatus: item.status,
            newStatus: dto.status,
            actorId,
          },
        });
      }
      return tx.onboardingChecklistItem.update({
        where: { id: itemId },
        data,
      });
    });
  }

  /**
   * Moves a ClientAccount from PENDING_ONBOARDING to ACTIVE. Without
   * `override`, every required checklist item must be COMPLETE or WAIVED.
   * With `override`, the CALLER (enforced by the controller's role check --
   * this method trusts that check already ran) bypasses remaining blockers,
   * but a LaunchGateOverride row is written with the exact blocked item ids,
   * so the bypass is always auditable.
   */
  async activate(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
    override?: { reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const clientAccount = await tx.clientAccount.findFirst({
        where: { id: clientAccountId, businessUnitId },
      });
      if (!clientAccount) {
        throw new NotFoundException(
          'Client account not found in this Business Unit',
        );
      }
      const plan = await tx.onboardingPlan.findUnique({
        where: { clientAccountId },
      });
      if (!plan) {
        throw new NotFoundException('No onboarding plan for this client');
      }

      const items = await tx.onboardingChecklistItem.findMany({
        where: { planId: plan.id, required: true },
      });
      const blockingItems = items.filter(
        (item) =>
          item.status !== ChecklistItemStatus.COMPLETE &&
          item.status !== ChecklistItemStatus.WAIVED,
      );

      if (blockingItems.length > 0) {
        if (!override) {
          throw new ConflictException({
            message: 'Required onboarding items are incomplete',
            blockingItems: blockingItems.map((i) => ({
              id: i.id,
              title: i.title,
            })),
          });
        }
        await tx.launchGateOverride.create({
          data: {
            planId: plan.id,
            reason: override.reason,
            actorId,
            affectedGates: blockingItems.map((i) => i.id),
          },
        });
      }

      const now = new Date();
      await tx.onboardingPlan.update({
        where: { id: plan.id },
        data: { state: OnboardingPlanState.COMPLETE, actualLaunchDate: now },
      });
      const updatedClientAccount = await tx.clientAccount.update({
        where: { id: clientAccountId },
        data: {
          onboardingState: OnboardingPlanState.COMPLETE,
          serviceStatus: MarketingServiceStatus.ACTIVE,
        },
      });

      await this.dom26rAudit.record(
        {
          organizationId,
          businessUnitId,
          workspaceId,
          actorId,
          action: override
            ? 'CLIENT_ACTIVATED_WITH_OVERRIDE'
            : 'CLIENT_ACTIVATED',
          purpose: 'CLIENT_ONBOARDING',
          outcome: 'SUCCESS',
          correlationId,
          metadata: {
            clientAccountId,
            planId: plan.id,
            overrideReason: override?.reason ?? null,
          },
        },
        tx,
      );

      const subjectType = clientAccount.companyId
        ? SubjectType.COMPANY
        : SubjectType.CONTACT;
      const subjectRefId =
        clientAccount.companyId ?? clientAccount.primaryContactId;
      await this.marketingRelationship.recordOnboardingMilestone(
        tx,
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        correlationId,
        {
          subjectType,
          subjectRefId,
          clientAccountId,
          summary: override
            ? 'Client activated with launch-gate override'
            : 'Client activated',
          structuredContent: {
            planId: plan.id,
            overrideReason: override?.reason ?? null,
          },
        },
      );

      return updatedClientAccount;
    });
  }
}
