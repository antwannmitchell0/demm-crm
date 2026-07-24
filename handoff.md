# DEMM Platform Release 1.0 — Technical Handoff Package

Welcome! This document provides all the context, schemas, and verification evidence needed to resume work on **DEMM Platform Release 1.0**. Last updated during **Phase 2 Sub-project 4 (Stripe Founder-Tier Billing)**, mid-Task 20, in worktree `.claude/worktrees/phase-2-lead-to-client-core` on branch `worktree-phase-2-lead-to-client-core`.

---

## 1. Project Context & Environment

- **GCP Project**: `gen-lang-client-0096028843`
- **Staging domains**:
  - Frontend: `https://demm-crm-frontend-staging-431876670120.us-east1.run.app`
  - Backend: `https://demm-crm-backend-staging-431876670120.us-east1.run.app`
- **Staging DB instance**: `demm-crm-staging-db` (region `us-east1`)
- **Deploy identity**: `antwannmitchell0@gmail.com` — the *only* gcloud account with real access to this project. `scripts/deploy-staging.sh` switches to it automatically; when running ad-hoc `gcloud` commands by hand, run `gcloud config set account antwannmitchell0@gmail.com` first. A different identity (`vertex-express@begreat-app-493417...` or anything authenticated on the `wtae-main` GCE VM) has **zero** access to this project — don't waste time debugging "permission denied" or "not found" errors against this project without first confirming the active account.
- **Deploy pipeline**: `scripts/deploy-staging.sh deploy --commit=<sha> [--dry-run] [--yes]` — builds from a `git archive` of a named, already-pushed commit (never the working tree), checks/applies pending Prisma migrations against staging before any build step, deploys both services, and verifies the live `/version` commit SHA matches on both before declaring success (auto-rollback on mismatch). See the script's own header comment for the incident that motivated it.

---

## 2. Current Implementation State — Sub-project 4 (Stripe Founder-Tier Billing)

Phase 2 Sub-projects 1–3 (Lead→Client core, Onboarding/Service Delivery, Marketing Dashboard/Health/Reporting) are complete and live on staging from prior sessions.

**Sub-project 4 status: Tasks 0–19 done, full regression + independent review clean, staging deploy live. Task 20 (live walkthrough) is in progress and currently blocked — see §4. Task 21 (final capture/report) not started.**

### 2.1 What shipped (commit `18485d254c6d7ffc626c6349a24ca24bfd4e57d6`, on `main`)
- 4 new Prisma models: `StripePriceMapping`, `BillingSubscription`, `BillingCheckoutSession`, `BillingPaymentRecord`; expanded `StripeWebhookEvent`; new fields on `Offer`/`OfferSnapshot` (`trialEligible`, `trialDays`, `stripePriceMappingId`) and `ClientAccount`.
- `StripeEnvironmentGuard` — fail-closed if `STRIPE_SECRET_KEY` missing, or if livemode/environment don't match (`APP_ENVIRONMENT` env var: `local`/`staging`/`production`). **Every Stripe operation is scoped per-environment** — a `StripePriceMapping` row provisioned with `environment: 'local'` is invisible to the staging backend and vice versa. This bit us once already during Task 20 setup (see §4).
- `StripeProvisioningService.syncOfferPrices()` — idempotent, provisions a real Stripe Product+Price per ACTIVE Offer for the current environment. One-off runner: `backend/scripts/dev-sync-offer-prices.ts` (not part of the app runtime, run manually — see §5 for the exact invocation pattern against staging).
- `StripeCheckoutService` + `BillingCheckoutSession` — `client-account.controller.ts`'s `convert()` now auto-generates a real Stripe Checkout Session immediately after conversion (never inside `convert()`'s transaction — that transaction body was touched in exactly one reviewed place: two new `OfferSnapshot` fields + one lookup query, nothing else). Failures route through `BillingCheckoutFailureService` (Task/RelationshipSignal/audit-event) without failing the conversion.
- `StripeCheckoutController` (`/marketing/clients/:id/billing/checkout` GET + `/regenerate` POST, role-gated).
- `StripeWebhookController` (`/webhooks/stripe`, raw-body, signature-verified, no auth guard — correct, Stripe can't present a JWT) + `StripeWebhookDedupService` (Postgres advisory lock spanning claim→process→mark) + `StripeWebhookHandlerService` (subscription lifecycle, payments, refunds, disputes — 8 event types, see §4 for the exact list).
- KPI `MIXED_SOURCES` classification + double-counting guard on `recordCommercialStateChange` (the `allowManualAlongsideStripe` flag defaults falsy — a caller can't bypass it by omission).
- Client Health `COMMERCIAL` factor from live `BillingSubscription` status.
- DOM26-R `RelationshipSignal` wiring for 6 billing-driven signal types.
- Frontend `BillingCard` component on the client detail page — status badge, subscription-status badge, checkout link, role-gated regenerate button. Visually verified working in-browser against real data.

### 2.2 Verification already done
- **Local**: `backend/test-stripe-billing-api.ts`, 75/75 checks passing (twice), real Stripe test-mode API calls throughout (not mocked), webhook signature verification exercised for real via `Stripe.webhooks.generateTestHeaderString` (cryptographically real HMAC, synthetic event payloads).
- **Independent architecture/security review** (fresh subagent, no prior context): **96/100, READY FOR STAGING**. All 8 required checks passed — `convert()` diff scope, additive-only migration, `StripePriceMapping` uniqueness, webhook auth/signature with no bypass, `payment_method_collection: 'always'` (cards required even during trial), no raw card/PAN/CVC anywhere, double-counting guard can't be bypassed by omission, no secret ever logged. Two non-blocking hardening notes for later: webhook handler doesn't cross-check `event.livemode` against the environment guard explicitly (currently safe because each environment has its own distinct webhook secret); `GET .../billing/checkout` has no extra role check beyond workspace scoping (only `regenerate` is role-gated) — confirm this matches intended RBAC.
- **Staging deploy** (Task 19): DB backed up first (`gcloud sql backups list --instance=demm-crm-staging-db`, backup ID `1784862865250`), migration `20260723164851_stripe_founder_tier_billing` applied, build+deploy succeeded via the pipeline, live commit SHA verified matching on both services (backend rev `demm-crm-backend-staging-00014-9zj`, frontend rev `demm-crm-frontend-staging-00006-745`, both at 100% traffic). Deploy report: `deploy-reports/18485d254c6d7ffc626c6349a24ca24bfd4e57d6-20260724T032454Z.json`.
- **Staging smoke test** (Task 20 Step 1): `backend/verify-stripe-billing-staging-smoke.ts`, 10/10 passing against live HTTPS staging. Provisions a throwaway Offer's Stripe Price mapping in-process, then exercises checkout generation/retrieval/regeneration and dashboard classification through the public API. **Does not** attempt synthetic webhook signing — the real `STRIPE_WEBHOOK_SECRET` was entered directly into GCP Secret Manager by Antwann and is never read by any Claude-driven process, so a validly-signed synthetic event can't be constructed. Real webhook delivery is meant to be proven in Task 20 Step 2 instead, via an actual completed Stripe test-mode checkout (Stripe's own infrastructure signs and delivers it — stronger proof than a self-signed synthetic event).

### 2.3 GCP Secret Manager (staging)
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` now exist in Secret Manager and are bound to the `demm-crm-backend-staging` Cloud Run service (via `--update-secrets`), alongside `APP_ENVIRONMENT=staging`. The webhook endpoint is registered in the Stripe Dashboard (test mode) pointing at `https://demm-crm-backend-staging-jn7t4ryyfq-ue.a.run.app/webhooks/stripe` (same service, alternate URL form — both resolve identically), subscribed to exactly these 8 events, matching what `stripe-webhook-handler.service.ts` processes:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`. API version pinned to `2026-06-24.dahlia` on both the endpoint and the SDK client (`backend/src/modules/marketing/stripe-config.ts:9`) — **do not let these drift apart**, a mismatch silently changes the webhook payload shape.

**Neither secret's actual value has ever been read, typed, or displayed by Claude** — provisioning them was done by Antwann directly per this session's established credential-handling boundary (see §5).

---

## 3. Standing Constraints (still binding — do not relitigate)

1. **No production deployment, no live-mode Stripe activity anywhere.** Test mode / staging only. `StripeEnvironmentGuard` enforces this in code (refuses a live key unless `APP_ENVIRONMENT=production`); this is also a standing human instruction independent of the code guard.
2. **`ClientAccountService.convert()`'s transaction body** may only be touched in the one already-reviewed way (Task 6's diff: two `OfferSnapshot` fields + one lookup). Never reopen it elsewhere.
3. **Claude never types, views, or handles real credential values** — passwords, API keys, webhook secrets. This session hit a hard sandbox classifier block on two specific actions: typing into a password-type input field via browser automation, and writing to `localStorage` keys resembling auth tokens (`demm_crm_token`, `demm_crm_user`) via injected JS. Both attempts were refused outright with an explicit instruction not to work around the denial. **Do not retry either approach.** The established pattern instead: create a throwaway local/staging user via direct DB insert with a known test password, tell the human the credentials, and have them log in themselves in the browser pane so Claude can then drive/verify visually. Real secret values (Stripe keys, DB passwords) are only ever piped blind through shell commands (fetched via `gcloud secrets versions access` directly into an env var, never echoed/printed) — never entered into a UI, never displayed in a response.
4. **`.env` files are local-dev-only** and are never inspected directly (`cat`/`grep` on `.env` has itself triggered sandbox denials in this session) — use `NODE_OPTIONS="-r dotenv/config"` to preload them into a child process blind, or set required vars explicitly on the command line, never read the file's contents.
5. **Multiple `gcloud` identities exist on this machine** for unrelated infra (BeGreat/empire VM work uses `begreat-app-493417` under a restricted service account). Always confirm `gcloud config get-value account` / `project` before trusting a "not found" or "permission denied" result — it has already produced a false "secret doesn't exist" read once this session (see git history / prior conversation) purely from wrong-identity permission denial, not actual absence.

---

## 4. Current Blocker — Task 20 Step 2 (Live Browser Walkthrough)

**Symptom**: A throwaway walkthrough user/workspace was created directly on the staging DB (org `2b5585fe-e8e4-46dd-8647-6dd3421412cf`, workspace `f0ece463-06f4-44d8-bd7b-c0baf1aafcf9`, email `task20-walkthrough-1784864659397@example.com`, password `Task20Walkthrough!`, ORG_ADMIN role) with a properly-provisioned Offer (`d889e84c-f754-4e7a-8e03-e177490dfa14`, Stripe mapping tagged `environment: staging` correctly this time). Backend login for this user was confirmed working via direct `curl` (returns a real `preAuthToken`, correct CORS headers for the staging frontend origin). But **the browser login fails with "Failed to fetch"**, reproduced twice by Antwann.

**Ruled out** (all confirmed clean):
- Backend health/CORS — `curl` login succeeds, `ALLOWED_ORIGINS` includes the exact staging frontend origin.
- Live bundle correctness — fetched the actual live JS chunks directly via `curl` (bypassing all browser cache) and confirmed the correct `NEXT_PUBLIC_API_URL` (`https://demm-crm-backend-staging-431876670120.us-east1.run.app`) is baked into chunk `2aif45zne8xgh.js`, not a `localhost:3001` fallback.
- Cloud Build log for the Task 19 deploy shows `verify-production-config.js` explicitly confirming the correct URL was used at build time.
- Cloud Run traffic split — 100% on the correct, freshly-built revision (`demm-crm-frontend-staging-00006-745`) for both services.
- An earlier browser tab in this same session *did* show a stale `localhost:3001` / `ERR_CONNECTION_REFUSED` request, but that tab had been open since before the Task 19 redeploy — its console/network history is stale, not representative of current state. A fresh tab was opened but not yet re-tested end-to-end before this handoff.

**Not yet confirmed**: whether Antwann's actual failing browser session is the Claude Browser pane or his own separate Chrome/Safari; whether a private/incognito window changes anything; whether he's on a VPN/restrictive network that blocks `*.run.app`; the exact request URL his failed attempt actually hit (would immediately confirm or rule out a stale-cache theory). **This is the next diagnostic step** — get that one piece of information before doing anything else.

**Do not re-attempt**: redeploying, re-provisioning, or touching CORS/secrets again without new evidence — everything server-side has been independently verified correct twice now via direct `curl`, bypassing browser cache entirely. The bug (if it's a bug and not environmental) is very likely client-side.

### Remaining Task 20 work once unblocked
- Step 2: convert a lead via the UI, confirm Billing card shows checkout link, **complete a real Stripe test-mode checkout with a test card** (this is the one piece of end-to-end proof still missing — every webhook exercised so far was synthetically constructed, even though signature verification was cryptographically real; a real Stripe-signed webhook from an actual completed checkout is the strongest remaining proof). Confirm Marketing Dashboard revenue KPIs render with new classification badges. For the Client Health `COMMERCIAL` factor PAST_DUE demonstration, consider using Stripe's published always-fails test card (e.g. `4000 0000 0000 0341`) on a second checkout rather than attempting to forge a synthetic webhook (which this session cannot do — see §3.3).
- Step 3: screenshot every surface touched (Billing card empty + checkout-link states, Marketing Dashboard revenue section, internal Reports showing new classification values).

### Cleanup owed
The throwaway walkthrough fixtures above (org/BU/workspace/user/offer/contact + its StripePriceMapping) are **still live on staging** and should be deleted once Task 20 Step 2/3 are done — follow the same cascade-delete pattern used in `verify-stripe-billing-staging-smoke.ts`'s `finally` block (StripePriceMapping before Offer, due to an FK constraint — this ordering bug was hit and fixed once already in that file).

---

## 5. How To Resume — Key Commands

**Check which gcloud identity/project is active (do this first, always):**
```bash
gcloud config get-value account
gcloud config get-value project
```

**Query staging DB directly** (Cloud SQL Auth Proxy is usually already running on `:5433` from prior sessions — check with `lsof -i :5433` before starting a new one):
```bash
SECRET="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=gen-lang-client-0096028843)"
DBPASS="$(echo "$SECRET" | sed -E 's#postgresql://demm_staging_user:([^@]+)@.*#\1#')"
DATABASE_URL="postgresql://demm_staging_user:${DBPASS}@127.0.0.1:5433/demm_crm_staging"
```

**Run a script against staging with the real Stripe key, blind** (never let the value hit a log line or response):
```bash
STRIPEKEY="$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=gen-lang-client-0096028843)"
DATABASE_URL="..." STRIPE_SECRET_KEY="$STRIPEKEY" APP_ENVIRONMENT=staging npx ts-node -T <script>.ts
```
**`APP_ENVIRONMENT=staging` is easy to forget and silently produces a mapping the real staging backend can't see** (see §4's root-cause story) — always include it explicitly for any staging-targeted provisioning run.

**Deploy**: `./scripts/deploy-staging.sh deploy --commit=<pushed-sha> --yes` (or `--dry-run` first). Requires a clean tree and a commit that's an ancestor of `origin/main`.

---

## 6. Remaining Tasks (plan: `docs/superpowers/plans/2026-07-23-stripe-founder-tier-billing.md`)

- **Task 20** (in progress): unblock the browser login issue above, complete the real checkout walkthrough, screenshot evidence.
- **Task 21** (not started): capture commit SHAs/migration name/deploy report/test results to DOM26v3 + gbrain page `demm-crm/phase-2-subproject-4-stripe-billing`; final report to Antwann restating the live-mode blockers (10 items from spec §13 — real Stripe live keys, real charges, production `APP_ENVIRONMENT`, etc. — none of this sub-project authorizes any of them) plus a next-slice recommendation, noting this may complete the currently-scoped Release 1.0 marketing operating slice pending Antwann's WTAE/$47-mo pricing decision (needs its own spec before being built).
