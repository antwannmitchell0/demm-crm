import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';
import { createStripeClient } from './stripe-config';
import { BillingSubscriptionStatus } from '@prisma/client';
import { BillingRelationshipSignalService } from './billing-relationship-signal.service';

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

  constructor(
    private prisma: PrismaService,
    private billingSignals: BillingRelationshipSignalService,
  ) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionUpsert(event);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event);
      case 'invoice.paid':
        return this.onInvoicePaid(event);
      case 'invoice.payment_failed':
        return this.onInvoicePaymentFailed(event);
      case 'charge.refunded':
        return this.onChargeRefunded(event);
      case 'charge.dispute.created':
        return this.onChargeDisputeCreated(event);
      default:
        this.logger.log(
          `No handler for event type ${event.type} -- acknowledged, no-op.`,
        );
    }
  }

  /**
   * Resolves the target ClientAccount for a subscription-carrying event.
   * Handles out-of-order delivery: if we've never seen this
   * stripeSubscriptionId before, retrieves the full Subscription object
   * from Stripe directly (which carries the metadata we set at Checkout-
   * creation time) rather than failing.
   */
  private async resolveClientAccountId(
    stripeSubscriptionId: string,
  ): Promise<string | null> {
    const existing = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (existing) return existing.clientAccountId;

    const stripe = createStripeClient();
    const subscription =
      await stripe.subscriptions.retrieve(stripeSubscriptionId);
    return subscription.metadata?.clientAccountId ?? null;
  }

  private async upsertBillingSubscription(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const clientAccountId =
      subscription.metadata?.clientAccountId ??
      (await this.resolveClientAccountId(subscription.id));
    if (!clientAccountId) {
      this.logger.error(
        `Cannot resolve clientAccountId for subscription ${subscription.id} -- skipping.`,
      );
      return;
    }

    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount?.offerSnapshot.stripePriceMappingId) {
      this.logger.error(
        `ClientAccount ${clientAccountId} has no stripePriceMappingId -- cannot upsert subscription.`,
      );
      return;
    }

    const status =
      STRIPE_TO_BILLING_STATUS[subscription.status] ??
      BillingSubscriptionStatus.INCOMPLETE;
    const item = subscription.items.data[0];

    await this.prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      create: {
        clientAccountId,
        stripePriceMappingId: clientAccount.offerSnapshot.stripePriceMappingId,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer as string,
        status,
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        currentPeriodStart: item?.current_period_start
          ? new Date(item.current_period_start * 1000)
          : null,
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000)
          : null,
      },
      update: {
        status,
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        currentPeriodStart: item?.current_period_start
          ? new Date(item.current_period_start * 1000)
          : null,
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000)
          : null,
      },
    });
  }

  private async onCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const clientAccountId = session.metadata?.clientAccountId;
    if (!clientAccountId) {
      this.logger.error(
        `checkout.session.completed with no clientAccountId metadata (session ${session.id})`,
      );
      return;
    }

    await this.prisma.billingCheckoutSession.updateMany({
      where: { stripeCheckoutSessionId: session.id },
      data: { status: 'COMPLETED' },
    });

    if (session.subscription) {
      const stripe = createStripeClient();
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string,
      );
      await this.upsertBillingSubscription(subscription);
    }
  }

  private async onSubscriptionUpsert(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    // Capture prior state BEFORE upserting -- signal transitions (entering
    // PAST_DUE, cancellation being scheduled/unscheduled) are detected by
    // comparing against what was true before this event, not the absolute
    // new state alone.
    const priorRow = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    await this.upsertBillingSubscription(subscription);

    const clientAccountId =
      subscription.metadata?.clientAccountId ?? priorRow?.clientAccountId;
    if (!clientAccountId) return;

    if (subscription.status === 'past_due' && priorRow?.status !== 'PAST_DUE') {
      await this.billingSignals.createSignal(
        clientAccountId,
        'PAST_DUE',
        `Stripe subscription ${subscription.id} is now past due.`,
      );
    }

    if (subscription.cancel_at_period_end && !priorRow?.cancelAtPeriodEnd) {
      await this.billingSignals.createSignal(
        clientAccountId,
        'CANCELLATION_SCHEDULED',
        `Stripe subscription ${subscription.id} is scheduled to cancel at period end.`,
      );
    } else if (
      !subscription.cancel_at_period_end &&
      priorRow?.cancelAtPeriodEnd
    ) {
      await this.billingSignals.resolveSignals(clientAccountId, [
        'CANCELLATION_SCHEDULED',
      ]);
    }
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const priorRow = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    await this.prisma.billingSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: BillingSubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      },
    });

    const clientAccountId =
      subscription.metadata?.clientAccountId ?? priorRow?.clientAccountId;
    if (clientAccountId) {
      // Deliberately NOT auto-resolved -- a completed cancellation needs
      // human follow-up, not a silent closure.
      await this.billingSignals.createSignal(
        clientAccountId,
        'CANCELLATION_COMPLETED',
        `Stripe subscription ${subscription.id} has been canceled.`,
      );
    }
  }

  private async resolveClientAccountIdBySubscription(
    stripeSubscriptionId: string | null,
  ): Promise<string | null> {
    if (!stripeSubscriptionId) return null;
    const sub = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (sub) return sub.clientAccountId;
    return this.resolveClientAccountId(stripeSubscriptionId);
  }

  private async onInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = (invoice as any).subscription as string | null;
    const clientAccountId =
      await this.resolveClientAccountIdBySubscription(stripeSubscriptionId);
    if (!clientAccountId) {
      this.logger.error(
        `invoice.paid: cannot resolve clientAccountId for invoice ${invoice.id}`,
      );
      return;
    }

    const billingSubscription = stripeSubscriptionId
      ? await this.prisma.billingSubscription.findUnique({
          where: { stripeSubscriptionId },
        })
      : null;

    const existingRecord = invoice.id
      ? await this.prisma.billingPaymentRecord.findUnique({
          where: { stripeInvoiceId: invoice.id },
        })
      : null;
    if (!existingRecord) {
      await this.prisma.billingPaymentRecord.create({
        data: {
          clientAccountId,
          billingSubscriptionId: billingSubscription?.id ?? null,
          stripeInvoiceId: invoice.id,
          stripePaymentIntentId: (invoice as any).payment_intent as
            string | null,
          stripeCustomerId: invoice.customer as string,
          stripeSubscriptionId,
          amountPaid: invoice.amount_paid / 100,
          currency: invoice.currency,
          // `.tax` was removed from the Stripe SDK's Invoice type in favor
          // of `total_taxes`, a structured array of per-tax-rate line items
          // (each with its own `amount` in cents) rather than one summed
          // number. Sum them here to get the equivalent total. `null` when
          // there are no taxes on the invoice (the common case for these
          // founder-tier subscriptions, which have no Stripe Tax config).
          taxAmount: invoice.total_taxes?.length
            ? invoice.total_taxes.reduce((sum, t) => sum + t.amount, 0) / 100
            : null,
          billingPeriodStart: invoice.period_start
            ? new Date(invoice.period_start * 1000)
            : null,
          billingPeriodEnd: invoice.period_end
            ? new Date(invoice.period_end * 1000)
            : null,
          paidAt: new Date(),
        },
      });

      await this.prisma.clientCommercialStateChange.create({
        data: {
          clientAccountId,
          field: 'PAYMENT',
          newValue: 'PAID',
          amount: invoice.amount_paid / 100,
          recordedById: null,
          source: 'STRIPE_WEBHOOK',
        },
      });

      const wasFailing = await this.billingSignals.hasActiveSignal(
        clientAccountId,
        ['PAYMENT_FAILURE', 'PAST_DUE'],
      );
      if (wasFailing) {
        await this.billingSignals.createSignal(
          clientAccountId,
          'PAYMENT_RECOVERY',
          `Payment recovered for invoice ${invoice.id}.`,
        );
        await this.billingSignals.resolveSignals(clientAccountId, [
          'PAYMENT_FAILURE',
          'PAST_DUE',
        ]);
      } else {
        await this.billingSignals.createSignal(
          clientAccountId,
          'PAYMENT_SUCCESS',
          `Payment succeeded for invoice ${invoice.id}.`,
        );
      }
      // A successful payment proves billing setup worked -- close out any
      // still-open checkout-in-progress or setup-failure signal.
      await this.billingSignals.resolveSignals(clientAccountId, [
        'CHECKOUT_PENDING',
        'BILLING_SETUP_FAILED',
      ]);
    }

    if (billingSubscription) {
      await this.prisma.billingSubscription.update({
        where: { id: billingSubscription.id },
        data: { status: BillingSubscriptionStatus.ACTIVE },
      });
    }
  }

  private async onInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = (invoice as any).subscription as string | null;
    if (!stripeSubscriptionId) return;
    await this.prisma.billingSubscription.updateMany({
      where: { stripeSubscriptionId },
      data: { status: BillingSubscriptionStatus.PAST_DUE },
    });

    const clientAccountId =
      await this.resolveClientAccountIdBySubscription(stripeSubscriptionId);
    if (clientAccountId) {
      await this.billingSignals.createSignal(
        clientAccountId,
        'PAYMENT_FAILURE',
        `Payment failed for invoice ${invoice.id}.`,
      );
    }
  }

  private async onChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = charge.payment_intent as string | null;
    if (!paymentIntentId) return;

    const record = await this.prisma.billingPaymentRecord.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!record) {
      this.logger.error(
        `charge.refunded: no BillingPaymentRecord found for payment intent ${paymentIntentId}`,
      );
      return;
    }

    const refundedAmount = charge.amount_refunded / 100;
    const isFullRefund = charge.amount_refunded >= charge.amount;

    await this.prisma.billingPaymentRecord.update({
      where: { id: record.id },
      data: {
        refundedAmount,
        reversalState: isFullRefund ? 'FULL_REFUND' : 'PARTIAL_REFUND',
      },
    });

    await this.prisma.clientCommercialStateChange.create({
      data: {
        clientAccountId: record.clientAccountId,
        field: 'PAYMENT',
        newValue: 'REFUNDED',
        amount: -refundedAmount,
        recordedById: null,
        source: 'STRIPE_WEBHOOK',
      },
    });
  }

  private onChargeDisputeCreated(event: Stripe.Event): void {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
    this.logger.warn(
      `Dispute created for charge ${chargeId} -- amount ${dispute.amount / 100} ${dispute.currency}. Manual review required (no automated handling in this sub-project).`,
    );
  }
}
