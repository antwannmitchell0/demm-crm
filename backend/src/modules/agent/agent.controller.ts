import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('agent')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Get('tools')
  async listTools() {
    return this.agentService.getRegisteredTools();
  }

  @Post('execute')
  async execute(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Body('toolName') toolName: string,
    @Body('arguments') args: any,
    @Body('sessionId') sessionId?: string,
  ) {
    return this.agentService.executeTool(workspaceId, user.id, toolName, args, user.role, sessionId);
  }

  @Post('plan/preview')
  async previewPlan(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Body('description') description: string,
  ) {
    return this.agentService.previewPlan(workspaceId, user.id, description);
  }

  @Post('execute/cancel')
  async cancel(
    @Body('sessionId') sessionId: string,
  ) {
    return this.agentService.cancelExecution(sessionId);
  }

  @Post('approvals/:id/resolve')
  async resolveApproval(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('action') action: 'APPROVE' | 'REJECT',
  ) {
    return this.agentService.resolveApproval(workspaceId, user.id, id, action);
  }
}
