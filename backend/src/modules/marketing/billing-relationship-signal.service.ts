import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SeverityState, SignalState } from '@prisma/client';

export type BillingSignalType =
  | 'CHECKOUT_PENDING'
  | 'BILLING_SETUP_FAILED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILURE'
  | 'PAST_DUE'
  | 'CANCELLATION_SCHEDULED'
  | 'CANCELLATION_COMPLETED'
  | 'PAYMENT_RECOVERY';

const SEVERITY_BY_TYPE: Record<BillingSignalType, SeverityState> = {
  CHECKOUT_PENDING: SeverityState.LOW,
  BILLING_SETUP_FAILED: SeverityState.HIGH,
  PAYMENT_SUCCESS: SeverityState.LOW,
  PAYMENT_FAILURE: SeverityState.MEDIUM,
  PAST_DUE: SeverityState.HIGH,
  CANCELLATION_SCHEDULED: SeverityState.MEDIUM,
  CANCELLATION_COMPLETED: SeverityState.HIGH,
  PAYMENT_RECOVERY: SeverityState.LOW,
};

// Types that self-resolve immediately (no standing ACTIVE signal
// accumulates for routine, healthy-state events -- avoids monthly memory
// spam for PAYMENT_SUCCESS specifically).
const SELF_RESOLVING: BillingSignalType[] = [
  'PAYMENT_SUCCESS',
  'PAYMENT_RECOVERY',
];

@Injectable()
export class BillingRelationshipSignalService {
  private readonly logger = new Logger(BillingRelationshipSignalService.name);

  constructor(private prisma: PrismaService) {}

  private async findProfileForClient(
    clientAccountId: string,
  ): Promise<string | null> {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
    });
    if (!clientAccount) return null;
    const subject = await this.prisma.relationshipSubject.findFirst({
      where: { contactId: clientAccount.primaryContactId },
    });
    if (!subject) return null;
    const profile = await this.prisma.relationshipProfile.findFirst({
      where: {
        subjectId: subject.id,
        businessUnitId: clientAccount.businessUnitId,
      },
    });
    return profile?.id ?? null;
  }

  async createSignal(
    clientAccountId: string,
    type: BillingSignalType,
    summary: string,
  ): Promise<void> {
    const profileId = await this.findProfileForClient(clientAccountId);
    if (!profileId) {
      this.logger.warn(
        `No RelationshipProfile found for client ${clientAccountId} -- skipping signal ${type}.`,
      );
      return;
    }

    await this.prisma.relationshipSignal.create({
      data: {
        profileId,
        type,
        summary,
        confidence: 1.0,
        severity: SEVERITY_BY_TYPE[type],
        state: SELF_RESOLVING.includes(type)
          ? SignalState.RESOLVED
          : SignalState.ACTIVE,
        resolvedAt: SELF_RESOLVING.includes(type) ? new Date() : null,
      },
    });
  }

  /** True if the client's profile has any still-ACTIVE signal of the given type(s). */
  async hasActiveSignal(
    clientAccountId: string,
    types: BillingSignalType[],
  ): Promise<boolean> {
    const profileId = await this.findProfileForClient(clientAccountId);
    if (!profileId) return false;
    const match = await this.prisma.relationshipSignal.findFirst({
      where: { profileId, type: { in: types }, state: SignalState.ACTIVE },
    });
    return !!match;
  }

  /** Auto-resolves any still-ACTIVE signal of the given type(s) for a client's profile. */
  async resolveSignals(
    clientAccountId: string,
    types: BillingSignalType[],
  ): Promise<void> {
    const profileId = await this.findProfileForClient(clientAccountId);
    if (!profileId) return;
    await this.prisma.relationshipSignal.updateMany({
      where: { profileId, type: { in: types }, state: SignalState.ACTIVE },
      data: { state: SignalState.RESOLVED, resolvedAt: new Date() },
    });
  }
}
