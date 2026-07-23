import { Controller, Post, Req, Res, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import Stripe from 'stripe';
import { createStripeClient } from './stripe-config';
import { StripeWebhookDedupService } from './stripe-webhook-dedup.service';
import { StripeWebhookHandlerService } from './stripe-webhook-handler.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private dedup: StripeWebhookDedupService,
    private handler: StripeWebhookHandlerService,
  ) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const signature = req.headers['stripe-signature'] as string | undefined;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured -- rejecting all webhook payloads (fail-closed).');
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Webhook not configured' });
    }
    if (!signature) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Missing Stripe-Signature header' });
    }

    let event: Stripe.Event;
    const stripe = createStripeClient();
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid signature' });
    }

    const payloadHash = createHash('sha256').update(req.body).digest('hex');

    // claimAndProcess holds the dedup advisory lock for the ENTIRE
    // claim -> handle -> mark-processed/failed lifecycle (not just the
    // claim), so a genuinely concurrent duplicate delivery of the same
    // event ID stays blocked until this whole thing commits -- see the
    // lock-scope note on StripeWebhookDedupService.claimAndProcess.
    const outcome = await this.dedup.claimAndProcess(event, payloadHash, (ev) =>
      this.handler.handleEvent(ev),
    );

    if (outcome.action === 'SKIPPED_ALREADY_PROCESSED') {
      return res.status(HttpStatus.OK).json({ received: true, skipped: 'already_processed' });
    }

    if (outcome.action === 'FAILED') {
      this.logger.error(
        `Webhook handler failed for event ${event.id} (${event.type})`,
        outcome.error as Error,
      );
      // Return 200 anyway: Stripe would otherwise retry, and our own
      // FAILED-state row already makes this retryable/inspectable without
      // relying on Stripe's retry schedule. A 500 here is reserved for
      // genuine infrastructure outages, not business-logic failures.
      return res.status(HttpStatus.OK).json({ received: true, processingFailed: true });
    }

    return res.status(HttpStatus.OK).json({ received: true });
  }
}
