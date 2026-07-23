# Stripe Founder-Tier Billing — Design Spec (v2, amended)

**Phase:** DEMM Platform Release 1.0, Phase 2 (DEMM Marketing Operating Slice), Sub-project 4
**Follows:** Sub-project 3 (Marketing Executive Dashboard, Explainable Client Health, Reporting) — deployed and verified on staging, commit `838cbb3`.
**Status:** v1 approved in direction 2026-07-23; amended per Antwann's 13-point spec amendment the same day. This version supersedes v1 in full.

---

## Goal

Replace the manual "Record Payment" honor system for founder-tier revenue with a real, recurring Stripe Subscription: checkout is generated automatically right after lead-to-client conversion, and all subsequent billing events (successful charge, failed charge, cancellation) arrive as Stripe webhooks and update the system automatically — with full audit history, retry-safety, environment isolation, and no silent failure. This upgrades `collectedRevenue90d` and `mrr` on the Marketing Dashboard toward `ACTUAL_VERIFIED`, and feeds payment failures into both Client Health and DOM26-R as controlled signals — without touching the Commercial Truth Lock, the `convert()` transaction, or the OfferSnapshot architecture's *mechanism* (one new snapshotted field is added using the exact same copy-at-creation pattern every other snapshotted field already uses — see §6).

## Hard constraints (carried over from prior sub-projects)

- Do not reopen or redesign: Commercial Truth Lock, Lead → Client conversion transaction, OfferSnapshot architecture, Client onboarding, Service delivery, DOM26-R foundation.
- All new logic must be additive. `ClientAccountService.convert()` and its transaction body are not modified in mechanism — the one field added to what it snapshots is copied the same way every existing field is copied.
- No live-mode charge and no production deployment without separate explicit authorization. Everything in this spec ships to staging in Stripe **test mode** only. §13 lists what must additionally be true before live-mode is authorized.

---

## 1. Environment-aware Stripe catalog (amendment §1, §2)

Checkout must never be built from Offer's currently-editable price. It must be built from an explicit, environment-scoped, immutable mapping between an exact `(Offer, version)` and an exact Stripe Price — and the purchased snapshot must carry a permanent reference to which mapping it used.

### `StripePriceMapping` (new model)

```prisma
model StripePriceMapping {
  id               String   @id @default(uuid())
  offerId          String
  offer            Offer    @relation(fields: [offerId], references: [id], onDelete: Restrict)
  offerVersion     Int
  amount           Decimal  @db.Decimal(12, 2)
  currency         String   @default("usd")
  billingInterval  String   @default("month")
  environment      String   // "local" | "staging" | "production"
  livemode         Boolean
  stripeProductId  String
  stripePriceId    String
  createdAt        DateTime @default(now())
  offerSnapshots   OfferSnapshot[]

  @@unique([offerId, offerVersion, environment, livemode])
  @@index([environment, livemode])
}
```

- One row per `(offer, version, environment, livemode)`. Re-running provisioning for an offer/version that already has a mapping in that environment is a no-op (idempotent by the unique constraint).
- `livemode` is stored explicitly, separate from `environment`, because "staging" could theoretically run against live Stripe keys by mistake — storing both lets the refusal check in §1.1 catch that specific misconfiguration, not just infer it from environment name.

### 1.1 Environment/livemode mismatch refusal

Every place that creates a Checkout Session or reads a price mapping first calls `StripeEnvironmentGuard.assertConsistent()`:
1. Reads `STRIPE_SECRET_KEY` and checks its prefix (`sk_test_` vs `sk_live_`) to determine actual livemode.
2. Reads the app's own `NODE_ENV`/deployment environment (already available via the existing `environment` field returned by `/version`, per Step 0's deployment pipeline).
3. Refuses (throws, fails the request with a clear error, does **not** silently fall through) if:
   - The configured `STRIPE_SECRET_KEY`'s livemode does not match the `StripePriceMapping.livemode` being requested, or
   - `environment: "production"` is paired with a test-mode key (safe direction — allowed only as an explicit, separate future step, never a default), or
   - `environment` is `local`/`staging` and the key is live-mode (this must never happen and is the higher-risk direction).

This guard runs on every checkout attempt and every provisioning call — it is cheap and is the single choke point that makes "wrong Stripe environment" structurally hard to ship.

### `Offer` — no new fields

Per the amendment, `Offer` itself gets **no** `stripeProductId`/`stripePriceId` fields (this reverses v1 §1). `Offer` stays exactly as it is today; `StripePriceMapping` is the only place Stripe catalog identity lives.

---

## 2. OfferSnapshot binding (amendment §1)

### `OfferSnapshot` — one new field

```prisma
model OfferSnapshot {
  // ...existing fields, unchanged...
  stripePriceMappingId String?
  stripePriceMapping    StripePriceMapping? @relation(fields: [stripePriceMappingId], references: [id], onDelete: Restrict)
}
```

- Nullable: snapshots created before this sub-project (or in an environment where the offer hasn't been Stripe-provisioned yet) simply have no Stripe billing attached — they continue to work exactly as they do today via manual commercial-state recording.
- Populated at snapshot-creation time inside `convert()` using the **exact same mechanism** already used to copy `price`, `name`, `includedServices`, etc. from `Offer` onto the new `OfferSnapshot` row: a lookup of `StripePriceMapping` by `(offerId, offerVersion, environment, livemode)` (all of which `convert()` already has available at that point) is added as one more field in the same `create({ data: {...} })` call. This is additive data, not new transaction logic, new side effects, new external calls, or new failure modes inside the transaction — `convert()` remains a pure-DB operation with the same guarantees it has today. If no mapping exists yet for that `(offer, version)` in the current environment, `stripePriceMappingId` is simply left `null` and conversion proceeds exactly as it does today (no Stripe billing available for that client until the offer is provisioned).
- Once set, `stripePriceMappingId` is never updated. A later Offer price/version change creates a *new* `StripePriceMapping` row (new `offerVersion`) — it never mutates the row an existing snapshot already points to. This is what guarantees a later price change can never alter what an already-converted, unbilled `ClientAccount` was promised.

---

## 3. Billing subscription history (amendment §3)

### `BillingSubscription` (new model)

```prisma
enum BillingSubscriptionStatus {
  INCOMPLETE
  INCOMPLETE_EXPIRED
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  UNPAID
  PAUSED
}

model BillingSubscription {
  id                  String                    @id @default(uuid())
  clientAccountId     String
  clientAccount       ClientAccount             @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  stripePriceMappingId String
  stripePriceMapping   StripePriceMapping        @relation(fields: [stripePriceMappingId], references: [id], onDelete: Restrict)
  stripeSubscriptionId String                    @unique
  stripeCustomerId     String
  status               BillingSubscriptionStatus
  trialStart           DateTime?
  trialEnd             DateTime?
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean                   @default(false)
  canceledAt           DateTime?
  createdAt            DateTime                  @default(now())
  syncedAt             DateTime                  @updatedAt
  payments             BillingPaymentRecord[]

  @@index([clientAccountId, createdAt])
  @@index([stripeCustomerId])
}
```

- Many rows per `ClientAccount` by design — a resubscribe after cancellation creates a new row rather than overwriting history.
- "Current" subscription for a client = the row with the latest `createdAt` (or, more precisely, whichever row's `stripeSubscriptionId` matches the most recent `checkout.session.completed`/`customer.subscription.*` event) — computed at read time, never cached redundantly elsewhere.
- `ClientAccount` gets exactly one new field: `stripeCustomerId String?` (a Customer is 1:1 with a ClientAccount even across multiple subscription attempts, so this one is safe to store directly rather than derive). No `stripeSubscriptionId`/`stripeSubscriptionStatus` fields go on `ClientAccount` — that state lives only in `BillingSubscription`, reversing that part of v1.

---

## 4. Checkout attempt persistence (amendment §4)

### `BillingCheckoutSession` (new model)

```prisma
enum BillingCheckoutStatus {
  PENDING
  CREATED
  COMPLETED
  EXPIRED
  FAILED
}

model BillingCheckoutSession {
  id                     String                 @id @default(uuid())
  clientAccountId        String
  clientAccount          ClientAccount          @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  offerSnapshotId        String
  offerSnapshot          OfferSnapshot          @relation(fields: [offerSnapshotId], references: [id], onDelete: Restrict)
  stripeCheckoutSessionId String?
  status                 BillingCheckoutStatus  @default(PENDING)
  idempotencyKey         String                 @unique
  attemptNumber          Int                    @default(1)
  checkoutUrl            String?
  createdAt              DateTime               @default(now())
  expiresAt              DateTime?
  failedAt               DateTime?
  lastError              String?

  @@index([clientAccountId, createdAt])
}
```

- Row is created with `status: PENDING` **before** the Stripe API call is made, so a checkout attempt is durably recorded even if the Stripe call itself never completes (network failure, timeout). Updated to `CREATED` with `stripeCheckoutSessionId`/`checkoutUrl` on success, or `FAILED` with `lastError` on failure.
- `checkoutUrl` is persisted server-side — the frontend reads it from `GET /marketing/clients/:id/billing/checkout` (latest non-expired, non-failed row for that client), not only from the one-time conversion response. This satisfies "do not depend on frontend page state as the only location of the checkout URL."
- **Regeneration action:** `POST /marketing/clients/:id/billing/checkout/regenerate` (role-gated `SUPERADMIN/ORG_OWNER/ORG_ADMIN/WORKSPACE_ADMIN`, matching the existing Client Health override gate) creates a new row with `attemptNumber` incremented from the prior attempt and a fresh idempotency key, then calls Stripe. This is how an operator recovers from an expired or failed checkout link without needing developer intervention.

---

## 5. Checkout failure visibility (amendment §5)

Lead conversion (`convert()`) is untouched and always succeeds or fails purely on today's Commercial Truth Lock rules — Stripe availability is never part of that transaction.

The checkout-generation step that runs immediately after `convert()` returns (same call site as v1 — the controller, wrapped in a non-fatal boundary) now does all of the following on failure, instead of just logging and swallowing:
1. Writes the `BillingCheckoutSession` row with `status: FAILED`, `lastError` populated (visible via §4's `GET .../billing/checkout` endpoint — "visible billing-setup status").
2. Creates a `Task` for the converting operator: "Billing setup failed for `<client name>` — Stripe checkout could not be generated. Retry from the Client Account page." (reuses the existing `Task` model and creation pattern already used for the onboarding-kickoff task in Sub-project 1 — no new model needed here).
3. Writes a `RelationshipSignal` (see §12) of `type: 'BILLING_SETUP_FAILED'`, `severity: HIGH`, `state: ACTIVE` — resolved automatically when a later checkout attempt succeeds.
4. Writes an audit event via the existing `MemoryAuditEvent` pattern (same table Sub-project 3 already writes to for Client Health actions) recording the failure with a correlation ID.

The regeneration endpoint (§4) is the retry path referenced above.

---

## 6. Trial rules from the immutable OfferSnapshot (amendment §10)

**No new field is added anywhere for this.** Trial length is derived purely from data the `OfferSnapshot` already immutably carries — its `key` (`'SURVIVOR'` / `'GROWTH'` / `'EMPIRE'`, copied at snapshot time exactly as today) — via a small static lookup in code, evaluated at Checkout-Session-creation time (not stored, not cached, always re-derived from the immutable snapshot so it can never drift):

```ts
const TRIAL_DAYS_BY_OFFER_KEY: Record<string, number> = {
  SURVIVOR: 7,
  GROWTH: 0,
  EMPIRE: 0,
};
```

If `OfferSnapshot.key` isn't one of these three (future tier), trial defaults to `0` and the lookup logs a warning — fails safe (no trial) rather than guessing. `StripeCheckoutService` passes `subscription_data.trial_period_days` on the Checkout Session accordingly. No additional trial behavior (grace periods, extensions, tier-specific proration) is implemented — locked to exactly the two-tier rule stated in the amendment.

---

## 7. Stripe idempotency keys (amendment §6)

Every Stripe-mutating call uses a deterministic idempotency key passed as Stripe's own `idempotencyKey` request option (not just our internal dedup table — this is Stripe-side idempotency, belt-and-suspenders with our own persistence):

| Call | Idempotency key |
|---|---|
| Product creation | `product-create:{offerId}:{offerVersion}:{environment}` |
| Price creation | `price-create:{offerId}:{offerVersion}:{environment}` |
| Customer creation | `customer-create:{clientAccountId}` |
| Checkout Session creation | the `BillingCheckoutSession.idempotencyKey` generated at row-creation time (§4), e.g. `checkout:{clientAccountId}:{attemptNumber}` |

**Retry-where-Stripe-succeeds-but-persistence-fails test (explicitly required):** simulate the Stripe API call succeeding and returning a real object, then force the subsequent local DB write to throw. Retry the same operation with the same idempotency key and assert: (a) Stripe does not create a second object (verified via Stripe's idempotency replay, which returns the original object), and (b) the local retry successfully persists using the object Stripe returns on replay — i.e., the local write is safe to retry to completion even after a partial failure, because Stripe's response is deterministic for a repeated idempotency key.

---

## 8. Retry-safe webhook processing (amendment §7, §8)

### `StripeWebhookEvent` — expanded

```prisma
enum WebhookProcessingState {
  RECEIVED
  PROCESSING
  PROCESSED
  FAILED
}

model StripeWebhookEvent {
  id              String                 @id @default(uuid())
  stripeEventId   String                 @unique
  eventType       String
  processingState WebhookProcessingState @default(RECEIVED)
  attemptCount    Int                    @default(0)
  receivedAt      DateTime               @default(now())
  processedAt     DateTime?
  lastError       String?
  eventCreatedAt  DateTime
  apiVersion      String
  livemode        Boolean
  payloadHash     String
  correlationId   String?

  @@index([processingState, receivedAt])
}
```

### 8.1 Concurrency-safe dedup

On receipt: attempt `INSERT INTO StripeWebhookEvent (...) VALUES (...) ON CONFLICT (stripeEventId) DO NOTHING`, inside a transaction.
- **No conflict** (new event): row is `RECEIVED`, immediately transitioned to `PROCESSING` (`attemptCount: 1`) inside the same transaction before releasing, then business-effect handlers run.
- **Conflict** (event ID already exists — either a genuine retry, or a concurrent duplicate delivery racing the first): re-fetch the existing row.
  - `PROCESSED` → acknowledge `200`, do nothing. ("Only PROCESSED events are ignored.")
  - `FAILED` → this is a legitimate retry; transition to `PROCESSING`, increment `attemptCount`, re-run handlers. ("FAILED events remain retryable.")
  - `PROCESSING` → another request is currently mid-flight for this exact event (the concurrent-duplicate case). Acquire a Postgres advisory lock keyed on a hash of `stripeEventId` before proceeding, so only one process actually executes business effects at a time for a given event; the second racer blocks briefly, then re-checks state (now `PROCESSED` or `FAILED`) and follows the branch above. This is what produces "one set of business effects" under concurrent duplicate delivery.
- All business-effect writes inside a handler are themselves naturally idempotent regardless (upsert `BillingSubscription` by `stripeSubscriptionId`, upsert `BillingPaymentRecord` by `stripeInvoiceId`) as defense in depth beyond the event-level lock.

### 8.2 Event ordering (§8)

`checkout.session.completed` is not assumed to arrive before `customer.subscription.created`/`invoice.paid` — Stripe does not guarantee delivery order. Every handler resolves its target `ClientAccount` independently:
- Checkout Session is created with `metadata: { clientAccountId }` **and** `subscription_data: { metadata: { clientAccountId } }` (both, per the amendment) — so a `customer.subscription.*` or `invoice.*` event that references a subscription which itself carries that metadata can resolve the `ClientAccount` even if the `checkout.session.completed` event hasn't been processed yet.
- If a handler receives a `stripeSubscriptionId` it hasn't seen before (no matching `BillingSubscription` row yet) — rather than failing, it calls `stripe.subscriptions.retrieve(id, { expand: ['metadata'] })` to fetch the full object (including metadata) directly from Stripe and upserts a `BillingSubscription` row from that retrieved state before applying the event. ("Retrieve Stripe objects when webhook data is insufficient.")

### 8.3 Handled event types

`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created` (the "required refund/reversal events"). Any other event type is acknowledged and no-op'd, still recorded in `StripeWebhookEvent` as `PROCESSED` (so replays don't reprocess it either).

---

## 9. Pinned Stripe API version (amendment §9)

- SDK initialized with an explicit `apiVersion` (e.g. `'2026-06-01'` — exact value confirmed against Stripe's current dashboard-recommended version at implementation time, not guessed here).
- The webhook endpoint's signature verification (`stripe.webhooks.constructEvent`) uses the same pinned SDK instance.
- The pinned version string is exported from one constant (`backend/src/modules/marketing/stripe-config.ts`) and imported everywhere Stripe is touched — SDK init, tests, and is written into `StripeWebhookEvent.apiVersion` per-event (recording what Stripe actually sent, which should match the pin — a mismatch is itself worth surfacing, e.g. via a startup log warning if Stripe's account-level webhook version drifts from our pin).
- Documented in this spec and in `docs/superpowers/specs/` going forward as the single place the pin is declared; the deployment report (existing `deploy-reports/*.json` from Step 0) is not modified for this, since the API version isn't a per-deploy fact — it's a per-SDK-version fact.

---

## 10. Rich payment records + KPI rules (amendment §11)

### `BillingPaymentRecord` (new model — the rich Stripe-fidelity ledger)

```prisma
enum PaymentReversalState {
  NONE
  PARTIAL_REFUND
  FULL_REFUND
}

model BillingPaymentRecord {
  id                     String                @id @default(uuid())
  clientAccountId        String
  clientAccount          ClientAccount         @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  billingSubscriptionId  String?
  billingSubscription    BillingSubscription?  @relation(fields: [billingSubscriptionId], references: [id], onDelete: SetNull)
  stripeInvoiceId        String?               @unique
  stripePaymentIntentId  String?
  stripeCustomerId       String
  stripeSubscriptionId   String?
  amountPaid             Decimal               @db.Decimal(12, 2)
  currency               String
  taxAmount              Decimal?              @db.Decimal(12, 2)
  creditAmount           Decimal?              @db.Decimal(12, 2)
  billingPeriodStart     DateTime?
  billingPeriodEnd       DateTime?
  paidAt                 DateTime
  refundedAmount         Decimal               @default(0) @db.Decimal(12, 2)
  reversalState          PaymentReversalState  @default(NONE)
  createdAt              DateTime              @default(now())

  @@index([clientAccountId, paidAt])
}
```

This is deliberately a **second, richer, sibling record** to the existing `ClientCommercialStateChange` row — not a replacement. On `invoice.paid`, the webhook handler writes both:
1. A `BillingPaymentRecord` (full Stripe fidelity, above).
2. A `ClientCommercialStateChange(field: 'PAYMENT', newValue: 'PAID', amount, source: 'STRIPE_WEBHOOK', recordedById: null)` — **exactly the same write shape Sub-project 3 already established**, so the existing dashboard/report KPI code that already reads `ClientCommercialStateChange` needs zero changes to pick up Stripe-sourced revenue. `BillingPaymentRecord` exists for audit fidelity, refund tracking, and future reporting depth; `ClientCommercialStateChange` stays the one feed the KPI layer already trusts.

On `charge.refunded`: updates the matching `BillingPaymentRecord.refundedAmount`/`reversalState`, and writes a **new** `ClientCommercialStateChange(field: 'PAYMENT', newValue: 'REFUNDED', amount: -refundedAmount, source: 'STRIPE_WEBHOOK')` — a negative-amount row, so revenue sums naturally net out without needing special-case subtraction logic anywhere in the KPI layer.

### KPI classification — `MIXED_SOURCES` (amendment §11)

`KpiClassification` gains one new value: `'MIXED_SOURCES'`. `KpiService`'s revenue classification logic (already checks whether every contributing `ClientCommercialStateChange` row shares one `source`) now has three outcomes instead of two:
- All contributing rows `source: 'STRIPE_WEBHOOK'` → `ACTUAL_VERIFIED`.
- All contributing rows `source: 'MANUAL'` → `MANUALLY_RECORDED` (unchanged from Sub-project 3).
- A mix of both → `MIXED_SOURCES` (new — never silently collapses to either pure label).

### Double-counting prevention (amendment §11)

`ClientAccountService.recordCommercialStateChange` (the existing method, not `convert()`) gets one new guard: if `field === 'PAYMENT'` and the target `ClientAccount` has any `BillingSubscription` row with `status` in `(ACTIVE, TRIALING, PAST_DUE, INCOMPLETE)`, the manual entry is **rejected** with a clear error directing the operator to Stripe as the authoritative source for that client — unless the caller explicitly passes `allowManualAlongsideStripe: true` (for a genuine edge case like an out-of-band wire transfer alongside an active Stripe subscription), in which case it's allowed but the resulting figure is what produces the `MIXED_SOURCES` classification above rather than silently presenting as fully verified.

The blocked-status list is deliberately narrow: `CANCELED`, `UNPAID`, `INCOMPLETE_EXPIRED`, and `PAUSED` are **not** included, because those states mean Stripe is no longer the active billing path for that client — a canceled Stripe subscription followed by an out-of-band payment (wire, check) is exactly the normal case the manual path should still cover without needing an override flag.

### MRR calculation

`mrr` is computed from the `amount` on the `StripePriceMapping` referenced by each client's current **`ACTIVE`** `BillingSubscription` (summed across clients), not from invoice history — this is what "MRR from active recurring subscription price" means: MRR reflects committed run-rate, not trailing collections, which is the standard MRR definition and matches what "Collected (90d)" already covers on the trailing-actuals side.

---

## 11. DOM26-R commercial signals (amendment §12)

Uses the existing `RelationshipSignal` model (already defined in schema, not yet wired to any service per its own schema comment — this sub-project is what activates it), scoped to the `RelationshipProfile` for the client's primary contact (same profile the existing Relationship Brief already uses).

| Trigger | `type` | `severity` | Resolution |
|---|---|---|---|
| `BillingCheckoutSession` created | `CHECKOUT_PENDING` | LOW | Auto-resolved when that session's status becomes `COMPLETED` or a new attempt supersedes it |
| Checkout attempt fails (§5) | `BILLING_SETUP_FAILED` | HIGH | Auto-resolved on next successful checkout generation |
| `invoice.paid` | `PAYMENT_SUCCESS` | LOW | Self-resolves immediately (informational, not a standing risk) |
| `invoice.payment_failed` | `PAYMENT_FAILURE` | MEDIUM | Auto-resolved by a later `invoice.paid` for the same subscription (payment recovery) |
| Subscription enters `PAST_DUE` | `PAST_DUE` | HIGH | Auto-resolved when status returns to `ACTIVE` |
| `cancel_at_period_end` set | `CANCELLATION_SCHEDULED` | MEDIUM | Auto-resolved if un-scheduled, or transitions to the next row on actual cancellation |
| `customer.subscription.deleted` | `CANCELLATION_COMPLETED` | HIGH | Stays `ACTIVE` (unresolved) — genuinely needs human follow-up, not auto-closed |
| A `PAST_DUE`/`PAYMENT_FAILURE` signal's subscription returns to `ACTIVE` | `PAYMENT_RECOVERY` | LOW | Self-resolves; also resolves the `PAST_DUE`/`PAYMENT_FAILURE` row it followed |

**No card data is ever stored** in `summary` or anywhere in DOM26-R — signals reference amounts, dates, and status strings only, never a PAN, card brand+last4 beyond what's needed for an operator to recognize the account (last4 alone is acceptable per PCI SAQ-A scope since Stripe Checkout is what handles the card; DEMM CRM never receives or stores full card data at any point in this design).

**No monthly memory spam:** routine `PAYMENT_SUCCESS` signals are the only high-frequency event type here (monthly, by definition, once a subscription is steady-state) — they're deliberately `LOW` severity and **self-resolve immediately** rather than accumulating as standing `ACTIVE` signals, so a healthy client doesn't build up an ever-growing list of "signals" over a year of normal billing. Only genuinely actionable states (`PAST_DUE`, `BILLING_SETUP_FAILED`, `CANCELLATION_COMPLETED`) remain `ACTIVE` and visible. This mirrors the same "routine mutation creates no permanent record, meaningful transition does" principle Client Health already established in Sub-project 3.

Relationship Briefs are updated by the same `recordHealthChangeCandidate`-style call already used by Client Health (creates a `MemoryCandidate`, not a raw engram) — only for the `HIGH`-severity transitions (`BILLING_SETUP_FAILED`, `PAST_DUE`, `CANCELLATION_COMPLETED`), not every signal, keeping brief-update frequency proportional to actual relationship risk.

---

## 12. Webhook endpoint

Unchanged in shape from v1: `POST /webhooks/stripe`, not behind `JwtAuthGuard`/`WorkspaceGuard`, raw-body-scoped to this one route, verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`. On signature failure: `400`, nothing processed (this is itself a fail-closed missing/wrong-secret behavior — see §14 tests). Now additionally computes `payloadHash` (sha256 of the raw body) and pulls `event.api_version`/`event.livemode`/`event.created` into the `StripeWebhookEvent` row per §8/§9 before dispatching to handlers.

---

## 13. Live-mode launch blockers (amendment §13)

The following are **explicitly deferred** from this sub-project's staging/test-mode scope, and each one is a **hard blocker** on live-mode production authorization — none of them may be skipped when the time comes to go live, and this spec does not authorize that transition:

1. Stripe Customer Portal (or equivalent) for client-initiated payment-method updates.
2. Operator-facing cancellation management UI (beyond the webhook-driven status sync already built here).
3. A defined retry/dunning recovery path for `PAST_DUE` subscriptions (Stripe's own Smart Retries can be configured, but the DEMM-side operator workflow around it is not designed here).
4. Invoice history UI for clients/operators.
5. Refund reconciliation workflow (the data model in §10 records refunds; there's no UI/process for *deciding* to issue one).
6. A tax decision (Stripe Tax vs. manual vs. none) — not decided in this spec.
7. Final, legally-reviewed cancellation terms per tier (the current `Offer.cancellationTerms` field is still `null`/undecided for most tiers per the Commercial Truth Lock's own known limitations).
8. A documented webhook replay/recovery procedure for extended Stripe or DEMM downtime.
9. Live secret rotation procedure and incident-response plan for a compromised live key.
10. A completed one-cent (or otherwise approved low-risk) live verification transaction, run and confirmed by Antwann before any real client is charged.

---

## 14. Testing

New HTTP-level test file `backend/test-stripe-billing-api.ts` (established pattern — boots the real Nest app), plus a webhook-specific fixture helper for signing synthetic Stripe events with the real `STRIPE_WEBHOOK_SECRET`. Required coverage:

1. **Environment/livemode isolation** — a staging-configured `StripePriceMapping` cannot be used to create a checkout when `STRIPE_SECRET_KEY` is a live key (and vice versa); `StripeEnvironmentGuard` refusal is asserted directly.
2. **OfferSnapshot price immutability** — create a `ClientAccount` against `StripePriceMapping` v1, then create a new `StripePriceMapping` v2 (simulating a price change), assert the existing `ClientAccount`'s `OfferSnapshot.stripePriceMappingId` still points at v1 and its checkout still uses v1's price.
3. **Trial rules** — SURVIVOR snapshot produces a Checkout Session with `trial_period_days: 7`; GROWTH and EMPIRE produce `0`/absent.
4. **Stripe POST idempotency** — the retry-after-Stripe-succeeds-but-persistence-fails scenario from §7, asserting no duplicate Stripe object and a successful eventual local write.
5. **Checkout persistence and regeneration** — a `BillingCheckoutSession` row exists before the Stripe call completes; regeneration creates `attemptNumber: 2` with a new idempotency key; `GET .../billing/checkout` returns the latest non-expired attempt.
6. **Out-of-order webhook delivery** — deliver `invoice.paid` before `checkout.session.completed` for the same subscription; assert the handler retrieves the subscription from Stripe directly and correctly resolves/creates the `ClientAccount` link.
7. **Failed-event retry** — force a handler to throw mid-processing (leaving `StripeWebhookEvent.processingState: FAILED`), redeliver the same event, assert it reprocesses and reaches `PROCESSED`.
8. **Concurrent duplicate webhooks** — fire the same signed event payload twice in parallel, assert exactly one set of business effects (one `BillingPaymentRecord`, one `ClientCommercialStateChange`) and both requests return `200`.
9. **Complete subscription status synchronization** — walk a subscription through `INCOMPLETE → TRIALING → ACTIVE → PAST_DUE → ACTIVE → CANCELED` via synthetic events, asserting `BillingSubscription.status` and the associated `RelationshipSignal`s at each step.
10. **Manual/Stripe double-count prevention** — attempt a manual `PAYMENT` entry on a client with an `ACTIVE` `BillingSubscription`, assert rejection (and assert the `allowManualAlongsideStripe: true` override produces a `MIXED_SOURCES`-classified figure).
11. **Refunds** — synthetic `charge.refunded` event updates `BillingPaymentRecord.reversalState`/`refundedAmount` and writes the offsetting negative `ClientCommercialStateChange`; dashboard `collectedRevenue90d` reflects the net figure.
12. **MRR vs. collected-revenue calculations** — assert MRR is computed from active `StripePriceMapping.amount`, not from trailing invoice sums, using a scenario where they'd otherwise diverge (e.g. mid-period upgrade).
13. **DOM26-R signal creation and resolution** — each row of the §11 table gets a test: signal created on trigger, auto-resolved (or deliberately left `ACTIVE`) exactly as specified.
14. **Missing-secret fail-closed behavior** — with `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` unset, assert checkout generation fails loudly (not silently skipped) and the webhook endpoint rejects all payloads with `400` rather than accepting unverified events.

Full existing regression suite (all prior sub-project suites) re-run afterward, same discipline as every prior sub-project.

## Known limitations (stated up front, not discovered later)

- No transactional email is wired up yet — checkout links are surfaced to the operator via `GET .../billing/checkout`, not auto-emailed. Out of scope for this sub-project.
- Founder-tier upgrade/downgrade with proration is not handled — out of scope, flagged for a future slice.
- This sub-project ships to staging in Stripe test mode only. See §13 for everything that must be true before live-mode is authorized — none of it is built here.
