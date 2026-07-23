import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';
import { createStripeClient } from './stripe-config';
import { BillingSubscriptionStatus } from '@prisma/client';

const STRIPE_TO_BILLING_STATUS: Record<string, BillingSubscriptionStatus> = {
  incomplete: BillingSubscriptionStatus.INCOMPLETE,
  incomplete_expired: BillingSubscriptionStatus.INCOMPLETE_EXPIRED,
  trialing: BillingSubscriptionStatus.TRIALING,
  active: BillingSubscriptionStatus.ACTIVE,
  past_due: BillingSubscriptionStatus.PAST_DUE,
  canceled: BillingSubscriptionStatus.CANCELED,
  unpaid: BillingSubscriptionStatus.UNPAID,
  paused: BillingSubscriptionStatus.PAUSED,
};

@Injectable()
export class StripeWebhookHandlerService {
  private readonly logger = new Logger(StripeWebhookHandlerService.name);

  constructor(private prisma: PrismaService) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionUpsert(event);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event);
      default:
        this.logger.log(`No handler for event type ${event.type} -- acknowledged, no-op.`);
    }
  }

  /**
   * Resolves the target ClientAccount for a subscription-carrying event.
   * Handles out-of-order delivery: if we've never seen this
   * stripeSubscriptionId before, retrieves the full Subscription object
   * from Stripe directly (which carries the metadata we set at Checkout-
   * creation time) rather than failing.
   */
  private async resolveClientAccountId(stripeSubscriptionId: string): Promise<string | null> {
    const existing = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (existing) return existing.clientAccountId;

    const stripe = createStripeClient();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    return subscription.metadata?.clientAccountId ?? null;
  }

  private async upsertBillingSubscription(subscription: Stripe.Subscription): Promise<void> {
    const clientAccountId =
      subscription.metadata?.clientAccountId ??
      (await this.resolveClientAccountId(subscription.id));
    if (!clientAccountId) {
      this.logger.error(`Cannot resolve clientAccountId for subscription ${subscription.id} -- skipping.`);
      return;
    }

    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount?.offerSnapshot.stripePriceMappingId) {
      this.logger.error(`ClientAccount ${clientAccountId} has no stripePriceMappingId -- cannot upsert subscription.`);
      return;
    }

    const status = STRIPE_TO_BILLING_STATUS[subscription.status] ?? BillingSubscriptionStatus.INCOMPLETE;
    const item = subscription.items.data[0];

    await this.prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      create: {
        clientAccountId,
        stripePriceMappingId: clientAccount.offerSnapshot.stripePriceMappingId,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer as string,
        status,
        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
      update: {
        status,
        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
    });
  }

  private async onCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const clientAccountId = session.metadata?.clientAccountId;
    if (!clientAccountId) {
      this.logger.error(`checkout.session.completed with no clientAccountId metadata (session ${session.id})`);
      return;
    }

    await this.prisma.billingCheckoutSession.updateMany({
      where: { stripeCheckoutSessionId: session.id },
      data: { status: 'COMPLETED' },
    });

    if (session.subscription) {
      const stripe = createStripeClient();
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      await this.upsertBillingSubscription(subscription);
    }
  }

  private async onSubscriptionUpsert(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    await this.upsertBillingSubscription(subscription);
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    await this.prisma.billingSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: { status: BillingSubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
  }
}
