import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma.service';
import {
  Prisma,
  ClientHealthState,
  ChecklistItemStatus,
  ServiceDeliverableStatus,
  SubjectType,
  SeverityState,
  SignalState,
} from '@prisma/client';
import { RelationshipProfileService } from '../dom26r/relationship-profile.service';
import { MarketingRelationshipService } from './marketing-relationship.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type RiskOwner =
  'DEMM' | 'CLIENT' | 'COMMERCIAL' | 'RELATIONSHIP' | 'DELIVERY';

export interface HealthFactor {
  code: string;
  description: string;
  riskOwner: RiskOwner;
  evidence: string;
}

/**
 * Rule-based, fully explainable Client Health engine. Every state this
 * produces traces back to a list of `factors` computed from real rows in
 * this request -- there is no trained model, no opaque score, nothing that
 * can't be read straight off the data. Missing evidence widens
 * `missingData` and pulls the result toward UNKNOWN rather than inventing
 * a negative signal from silence.
 */
@Injectable()
export class ClientHealthService {
  constructor(
    private prisma: PrismaService,
    private profiles: RelationshipProfileService,
    private marketingRelationship: MarketingRelationshipService,
  ) {}

  private daysSince(date: Date | null): number | null {
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / DAY_MS);
  }

  /**
   * Computes fresh factors from real evidence, determines the resulting
   * state via explicit priority rules (worst factor wins), and persists.
   * Safe and idempotent to call after any relevant mutation (checklist
   * item update, deliverable update, activation) -- NOT on every read, to
   * avoid recalculating on every dashboard page view.
   *
   * Deliberately takes only businessUnitId/actorId as required context
   * (organizationId is resolved internally, correlationId is generated
   * when not supplied) so this can be called as a side-effect from
   * OnboardingService/ServiceDeliverableService/ClientAccountService
   * without changing any of their existing public method signatures --
   * those are accepted, tested surfaces from Sub-project 2 that this
   * sub-project must not reopen.
   */
  async calculate(
    businessUnitId: string,
    clientAccountId: string,
    actorId: string,
    correlationId: string = randomUUID(),
  ) {
    const businessUnit = await this.prisma.businessUnit.findUnique({
      where: { id: businessUnitId },
      select: { organizationId: true },
    });
    if (!businessUnit) {
      throw new NotFoundException('Business Unit not found');
    }
    const organizationId = businessUnit.organizationId;
    const workspaceId: string | null = null;

    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: {
        commercialChanges: { orderBy: { createdAt: 'desc' } },
        onboardingPlan: { include: { items: true } },
        serviceDeliverables: true,
      },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }

    const factors: HealthFactor[] = [];
    const missingData: string[] = [];

    // --- Service lifecycle state takes priority when it's a terminal one.
    if (clientAccount.serviceStatus === 'CHURNED') {
      factors.push({
        code: 'SERVICE_CHURNED',
        description: 'Client service status is CHURNED.',
        riskOwner: 'COMMERCIAL',
        evidence: 'ClientAccount.serviceStatus=CHURNED',
      });
    }
    if (clientAccount.serviceStatus === 'PAUSED') {
      factors.push({
        code: 'SERVICE_PAUSED',
        description: 'Client service status is PAUSED.',
        riskOwner: 'COMMERCIAL',
        evidence: 'ClientAccount.serviceStatus=PAUSED',
      });
    }

    // --- Onboarding checklist evidence.
    const items = clientAccount.onboardingPlan?.items ?? [];
    if (!clientAccount.onboardingPlan) {
      missingData.push('No onboarding plan found for this client.');
    }
    let blockedCount = 0;
    let maxBlockedDays = 0;
    for (const item of items) {
      if (item.status === ChecklistItemStatus.BLOCKED) {
        blockedCount++;
        const days = this.daysSince(item.updatedAt) ?? 0;
        maxBlockedDays = Math.max(maxBlockedDays, days);
        factors.push({
          code: 'CHECKLIST_ITEM_BLOCKED',
          description: `Onboarding item "${item.title}" is blocked${item.blockerReason ? `: ${item.blockerReason}` : '.'}`,
          riskOwner: item.responsibility === 'CLIENT' ? 'CLIENT' : 'DEMM',
          evidence: `OnboardingChecklistItem ${item.id}, blocked ${days}d`,
        });
      }
      if (
        item.required &&
        item.dueDate &&
        item.dueDate < new Date() &&
        item.status !== ChecklistItemStatus.COMPLETE &&
        item.status !== ChecklistItemStatus.WAIVED &&
        item.status !== ChecklistItemStatus.CANCELLED
      ) {
        const overdueDays = this.daysSince(item.dueDate) ?? 0;
        factors.push({
          code: 'CHECKLIST_ITEM_OVERDUE',
          description: `Required onboarding item "${item.title}" is ${overdueDays}d overdue.`,
          riskOwner: item.responsibility === 'CLIENT' ? 'CLIENT' : 'DEMM',
          evidence: `OnboardingChecklistItem ${item.id}, dueDate ${item.dueDate.toISOString()}`,
        });
      }
      if (
        item.status === ChecklistItemStatus.WAITING_ON_CLIENT &&
        (this.daysSince(item.updatedAt) ?? 0) >= 14
      ) {
        factors.push({
          code: 'CLIENT_UNRESPONSIVE',
          description: `Waiting on client for "${item.title}" for ${this.daysSince(item.updatedAt)}d.`,
          riskOwner: 'CLIENT',
          evidence: `OnboardingChecklistItem ${item.id}, WAITING_ON_CLIENT`,
        });
      }
    }

    // --- Service deliverable evidence.
    for (const deliverable of clientAccount.serviceDeliverables) {
      if (deliverable.status === ServiceDeliverableStatus.BLOCKED) {
        blockedCount++;
        const days = this.daysSince(deliverable.updatedAt) ?? 0;
        maxBlockedDays = Math.max(maxBlockedDays, days);
        factors.push({
          code: 'DELIVERABLE_BLOCKED',
          description: `Deliverable "${deliverable.name}" is blocked${deliverable.blockerReason ? `: ${deliverable.blockerReason}` : '.'}`,
          riskOwner: 'DEMM',
          evidence: `ServiceDeliverable ${deliverable.id}, blocked ${days}d`,
        });
      }
      if (
        deliverable.dueDate &&
        deliverable.dueDate < new Date() &&
        !['DELIVERED', 'ACCEPTED', 'CANCELLED'].includes(deliverable.status)
      ) {
        const overdueDays = this.daysSince(deliverable.dueDate) ?? 0;
        factors.push({
          code: 'DELIVERABLE_OVERDUE',
          description: `Deliverable "${deliverable.name}" is ${overdueDays}d overdue.`,
          riskOwner: 'DEMM',
          evidence: `ServiceDeliverable ${deliverable.id}, dueDate ${deliverable.dueDate.toISOString()}`,
        });
      }
      if (deliverable.status === ServiceDeliverableStatus.REJECTED) {
        factors.push({
          code: 'DELIVERABLE_REJECTED',
          description: `Client rejected delivered work: "${deliverable.name}".`,
          riskOwner: 'DELIVERY',
          evidence: `ServiceDeliverable ${deliverable.id}, status=REJECTED`,
        });
      }
    }

    // --- Commercial evidence.
    const latestPayment = clientAccount.commercialChanges.find(
      (c) => c.field === 'PAYMENT',
    );
    if (!latestPayment) {
      missingData.push('No payment state has been manually recorded.');
    } else if (!/PAID/.test(latestPayment.newValue)) {
      factors.push({
        code: 'PAYMENT_NOT_CONFIRMED',
        description: `Latest recorded payment state is "${latestPayment.newValue}", not a PAID state.`,
        riskOwner: 'COMMERCIAL',
        evidence: `ClientCommercialStateChange ${latestPayment.id}`,
      });
    }
    const latestContract = clientAccount.commercialChanges.find(
      (c) => c.field === 'CONTRACT',
    );
    if (!latestContract) {
      missingData.push('No contract state has been manually recorded.');
    }

    // --- Relationship signals (read-side; nothing currently creates these
    // except this service itself on a meaningful transition -- see below).
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
    const activeSignals = await this.prisma.relationshipSignal.findMany({
      where: { profileId: profile.id, state: SignalState.ACTIVE },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    if (activeSignals.length === 0) {
      missingData.push('No active relationship signals recorded.');
    }
    for (const signal of activeSignals) {
      factors.push({
        code: 'RELATIONSHIP_SIGNAL',
        description: signal.summary,
        riskOwner: 'RELATIONSHIP',
        evidence: `RelationshipSignal ${signal.id}, severity=${signal.severity}`,
      });
    }

    // --- Determine state: worst factor wins, in explicit priority order.
    const has = (code: string) => factors.some((f) => f.code === code);
    const overdueDays = (code: string) =>
      Math.max(
        0,
        ...factors
          .filter((f) => f.code === code)
          .map((f) => parseInt(f.evidence.match(/(\d+)d/)?.[1] ?? '0', 10)),
      );

    let computedState: ClientHealthState;
    if (has('SERVICE_CHURNED')) {
      computedState = ClientHealthState.CHURNED;
    } else if (has('SERVICE_PAUSED')) {
      computedState = ClientHealthState.PAUSED;
    } else if (maxBlockedDays > 14 || blockedCount >= 2) {
      computedState = ClientHealthState.CRITICAL;
    } else if (
      blockedCount === 1 ||
      overdueDays('CHECKLIST_ITEM_OVERDUE') > 7 ||
      overdueDays('DELIVERABLE_OVERDUE') > 7 ||
      has('CLIENT_UNRESPONSIVE') ||
      has('DELIVERABLE_REJECTED')
    ) {
      computedState = ClientHealthState.AT_RISK;
    } else if (
      has('CHECKLIST_ITEM_OVERDUE') ||
      has('DELIVERABLE_OVERDUE') ||
      has('PAYMENT_NOT_CONFIRMED')
    ) {
      computedState = ClientHealthState.WATCH;
    } else if (
      !clientAccount.onboardingPlan &&
      clientAccount.commercialChanges.length === 0
    ) {
      computedState = ClientHealthState.UNKNOWN;
    } else {
      computedState = ClientHealthState.HEALTHY;
    }

    const recommendedAction = this.recommendAction(computedState, factors);

    const existing = await this.prisma.clientHealth.findUnique({
      where: { clientAccountId },
    });
    const effectiveState = existing?.overrideState ?? computedState;

    const health = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.clientHealth.upsert({
        where: { clientAccountId },
        create: {
          clientAccountId,
          state: effectiveState,
          computedState,
          overrideState: existing?.overrideState ?? null,
          factors: factors as unknown as Prisma.InputJsonValue,
          missingData,
          recommendedAction,
        },
        update: {
          state: effectiveState,
          computedState,
          factors: factors as unknown as Prisma.InputJsonValue,
          missingData,
          recommendedAction,
          calculatedAt: new Date(),
        },
      });

      if (existing && existing.state !== effectiveState) {
        await tx.clientHealthHistory.create({
          data: {
            healthId: saved.id,
            oldState: existing.state,
            newState: effectiveState,
            trigger: 'RECALCULATION',
          },
        });
      }
      return saved;
    });

    // Meaningful transition only: entering or leaving AT_RISK/CRITICAL.
    // Routine recalculation that doesn't cross this boundary creates
    // nothing in DOM26-R -- no memory spam for every status toggle.
    const wasElevated =
      existing &&
      (existing.state === ClientHealthState.AT_RISK ||
        existing.state === ClientHealthState.CRITICAL);
    const isElevated =
      effectiveState === ClientHealthState.AT_RISK ||
      effectiveState === ClientHealthState.CRITICAL;
    if (!wasElevated && isElevated) {
      await this.onHealthDegraded(
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        correlationId,
        profile.id,
        clientAccountId,
        effectiveState,
        factors,
      );
    } else if (wasElevated && !isElevated) {
      await this.onHealthRecovered(
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        correlationId,
        profile.id,
        clientAccountId,
        effectiveState,
      );
    }

    return health;
  }

  private recommendAction(
    state: ClientHealthState,
    factors: HealthFactor[],
  ): string | null {
    if (state === ClientHealthState.CRITICAL) {
      return 'Escalate immediately -- multiple or long-standing blockers unresolved.';
    }
    if (state === ClientHealthState.AT_RISK) {
      const demmFactor = factors.find((f) => f.riskOwner === 'DEMM');
      const clientFactor = factors.find((f) => f.riskOwner === 'CLIENT');
      if (demmFactor) return `DEMM action needed: ${demmFactor.description}`;
      if (clientFactor)
        return `Follow up with client: ${clientFactor.description}`;
      return 'Review contributing factors and assign an owner.';
    }
    if (state === ClientHealthState.WATCH) {
      return 'Monitor -- one or more items trending overdue.';
    }
    if (state === ClientHealthState.UNKNOWN) {
      return 'Insufficient data to assess health -- confirm onboarding plan and commercial state exist.';
    }
    return null;
  }

  private async onHealthDegraded(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    profileId: string,
    clientAccountId: string,
    newState: ClientHealthState,
    factors: HealthFactor[],
  ) {
    const severity =
      newState === ClientHealthState.CRITICAL
        ? SeverityState.CRITICAL
        : SeverityState.HIGH;
    const summary = `Client Health degraded to ${newState}: ${factors[0]?.description ?? 'multiple contributing factors'}`;
    await this.prisma.relationshipSignal.create({
      data: {
        profileId,
        type: 'HEALTH_DEGRADED',
        summary,
        confidence: 0.9,
        severity,
        state: SignalState.ACTIVE,
      },
    });
    await this.marketingRelationship.recordHealthChangeCandidate(
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType: SubjectType.CONTACT,
        subjectRefId: clientAccountId,
        profileId,
        summary,
      },
    );
  }

  private async onHealthRecovered(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    profileId: string,
    clientAccountId: string,
    newState: ClientHealthState,
  ) {
    await this.prisma.relationshipSignal.updateMany({
      where: { profileId, type: 'HEALTH_DEGRADED', state: SignalState.ACTIVE },
      data: { state: SignalState.RESOLVED, resolvedAt: new Date() },
    });
    const summary = `Client Health recovered to ${newState} after being at risk.`;
    await this.marketingRelationship.recordHealthChangeCandidate(
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType: SubjectType.CONTACT,
        subjectRefId: clientAccountId,
        profileId,
        summary,
      },
    );
  }

  async getHealth(businessUnitId: string, clientAccountId: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    return this.prisma.clientHealth.findUnique({
      where: { clientAccountId },
      include: {
        overrides: { orderBy: { createdAt: 'desc' } },
        history: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  async override(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    state: ClientHealthState,
    reason: string,
  ) {
    const health = await this.prisma.clientHealth.findFirst({
      where: { clientAccountId, clientAccount: { businessUnitId } },
    });
    if (!health) {
      throw new NotFoundException(
        'No Client Health record exists yet for this client -- trigger a recalculation first.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.clientHealthOverride.create({
        data: { healthId: health.id, state, reason, actorId },
      });
      const updated = await tx.clientHealth.update({
        where: { id: health.id },
        data: { overrideState: state, state },
      });
      if (health.state !== state) {
        await tx.clientHealthHistory.create({
          data: {
            healthId: health.id,
            oldState: health.state,
            newState: state,
            trigger: 'OVERRIDE',
          },
        });
      }
      return updated;
    });
  }

  async clearOverride(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
  ) {
    const health = await this.prisma.clientHealth.findFirst({
      where: { clientAccountId, clientAccount: { businessUnitId } },
    });
    if (!health) {
      throw new NotFoundException(
        'No Client Health record exists yet for this client.',
      );
    }
    if (!health.overrideState) {
      throw new ForbiddenException('No active override to clear.');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clientHealth.update({
        where: { id: health.id },
        data: { overrideState: null, state: health.computedState },
      });
      await tx.clientHealthHistory.create({
        data: {
          healthId: health.id,
          oldState: health.state,
          newState: health.computedState,
          trigger: 'OVERRIDE_CLEARED',
        },
      });
      return updated;
    });
  }
}
