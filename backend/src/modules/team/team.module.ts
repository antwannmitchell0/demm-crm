import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { InvitationController } from './invitation.controller';

@Module({
  // InvitationController is listed FIRST so its POST /team/invitations/accept
  // route is registered before TeamController's parameterised routes. The two
  // do not actually collide (different path / different method), but ordering
  // them this way means adding a `POST /team/invitations/:id` later cannot
  // silently swallow `accept`.
  controllers: [InvitationController, TeamController],
  providers: [PrismaService, TeamService],
  exports: [TeamService],
})
export class TeamModule {}
