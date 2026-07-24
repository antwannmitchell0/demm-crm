import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageTemplate, ConversationChannel } from '@prisma/client';

@Injectable()
export class MessageTemplateService {
  constructor(private prisma: PrismaService) {}

  async create(params: {
    workspaceId: string;
    businessUnitId: string;
    channel: ConversationChannel;
    name: string;
    body: string;
  }): Promise<MessageTemplate> {
    return this.prisma.messageTemplate.create({ data: params });
  }

  async list(businessUnitId: string, channel?: ConversationChannel): Promise<MessageTemplate[]> {
    return this.prisma.messageTemplate.findMany({
      where: { businessUnitId, channel, active: true },
    });
  }

  resolve(template: Pick<MessageTemplate, 'body'>, tokens: Record<string, string>): string {
    return template.body.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
    );
  }
}
