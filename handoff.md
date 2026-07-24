# DEMM Platform Release 1.0 — Technical Handoff Package

**Last updated:** mid-Task 18 of the **Unified Communications Core** build (Sub-project 5), in worktree `.claude/worktrees/phase-2-lead-to-client-core` on branch `worktree-phase-2-lead-to-client-core`. Handed off because the operator ran out of session budget — pick up exactly where this left off, do not re-derive or re-plan from scratch.

---

## 0. Read this first — how to resume in one command

Everything needed to finish is already written down. Do not re-plan. Do not re-audit providers. Do not re-read the whole codebase from zero.

```bash
cd "/Users/antwannmitchellsr/Desktop/demm CRM/.claude/worktrees/phase-2-lead-to-client-core"
git log --oneline -3          # confirm HEAD is 06ee7f1 or later
cat .superpowers/sdd/progress-communications.md   # exact per-task status, findings, fix commits
```

The full plan (23 tasks, 17 already done) is at:
`docs/superpowers/plans/2026-07-24-unified-communications-core.md`

The full design spec (schema, interfaces, missed-call rule, threading model — reference this for any "why was it built this way" question) is at:
`docs/superpowers/specs/2026-07-24-unified-communications-core-design.md`

**Resume at Task 18** (frontend Inbox UI — was about to start, zero code written for it yet). Get its brief with:
```bash
bash /Users/antwannmitchellsr/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development/scripts/task-brief docs/superpowers/plans/2026-07-24-unified-communications-core.md 18
```
That prints the exact requirements to `.superpowers/sdd/task-18-brief.md`. Then Tasks 19–22 the same way, in order.

If you're using Claude Code / a Claude-based agent, invoke the skill `superpowers:subagent-driven-development` against the plan file and it will run this loop automatically (fresh implementer subagent per task → `review-package` script → fresh reviewer subagent → fix loop → next task). If you're a different tool ("open code" or similar), just do the equivalent manually: implement the task brief, review it yourself for spec compliance + the recurring bug classes below, commit, move to the next task.

---

## 1. Two sub-projects, two states

### Sub-project 4 — Stripe Founder-Tier Billing: **COMPLETE**, deployed to staging, verified end-to-end with real Stripe test-mode charges. Nothing left to do here. See §5 below for the compressed record if you need it.

### Sub-project 5 — Unified Communications Core: **17 of 23 tasks complete**, all committed to this branch, NOT merged to `main`, NOT deployed anywhere, no real Twilio/Resend account exists. This is the active work. Details below.

---

## 2. Communications Core — what's built (Tasks 1–17, all done)

Provider decision, locked by Antwann: **Twilio** (SMS + voice), **Resend** (outbound + inbound via Resend Receiving). No Postmark/Mailgun.

- Prisma schema: `ChannelConnection`, `Conversation`, `Message`, `DeliveryAttempt`, `CommunicationEvent`, `CommunicationConsent`, `MessageTemplate`, `CallEvent` — additive-only migration.
- 5 provider-neutral interfaces (`SmsProvider`, `VoiceProvider`, `EmailProvider`, `InboundEmailProvider`, `DeliveryStatusProvider`) + DI tokens. Zero provider-specific logic leaks outside the adapter files — this was checked in every review.
- Null providers (zero-credential safe default — app builds and Stage 1 tests pass with no Twilio/Resend secrets present anywhere).
- `CommunicationsModule` wired into `AppModule`, config-driven provider binding.
- Raw-body middleware for `/webhooks/twilio` and `/webhooks/resend` in `main.ts` (needed for real signature verification — see the recurring-bug list below).
- `ChannelConnectionService`, `CommunicationConsentService` (TCPA STOP/START/HELP), `ConversationService` (reply-token email threading), `MessageService` (consent-gated send, idempotent inbound dedup).
- `TwilioAdapter` (real SMS/voice/delivery-status, real HMAC signature verification via the `twilio` SDK).
- SMS controllers: outbound send, inbound webhook (STOP/START handling), delivery-status callback.
- `CallEventService` + missed-call text-back: terminal-status classification, out-of-order-callback guard, **`pg_advisory_xact_lock`-based cooldown** (real atomicity, not a bare transaction — see recurring bugs).
- `ResendAdapter` (real email send/inbound/delivery-status, Svix signature verification).
- `MessageTemplateService` (token substitution).
- Email controllers: outbound, reply-token-threaded inbound, delivery/bounce/complaint events.
- `CommunicationRelationshipSignalService` (DOM26-R signal wiring, correctly scoped by `businessUnitId` after a real fix — see below).
- Stage 1 comprehensive test suite (`backend/test-communications-provider-neutral.ts`, 45/45 passing, opus-reviewed) — proves message creation, send state, inbound ingestion, consent blocking, conversation threading, genuine two-tenant Business Unit isolation, and correctly-scoped DOM26-R signals, all against deterministic fakes (no real network calls).
- `InboxController` (list conversations, get thread) — backend only, no frontend yet.

**Test count as of last commit:** 12 Jest suites / 34 unit tests, 14 SMS integration checks, 14 email integration checks, 45 Stage-1 checks, 12 Inbox checks. All passing. `tsc --noEmit` and `eslint` clean except one pre-existing, unrelated error in `verify-stripe-billing-staging-smoke.ts` (predates this entire project, not yours to fix).

---

## 3. Recurring real bugs found across this build — READ BEFORE REVIEWING ANY NEW TASK

Every one of these was found by actually reading the code and running tests, not by trusting a report. They recurred because the plan's own sample code had these bugs baked in — later tasks may still hit variants.

1. **IDOR: unscoped `clientAccount.findUnique({ where: { id: clientAccountId } })`** in a controller that takes `clientAccountId` as a client-supplied route param. Found in the SMS controller (Task 10), the MessageTemplate controller (Task 13), preemptively fixed in the Email controller's plan text (Task 14). The fix pattern every time: use `@CurrentBusinessUnitId()` (a real, existing, guard-sourced decorator — never trust client input for scope) and `findFirst({ where: { id, businessUnitId } })` instead of `findUnique({ where: { id } })`. **If Task 18's frontend calls any new backend endpoint you have to add, check this pattern first.**
2. **Raw-body signature verification bypassed by NestJS's auto body-parsing.** Twilio's HMAC and Resend's Svix signatures are computed over the exact original bytes. A `@Body()` DTO decorator gives you a re-parsed JS object, not the original bytes — signature verification silently breaks. Fix: `main.ts` mounts `express.raw()` on the webhook route prefixes ahead of the global JSON parser (already done, Task 4.5); webhook controller methods use `(req.body as Buffer).toString('utf-8')`, never `@Body()`.
3. **Bare `prisma.$transaction` is not a real concurrency lock.** Postgres Read Committed doesn't serialize a `findFirst`-then-`update` across different rows in concurrent transactions. Fixed for the missed-call cooldown using `pg_advisory_xact_lock(hashtext($1))` as the *first* statement inside the transaction — mirrors the exact pattern already proven in `backend/src/modules/marketing/stripe-webhook-dedup.service.ts`. If any new concurrency-sensitive check-and-set logic gets added, use this same pattern, not a bare transaction.
4. **DOM26-R cross-Business-Unit relationship data leakage.** `RelationshipProfile` has `@@unique([subjectId, businessUnitId])` specifically so one person's data never blends across businesses. Any new code resolving a `RelationshipProfile` from a `contactId` must filter by `businessUnitId` too (see `communication-relationship-signal.service.ts`'s `findProfileForContact` for the fixed reference implementation).
5. **Test fixture cleanup not exception-safe.** Cleanup inline after assertions (not `beforeAll`/`afterAll`, or not in a `try/finally`) skips on any thrown error, leaking rows into the shared dev Postgres database on every crashed run. Found and fixed twice (Task 5, Task 16). Any new integration test must wrap its body in `try { ... } finally { cleanup(); }` or use `beforeAll`/`afterAll` hooks — verify this explicitly in review, it's the single most-repeated defect in this series after IDOR.
6. **Brief sample code doesn't always match the real external SDK.** Resend's actual `email.received` webhook nests fields under `data`, `to` is an array not a string, and there's no body content in the webhook at all (fixed in Task 12 against the real installed `resend` package's `.d.ts` files, not assumed). If Task 19 needs real Twilio/Resend behavior, check the installed SDK's type definitions directly, don't trust memory or an older brief draft.

---

## 4. Remaining work — Tasks 18–22

### Task 18 — Inbox frontend UI (IN PROGRESS, not started, resume here)

Files: `frontend/src/app/marketing/communications/page.tsx` (conversation list + provider-status banner), `frontend/src/app/marketing/communications/[conversationId]/page.tsx` (thread view + send box), additions to `frontend/src/lib/api.ts` (`listConversations`, `getConversationThread`, `sendSms`, `sendEmail`).

Before writing code: read `frontend/src/lib/api.ts` for the existing fetch/auth pattern, read `frontend/src/app/marketing/leads/page.tsx` or `contacts/page.tsx` for layout/styling convention, read `frontend/src/app/marketing/clients/[id]/page.tsx` for how the Billing card renders status badges (mirror that for `ChannelConnectionStatus`).

**Expected state when you test it:** zero real `ChannelConnection` rows will show `ACTIVE` status anywhere (no real Twilio/Resend account exists yet) — the empty/not-connected state is the CORRECT thing to see, not a bug. Verify no console errors when navigating to `/marketing/communications` with an empty inbox.

Full task text: run the `task-brief` command in §0, task number 18.

### Task 19 — Stage 2 adapter contract tests

Needs real Twilio test-mode credentials (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` — Twilio issues these free on every account including a trial one, no purchase needed) and a Resend test-mode API key in the environment. **If neither exists, this task should honestly report BLOCKED/NEEDS_CONTEXT, not fabricate a pass.** That's an acceptable, expected outcome per the plan — don't force it.

### Task 20 — Full regression suite
Run every test suite (communications + pre-existing marketing/Stripe suites), confirm zero regressions against the baseline documented in `.superpowers/sdd/progress-communications.md`.

### Task 21 — Chairman external-setup package
Doc only: exact Twilio + Resend account-creation steps, required secret **names** (never values), DNS records needed on `send.demmmarketing.com`/`reply.demmmarketing.com`, webhook URLs, costs, risks. No account gets created by this task — informational only.

### Task 22 — Final capture + report
Dom26v3 + gbrain capture (see §6), rubric scoring, final report using the exact completion language: **"COMMUNICATION FOUNDATION COMPLETE — PROVIDER ACTIVATION PENDING."** Never say "OPERATIONAL" — that's reserved for after Stage 3 (real provider accounts, real end-to-end message), which is explicitly out of scope for this whole plan and gated on Antwann's separate authorization.

---

## 5. Sub-project 4 (Stripe Billing) — compressed record, complete, nothing to do

Deployed to staging, commit `d0d0b26ae849c1b1449dd29a251fabf5434ca674`, backend rev `demm-crm-backend-staging-00016-9d2`. Real Stripe test-mode checkout proven end-to-end (real charge → real webhook → `BillingPaymentRecord` created → dashboard shows `Collected(90D)` with `Verified` badge). Two real bugs found and fixed during the live walkthrough: (1) `invoice.subscription` moved to `invoice.parent.subscription_details.subscription` under the pinned Stripe API version, silently dropping every payment record — fixed with a dual-path extraction helper; (2) missing `FRONTEND_BASE_URL` env var breaking checkout redirects — fixed via `gcloud run services update`. PAST_DUE live-UI demo was descoped (needs Stripe Test Clocks, not buildable without a real account) — the code path itself is proven via test coverage. 10 live-mode blockers from the original spec §13 remain the hard gate before any real charge (Customer Portal, dunning workflow, tax decision, legal review, etc. — full list in the design spec).

---

## 6. Standing constraints — apply to ALL remaining work, no exceptions

- **No production deployment, no real Twilio number purchase, no paid-plan upgrade, no production DNS change, no real customer message, anywhere in Tasks 18–22.** Everything targets local dev / staging test-mode only.
- **Never type, view, or handle a real credential value** — passwords, API keys, webhook signing secrets. If a task needs a real secret to proceed (Task 19 might), check the environment for it; if absent, report the gap honestly rather than fabricating a test or a passing result.
- **`.env` files are never inspected directly** (`cat`/`grep` on any `.env*` file, even `.env.example`, has been permission-denied all session — don't retry, use `process.env.X` checks or Secret Manager instead).
- Multiple `gcloud` identities exist on this machine. Before any `gcloud` command against this project, confirm: `gcloud config get-value account` should be `antwannmitchell0@gmail.com`, project `gen-lang-client-0096028843`. It silently reverts to a wrong service account between commands sometimes — always re-check, don't trust a "permission denied" as proof something doesn't exist without first confirming identity.
- **Capture every meaningful decision to Dom26v3 as you go** (not batched at the end):
  ```bash
  curl -s -X POST https://intelligence.demmmarketing.com/engrams/capture \
    -H "Content-Type: application/json" \
    -d '{"summary": "...", "domain": "DEMM", "salience_score": 0.6, "source": "council", "confidence": 0.9}'
  ```
- **Update the gbrain page** `demm-crm/communications-core-provider-audit` as tasks complete (via whatever gbrain MCP tool your environment exposes — `put_page` with the same slug updates it in place).
- **Completion language discipline** (§4, Task 22) is not optional — Antwann explicitly specified this exact phrasing and explicitly said not to claim "OPERATIONAL" prematurely.

---

## 7. What comes after this plan (do not start without Antwann's explicit go-ahead)

Per Antwann's stated priority order: Communications Core (this plan) → already-complete Stripe Billing → **WTAE/$47-mo pricing and creator-network product spec** (not started, needs its own spec, explicitly told to wait until Communications Core and Billing are both done). Do not begin that work as part of finishing this plan.
