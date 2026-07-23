import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  ChecklistItemStatus,
  ClientHealthState,
  ContactStatus,
  MarketingServiceStatus,
  OpportunityStatus,
  OnboardingPlanState,
} from '@prisma/client';

export type KpiClassification =
  | 'ACTUAL_VERIFIED'
  | 'MANUALLY_RECORDED'
  | 'MIXED_SOURCES'
  | 'PROJECTED'
  | 'ESTIMATED'
  | 'UNAVAILABLE';

export interface KpiValue {
  code: string;
  value: number | null;
  classification: KpiClassification;
  asOf: string;
  sources: string[];
  missingData?: string[];
}

/**
 * The canonical, static definition of every KPI this app computes.
 * `formula` is prose, not code -- KpiService below is the ONLY place that
 * actually computes a value, so no frontend component (or future backend
 * caller) can silently invent its own version of "collected revenue."
 */
export interface KpiDefinition {
  code: string;
  name: string;
  definition: string;
  formula: string;
  sourceTables: string[];
  dateRange: string;
  refreshFrequency: string;
  owner: string;
  exclusions: string;
  dataQualityState: string;
  defaultClassification: KpiClassification;
}

export const KPI_REGISTRY: KpiDefinition[] = [
  {
    code: 'collectedRevenue90d',
    name: 'Collected Revenue (trailing 90 days)',
    definition:
      'Dollar amount actually recorded as paid by clients in the last 90 days.',
    formula:
      'SUM(ClientCommercialStateChange.amount) WHERE field=PAYMENT AND newValue matches /PAID/ AND createdAt >= now-90d',
    sourceTables: ['ClientCommercialStateChange', 'ClientAccount'],
    dateRange: 'Rolling 90 days ending now',
    refreshFrequency:
      'On every dashboard/report request (live query, not cached)',
    owner: 'DEMM Marketing',
    exclusions:
      'Rows with no recorded amount are not counted (no invoicing/payment-gateway integration exists -- this is a manual ledger, not a verified one).',
    dataQualityState:
      'MANUALLY_RECORDED only; there is no payment-gateway integration in this app.',
    defaultClassification: 'MANUALLY_RECORDED',
  },
  {
    code: 'revenueTargetProgress',
    name: '$45K/90-Day Target Progress',
    definition:
      'Collected revenue (trailing 90d) as a percentage of the $45,000 target.',
    formula: 'collectedRevenue90d / 45000 * 100',
    sourceTables: ['ClientCommercialStateChange'],
    dateRange: 'Rolling 90 days ending now',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: "Inherits collectedRevenue90d's exclusions.",
    dataQualityState: 'Derived from a MANUALLY_RECORDED figure.',
    defaultClassification: 'MANUALLY_RECORDED',
  },
  {
    code: 'mrr',
    name: 'Monthly Recurring Revenue (estimated)',
    definition: "Sum of ACTIVE clients' committed monthly plan price.",
    formula:
      'SUM(OfferSnapshot.price) WHERE ClientAccount.serviceStatus=ACTIVE',
    sourceTables: ['ClientAccount', 'OfferSnapshot'],
    dateRange: 'Point-in-time (current ACTIVE clients)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions:
      'Does not verify the client is actually current on payment this month -- there is no billing system. This is the committed rate, not a collected amount.',
    dataQualityState: 'ESTIMATED: no billing system verifies ongoing payment.',
    defaultClassification: 'ESTIMATED',
  },
  {
    code: 'projectedPipelineRevenue',
    name: 'Projected Pipeline Revenue',
    definition: 'Total value of all OPEN Opportunities in the Marketing BU.',
    formula: 'SUM(Opportunity.value) WHERE status=OPEN',
    sourceTables: ['Opportunity', 'Workspace'],
    dateRange: 'Point-in-time (current OPEN opportunities)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'Excludes WON and LOST opportunities.',
    dataQualityState:
      'PROJECTED: face value of the deal, unweighted by likelihood.',
    defaultClassification: 'PROJECTED',
  },
  {
    code: 'weightedPipelineRevenue',
    name: 'Weighted Pipeline Revenue',
    definition:
      "Pipeline value adjusted by each Opportunity's recorded probability.",
    formula:
      'SUM(Opportunity.value * Opportunity.probability / 100) WHERE status=OPEN',
    sourceTables: ['Opportunity', 'Workspace'],
    dateRange: 'Point-in-time (current OPEN opportunities)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'Excludes WON and LOST opportunities.',
    dataQualityState:
      'PROJECTED: probability is manually set per-opportunity, not derived from history.',
    defaultClassification: 'PROJECTED',
  },
  {
    code: 'leadResponseBacklog',
    name: 'Lead Response Backlog',
    definition: 'Leads with no recorded first-contact Activity yet.',
    formula:
      'COUNT(Contact) WHERE status=LEAD AND no Activity of type in (CALL, EMAIL, MEETING)',
    sourceTables: ['Contact', 'Activity', 'Workspace'],
    dateRange: 'Point-in-time (current open leads)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions:
      'A recorded Activity of any of the three types counts as "responded to," regardless of outcome.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'conversionRate',
    name: 'Lead-to-Client Conversion Rate (trailing 90 days)',
    definition:
      'Share of leads entering the funnel in the last 90 days that became clients.',
    formula:
      'COUNT(ClientAccount created in 90d) / COUNT(Contact created in 90d) * 100',
    sourceTables: ['ClientAccount', 'Contact'],
    dateRange: 'Rolling 90 days ending now',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions:
      'A lead created and converted in the same window counts once in each side of the ratio.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'onboardingCompletionRate',
    name: 'Onboarding Completion Rate',
    definition: 'Share of onboarding plans that have reached COMPLETE.',
    formula:
      'COUNT(OnboardingPlan WHERE state=COMPLETE) / COUNT(OnboardingPlan) * 100',
    sourceTables: ['OnboardingPlan'],
    dateRange: 'Point-in-time (all plans ever generated for this BU)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'None.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'launchReadyCount',
    name: 'Launch-Ready Clients',
    definition:
      'Clients still PENDING_ONBOARDING whose onboarding plan has every required item complete/waived.',
    formula:
      'COUNT(ClientAccount) WHERE serviceStatus=PENDING_ONBOARDING AND all required OnboardingChecklistItem in (COMPLETE, WAIVED)',
    sourceTables: [
      'ClientAccount',
      'OnboardingPlan',
      'OnboardingChecklistItem',
    ],
    dateRange: 'Point-in-time (current pending clients)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'None.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'overdueDeliverablesCount',
    name: 'Overdue Service Deliverables',
    definition:
      'Service deliverables past their due date and not yet delivered/accepted/cancelled.',
    formula:
      'COUNT(ServiceDeliverable) WHERE dueDate < now AND status NOT IN (DELIVERED, ACCEPTED, CANCELLED)',
    sourceTables: ['ServiceDeliverable'],
    dateRange: 'Point-in-time (current deliverables)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions:
      'Deliverables with no dueDate set are never counted as overdue (honest -- no fabricated deadline).',
    dataQualityState:
      'ACTUAL_VERIFIED, but coverage depends on operators actually setting dueDate.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'activeClientsCount',
    name: 'Active Clients',
    definition: 'Clients currently in ACTIVE service status.',
    formula: 'COUNT(ClientAccount) WHERE serviceStatus=ACTIVE',
    sourceTables: ['ClientAccount'],
    dateRange: 'Point-in-time',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'None.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'atRiskClientsCount',
    name: 'At-Risk Clients',
    definition: 'Clients whose Client Health state is AT_RISK or CRITICAL.',
    formula: 'COUNT(ClientHealth) WHERE state IN (AT_RISK, CRITICAL)',
    sourceTables: ['ClientHealth'],
    dateRange: 'Point-in-time (most recent calculation per client)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions:
      'A client with no ClientHealth row yet (never calculated) is not counted here -- see missingData.',
    dataQualityState:
      'ACTUAL_VERIFIED, but only as current as the last recalculation per client.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'churnRate',
    name: 'Churn Rate',
    definition: 'Share of all-time clients whose service status is CHURNED.',
    formula:
      'COUNT(ClientAccount WHERE serviceStatus=CHURNED) / COUNT(ClientAccount) * 100',
    sourceTables: ['ClientAccount'],
    dateRange: 'All-time',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'None.',
    dataQualityState:
      'ACTUAL_VERIFIED: directly counted from real rows. No code path currently sets CHURNED, so this is expected to read 0 today -- that is a true reading of the data, not a bug.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
  {
    code: 'averageClientValue',
    name: 'Average Client Value',
    definition: 'Average committed monthly plan price across all clients.',
    formula: 'AVG(OfferSnapshot.price) across all ClientAccount',
    sourceTables: ['ClientAccount', 'OfferSnapshot'],
    dateRange: 'Point-in-time (all clients ever converted in this BU)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'Based on committed plan price, not verified collected amount.',
    dataQualityState: 'ESTIMATED: no billing system verifies ongoing payment.',
    defaultClassification: 'ESTIMATED',
  },
  {
    code: 'tierDistribution',
    name: 'Founder-Tier Distribution',
    definition:
      'Count of clients on each DEMM OS plan (Survivor/Growth/Empire).',
    formula: 'COUNT(ClientAccount) GROUP BY OfferSnapshot.key',
    sourceTables: ['ClientAccount', 'OfferSnapshot'],
    dateRange: 'Point-in-time (all clients ever converted in this BU)',
    refreshFrequency: 'On every dashboard/report request',
    owner: 'DEMM Marketing',
    exclusions: 'None.',
    dataQualityState: 'ACTUAL_VERIFIED: directly counted from real rows.',
    defaultClassification: 'ACTUAL_VERIFIED',
  },
];

@Injectable()
export class KpiService {
  constructor(private prisma: PrismaService) {}

  private now() {
    return new Date().toISOString();
  }

  private ninetyDaysAgo() {
    return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  }

  async computeAll(businessUnitId: string): Promise<Record<string, KpiValue>> {
    const [
      collectedRevenue90d,
      mrr,
      pipeline,
      leadResponseBacklog,
      conversionRate,
      onboardingCompletionRate,
      launchReadyCount,
      overdueDeliverablesCount,
      activeClientsCount,
      atRiskClientsCount,
      churnRate,
      averageClientValue,
      tierDistribution,
    ] = await Promise.all([
      this.computeCollectedRevenue90d(businessUnitId),
      this.computeMrr(businessUnitId),
      this.computePipeline(businessUnitId),
      this.computeLeadResponseBacklog(businessUnitId),
      this.computeConversionRate(businessUnitId),
      this.computeOnboardingCompletionRate(businessUnitId),
      this.computeLaunchReadyCount(businessUnitId),
      this.computeOverdueDeliverablesCount(businessUnitId),
      this.computeActiveClientsCount(businessUnitId),
      this.computeAtRiskClientsCount(businessUnitId),
      this.computeChurnRate(businessUnitId),
      this.computeAverageClientValue(businessUnitId),
      this.computeTierDistribution(businessUnitId),
    ]);

    const revenueTargetProgress: KpiValue = {
      code: 'revenueTargetProgress',
      value:
        collectedRevenue90d.value === null
          ? null
          : Math.round((collectedRevenue90d.value / 45000) * 1000) / 10,
      classification: collectedRevenue90d.classification,
      asOf: this.now(),
      sources: collectedRevenue90d.sources,
    };

    return {
      collectedRevenue90d,
      revenueTargetProgress,
      mrr,
      projectedPipelineRevenue: pipeline.projected,
      weightedPipelineRevenue: pipeline.weighted,
      leadResponseBacklog,
      conversionRate,
      onboardingCompletionRate,
      launchReadyCount,
      overdueDeliverablesCount,
      activeClientsCount,
      atRiskClientsCount,
      churnRate,
      averageClientValue,
      tierDistribution: tierDistribution as unknown as KpiValue,
    };
  }

  private async computeCollectedRevenue90d(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const rows = await this.prisma.clientCommercialStateChange.findMany({
      where: {
        field: 'PAYMENT',
        newValue: { contains: 'PAID' },
        amount: { not: null },
        createdAt: { gte: this.ninetyDaysAgo() },
        clientAccount: { businessUnitId },
      },
      select: { amount: true, source: true },
    });
    const total = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const sources = new Set(rows.map((r) => r.source));
    let classification: KpiClassification;
    if (rows.length === 0) {
      classification = 'MANUALLY_RECORDED';
    } else if (sources.size === 1 && sources.has('STRIPE_WEBHOOK')) {
      classification = 'ACTUAL_VERIFIED';
    } else if (sources.size === 1 && sources.has('MANUAL')) {
      classification = 'MANUALLY_RECORDED';
    } else {
      classification = 'MIXED_SOURCES';
    }
    return {
      code: 'collectedRevenue90d',
      value: total,
      classification,
      asOf: this.now(),
      sources: ['ClientCommercialStateChange'],
      missingData:
        rows.length === 0
          ? [
              'No manually-recorded or Stripe-verified PAID payment amounts in the trailing 90 days.',
            ]
          : undefined,
    };
  }

  private async computeMrr(businessUnitId: string): Promise<KpiValue> {
    const active = await this.prisma.clientAccount.findMany({
      where: { businessUnitId, serviceStatus: MarketingServiceStatus.ACTIVE },
      include: {
        offerSnapshot: { select: { price: true } },
        billingSubscriptions: {
          where: { status: 'ACTIVE' },
          include: { stripePriceMapping: { select: { amount: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let stripeVerifiedCount = 0;
    const total = active.reduce((sum, c) => {
      const stripeSub = c.billingSubscriptions[0];
      if (stripeSub) {
        stripeVerifiedCount++;
        return sum + Number(stripeSub.stripePriceMapping.amount);
      }
      return sum + Number(c.offerSnapshot.price);
    }, 0);

    const classification: KpiClassification =
      active.length === 0
        ? 'ESTIMATED'
        : stripeVerifiedCount === active.length
          ? 'ACTUAL_VERIFIED'
          : stripeVerifiedCount === 0
            ? 'ESTIMATED'
            : 'MIXED_SOURCES';

    return {
      code: 'mrr',
      value: total,
      classification,
      asOf: this.now(),
      sources: [
        'ClientAccount',
        'OfferSnapshot',
        'BillingSubscription',
        'StripePriceMapping',
      ],
    };
  }

  private async computePipeline(
    businessUnitId: string,
  ): Promise<{ projected: KpiValue; weighted: KpiValue }> {
    const open = await this.prisma.opportunity.findMany({
      where: {
        status: OpportunityStatus.OPEN,
        workspace: { businessUnitId },
      },
      select: { value: true, probability: true },
    });
    const projected = open.reduce((sum, o) => sum + Number(o.value), 0);
    const weighted = open.reduce(
      (sum, o) => sum + (Number(o.value) * o.probability) / 100,
      0,
    );
    return {
      projected: {
        code: 'projectedPipelineRevenue',
        value: projected,
        classification: 'PROJECTED',
        asOf: this.now(),
        sources: ['Opportunity'],
        missingData: open.length === 0 ? ['No open Opportunities.'] : undefined,
      },
      weighted: {
        code: 'weightedPipelineRevenue',
        value: weighted,
        classification: 'PROJECTED',
        asOf: this.now(),
        sources: ['Opportunity'],
      },
    };
  }

  private async computeLeadResponseBacklog(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const leads = await this.prisma.contact.findMany({
      where: { status: ContactStatus.LEAD, workspace: { businessUnitId } },
      select: {
        id: true,
        activities: {
          where: { type: { in: ['CALL', 'EMAIL', 'MEETING'] } },
          take: 1,
        },
      },
    });
    const backlog = leads.filter((l) => l.activities.length === 0).length;
    return {
      code: 'leadResponseBacklog',
      value: backlog,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['Contact', 'Activity'],
    };
  }

  private async computeConversionRate(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const since = this.ninetyDaysAgo();
    const [leadsCreated, clientsCreated] = await Promise.all([
      this.prisma.contact.count({
        where: { workspace: { businessUnitId }, createdAt: { gte: since } },
      }),
      this.prisma.clientAccount.count({
        where: { businessUnitId, createdAt: { gte: since } },
      }),
    ]);
    return {
      code: 'conversionRate',
      value:
        leadsCreated === 0
          ? null
          : Math.round((clientsCreated / leadsCreated) * 1000) / 10,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['Contact', 'ClientAccount'],
      missingData:
        leadsCreated === 0
          ? ['No leads created in the trailing 90 days.']
          : undefined,
    };
  }

  private async computeOnboardingCompletionRate(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const plans = await this.prisma.onboardingPlan.findMany({
      where: { clientAccount: { businessUnitId } },
      select: { state: true },
    });
    const complete = plans.filter(
      (p) => p.state === OnboardingPlanState.COMPLETE,
    ).length;
    return {
      code: 'onboardingCompletionRate',
      value:
        plans.length === 0
          ? null
          : Math.round((complete / plans.length) * 1000) / 10,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['OnboardingPlan'],
      missingData:
        plans.length === 0 ? ['No onboarding plans exist yet.'] : undefined,
    };
  }

  private async computeLaunchReadyCount(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const pending = await this.prisma.clientAccount.findMany({
      where: {
        businessUnitId,
        serviceStatus: MarketingServiceStatus.PENDING_ONBOARDING,
      },
      include: { onboardingPlan: { include: { items: true } } },
    });
    const ready = pending.filter((c) => {
      const items = c.onboardingPlan?.items ?? [];
      const required = items.filter((i) => i.required);
      return (
        required.length > 0 &&
        required.every(
          (i) =>
            i.status === ChecklistItemStatus.COMPLETE ||
            i.status === ChecklistItemStatus.WAIVED,
        )
      );
    }).length;
    return {
      code: 'launchReadyCount',
      value: ready,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['ClientAccount', 'OnboardingPlan', 'OnboardingChecklistItem'],
    };
  }

  private async computeOverdueDeliverablesCount(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const count = await this.prisma.serviceDeliverable.count({
      where: {
        clientAccount: { businessUnitId },
        dueDate: { lt: new Date() },
        status: { notIn: ['DELIVERED', 'ACCEPTED', 'CANCELLED'] },
      },
    });
    return {
      code: 'overdueDeliverablesCount',
      value: count,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['ServiceDeliverable'],
    };
  }

  private async computeActiveClientsCount(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const count = await this.prisma.clientAccount.count({
      where: { businessUnitId, serviceStatus: MarketingServiceStatus.ACTIVE },
    });
    return {
      code: 'activeClientsCount',
      value: count,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['ClientAccount'],
    };
  }

  private async computeAtRiskClientsCount(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const count = await this.prisma.clientHealth.count({
      where: {
        clientAccount: { businessUnitId },
        state: { in: [ClientHealthState.AT_RISK, ClientHealthState.CRITICAL] },
      },
    });
    const totalWithHealth = await this.prisma.clientHealth.count({
      where: { clientAccount: { businessUnitId } },
    });
    const totalClients = await this.prisma.clientAccount.count({
      where: { businessUnitId },
    });
    return {
      code: 'atRiskClientsCount',
      value: count,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['ClientHealth'],
      missingData:
        totalWithHealth < totalClients
          ? [
              `${totalClients - totalWithHealth} client(s) have no Client Health calculation yet.`,
            ]
          : undefined,
    };
  }

  private async computeChurnRate(businessUnitId: string): Promise<KpiValue> {
    const [churned, total] = await Promise.all([
      this.prisma.clientAccount.count({
        where: {
          businessUnitId,
          serviceStatus: MarketingServiceStatus.CHURNED,
        },
      }),
      this.prisma.clientAccount.count({ where: { businessUnitId } }),
    ]);
    return {
      code: 'churnRate',
      value: total === 0 ? null : Math.round((churned / total) * 1000) / 10,
      classification: 'ACTUAL_VERIFIED',
      asOf: this.now(),
      sources: ['ClientAccount'],
      missingData: total === 0 ? ['No clients exist yet.'] : undefined,
    };
  }

  private async computeAverageClientValue(
    businessUnitId: string,
  ): Promise<KpiValue> {
    const clients = await this.prisma.clientAccount.findMany({
      where: { businessUnitId },
      include: { offerSnapshot: { select: { price: true } } },
    });
    const avg =
      clients.length === 0
        ? null
        : clients.reduce((sum, c) => sum + Number(c.offerSnapshot.price), 0) /
          clients.length;
    return {
      code: 'averageClientValue',
      value: avg,
      classification: 'ESTIMATED',
      asOf: this.now(),
      sources: ['ClientAccount', 'OfferSnapshot'],
      missingData: clients.length === 0 ? ['No clients exist yet.'] : undefined,
    };
  }

  private async computeTierDistribution(businessUnitId: string) {
    const clients = await this.prisma.clientAccount.findMany({
      where: { businessUnitId },
      include: { offerSnapshot: { select: { key: true } } },
    });
    const counts: Record<string, number> = {};
    for (const c of clients) {
      counts[c.offerSnapshot.key] = (counts[c.offerSnapshot.key] ?? 0) + 1;
    }
    return {
      code: 'tierDistribution',
      value: counts,
      classification: 'ACTUAL_VERIFIED' as KpiClassification,
      asOf: this.now(),
      sources: ['ClientAccount', 'OfferSnapshot'],
    };
  }
}
