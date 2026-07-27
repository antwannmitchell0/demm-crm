import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolveApprovalDto } from './dto/resolve-approval.dto';

@Controller('agent')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Get('tools')
  listTools() {
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
    return this.agentService.executeTool(
      workspaceId,
      user.id,
      toolName,
      args,
      user.role,
      sessionId,
    );
  }

  @Post('plan/preview')
  previewPlan(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Body('description') description: string,
  ) {
    return this.agentService.previewPlan(workspaceId, user.id, description);
  }

  @Post('execute/cancel')
  cancel(@Body('sessionId') sessionId: string) {
    return this.agentService.cancelExecution(sessionId);
  }

  /**
   * Resolving a high-risk approval is an administrative act, so it is gated to
   * administrative roles.
   *
   * GUARD ORDER IS LOAD-BEARING. Nest runs controller-level guards before
   * route-level ones, so the effective chain here is
   * JwtAuthGuard -> WorkspaceGuard -> RolesGuard. That order matters because
   * `request.user.role` does not come from the JWT (jwt.strategy returns the
   * Prisma user with no role); it is assigned by WorkspaceGuard from the
   * caller's CURRENT membership. RolesGuard must therefore run after it, or it
   * would evaluate an undefined role and reject every caller.
   *
   * RolesGuard is applied at the METHOD level, matching the existing pattern in
   * workspace.controller.ts, so the other agent routes keep their current
   * behaviour untouched rather than relying on RolesGuard's
   * no-metadata-passes-through contract.
   */
  @Post('approvals/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(Role.WORKSPACE_ADMIN, Role.ORG_ADMIN, Role.ORG_OWNER, Role.SUPERADMIN)
  async resolveApproval(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    // Bound as a DTO rather than `@Body('action')` so the global ValidationPipe
    // actually runs. Reading a raw body property bypasses validation entirely,
    // which is how a misspelled action previously reached the APPROVE path.
    @Body() body: ResolveApprovalDto,
  ) {
    return this.agentService.resolveApproval(
      workspaceId,
      user.id,
      id,
      body.action,
    );
  }
}
