import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InviteMemberDto, ChangeRoleDto } from './dto/team.dto';

const ADMIN_ROLES = [
  Role.WORKSPACE_ADMIN,
  Role.ORG_ADMIN,
  Role.ORG_OWNER,
  Role.SUPERADMIN,
] as const;

/**
 * Managing who is in a workspace.
 *
 * GUARD ORDER IS LOAD-BEARING, exactly as in agent.controller.ts. Nest runs
 * controller-level guards before route-level ones, so the chain here is
 * JwtAuthGuard -> WorkspaceGuard -> RolesGuard. `request.user.role` does NOT
 * come from the JWT (jwt.strategy returns the Prisma user with no role); it is
 * assigned by WorkspaceGuard from the caller's CURRENT membership. RolesGuard
 * must therefore run after it, or it would evaluate an undefined role and
 * reject every caller.
 *
 * Every route is scoped to the workspace WorkspaceGuard resolved -- there is no
 * workspaceId path parameter to tamper with, and no route accepts one.
 */
@Controller('team')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Get('members')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  listMembers(@CurrentWorkspaceId() workspaceId: string) {
    return this.teamService.listMembers(workspaceId);
  }

  @Get('invitations')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  listInvitations(@CurrentWorkspaceId() workspaceId: string) {
    return this.teamService.listInvitations(workspaceId);
  }

  @Post('invitations')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  invite(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Body() body: InviteMemberDto,
  ) {
    return this.teamService.invite(
      workspaceId,
      user.id,
      user.role,
      body.email,
      body.role,
    );
  }

  @Delete('invitations/:id')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  revokeInvitation(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.teamService.revokeInvitation(workspaceId, id, user.id);
  }

  @Patch('members/:userId')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  changeRole(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() body: ChangeRoleDto,
  ) {
    return this.teamService.changeRole(
      workspaceId,
      user.id,
      user.role,
      targetUserId,
      body.role,
    );
  }

  @Delete('members/:userId')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  removeMember(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.teamService.removeMember(workspaceId, user.id, targetUserId);
  }
}
