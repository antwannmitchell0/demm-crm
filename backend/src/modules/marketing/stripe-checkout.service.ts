import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { createStripeClient } from './stripe-config';
import { StripeEnvironmentGuard } from './stripe-environment.guard';
import { BillingCheckoutStatus } from '@prisma/client';

@Injectable()
export class StripeCheckoutService {
  private readonly logger = new Logger(StripeCheckoutService.name);

  constructor(
    private prisma: PrismaService,
    private envGuard: StripeEnvironmentGuard,
  ) {}

  async createSubscriptionCheckout(
    clientAccountId: string,
    attemptNumber = 1,
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const clientAccount = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: clientAccountId },
      include: { offerSnapshot: true },
    });

    if (!clientAccount.offerSnapshot.stripePriceMappingId) {
      throw new BadRequestException(
        "This client's Offer has not been Stripe-provisioned in this environment yet. " +
          'Run StripeProvisioningService.syncOfferPrices() first.',
      );
    }

    const mapping = await this.prisma.stripePriceMapping.findUniqueOrThrow({
      where: { id: clientAccount.offerSnapshot.stripePriceMappingId },
    });
    this.envGuard.assertConsistent({
      environment: mapping.environment,
      livemode: mapping.livemode,
    });

    const idempotencyKey = `checkout:${clientAccountId}:${attemptNumber}`;

    // Upsert, not create: (clientAccountId, attemptNumber) -- and therefore
    // idempotencyKey -- can legitimately be called more than once (a retry
    // after a local persistence failure, per the idempotency contract this
    // key exists to support). A bare create() would throw a unique-
    // constraint violation on the second call, before ever reaching
    // Stripe's own idempotency handling below. Reusing the existing row
    // (rather than failing) is what actually makes retrying safe.
    const checkoutSessionRow = await this.prisma.billingCheckoutSession.upsert({
      where: { idempotencyKey },
      create: {
        clientAccountId,
        offerSnapshotId: clientAccount.offerSnapshotId,
        status: BillingCheckoutStatus.PENDING,
        idempotencyKey,
        attemptNumber,
      },
      update: {
        status: BillingCheckoutStatus.PENDING,
      },
    });

    const stripe = createStripeClient();

    try {
      let stripeCustomerId = clientAccount.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create(
          { metadata: { clientAccountId } },
          { idempotencyKey: `customer-create:${clientAccountId}` },
        );
        stripeCustomerId = customer.id;
        await this.prisma.clientAccount.update({
          where: { id: clientAccountId },
          data: { stripeCustomerId },
        });
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: stripeCustomerId,
          line_items: [{ price: mapping.stripePriceId, quantity: 1 }],
          metadata: { clientAccountId },
          subscription_data: {
            metadata: { clientAccountId },
            ...(clientAccount.offerSnapshot.trialEligible
              ? { trial_period_days: clientAccount.offerSnapshot.trialDays }
              : {}),
          },
          payment_method_collection: 'always',
          success_url: `${process.env.FRONTEND_BASE_URL || 'http://localhost:4000'}/marketing/clients/${clientAccountId}?billing=success`,
          cancel_url: `${process.env.FRONTEND_BASE_URL || 'http://localhost:4000'}/marketing/clients/${clientAccountId}?billing=canceled`,
        },
        { idempotencyKey },
      );

      await this.prisma.billingCheckoutSession.update({
        where: { id: checkoutSessionRow.id },
        data: {
          status: BillingCheckoutStatus.CREATED,
          stripeCheckoutSessionId: session.id,
          checkoutUrl: session.url,
          expiresAt: session.expires_at
            ? new Date(session.expires_at * 1000)
            : null,
        },
      });

      return { checkoutUrl: session.url!, sessionId: session.id };
    } catch (err: any) {
      await this.prisma.billingCheckoutSession.update({
        where: { id: checkoutSessionRow.id },
        data: {
          status: BillingCheckoutStatus.FAILED,
          failedAt: new Date(),
          lastError:
            err?.message || 'Unknown error creating Stripe Checkout Session',
        },
      });
      throw err;
    }
  }

  async getLatestCheckoutSession(clientAccountId: string) {
    return this.prisma.billingCheckoutSession.findFirst({
      where: { clientAccountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async regenerateCheckout(clientAccountId: string) {
    const latest = await this.getLatestCheckoutSession(clientAccountId);
    const nextAttempt = (latest?.attemptNumber ?? 0) + 1;
    return this.createSubscriptionCheckout(clientAccountId, nextAttempt);
  }
}
