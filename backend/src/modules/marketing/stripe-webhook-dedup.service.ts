import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WebhookProcessingState } from '@prisma/client';
import Stripe from 'stripe';

export type DedupOutcome =
  | { action: 'PROCESS'; rowId: string }
  | { action: 'SKIP_ALREADY_PROCESSED' };

@Injectable()
export class StripeWebhookDedupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Concurrency-safe dedup. Returns PROCESS (with the row to update once
   * business effects complete) if this event should run now, or
   * SKIP_ALREADY_PROCESSED if it's a true no-op replay. Blocks briefly via
   * a Postgres advisory lock when a concurrent duplicate is mid-flight for
   * the exact same Stripe event ID, so only one caller ever proceeds.
   */
  async claimForProcessing(
    event: Stripe.Event,
    payloadHash: string,
  ): Promise<DedupOutcome> {
    // Advisory lock keyed on a hash of the Stripe event ID -- held for the
    // duration of this transaction, released automatically on commit.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        event.id,
      );

      const existing = await tx.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id },
      });

      if (!existing) {
        const created = await tx.stripeWebhookEvent.create({
          data: {
            stripeEventId: event.id,
            eventType: event.type,
            processingState: WebhookProcessingState.PROCESSING,
            attemptCount: 1,
            eventCreatedAt: new Date(event.created * 1000),
            apiVersion: event.api_version || 'unknown',
            livemode: event.livemode,
            payloadHash,
          },
        });
        return { action: 'PROCESS', rowId: created.id };
      }

      if (existing.processingState === WebhookProcessingState.PROCESSED) {
        return { action: 'SKIP_ALREADY_PROCESSED' };
      }

      // FAILED (legitimate retry) or PROCESSING (we now hold the advisory
      // lock, so any earlier concurrent processor has either finished or
      // this genuinely is a retry) -- either way, retry it.
      await tx.stripeWebhookEvent.update({
        where: { id: existing.id },
        data: {
          processingState: WebhookProcessingState.PROCESSING,
          attemptCount: { increment: 1 },
        },
      });
      return { action: 'PROCESS', rowId: existing.id };
    });
  }

  async markProcessed(rowId: string, correlationId?: string): Promise<void> {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: rowId },
      data: {
        processingState: WebhookProcessingState.PROCESSED,
        processedAt: new Date(),
        correlationId,
      },
    });
  }

  async markFailed(rowId: string, error: unknown): Promise<void> {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: rowId },
      data: {
        processingState: WebhookProcessingState.FAILED,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
