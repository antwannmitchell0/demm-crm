# Stripe Founder-Tier Billing — Task 20/21 Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out Sub-project 4 (Stripe Founder-Tier Billing) of DEMM Platform Release 1.0 — unblock the staging browser-login failure, prove the billing flow end-to-end with a real Stripe test-mode checkout, capture every decision to Dom26v3 + gbrain as it happens (not batched at the end), and deliver the final report to Antwann.

**Architecture:** No new subsystems. This plan resumes exactly where `docs/superpowers/plans/2026-07-23-stripe-founder-tier-billing.md` Task 20 (Step 2 onward) and Task 21 left off. Task 20 Step 1 (HTTPS staging smoke test, `backend/verify-stripe-billing-staging-smoke.ts`, 10/10 passing) is already done — see handoff §2.2. Everything here is diagnosis, verification, and reporting; code changes only happen if Task 1's diagnosis finds an actual bug, in which case the fix is scoped to whatever file the diagnosis names.

**Tech Stack:** NestJS backend (Cloud Run staging), Next.js 16 frontend (Cloud Run staging), PostgreSQL 16 (`demm-crm-staging-db`), Stripe test mode, Claude Browser pane for walkthrough + screenshots.

## Global Constraints

- No production deployment, no live-mode Stripe activity anywhere — test mode / staging only (standing instruction, also enforced in code by `StripeEnvironmentGuard`).
- `ClientAccountService.convert()`'s transaction body is never touched again outside the one already-reviewed diff (original plan's Task 6).
- Claude never types, views, or handles real credential values (passwords, API keys, webhook secrets). The established pattern is the only one used here: throwaway test user with a known test password, Antwann logs in himself, Claude drives/verifies visually afterward.
- `.env` files are never read directly; secrets are piped blind through shell commands into env vars for one-off scripts.
- Always run `gcloud config get-value account` / `project` before trusting any "not found" / "permission denied" result.
- Email/SMS notification capability is explicitly out of scope for this plan — Task 9's final report notes it as a named gap and next-slice candidate, nothing more.
- Every task ends with a Dom26v3 capture (`POST https://intelligence.demmmarketing.com/engrams/capture`, domain `DEMM`) — decisions and findings get logged as they happen, not batched into Task 8.

---

### Task 1: Diagnose the staging browser-login "Failed to fetch" blocker

**Files:** None expected. If the diagnosis implicates a real bug, name the exact file/line found — do not guess here.

**Interfaces:**
- Consumes: existing throwaway walkthrough user (`task20-walkthrough-1784864659397@example.com` / `Task20Walkthrough!`, org `2b5585fe-e8e4-46dd-8647-6dd3421412cf`, workspace `f0ece463-06f4-44d8-bd7b-c0baf1aafcf9`) and Offer (`d889e84c-f754-4e7a-8e03-e177490dfa14`) already provisioned on staging per handoff §4.
- Produces: a confirmed root cause (or explicit ruling-out of every hypothesis below) that Task 2 acts on.

- [ ] **Step 1: Reproduce independently in a fresh Claude Browser pane tab**

Open a brand-new tab (not the stale one from the prior session) and attempt the login:

```
mcp__Claude_Browser__tabs_create
mcp__Claude_Browser__navigate -> https://demm-crm-frontend-staging-431876670120.us-east1.run.app/login
```

Log in with the throwaway credentials above via `computer`/`form_input`. Immediately after the attempt (pass or fail), pull evidence before it scrolls out of the buffer:

```
mcp__Claude_Browser__read_console_messages (onlyErrors: false, limit: 50)
mcp__Claude_Browser__read_network_requests (urlPattern: "login")
```

Record: the exact request URL hit, its status code (or "failed" with reason), and any console error text.

- [ ] **Step 2: Ask Antwann for the one missing diagnostic detail from his own failing session**

Ask directly (do not guess): "When you hit 'Failed to fetch' — was that in this Claude Browser pane, or your own Chrome/Safari? Incognito/private window or normal? On your regular network or a VPN? And if you can, open dev tools → Network tab, retry the login, and tell me the exact URL and status of the failed request."

- [ ] **Step 3: Compare the two data points and narrow to one of these branches**

  - **Branch A — stale cache/service worker in Antwann's own browser** (fresh Claude Browser tab logs in fine, his browser still fails): have him hard-reload (Cmd+Shift+R) or open a private window and retry. If that fixes it, root cause confirmed as client-side cache — no code change needed, go to Step 4 with "no bug" verdict.
  - **Branch B — network/VPN block** (`*.run.app` unreachable from his network specifically): the failed request never leaves the browser (network error, not an HTTP status). Confirm via `curl -sv https://demm-crm-backend-staging-431876670120.us-east1.run.app/health` from his machine if he can run it, or have him try a different network. No code change needed.
  - **Branch C — CORS preflight rejection** (request shows as failed with a CORS console error, in either browser): check the actual `Origin` header the browser sent against `backend/src/main.ts:32-49`'s `ALLOWED_ORIGINS` allowlist — get the live value with `gcloud run services describe demm-crm-backend-staging --region=us-east1 --project=gen-lang-client-0096028843 --format="value(spec.template.spec.containers[0].env)"` and grep for `ALLOWED_ORIGINS`. If the frontend's actual origin isn't in that list, this is a real bug — go to Task 2.
  - **Branch D — genuinely intermittent Cloud Run cold start / timeout** (request shows a 5xx or timeout, reproducible): capture the exact status/timing from `read_network_requests` and check `gcloud run services logs read demm-crm-backend-staging --region=us-east1 --project=gen-lang-client-0096028843 --limit=50` for the same timestamp. Go to Task 2 if the backend logs show an actual error.

- [ ] **Step 4: Capture the diagnosis to Dom26v3 immediately**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20 browser-login blocker diagnosed: <branch A/B/C/D, one-line root cause>", "domain": "DEMM", "salience_score": 0.7, "source": "council", "confidence": 0.9}'
```

---

### Task 2: Fix the root cause (only if Task 1 found a real bug)

**Files:** Named by Task 1's diagnosis. If Branch C: `backend/src/main.ts` (the `ALLOWED_ORIGINS` env var on the Cloud Run service, not the code itself — this is a config fix via `gcloud run services update --update-env-vars`, not a source change). If Branch D and the logs show an actual application error: the specific file/line the stack trace points to.

**Interfaces:**
- Consumes: root cause from Task 1 Step 3.
- Produces: a staging environment where the throwaway walkthrough user can log in from a fresh browser session, confirmed in Step 2 below.

- [ ] **Step 1: Apply the fix matching the confirmed branch**

If Branch A or B: no fix to apply — skip to Step 2 to just re-confirm, then Step 3.

If Branch C (missing origin in `ALLOWED_ORIGINS`):
```bash
gcloud run services update demm-crm-backend-staging \
  --region=us-east1 --project=gen-lang-client-0096028843 \
  --update-env-vars="ALLOWED_ORIGINS=https://demm-crm-frontend-staging-431876670120.us-east1.run.app,https://demm-crm-frontend-staging-jn7t4ryyfq-ue.a.run.app"
```
(include both URL forms the frontend might present from, matching the pattern already noted in handoff §2.3 for the webhook endpoint).

If Branch D: fix the exact line the stack trace names. No placeholder — if this branch is reached, stop and report the specific error text to Antwann before writing a fix, since the original plan's spec didn't anticipate this failure mode.

- [ ] **Step 2: Re-verify login from a fresh Claude Browser tab**

Repeat Task 1 Step 1 exactly. Expected: login succeeds, `read_network_requests` shows the login request returning `200`/`201` with a `preAuthToken` in the response body (confirm via `mcp__Claude_Browser__read_network_requests` with `requestId` to fetch the body).

- [ ] **Step 3: Have Antwann confirm independently on his own browser**

Ask him to retry the exact login that failed twice before. Wait for explicit confirmation before proceeding to Task 3.

- [ ] **Step 4: Capture the fix to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20 blocker resolved: <fix applied or \"no code change needed, client-side cache\">", "domain": "DEMM", "salience_score": 0.75, "source": "council", "confidence": 0.9}'
```

- [ ] **Step 5: Commit (only if Step 1 touched tracked source)**

```bash
git add backend/src/main.ts
git commit -m "fix(billing): <exact one-line description of the CORS/config fix>"
```

Skip this step entirely if Step 1 was a `gcloud run services update` env-var change or a no-op — there's nothing to commit.

---

### Task 3: Live browser walkthrough — convert a lead and confirm the Billing card

**Files:** None — verification only.

**Interfaces:**
- Consumes: working staging login (Task 2), throwaway Offer `d889e84c-f754-4e7a-8e03-e177490dfa14` with its `environment: staging` `StripePriceMapping` already provisioned.
- Produces: a converted `ClientAccount` with a real `BillingCheckoutSession`, ready for Task 4's real checkout.

- [ ] **Step 1: Log in and navigate to the lead conversion flow**

Using the now-working throwaway walkthrough user, drive the Claude Browser pane to the leads list, create or select a lead, and run the conversion flow against the provisioned Offer.

- [ ] **Step 2: Confirm the Billing card renders on the client detail page**

`mcp__Claude_Browser__read_page` on the client detail page. Confirm: status badge present, subscription-status badge present, a checkout link is rendered (not an error/empty state), and — logged in as a role with permission — the regenerate button is visible.

- [ ] **Step 3: Capture the conversion + checkout-generation event to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20 walkthrough: lead converted, Billing card confirmed showing live checkout link on staging", "domain": "DEMM", "salience_score": 0.6, "source": "council", "confidence": 0.9}'
```

---

### Task 4: Complete a real Stripe test-mode checkout (the one piece of proof still missing)

**Files:** None — verification only.

**Interfaces:**
- Consumes: the checkout link from Task 3.
- Produces: a real, Stripe-signed `checkout.session.completed` webhook delivered to the live staging endpoint — proof that's stronger than any synthetic signed event, since Stripe's own infrastructure signs and sends it.

- [ ] **Step 1: Open the checkout link and complete it with Stripe's standard test card**

Navigate the Claude Browser pane to the checkout URL from the Billing card. Fill the test card `4242 4242 4242 4242`, any future expiry, any CVC, any postal code. Submit.

- [ ] **Step 2: Confirm the redirect back to the app succeeds and the Billing card updates**

Reload the client detail page. Confirm the subscription-status badge now shows an active/trialing state (matching whatever `Offer.trialDays` the provisioned Offer carries).

- [ ] **Step 3: Confirm the real webhook was received and processed**

Query the staging DB directly (Cloud SQL Auth Proxy on `:5433`, per handoff §5) for the `StripeWebhookEvent` row matching this checkout's session, and the `BillingSubscription` row for the client:

```sql
SELECT id, "eventType", "processingState", "receivedAt" FROM "StripeWebhookEvent" ORDER BY "receivedAt" DESC LIMIT 5;
SELECT id, status, "clientAccountId" FROM "BillingSubscription" WHERE "clientAccountId" = '<the client id from Task 3>';
```

Expected: `processingState: PROCESSED` for `checkout.session.completed`, and `BillingSubscription.status` reflecting `TRIALING` or `ACTIVE`.

- [ ] **Step 4: Confirm the Marketing Dashboard revenue KPIs render with the new classification badge**

Navigate to the Marketing Dashboard revenue section, `read_page`, confirm the new Stripe-sourced classification (not `MANUAL`) appears for this client's contribution.

- [ ] **Step 5: Capture the completed real-checkout proof to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20: real Stripe test-mode checkout completed on staging, webhook processed, subscription active, dashboard KPI reflects it -- strongest end-to-end proof of Sub-project 4", "domain": "DEMM", "salience_score": 0.85, "source": "council", "confidence": 0.95}'
```

---

### Task 5: Demonstrate the PAST_DUE Client Health factor

**Files:** None — verification only.

**Interfaces:**
- Consumes: a second checkout flow, same client or a second throwaway client.
- Produces: a visible `PAST_DUE` state on the Client Health `COMMERCIAL` factor, driven by a real Stripe-signed webhook (not a forged synthetic one — this session cannot construct those, see handoff §3.3).

- [ ] **Step 1: Run a second checkout using Stripe's published always-fails test card**

Same flow as Task 4 Step 1, but with card `4000 0000 0000 0341` (attaches successfully, then fails on the first charge attempt — Stripe's documented behavior for this exact purpose).

- [ ] **Step 2: Confirm the resulting `invoice.payment_failed` webhook flips the subscription to `PAST_DUE`**

Same DB query pattern as Task 4 Step 3, watching for `BillingSubscription.status = 'PAST_DUE'`.

- [ ] **Step 3: Confirm the Client Health tab shows the `COMMERCIAL` factor reflecting `PAST_DUE`**

`read_page` on the Client Health tab for this client.

- [ ] **Step 4: Capture to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20: PAST_DUE demonstrated end-to-end via Stripe test card 4000000000000341, Client Health COMMERCIAL factor confirmed live on staging", "domain": "DEMM", "salience_score": 0.7, "source": "council", "confidence": 0.9}'
```

---

### Task 6: Screenshot evidence

**Files:** None — screenshots only, delivered via `SendUserFile`.

- [ ] **Step 1: Screenshot every surface touched**

Client Account Billing card — empty state (use a lead not yet converted) and checkout-link state (the converted client from Task 3). Marketing Dashboard revenue section showing the new classification badges. Internal Reports view showing the new classification values. PAST_DUE state on the Client Health tab (from Task 5).

Use `mcp__Claude_Browser__computer` with `action: "screenshot"` for each, save to the scratchpad, then `SendUserFile` with `status: "normal"` and a caption naming which surface each one is.

- [ ] **Step 2: Capture to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20: screenshot evidence captured for all billing surfaces, walkthrough complete", "domain": "DEMM", "salience_score": 0.5, "source": "council", "confidence": 0.9}'
```

---

### Task 7: Clean up throwaway walkthrough fixtures

**Files:** None — direct DB deletes only, following the cascade order already established in `backend/verify-stripe-billing-staging-smoke.ts`'s `finally` block.

**Interfaces:**
- Consumes: the org/BU/workspace/user/offer/contact/StripePriceMapping IDs from handoff §4.
- Produces: a staging DB with no leftover walkthrough fixtures.

- [ ] **Step 1: Delete in FK-safe order — StripePriceMapping before Offer**

```sql
DELETE FROM "StripePriceMapping" WHERE "offerId" = 'd889e84c-f754-4e7a-8e03-e177490dfa14';
DELETE FROM "Offer" WHERE id = 'd889e84c-f754-4e7a-8e03-e177490dfa14';
-- then contact, client account(s) created in Task 3/4/5, user, workspace, BU, org --
-- same cascade order as verify-stripe-billing-staging-smoke.ts's finally block
```

- [ ] **Step 2: Verify clean — no rows remain referencing the throwaway org**

```sql
SELECT count(*) FROM "Organization" WHERE id = '2b5585fe-e8e4-46dd-8647-6dd3421412cf';
```
Expected: `0`.

- [ ] **Step 3: Capture to Dom26v3**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Task 20: throwaway walkthrough fixtures cleaned up from staging", "domain": "DEMM", "salience_score": 0.4, "source": "council", "confidence": 0.9}'
```

---

### Task 8: Update the gbrain page

**Files:** gbrain page `demm-crm/phase-2-subproject-4-stripe-billing` (via `mcp__gbrain__put_page` / `update_note` equivalent — confirm the exact gbrain tool available at execution time).

- [ ] **Step 1: Update the page with final status**

Include: commit SHA(s) from Task 2 (if any fix was made) plus the original `18485d254c6d7ffc626c6349a24ca24bfd4e57d6`, migration name `20260723164851_stripe_founder_tier_billing`, staging deployment outcome, link to `deploy-reports/18485d254c6d7ffc626c6349a24ca24bfd4e57d6-20260724T032454Z.json`, the real-checkout + PAST_DUE proof from Tasks 4–5, a reference (not a re-litigation) of the trial-terms-as-immutable-data decision already captured in the `v4`/`v3` design-spec commits, and the environment-isolation proof (staging `StripePriceMapping` invisible to any other `APP_ENVIRONMENT`, enforced by `StripeEnvironmentGuard`, exercised in `test-stripe-billing-api.ts` check #1).

- [ ] **Step 2: Capture to Dom26v3 that the gbrain page is current**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "gbrain page demm-crm/phase-2-subproject-4-stripe-billing updated with final Sub-project 4 status", "domain": "DEMM", "salience_score": 0.5, "source": "council", "confidence": 0.9}'
```

---

### Task 9: Final report to Antwann

**Files:** None — report only, delivered as a chat response, not a written doc (per house style: no unsolicited planning/summary documents).

- [ ] **Step 1: State what shipped and what's proven**

Commit SHAs, migration name, test results (75/75 local + 10/10 staging smoke + the real checkout/PAST_DUE proof from Tasks 4–5), staging deployment confirmation.

- [ ] **Step 2: Restate the 10 live-mode blockers from spec §13 as the explicit gate**

Verbatim from `docs/superpowers/specs/2026-07-23-stripe-founder-tier-billing-design.md` §13 — Customer Portal, cancellation UI, dunning workflow, invoice history UI, refund reconciliation workflow, tax decision, legally-reviewed cancellation terms, webhook replay/recovery procedure, live secret rotation/incident-response plan, and the one-cent live verification transaction. None of this sub-project authorizes crossing any of them.

- [ ] **Step 3: Name the email/SMS gap explicitly**

State plainly: DEMM OS cannot currently send email or SMS. This was raised and scoped out of this plan by Antwann's own decision. Flag it as a candidate for its own spec (likely touching `BillingCheckoutFailureService`, conversion confirmations, and any future client-facing notification), not something to bolt on ad hoc.

- [ ] **Step 4: Recommend the next slice**

Either: this completes the currently-scoped Release 1.0 marketing operating slice, pending Antwann's WTAE/$47-mo pricing decision (needs its own spec before being built) — or a communications (email/SMS) sub-project, per his call in Step 3.

- [ ] **Step 5: Final Dom26v3 capture — sub-project close**

```bash
curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
  -H "Content-Type: application/json" \
  -d '{"summary": "Sub-project 4 (Stripe Founder-Tier Billing) complete: Task 20/21 closed, real checkout + PAST_DUE proven on staging, 10 live-mode blockers restated, email/SMS gap flagged as next-slice candidate", "domain": "DEMM", "salience_score": 0.9, "source": "council", "confidence": 0.95}'
```
