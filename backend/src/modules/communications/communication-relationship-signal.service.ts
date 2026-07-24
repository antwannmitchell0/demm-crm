import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SeverityState, SignalState } from '@prisma/client';

export type CommunicationSignalType =
  | 'CONSENT_STOP'
  | 'CONSENT_START'
  | 'CONSENT_HELP'
  | 'UNSUBSCRIBE'
  | 'COMPLAINT'
  | 'MISSED_CALL_DETECTED'
  | 'MISSED_CALL_TEXTBACK_SENT'
  | 'MISSED_CALL_TEXTBACK_SUPPRESSED_COOLDOWN';

const SEVERITY_BY_TYPE: Record<CommunicationSignalType, SeverityState> = {
  CONSENT_STOP: SeverityState.MEDIUM,
  CONSENT_START: SeverityState.LOW,
  CONSENT_HELP: SeverityState.LOW,
  UNSUBSCRIBE: SeverityState.MEDIUM,
  COMPLAINT: SeverityState.HIGH,
  MISSED_CALL_DETECTED: SeverityState.MEDIUM,
  MISSED_CALL_TEXTBACK_SENT: SeverityState.LOW,
  MISSED_CALL_TEXTBACK_SUPPRESSED_COOLDOWN: SeverityState.LOW,
};

// Types that self-resolve immediately (no standing ACTIVE signal accumulates
// for routine, healthy-state events) -- mirrors billing-relationship-signal
// .service.ts's SELF_RESOLVING treatment of PAYMENT_SUCCESS/PAYMENT_RECOVERY.
// CONSENT_START, a successful text-back, and a suppressed (already-handled)
// text-back are all "things resolved themselves" rather than open problems;
// CONSENT_STOP and a freshly detected missed call are the open problems that
// stay ACTIVE until something (an opt-back-in, a human callback) closes them.
const SELF_RESOLVING: CommunicationSignalType[] = [
  'CONSENT_START',
  'MISSED_CALL_TEXTBACK_SENT',
  'MISSED_CALL_TEXTBACK_SUPPRESSED_COOLDOWN',
];

@Injectable()
export class CommunicationRelationshipSignalService {
  private readonly logger = new Logger(
    CommunicationRelationshipSignalService.name,
  );

  constructor(private prisma: PrismaService) {}

  /**
   * Resolves a Contact directly to its RelationshipProfile -- mirrors the
   * subject/profile lookup steps inside billing-relationship-signal
   * .service.ts's findProfileForClient (RelationshipSubject by contactId,
   * then RelationshipProfile by subjectId). Communications events only ever
   * carry a bare contactId (no ClientAccount/BusinessUnit context is
   * available at the consent/call-event call sites), so unlike billing's
   * version this does not scope by businessUnitId -- it takes whichever
   * profile the subject already has.
   */
  private async findProfileForContact(
    contactId: string,
  ): Promise<string | null> {
    const subject = await this.prisma.relationshipSubject.findFirst({
      where: { contactId },
    });
    if (!subject) return null;
    const profile = await this.prisma.relationshipProfile.findFirst({
      where: { subjectId: subject.id },
    });
    return profile?.id ?? null;
  }

  async createSignal(
    contactId: string,
    type: CommunicationSignalType,
    summary: string,
  ): Promise<void> {
    const profileId = await this.findProfileForContact(contactId);
    if (!profileId) {
      this.logger.warn(
        `No RelationshipProfile found for contact ${contactId} -- skipping signal ${type}.`,
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

  /** True if the contact's profile has any still-ACTIVE signal of the given type(s). */
  async hasActiveSignal(
    contactId: string,
    types: CommunicationSignalType[],
  ): Promise<boolean> {
    const profileId = await this.findProfileForContact(contactId);
    if (!profileId) return false;
    const match = await this.prisma.relationshipSignal.findFirst({
      where: { profileId, type: { in: types }, state: SignalState.ACTIVE },
    });
    return !!match;
  }

  /** Auto-resolves any still-ACTIVE signal of the given type(s) for a contact's profile. */
  async resolveSignals(
    contactId: string,
    types: CommunicationSignalType[],
  ): Promise<void> {
    const profileId = await this.findProfileForContact(contactId);
    if (!profileId) return;
    await this.prisma.relationshipSignal.updateMany({
      where: { profileId, type: { in: types }, state: SignalState.ACTIVE },
      data: { state: SignalState.RESOLVED, resolvedAt: new Date() },
    });
  }
}
