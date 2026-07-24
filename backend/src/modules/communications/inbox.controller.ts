import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';

// Unified Inbox surface (Task 17) -- backend for the frontend Inbox UI
// (Task 18). Deliberately workspace-wide, not Business-Unit-scoped: unlike
// MessageTemplateController/SmsOutboundController/EmailOutboundController
// (which gate on @CurrentBusinessUnitId()), an inbox reasonably spans every
// Business Unit's conversations within the operator's workspace, so only
// WorkspaceGuard (not BusinessUnitGuard) is applied here.
@Controller('marketing/communications/inbox')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class InboxController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: Request & { workspaceId: string }) {
    return this.prisma.conversation.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        channelConnection: { select: { status: true, type: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // conversationId is client-supplied (route param). This is a
  // fetch-then-verify pattern, not the unscoped-findUnique IDOR pattern
  // found and fixed in Tasks 10/13/14 (SMS/MessageTemplate/Email
  // controllers, which fetched a Business-Unit-scoped resource by id alone
  // and then TRUSTED the fetched row's businessUnitId as the caller's
  // context without ever checking it against a guard-verified value):
  // here the fetched conversation.workspaceId is explicitly compared
  // against WorkspaceGuard's DB-verified req.workspaceId before the row is
  // ever returned, and a mismatch (or a nonexistent id) throws
  // ForbiddenException rather than silently trusting the row. A combined
  // findFirst({ where: { id, workspaceId } }) would enforce the same scope
  // but collapse "wrong workspace" and "doesn't exist" into an
  // indistinguishable null -- the explicit fetch + compare is kept so a
  // cross-workspace conversationId reliably 403s (not 404s), matching this
  // task's required test assertion.
  @Get(':conversationId')
  async thread(
    @Param('conversationId') conversationId: string,
    @Req() req: Request & { workspaceId: string },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { deliveryAttempts: true },
        },
        channelConnection: { select: { status: true, type: true } },
      },
    });
    if (!conversation || conversation.workspaceId !== req.workspaceId) {
      throw new ForbiddenException('Conversation not in scope');
    }
    return conversation;
  }
}
