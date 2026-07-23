import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WebhookProcessingState } from '@prisma/client';
import Stripe from 'stripe';

export type ClaimAndProcessOutcome =
  | { action: 'PROCESSED' }
  | { action: 'SKIPPED_ALREADY_PROCESSED' }
  | { action: 'FAILED'; error: unknown };

export type WebhookHandlerFn = (
  event: Stripe.Event,
) => Promise<{ correlationId?: string } | void>;

@Injectable()
export class StripeWebhookDedupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Concurrency-safe claim-AND-process. Holds a Postgres advisory lock,
   * keyed on a hash of the Stripe event ID, for the FULL
   * claim -> handle -> mark-processed/failed lifecycle -- not just the row
   * claim -- by running the entire flow inside one Prisma interactive
   * transaction. Interactive transactions pin ONE dedicated connection for
   * the whole callback, and `pg_advisory_xact_lock` is transaction-scoped
   * (auto-released only on that transaction's commit or rollback), so the
   * lock is provably held until this function's returned promise settles.
   *
   * Why this matters: an earlier version acquired the lock only around the
   * row claim (create/read/update), which released as soon as the claim
   * step finished -- BEFORE the handler ever ran. Two truly concurrent
   * deliveries of the same event ID could then both reach the handler: the
   * first commits the row as PROCESSING and releases the lock; the second,
   * unblocked, sees PROCESSING and (wrongly assuming the first had already
   * finished, since the lock was free) proceeds to call the handler too --
   * producing duplicate business effects. Wrapping the whole lifecycle in
   * one transaction closes that window: a second concurrent caller stays
   * blocked on the advisory lock until the first caller's transaction
   * (claim + handle + mark) fully commits, at which point it observes
   * PROCESSED and skips instead of racing the handler.
   *
   * The handler itself is free to use its own injected PrismaService (a
   * different pooled connection) for its business writes -- it does not
   * need to run on `tx`. What must stay inside this transaction's window
   * is only: (1) the advisory lock acquisition, and (2) the final
   * PROCESSED/FAILED write to the StripeWebhookEvent row, so the lock is
   * never released before that row's terminal state is committed.
   */
  async claimAndProcess(
    event: Stripe.Event,
    payloadHash: string,
    handle: WebhookHandlerFn,
  ): Promise<ClaimAndProcessOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          event.id,
        );

        const existing = await tx.stripeWebhookEvent.findUnique({
          where: { stripeEventId: event.id },
        });

        let rowId: string;
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
          rowId = created.id;
        } else if (existing.processingState === WebhookProcessingState.PROCESSED) {
          // True no-op replay: whoever held this exact advisory lock
          // before us already ran the handler to completion and committed
          // PROCESSED before we were able to acquire it.
          return { action: 'SKIPPED_ALREADY_PROCESSED' };
        } else {
          // FAILED (legitimate retry) or PROCESSING. Now that the lock
          // spans the full lifecycle, PROCESSING can only mean a prior
          // attempt crashed/was killed mid-transaction (which rolled back
          // to no committed row change) or this is a genuine retry after a
          // FAILED attempt -- a concurrent in-flight duplicate can never
          // observe PROCESSING anymore, because it would still be blocked
          // on the advisory lock. Either way, retry it.
          await tx.stripeWebhookEvent.update({
            where: { id: existing.id },
            data: {
              processingState: WebhookProcessingState.PROCESSING,
              attemptCount: { increment: 1 },
            },
          });
          rowId = existing.id;
        }

        try {
          const result = await handle(event);
          await tx.stripeWebhookEvent.update({
            where: { id: rowId },
            data: {
              processingState: WebhookProcessingState.PROCESSED,
              processedAt: new Date(),
              correlationId: result?.correlationId,
            },
          });
          return { action: 'PROCESSED' };
        } catch (err) {
          // Deliberately NOT rethrown: rethrowing would roll back this
          // transaction, which would also roll back the FAILED marker
          // we're about to write, losing the audit trail of the failure.
          // Any writes the handler itself made through its own connection
          // are unaffected by this transaction's commit/rollback either
          // way, since they were never part of it.
          await tx.stripeWebhookEvent.update({
            where: { id: rowId },
            data: {
              processingState: WebhookProcessingState.FAILED,
              lastError: err instanceof Error ? err.message : String(err),
            },
          });
          return { action: 'FAILED', error: err };
        }
      },
      // Headroom beyond Prisma's 5s interactive-transaction default: the
      // handler's business-effect work now runs INSIDE this transaction's
      // window (that's the point -- see the lock-scope note above), so it
      // needs more room than the bare row claim did.
      { timeout: 15000 },
    );
  }
}
