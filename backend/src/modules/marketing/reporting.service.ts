import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ChecklistItemStatus, ServiceDeliverableStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface EvidenceRef {
  type:
    | 'ChecklistItem'
    | 'ServiceDeliverable'
    | 'Task'
    | 'Opportunity'
    | 'ClientCommercialStateChange'
    | 'Manual';
  id: string | null;
  description: string;
}

/**
 * Two separate report generators, deliberately kept apart (not one report
 * with a "client-safe view flag") so it is structurally impossible for an
 * internal-only field to leak into the client-facing path by a missed
 * conditional. Every line item in either report carries an `evidence`
 * reference back to a real row -- see EvidenceRef -- so no statement is
 * ever just prose with nothing behind it.
 */
@Injectable()
export class ReportingService {
  constructor(
    private prisma: PrismaService,
    private dashboard: DashboardService,
  ) {}

  async getInternalOperatingReport(businessUnitId: string) {
    const dashboardData = await this.dashboard.getDashboard(businessUnitId);

    const knownLimitations = [
      'No payment gateway or invoicing system is integrated -- all revenue figures are either MANUALLY_RECORDED (from operator-entered payment events) or ESTIMATED (from committed plan price), never independently verified.',
      'No renewal/repeat-purchase tracking exists -- "returning client opportunities" is reported as UNAVAILABLE.',
      'Overdue-item metrics only cover items where an operator has actually set a dueDate -- coverage depends on that discipline.',
      'Client Health recalculates on relevant mutations (checklist/deliverable updates, activation), not on a fixed schedule -- a client with no recent activity may show a stale assessment.',
    ];

    return {
      generatedAt: new Date().toISOString(),
      businessUnitId,
      revenueTrajectory: dashboardData.revenueTrajectory,
      pipeline: dashboardData.leadPipelineHealth,
      onboardingProgress: dashboardData.clientOperations,
      atRiskClients: dashboardData.relationshipIntelligence.atRiskClients,
      overdueCommitments: dashboardData.clientOperations.commitmentsAtRisk,
      topNextActions: dashboardData.relationshipIntelligence.atRiskClients
        .filter((c) => c.recommendedAction)
        .map((c) => ({
          clientAccountId: c.clientAccountId,
          clientName: c.clientName,
          action: c.recommendedAction,
        })),
      operationalBlockers: dashboardData.clientOperations.blockedClients,
      systemLimitations: knownLimitations,
    };
  }

  async getClientProgressReport(
    businessUnitId: string,
    clientAccountId: string,
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: {
        offerSnapshot: true,
        primaryContact: { select: { firstName: true, lastName: true } },
        company: { select: { name: true } },
        onboardingPlan: { include: { items: true } },
        serviceDeliverables: true,
      },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }

    const items = clientAccount.onboardingPlan?.items ?? [];
    const deliverables = clientAccount.serviceDeliverables;
    const upcomingCutoff = new Date(Date.now() + THIRTY_DAYS_MS);

    const workCompleted: { description: string; evidence: EvidenceRef }[] = [
      ...items
        .filter((i) => i.status === ChecklistItemStatus.COMPLETE)
        .map((i) => ({
          description: i.title,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'Onboarding checklist item marked complete',
          },
        })),
      ...deliverables
        .filter((d) => ['DELIVERED', 'ACCEPTED'].includes(d.status))
        .map((d) => ({
          description: d.name,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: `Service deliverable, status=${d.status}`,
          },
        })),
    ];

    const workInProgress = [
      ...items
        .filter((i) => i.status === ChecklistItemStatus.IN_PROGRESS)
        .map((i) => ({
          description: i.title,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'In progress',
          },
        })),
      ...deliverables
        .filter((d) => d.status === ServiceDeliverableStatus.IN_PROGRESS)
        .map((d) => ({
          description: d.name,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: 'In progress',
          },
        })),
    ];

    const waitingOnClient = items
      .filter((i) => i.status === ChecklistItemStatus.WAITING_ON_CLIENT)
      .map((i) => ({
        description: i.title,
        evidence: {
          type: 'ChecklistItem' as const,
          id: i.id,
          description: 'Waiting on client',
        },
      }));

    const demmOwedItemStatuses: ChecklistItemStatus[] = [
      ChecklistItemStatus.NOT_STARTED,
      ChecklistItemStatus.IN_PROGRESS,
      ChecklistItemStatus.BLOCKED,
    ];
    const demmOwedDeliverableStatuses: ServiceDeliverableStatus[] = [
      ServiceDeliverableStatus.NOT_STARTED,
      ServiceDeliverableStatus.BLOCKED,
    ];
    const waitingOnDemm = [
      ...items
        .filter(
          (i) =>
            i.responsibility === 'DEMM' &&
            demmOwedItemStatuses.includes(i.status),
        )
        .map((i) => ({
          description: i.title,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'DEMM-owed item',
          },
        })),
      ...deliverables
        .filter((d) => demmOwedDeliverableStatuses.includes(d.status))
        .map((d) => ({
          description: d.name,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: `Deliverable, status=${d.status}`,
          },
        })),
    ];

    const blockers = [
      ...items
        .filter((i) => i.status === ChecklistItemStatus.BLOCKED)
        .map((i) => ({
          description: i.blockerReason ?? `"${i.title}" is blocked`,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'Blocked item',
          },
        })),
      ...deliverables
        .filter((d) => d.status === ServiceDeliverableStatus.BLOCKED)
        .map((d) => ({
          description: d.blockerReason ?? `"${d.name}" is blocked`,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: 'Blocked deliverable',
          },
        })),
    ];

    const evidenceAndDeliverables = [
      ...items
        .filter((i) => i.evidence)
        .map((i) => ({
          description: `${i.title}: ${i.evidence}`,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'Recorded evidence',
          },
        })),
      ...deliverables
        .filter((d) => d.evidence)
        .map((d) => ({
          description: `${d.name}: ${d.evidence}`,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: 'Recorded evidence',
          },
        })),
    ];

    const upcomingMilestones = [
      ...items
        .filter(
          (i) =>
            i.dueDate && i.dueDate <= upcomingCutoff && i.dueDate >= new Date(),
        )
        .map((i) => ({
          description: i.title,
          dueDate: i.dueDate,
          evidence: {
            type: 'ChecklistItem' as const,
            id: i.id,
            description: 'Upcoming due date',
          },
        })),
      ...deliverables
        .filter(
          (d) =>
            d.dueDate && d.dueDate <= upcomingCutoff && d.dueDate >= new Date(),
        )
        .map((d) => ({
          description: d.name,
          dueDate: d.dueDate,
          evidence: {
            type: 'ServiceDeliverable' as const,
            id: d.id,
            description: 'Upcoming due date',
          },
        })),
    ];

    const agreedNextSteps = [...waitingOnClient, ...waitingOnDemm].slice(0, 5);

    const dataAvailable = clientAccount.onboardingPlan !== null;

    return {
      generatedAt: new Date().toISOString(),
      clientName:
        clientAccount.company?.name ??
        `${clientAccount.primaryContact.firstName} ${clientAccount.primaryContact.lastName}`,
      purchased: {
        planName: clientAccount.offerSnapshot.name,
        price: clientAccount.offerSnapshot.price,
        includedServices: clientAccount.offerSnapshot.includedServices,
      },
      servicePeriod: {
        startedAt: clientAccount.createdAt,
        coveredThrough: new Date().toISOString(),
      },
      workCompleted,
      workInProgress,
      waitingOnClient,
      waitingOnDemm,
      blockers,
      evidenceAndDeliverables,
      agreedNextSteps,
      upcomingMilestones,
      dataAvailabilityNote: dataAvailable
        ? null
        : 'No onboarding plan has been generated for this client yet -- this report is incomplete.',
    };
  }
}
