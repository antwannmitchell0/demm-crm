import { Injectable } from '@nestjs/common';
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
    const workspaceId = await this.getWorkspaceId(contactId);
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, workspaceId, channel, optedOut: true, reason },
      update: { optedOut: true, reason },
    });
    await this.relationshipSignals.createSignal(
      contactId,
      'CONSENT_STOP',
      `Contact opted out of ${channel} communications (${reason}).`,
    );
  }

  async recordOptIn(
    contactId: string,
    channel: ConsentChannelType,
    reason: string,
  ): Promise<void> {
    const workspaceId = await this.getWorkspaceId(contactId);
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, workspaceId, channel, optedOut: false, reason },
      update: { optedOut: false, reason },
    });
    await this.relationshipSignals.createSignal(
      contactId,
      'CONSENT_START',
      `Contact opted back in to ${channel} communications (${reason}).`,
    );
  }

  private async getWorkspaceId(contactId: string): Promise<string> {
    const contact = await this.prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: { workspaceId: true },
    });
    return contact.workspaceId;
  }

  parseSmsKeyword(body: string): 'STOP' | 'START' | 'HELP' | null {
    const normalized = body.trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalized)) return 'STOP';
    if (START_KEYWORDS.has(normalized)) return 'START';
    if (HELP_KEYWORDS.has(normalized)) return 'HELP';
    return null;
  }
}
