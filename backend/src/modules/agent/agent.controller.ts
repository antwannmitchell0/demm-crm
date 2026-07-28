import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolveApprovalDto } from './dto/resolve-approval.dto';
import { ExecuteToolDto } from './dto/execute-tool.dto';
import { CancelExecutionDto } from './dto/cancel-execution.dto';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';

@Controller('agent')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Get('tools')
  listTools() {
    return this.agentService.getRegisteredTools();
  }

  // Every body below is bound as a whole DTO rather than with
  // `@Body('property')`. Per-property binding reads the parsed body directly
  // and never reaches the global ValidationPipe, so type, presence and
  // unknown-property checks were all skipped on these two routes.
  @Post('execute')
  async execute(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Body() body: ExecuteToolDto,
  ) {
    return this.agentService.executeTool(
      workspaceId,
      user.id,
      body.toolName,
      body.arguments ?? {},
      user.role,
      body.sessionId,
    );
  }

  @Post('execute/cancel')
  cancel(@Body() body: CancelExecutionDto) {
    return this.agentService.cancelExecution(body.sessionId);
  }

  /**
   * The approval inbox. Readable by any member of the workspace, deliberately:
   * a requester must be able to see the request they made and its outcome, and
   * gating the list to approvers would leave them staging actions into silence.
   * Resolving is still administrative (below); only WITHDRAWING your own
   * request is not.
   */
  @Get('approvals')
  listApprovals(
    @CurrentWorkspaceId() workspaceId: string,
    @Query() query: ListApprovalsQueryDto,
  ) {
    return this.agentService.listApprovals(workspaceId, query.status);
  }

  /**
   * Withdraws a pending request. Restricted to the person who made it -- an
   * administrator already has REJECT, and letting them cancel instead would
   * record a decision as if none had been made. No RolesGuard: authority here
   * is ownership of the request, not rank.
   */
  @Post('approvals/:id/cancel')
  @HttpCode(200)
  cancelApproval(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agentService.cancelApproval(workspaceId, user.id, id);
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
