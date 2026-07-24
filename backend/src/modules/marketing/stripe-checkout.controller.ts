import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { StripeCheckoutService } from './stripe-checkout.service';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

// Same allowed-role set as the Client Health override endpoint --
// regenerating a checkout link is an equally consequential billing action.
const REGENERATE_ALLOWED_ROLES: Role[] = [
  Role.SUPERADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
  Role.WORKSPACE_ADMIN,
];

@Controller('marketing/clients/:id/billing')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class StripeCheckoutController {
  constructor(
    private checkoutService: StripeCheckoutService,
    private prisma: PrismaService,
  ) {}

  @Get('checkout')
  async getCheckout(@Param('id') clientAccountId: string) {
    const session =
      await this.checkoutService.getLatestCheckoutSession(clientAccountId);
    const latestSubscription = await this.prisma.billingSubscription.findFirst({
      where: { clientAccountId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return {
      ...(session ?? { status: 'NONE' }),
      subscriptionStatus: latestSubscription?.status ?? null,
    };
  }

  @Post('checkout/regenerate')
  async regenerateCheckout(
    @CurrentUser() user: any,
    @Param('id') clientAccountId: string,
  ) {
    if (!REGENERATE_ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'This role cannot regenerate a billing checkout link',
      );
    }
    return this.checkoutService.regenerateCheckout(clientAccountId);
  }
}
