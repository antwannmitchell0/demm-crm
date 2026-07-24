import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  createStripeClient,
  currentEnvironment,
  isLiveKey,
} from './stripe-config';
import { StripeEnvironmentGuard } from './stripe-environment.guard';
import { OfferLifecycleState } from '@prisma/client';

@Injectable()
export class StripeProvisioningService {
  private readonly logger = new Logger(StripeProvisioningService.name);

  constructor(
    private prisma: PrismaService,
    private envGuard: StripeEnvironmentGuard,
  ) {}

  /**
   * For each ACTIVE Offer with no StripePriceMapping yet in this
   * environment/livemode, creates a Stripe Product + recurring monthly
   * Price and persists the mapping. Idempotent: an Offer/version that
   * already has a mapping for this (environment, livemode) is skipped.
   */
  async syncOfferPrices(): Promise<
    { offerId: string; key: string; created: boolean; mappingId: string }[]
  > {
    const environment = currentEnvironment();
    const livemode = isLiveKey();
    this.envGuard.assertConsistent({ environment, livemode });

    const stripe = createStripeClient();
    const offers = await this.prisma.offer.findMany({
      where: { lifecycleState: OfferLifecycleState.ACTIVE },
    });

    const results: {
      offerId: string;
      key: string;
      created: boolean;
      mappingId: string;
    }[] = [];

    for (const offer of offers) {
      const existing = await this.prisma.stripePriceMapping.findUnique({
        where: {
          offerId_offerVersion_environment_livemode: {
            offerId: offer.id,
            offerVersion: offer.version,
            environment,
            livemode,
          },
        },
      });
      if (existing) {
        results.push({
          offerId: offer.id,
          key: offer.key,
          created: false,
          mappingId: existing.id,
        });
        continue;
      }

      const product = await stripe.products.create(
        { name: `${offer.name} (${offer.key} v${offer.version})` },
        {
          idempotencyKey: `product-create:${offer.id}:${offer.version}:${environment}`,
        },
      );
      const price = await stripe.prices.create(
        {
          product: product.id,
          unit_amount: Math.round(Number(offer.price) * 100),
          currency: 'usd',
          recurring: { interval: 'month' },
        },
        {
          idempotencyKey: `price-create:${offer.id}:${offer.version}:${environment}`,
        },
      );

      const mapping = await this.prisma.stripePriceMapping.create({
        data: {
          offerId: offer.id,
          offerVersion: offer.version,
          amount: offer.price,
          currency: 'usd',
          billingInterval: 'month',
          environment,
          livemode,
          stripeProductId: product.id,
          stripePriceId: price.id,
        },
      });

      this.logger.log(
        `Provisioned Stripe Product/Price for ${offer.key} v${offer.version} (${environment}, livemode=${livemode})`,
      );
      results.push({
        offerId: offer.id,
        key: offer.key,
        created: true,
        mappingId: mapping.id,
      });
    }

    return results;
  }
}
