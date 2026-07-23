import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  ChecklistItemStatus,
  ServiceDeliverableStatus,
  ClientHealthState,
  ContactStatus,
  OpportunityStatus,
  CandidateState,
} from '@prisma/client';
import { KpiService, KpiValue } from './kpi.service';

const STALLED_DAYS = 21;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Single source of truth for the Marketing Dashboard. Every number here
 * either comes straight from KpiService (the canonical registry) or is
 * computed once, here, in the same honest style -- real counts, explicit
 * UNAVAILABLE where the app genuinely has no data for something, never a
 * frontend-invented formula.
 */
@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private kpi: KpiService,
  ) {}

  async getDashboard(businessUnitId: string) {
    const kpis = await this.kpi.computeAll(businessUnitId);
    const [leadPipelineHealth, clientOperations, relationshipIntelligence] =
      await Promise.all([
        this.getLeadPipelineHealth(businessUnitId, kpis),
        this.getClientOperations(businessUnitId),
        this.getRelationshipIntelligence(businessUnitId),
      ]);

    return {
      businessUnitId,
      generatedAt: new Date().toISOString(),
      revenueTrajectory: {
        target90d: 45000,
        collectedRevenue90d: kpis.collectedRevenue90d,
        revenueTargetProgress: kpis.revenueTargetProgress,
        mrr: kpis.mrr,
        projectedPipelineRevenue: kpis.projectedPipelineRevenue,
        activeClientCount: kpis.activeClientsCount,
        tierDistribution: kpis.tierDistribution,
        averageClientValue: kpis.averageClientValue,
      },
      leadPipelineHealth,
      clientOperations,
      relationshipIntelligence,
    };
  }

  private async getLeadPipelineHealth(
    businessUnitId: string,
    kpis: Record<string, KpiValue>,
  ) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      newLeadsToday,
      overdueTasks,
      opportunitiesByStage,
      recentConversions,
      lostOpportunities,
      allOpenOpportunities,
    ] = await Promise.all([
      this.prisma.contact.count({
        where: {
          workspace: { businessUnitId },
          status: ContactStatus.LEAD,
          createdAt: { gte: startOfToday },
        },
      }),
      this.prisma.task.findMany({
        where: {
          workspace: { businessUnitId },
          status: 'PENDING',
          dueDate: { lt: new Date() },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          contactId: true,
          opportunityId: true,
        },
      }),
      this.prisma.opportunity.groupBy({
        by: ['stageId'],
        where: {
          workspace: { businessUnitId },
          status: OpportunityStatus.OPEN,
        },
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.clientAccount.findMany({
        where: { businessUnitId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          createdAt: true,
          primaryContact: { select: { firstName: true, lastName: true } },
          offerSnapshot: { select: { name: true } },
        },
      }),
      this.prisma.opportunity.findMany({
        where: {
          workspace: { businessUnitId },
          status: OpportunityStatus.LOST,
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          value: true,
          updatedAt: true,
          aiInsights: true,
        },
      }),
      this.prisma.opportunity.findMany({
        where: {
          workspace: { businessUnitId },
          status: OpportunityStatus.OPEN,
        },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          value: true,
          stageId: true,
        },
      }),
    ]);

    const stageMeta = await this.prisma.stage.findMany({
      where: { id: { in: opportunitiesByStage.map((s) => s.stageId) } },
      select: { id: true, name: true },
    });
    const stageNameById = new Map(stageMeta.map((s) => [s.id, s.name]));

    const stalledCutoff = new Date(
      Date.now() - STALLED_DAYS * 24 * 60 * 60 * 1000,
    );
    const stalledOpportunities = allOpenOpportunities.filter(
      (o) => o.updatedAt < stalledCutoff,
    );

    return {
      newLeadsToday,
      leadResponseBacklog: kpis.leadResponseBacklog,
      leadsWithOverdueNextAction: overdueTasks.length,
      overdueNextActions: overdueTasks.slice(0, 10),
      opportunitiesByStage: opportunitiesByStage.map((s) => ({
        stageId: s.stageId,
        stageName: stageNameById.get(s.stageId) ?? 'Unknown stage',
        count: s._count._all,
        totalValue: s._sum.value ?? 0,
      })),
      weightedPipeline: kpis.weightedPipelineRevenue,
      projectedPipeline: kpis.projectedPipelineRevenue,
      stalledOpportunitiesCount: stalledOpportunities.length,
      stalledOpportunities: stalledOpportunities.slice(0, 10).map((o) => ({
        id: o.id,
        name: o.name,
        value: o.value,
        daysSinceUpdate: Math.floor(
          (Date.now() - o.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
        ),
      })),
      recentConversions: recentConversions.map((c) => ({
        clientAccountId: c.id,
        clientName: `${c.primaryContact.firstName} ${c.primaryContact.lastName}`,
        offerName: c.offerSnapshot.name,
        convertedAt: c.createdAt,
      })),
      lostOpportunities: lostOpportunities.map((o) => ({
        id: o.id,
        name: o.name,
        value: o.value,
        lostAt: o.updatedAt,
        reason: o.aiInsights ?? null,
      })),
    };
  }

  private async getClientOperations(businessUnitId: string) {
    const clients = await this.prisma.clientAccount.findMany({
      where: { businessUnitId },
      include: {
        onboardingPlan: { include: { items: true } },
        serviceDeliverables: true,
        health: true,
        primaryContact: { select: { firstName: true, lastName: true } },
      },
    });

    const pendingOnboarding = clients.filter(
      (c) => c.serviceStatus === 'PENDING_ONBOARDING',
    );
    const blockedClients: {
      clientAccountId: string;
      clientName: string;
      blockedItems: number;
    }[] = [];
    const waitingOnDemm: string[] = [];
    const waitingOnThemselves: string[] = [];
    let launchReady = 0;

    for (const c of pendingOnboarding) {
      const items = c.onboardingPlan?.items ?? [];
      const blocked = items.filter(
        (i) => i.status === ChecklistItemStatus.BLOCKED,
      );
      if (blocked.length > 0) {
        blockedClients.push({
          clientAccountId: c.id,
          clientName: `${c.primaryContact.firstName} ${c.primaryContact.lastName}`,
          blockedItems: blocked.length,
        });
      }
      const demmDoneStatuses: ChecklistItemStatus[] = [
        ChecklistItemStatus.COMPLETE,
        ChecklistItemStatus.WAIVED,
        ChecklistItemStatus.CANCELLED,
      ];
      const demmOwed = items.some(
        (i) =>
          i.responsibility === 'DEMM' && !demmDoneStatuses.includes(i.status),
      );
      const clientOwed = items.some(
        (i) =>
          i.responsibility === 'CLIENT' &&
          i.status === ChecklistItemStatus.WAITING_ON_CLIENT,
      );
      if (demmOwed) waitingOnDemm.push(c.id);
      if (clientOwed) waitingOnThemselves.push(c.id);

      const required = items.filter((i) => i.required);
      if (
        required.length > 0 &&
        required.every(
          (i) =>
            i.status === ChecklistItemStatus.COMPLETE ||
            i.status === ChecklistItemStatus.WAIVED,
        )
      ) {
        launchReady++;
      }
    }

    const overdueDeliverables = clients.flatMap((c) =>
      c.serviceDeliverables
        .filter(
          (d) =>
            d.dueDate &&
            d.dueDate < new Date() &&
            !['DELIVERED', 'ACCEPTED', 'CANCELLED'].includes(d.status),
        )
        .map((d) => ({
          clientAccountId: c.id,
          clientName: `${c.primaryContact.firstName} ${c.primaryContact.lastName}`,
          deliverableName: d.name,
          dueDate: d.dueDate,
        })),
    );

    const outsideScopeRequests = clients.flatMap((c) =>
      c.serviceDeliverables
        .filter(
          (d) =>
            d.outsideScope && d.status !== ServiceDeliverableStatus.CANCELLED,
        )
        .map((d) => ({
          clientAccountId: c.id,
          clientName: `${c.primaryContact.firstName} ${c.primaryContact.lastName}`,
          deliverableName: d.name,
          status: d.status,
        })),
    );

    const commitmentsAtRisk = [
      ...blockedClients.map(
        (b) => `${b.clientName}: ${b.blockedItems} blocked item(s)`,
      ),
      ...overdueDeliverables.map(
        (d) =>
          `${d.clientName}: "${d.deliverableName}" overdue since ${d.dueDate?.toISOString().slice(0, 10)}`,
      ),
    ];

    return {
      pendingOnboardingCount: pendingOnboarding.length,
      launchReadyCount: launchReady,
      activeCount: clients.filter((c) => c.serviceStatus === 'ACTIVE').length,
      blockedClients,
      clientsWaitingOnDemmCount: waitingOnDemm.length,
      clientsWaitingOnThemselvesCount: waitingOnThemselves.length,
      overdueDeliverables,
      outsideScopeRequests,
      commitmentsAtRisk,
    };
  }

  private async getRelationshipIntelligence(businessUnitId: string) {
    const atRiskHealth = await this.prisma.clientHealth.findMany({
      where: {
        clientAccount: { businessUnitId },
        state: { in: [ClientHealthState.AT_RISK, ClientHealthState.CRITICAL] },
      },
      include: {
        clientAccount: {
          select: {
            id: true,
            primaryContact: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { calculatedAt: 'desc' },
      take: 10,
    });

    const activeSignals = await this.prisma.relationshipSignal.count({
      where: {
        profile: { businessUnitId },
        state: 'ACTIVE',
      },
    });

    const pendingCandidates = await this.prisma.memoryCandidate.count({
      where: {
        profile: { businessUnitId },
        status: CandidateState.PENDING,
      },
    });

    const approachingDueDates = await this.prisma.onboardingChecklistItem.count(
      {
        where: {
          plan: { clientAccount: { businessUnitId } },
          dueDate: {
            gte: new Date(),
            lte: new Date(Date.now() + SEVEN_DAYS_MS),
          },
          status: {
            notIn: [
              ChecklistItemStatus.COMPLETE,
              ChecklistItemStatus.WAIVED,
              ChecklistItemStatus.CANCELLED,
            ],
          },
        },
      },
    );

    return {
      // Deliberately summary-only -- no raw engram/candidate content, no
      // internal confidence scores, matching "do not expose private or
      // unnecessary memory details on the executive dashboard."
      atRiskClients: atRiskHealth.map((h) => ({
        clientAccountId: h.clientAccountId,
        clientName: `${h.clientAccount.primaryContact.firstName} ${h.clientAccount.primaryContact.lastName}`,
        state: h.state,
        recommendedAction: h.recommendedAction,
      })),
      activeRelationshipSignalsCount: activeSignals,
      memoriesAwaitingReconfirmationCount: pendingCandidates,
      milestonesApproachingCount: approachingDueDates,
      returningClientOpportunities: {
        value: null,
        classification: 'UNAVAILABLE',
        note: 'No renewal/repeat-purchase tracking exists yet in this app.',
      },
    };
  }
}
