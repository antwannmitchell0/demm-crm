import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AcceptInvitationDto } from './dto/team.dto';

/**
 * Accepting an invitation.
 *
 * SEPARATE FROM TeamController ON PURPOSE. Every route there is behind
 * WorkspaceGuard, which requires the caller to ALREADY hold a membership in the
 * workspace. An invitee by definition does not -- that is the entire point of
 * the invitation -- so applying that guard here would make the endpoint
 * impossible to call successfully.
 *
 * JwtAuthGuard still applies: the caller must be a signed-in account, and the
 * service checks that their verified email matches the address the invitation
 * was issued to. Possession of the token is necessary but not sufficient, so a
 * forwarded link cannot be used by whoever happens to receive it.
 *
 * No route collision with TeamController despite the shared `/team/invitations`
 * prefix: this is POST /team/invitations/accept, while that controller owns
 * POST /team/invitations (different path) and DELETE /team/invitations/:id
 * (different method).
 */
@Controller('team/invitations')
@UseGuards(JwtAuthGuard)
export class InvitationController {
  constructor(private teamService: TeamService) {}

  /**
   * 200, not 201, because this endpoint is IDEMPOTENT.
   *
   * 201 asserts "a resource was created", which is true only on the JOINED
   * path. The same call also legitimately returns ALREADY_MEMBER (the account
   * had access already) and ALREADY_ACCEPTED (the same person retried a
   * consumed link); neither creates anything, and answering 201 there would be
   * a claim the client cannot check. The `outcome` field carries the
   * distinction instead, so a caller can tell the three apart without inferring
   * it from a status code.
   *
   * No existing contract depends on 201 here: the route shipped in this same
   * unreleased phase, and its only caller (frontend/src/lib/api.ts) treats any
   * 2xx as success.
   */
  @Post('accept')
  @HttpCode(200)
  accept(@CurrentUser() user: any, @Body() body: AcceptInvitationDto) {
    return this.teamService.acceptInvitation(user.id, body.token);
  }
}
