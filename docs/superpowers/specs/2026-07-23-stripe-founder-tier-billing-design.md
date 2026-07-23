# Stripe Founder-Tier Billing — Design Spec

**Phase:** DEMM Platform Release 1.0, Phase 2 (DEMM Marketing Operating Slice), Sub-project 4
**Follows:** Sub-project 3 (Marketing Executive Dashboard, Explainable Client Health, Reporting) — deployed and verified on staging, commit `838cbb3`.
**Status:** Approved by Antwann in brainstorming session, 2026-07-23.

---

## Goal

Replace the manual "Record Payment" honor system for founder-tier revenue with a real, recurring Stripe Subscription: checkout is generated automatically right after lead-to-client conversion, and all subsequent billing events (successful charge, failed charge, cancellation) arrive as Stripe webhooks and update the system automatically. This upgrades `collectedRevenue90d` and `mrr` on the Marketing Dashboard from `MANUALLY_RECORDED`/`ESTIMATED` to `ACTUAL_VERIFIED` for Stripe-covered clients, and feeds payment failures into Client Health as a `COMMERCIAL`-owned risk factor — without touching the Commercial Truth Lock, the `convert()` transaction, or the OfferSnapshot architecture.

## Hard constraints (carried over from prior sub-projects)

- Do not reopen or redesign: Commercial Truth Lock, Lead → Client conversion transaction, OfferSnapshot architecture, Client onboarding, Service delivery, DOM26-R foundation.
- All new logic must be additive: new tables, new fields (nullable, non-breaking), new services, one new controller, one new webhook endpoint. `ClientAccountService.convert()` and its transaction body are not modified.
- No production deployment without separate explicit authorization. Stripe integration ships to staging in **test mode** only until Antwann explicitly authorizes live-mode keys and a production deploy.

## Decisions locked during brainstorming

1. **Billing model:** real recurring Stripe Subscription (not one-time/manual-invoice-per-cycle). Matches the existing "/mo" pricing and MRR KPI semantics already live on the dashboard.
2. **Trigger point:** checkout is auto-generated immediately after `convert()` returns (in the controller, not inside the conversion transaction) — not a separate manual "Send Checkout Link" action.
3. **Stripe account:** Antwann has an existing Stripe account. Test-mode keys will be provisioned into GCP Secret Manager before implementation begins; live-mode activation is a separate, later, explicitly-authorized step.
4. **Stripe Products/Prices:** created and owned by this integration (not pre-existing in Stripe) — a seed/sync step creates one Stripe Product + recurring monthly Price per founder-tier `Offer`, keyed by `Offer.key`, and stores the resulting IDs back on the `Offer` row. The `Offer` table remains the single source of truth; Stripe's catalog is derived from it, not the reverse.

## 1. Data model

### `Offer` — new nullable fields
- `stripeProductId String?`
- `stripePriceId String?`

Populated by a one-time seed/sync script per environment (local, staging, later production), not by application runtime code. If a founder-tier Offer has no `stripePriceId` yet, checkout generation for that tier fails loudly (not silently) with a clear "Offer not yet Stripe-provisioned" error — this is a deliberate fail-closed choice so a misconfigured environment can never silently skip billing.

### `ClientAccount` — new nullable fields
- `stripeCustomerId String?`
- `stripeSubscriptionId String?`
- `stripeSubscriptionStatus StripeSubscriptionStatus?` — new enum: `INCOMPLETE | ACTIVE | PAST_DUE | CANCELED | UNPAID`, mirroring Stripe's own subscription status values.

All three are nullable because clients created before this sub-project, or clients handled outside Stripe entirely, will never have them populated — the manual "Record Payment" path continues to work exactly as it does today for those cases.

### `ClientCommercialStateChange` — reuse existing `source` field, loosen `recordedById`
`source String @default("MANUAL")` already exists on this model (added in Sub-project 3 for the same manual-payment-recording work). No new field is needed — Stripe-driven rows simply write `source: 'STRIPE_WEBHOOK'` instead of `'MANUAL'`. This is the field the KPI layer reads to decide whether a given payment record can be classified `ACTUAL_VERIFIED` (source `'STRIPE_WEBHOOK'`) or must remain `MANUALLY_RECORDED` (source `'MANUAL'`, the existing default — every historical row keeps its current, correct classification with no backfill needed).

`recordedById String` is currently **required** (references `User`), which breaks for a webhook-created row — Stripe events have no human actor. Loosen it to `recordedById String?` (nullable relation). This is additive/backward-compatible: every existing row already has a value and is unaffected; only new Stripe-sourced rows will have `recordedById: null`. Nullable is preferred over inventing a synthetic "system user" — a null actor honestly communicates "no human recorded this," rather than a fake identity implying someone did.

### New table: `StripeWebhookEvent`
- `id String @id @default(uuid())`
- `stripeEventId String @unique`
- `eventType String`
- `processedAt DateTime @default(now())`

Idempotency ledger for inbound webhooks — same discipline as the existing `ConversionIdempotencyKey` table. A webhook whose `stripeEventId` is already present is acknowledged with `200 OK` and otherwise ignored (Stripe retries on any non-2xx, so this table is what makes retries safe).

## 2. Backend services

### `StripeProvisioningService` (new, `backend/src/modules/marketing/stripe-provisioning.service.ts`)
One method, `syncOfferPrices()`: for each `Offer` with `lifecycleState: ACTIVE` and no `stripePriceId`, creates a Stripe Product (name = Offer.name) and a recurring monthly Price (amount = Offer.price, currency = usd), writes both IDs back onto the `Offer` row. Idempotent — re-running it is a no-op for Offers that already have a `stripePriceId`. Exposed as a one-off admin action (script + optional protected controller route, `SUPERADMIN`-gated) rather than something that runs automatically, since it mutates the Stripe catalog.

### `StripeCheckoutService` (new, `backend/src/modules/marketing/stripe-checkout.service.ts`)
`createSubscriptionCheckout(clientAccountId: string): Promise<{ checkoutUrl: string }>`:
1. Loads the `ClientAccount` with its `offer` (via `offerSnapshot.offerId` → `Offer`, read-only lookup — does not touch OfferSnapshot).
2. Fails loudly if `Offer.stripePriceId` is null ("Offer not yet Stripe-provisioned").
3. Creates a Stripe Customer if `ClientAccount.stripeCustomerId` is null (stores the resulting ID), reusing the existing one otherwise (safe to call more than once — e.g. operator re-generates a link after the first one expired).
4. Creates a Stripe Checkout Session, `mode: 'subscription'`, `line_items: [{ price: offer.stripePriceId, quantity: 1 }]`, `customer: stripeCustomerId`, `metadata: { clientAccountId }` (this metadata is what lets the webhook handler resolve the target `ClientAccount` without trusting anything else in the payload), `success_url`/`cancel_url` pointing back at the Client Account page.
5. Returns the session's hosted `url`.

Called from `ClientAccountController`, immediately after `convert()` resolves and after the existing Client Health recalculation call — same additive pattern already used for that call, wrapped in the same non-fatal `.catch` (a Stripe outage must never fail or roll back an otherwise-successful conversion).

### `StripeWebhookService` (new, `backend/src/modules/marketing/stripe-webhook.service.ts`)
`handleEvent(event: Stripe.Event): Promise<void>`, dispatched by type:
- `checkout.session.completed` → resolve `ClientAccount` via `event.data.object.metadata.clientAccountId`; set `stripeSubscriptionId` from `event.data.object.subscription`.
- `invoice.paid` → resolve `ClientAccount` via `stripeSubscriptionId` (from `event.data.object.subscription`); write `ClientCommercialStateChange(field: 'PAYMENT', newValue: 'PAID', amount: event.data.object.amount_paid / 100, source: 'STRIPE_WEBHOOK', recordedById: null)`; set `stripeSubscriptionStatus: ACTIVE`; call `ClientHealthService.calculate(...)` (fire-and-forget, matching the existing side-effect pattern).
- `invoice.payment_failed` → resolve `ClientAccount` via `stripeSubscriptionId`; set `stripeSubscriptionStatus: PAST_DUE`; call `ClientHealthService.calculate(...)`.
- `customer.subscription.deleted` → resolve `ClientAccount` via `stripeSubscriptionId`; set `stripeSubscriptionStatus: CANCELED`; call `ClientHealthService.calculate(...)`.
- Any other event type: acknowledged, no-op.

Every branch first checks `StripeWebhookEvent` for the incoming `event.id`; if present, returns immediately without reprocessing.

### `ClientHealthService` — one new factor source
Reads `ClientAccount.stripeSubscriptionStatus`. If `PAST_DUE` or `UNPAID`, emits a factor: `{ riskOwner: 'COMMERCIAL', description: 'Stripe subscription payment failed / past due', evidence: 'stripeSubscriptionStatus=PAST_DUE' }`. This is the only change to `client-health.service.ts` — additive to the existing factor-computation list, no change to its public signature.

### `KpiService` — classification logic
Where `collectedRevenue90d` and `mrr` currently classify as `MANUALLY_RECORDED`, they now check whether every `ClientCommercialStateChange` row contributing to the figure has `source: STRIPE_WEBHOOK`. If all contributing rows are Stripe-verified, classify `ACTUAL_VERIFIED`. If the set is mixed (some manual, some Stripe) or all manual, classification stays `MANUALLY_RECORDED` — never silently upgrades a partially-manual figure to look fully verified.

## 3. Webhook endpoint

`POST /webhooks/stripe` (new controller, `backend/src/modules/marketing/stripe-webhook.controller.ts`):
- Not behind `JwtAuthGuard`/`WorkspaceGuard` (Stripe cannot present our JWT or workspace header).
- Verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.constructEvent(rawBody, signature, secret)` — requires the raw request body, so this one route is registered with Nest's raw-body option (`express.raw({ type: 'application/json' })`) scoped only to this path; every other route keeps the existing JSON body parser untouched.
- On signature verification failure: `400`, nothing processed, nothing logged beyond the rejection.
- On success: delegates to `StripeWebhookService.handleEvent(event)`, returns `200`.

## 4. Frontend

### Client Account Overview tab — new "Billing" card
Mirrors the existing "Commercial State" and "Launch" cards structurally. Shows:
- No subscription yet: the generated checkout URL (from the conversion response, held in page state) with a copy-to-clipboard button.
- Subscription exists: a status badge (`ACTIVE`/`PAST_DUE`/`CANCELED`/`INCOMPLETE`/`UNPAID`, same `STATE_TONE`-style color mapping as Client Health) plus the last-known amount from the most recent Stripe-sourced `ClientCommercialStateChange`.

No changes to the Marketing Dashboard or Reports frontend code — both already render whatever classification the backend returns.

## 5. Security

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` → GCP Secret Manager, same pattern as `DATABASE_URL`. Antwann provisions the actual values via `gcloud secrets create`/`versions add` when implementation reaches that step; values are never pasted into chat or committed.
- Webhook signature verification is mandatory and non-optional — there is no code path that processes a Stripe event without a verified signature.
- The webhook payload's `metadata.clientAccountId` (set by us at Checkout-Session-creation time) and `stripeSubscriptionId`/`stripeCustomerId` (assigned by Stripe, never client-editable) are the only identifiers trusted to resolve which `ClientAccount` a webhook event applies to.
- Test mode only for this sub-project. Live-mode key provisioning and the first live charge require a separate, explicit, later authorization from Antwann — this spec does not authorize live billing.

## 6. Testing

New HTTP-level test file, `backend/test-stripe-billing-api.ts`, following the established pattern (boots the real Nest app):
- `StripeProvisioningService.syncOfferPrices()` against Stripe test mode: asserts all 3 founder-tier Offers end up with non-null `stripePriceId`/`stripeProductId`, and that re-running is a no-op (no duplicate Stripe objects).
- `StripeCheckoutService.createSubscriptionCheckout()`: asserts a well-formed Stripe-hosted checkout URL is returned, and that `ClientAccount.stripeCustomerId` is populated.
- Webhook idempotency: POST the same synthetic, correctly-signed `invoice.paid` event twice; asserts only one `ClientCommercialStateChange` row is created.
- Webhook → KPI classification: after a synthetic `invoice.paid` event, asserts `collectedRevenue90d.classification === 'ACTUAL_VERIFIED'` on the dashboard for that client's contribution.
- Webhook → Client Health: after a synthetic `invoice.payment_failed` event, asserts a `COMMERCIAL`-owned factor appears on that client's Client Health.
- Signature rejection: POST an unsigned/badly-signed payload, asserts `400` and no state change.
- Full existing regression suite re-run afterward (all prior sub-project suites), same discipline as every prior sub-project.

Synthetic events are built and signed using Stripe's own SDK test helpers (`stripe.webhooks.generateTestHeaderString` or equivalent) against the real `STRIPE_WEBHOOK_SECRET` — not hand-rolled fixtures — so the test exercises the actual signature-verification code path.

## Known limitations (stated up front, not discovered later)

- No transactional email is wired up yet — the checkout link is generated for an operator to copy/send manually, not auto-emailed to the client. Email delivery is out of scope for this sub-project.
- Founder-tier price changes after a client is already subscribed are not handled by this sub-project (no proration/upgrade-downgrade flow) — out of scope, flagged for a future slice if it becomes a real need.
- This sub-project ships to staging in Stripe test mode only. Live-mode activation is a distinct, later, separately-authorized step.
