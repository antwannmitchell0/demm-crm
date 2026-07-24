import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ConsentChannelType } from '@prisma/client';
import { CommunicationRelationshipSignalService } from './communication-relationship-signal.service';

const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
]);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

@Injectable()
export class CommunicationConsentService {
  private readonly logger = new Logger(CommunicationConsentService.name);

  constructor(
    private prisma: PrismaService,
    private relationshipSignals: CommunicationRelationshipSignalService,
  ) {}

  async isOptedOut(
    contactId: string,
    channel: ConsentChannelType,
  ): Promise<boolean> {
    const row = await this.prisma.communicationConsent.findUnique({
      where: { contactId_channel: { contactId, channel } },
    });
    return row?.optedOut ?? false;
  }

  async recordOptOut(
    contactId: string,
    channel: ConsentChannelType,
    reason: string,
  ): Promise<void> {
    const { workspaceId, businessUnitId } =
      await this.getWorkspaceAndBusinessUnitId(contactId);
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, workspaceId, channel, optedOut: true, reason },
      update: { optedOut: true, reason },
    });
    if (businessUnitId) {
      await this.relationshipSignals.createSignal(
        contactId,
        businessUnitId,
        'CONSENT_STOP',
        `Contact opted out of ${channel} communications (${reason}).`,
      );
    } else {
      this.logger.warn(
        `Contact ${contactId}'s workspace ${workspaceId} has no businessUnitId -- skipping CONSENT_STOP signal.`,
      );
    }
  }

  async recordOptIn(
    contactId: string,
    channel: ConsentChannelType,
    reason: string,
  ): Promise<void> {
    const { workspaceId, businessUnitId } =
      await this.getWorkspaceAndBusinessUnitId(contactId);
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, workspaceId, channel, optedOut: false, reason },
      update: { optedOut: false, reason },
    });
    if (businessUnitId) {
      await this.relationshipSignals.createSignal(
        contactId,
        businessUnitId,
        'CONSENT_START',
        `Contact opted back in to ${channel} communications (${reason}).`,
      );
    } else {
      this.logger.warn(
        `Contact ${contactId}'s workspace ${workspaceId} has no businessUnitId -- skipping CONSENT_START signal.`,
      );
    }
  }

  /**
   * Resolves both the Contact's workspaceId (needed for the
   * CommunicationConsent row) and its Workspace's businessUnitId (needed to
   * scope the RelationshipProfile lookup in CommunicationRelationshipSignalService
   * -- see that service's findProfileForContact for why cross-business-unit
   * scoping is mandatory). Workspace.businessUnitId is nullable in the
   * schema (a workspace can exist before being assigned to a Business
   * Unit), so businessUnitId comes back null in that edge case and callers
   * must treat it as "skip the signal," not fall back to some other unit.
   */
  private async getWorkspaceAndBusinessUnitId(
    contactId: string,
  ): Promise<{ workspaceId: string; businessUnitId: string | null }> {
    const contact = await this.prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: {
        workspaceId: true,
        workspace: { select: { businessUnitId: true } },
      },
    });
    return {
      workspaceId: contact.workspaceId,
      businessUnitId: contact.workspace.businessUnitId,
    };
  }

  parseSmsKeyword(body: string): 'STOP' | 'START' | 'HELP' | null {
    const normalized = body.trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalized)) return 'STOP';
    if (START_KEYWORDS.has(normalized)) return 'START';
    if (HELP_KEYWORDS.has(normalized)) return 'HELP';
    return null;
  }
}
