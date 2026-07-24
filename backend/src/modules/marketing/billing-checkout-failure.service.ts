import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Dom26rAuditService } from '../dom26r/dom26r-audit.service';
import { BillingRelationshipSignalService } from './billing-relationship-signal.service';

@Injectable()
export class BillingCheckoutFailureService {
  private readonly logger = new Logger(BillingCheckoutFailureService.name);

  constructor(
    private prisma: PrismaService,
    private dom26rAudit: Dom26rAuditService,
    private billingSignals: BillingRelationshipSignalService,
  ) {}

  async handle(
    businessUnitId: string,
    workspaceId: string,
    organizationId: string,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
    error: unknown,
  ): Promise<void> {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { primaryContact: true },
    });
    if (!clientAccount) return;

    // 1. Operator Task -- same pattern as the onboarding-kickoff Task
    // already created inside convert().
    await this.prisma.task.create({
      data: {
        title: `Billing setup failed for ${clientAccount.primaryContact.firstName} ${clientAccount.primaryContact.lastName} -- Stripe checkout could not be generated. Retry from the Client Account page.`,
        workspaceId,
        contactId: clientAccount.primaryContactId,
      },
    });

    // 2. RelationshipSignal -- via the shared signal service (Task 15),
    // not a raw prisma.relationshipSignal.create -- keeps severity/state
    // rules and profile resolution in one place. A later successful
    // checkout generation resolves this same signal type (see
    // StripeCheckoutService).
    await this.billingSignals.createSignal(
      clientAccountId,
      'BILLING_SETUP_FAILED',
      `Stripe checkout generation failed for ${clientAccount.primaryContact.firstName} ${clientAccount.primaryContact.lastName}.`,
    );

    // 3. Audit event.
    await this.dom26rAudit.record({
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      action: 'BILLING_CHECKOUT_FAILED',
      purpose: 'STRIPE_CHECKOUT_GENERATION',
      outcome: 'FAILURE',
      correlationId,
      metadata: {
        clientAccountId,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    this.logger.error(
      `Billing checkout failure fully recorded for ${clientAccountId}`,
    );
  }
}
