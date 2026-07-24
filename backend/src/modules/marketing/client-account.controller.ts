import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ClientAccountService } from './client-account.service';
import { ClientHealthService } from './client-health.service';
import { StripeCheckoutService } from './stripe-checkout.service';
import { BillingCheckoutFailureService } from './billing-checkout-failure.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { RecordCommercialStateChangeDto } from './dto/commercial-state-change.dto';

/**
 * One controller covering both route groups the plan calls for --
 * `marketing/leads/:contactId/convert` (the conversion action) and
 * `marketing/clients/:id` (post-conversion client detail) -- via
 * method-level paths, since Nest's `@Controller()` prefix is one string
 * per class and these two resources don't share a common prefix.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ClientAccountController {
  private readonly logger = new Logger(ClientAccountController.name);

  constructor(
    private clientAccountService: ClientAccountService,
    private clientHealth: ClientHealthService,
    private stripeCheckout: StripeCheckoutService,
    private checkoutFailureHandler: BillingCheckoutFailureService,
  ) {}

  @Post('marketing/leads/:contactId/convert')
  async convert(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('contactId') contactId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConvertLeadDto,
  ) {
    const clientAccount = await this.clientAccountService.convert(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      contactId,
      idempotencyKey,
      dto,
    );

    // Initial Client Health calculation -- deliberately AFTER convert()'s
    // own transaction has fully committed (never inside it: convert() is
    // an accepted, tested Sub-project 1 surface this sub-project must not
    // reopen). A failure here never fails the conversion itself.
    await this.clientHealth
      .calculate(businessUnitId, clientAccount.id, user.id, correlationId)
      .catch((err) =>
        this.logger.error(
          `Initial Client Health calculation failed for ${clientAccount.id}`,
          err,
        ),
      );

    // Auto-generate the Stripe Checkout Session right after conversion.
    // Never inside convert()'s transaction, never able to fail the
    // conversion itself -- failures are made visible via
    // BillingCheckoutSession(FAILED) + Task + RelationshipSignal, not
    // swallowed silently.
    let checkoutUrl: string | null = null;
    try {
      const checkout = await this.stripeCheckout.createSubscriptionCheckout(
        clientAccount.id,
        1,
      );
      checkoutUrl = checkout.checkoutUrl;
    } catch (err) {
      this.logger.error(
        `Stripe checkout generation failed for ${clientAccount.id}`,
        err,
      );
      await this.checkoutFailureHandler
        .handle(
          businessUnitId,
          workspaceId,
          organizationId,
          user.id,
          correlationId,
          clientAccount.id,
          err,
        )
        .catch((e) =>
          this.logger.error(
            'Checkout failure visibility handler itself failed',
            e,
          ),
        );
    }

    return { ...clientAccount, checkoutUrl };
  }

  @Get('marketing/clients/:id')
  async getClientDetail(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.clientAccountService.getClientDetail(businessUnitId, id);
  }

  @Post('marketing/clients/:id/commercial-state')
  async recordCommercialStateChange(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RecordCommercialStateChangeDto,
  ) {
    return this.clientAccountService.recordCommercialStateChange(
      businessUnitId,
      user.id,
      id,
      dto.field,
      dto.newValue,
      dto.amount,
      dto.allowManualAlongsideStripe,
    );
  }
}
