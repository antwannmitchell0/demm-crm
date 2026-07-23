import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookHandlerService {
  private readonly logger = new Logger(StripeWebhookHandlerService.name);

  async handleEvent(event: Stripe.Event): Promise<void> {
    this.logger.log(`Received ${event.type} (stub -- Tasks 11-12 complete this)`);
  }
}
