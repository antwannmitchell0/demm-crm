import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { MessageTemplateService } from './message-template.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { ConversationChannel } from '@prisma/client';

@Controller('marketing/communications/templates')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class MessageTemplateController {
  constructor(private templates: MessageTemplateService) {}

  @Get()
  list(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Query('channel') channel?: ConversationChannel,
  ) {
    return this.templates.list(businessUnitId, channel);
  }

  @Post()
  create(
    @Body() body: { channel: ConversationChannel; name: string; body: string },
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
  ) {
    return this.templates.create({
      workspaceId,
      businessUnitId,
      channel: body.channel,
      name: body.name,
      body: body.body,
    });
  }
}
