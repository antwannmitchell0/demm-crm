# Phase 0: Baseline Truth & Critical Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or
> `superpowers:subagent-driven-development`) to implement the remaining tasks one at a time.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an honest, stable baseline on `main` — no dead-loop approvals, no
15-minute forced logouts, no fabricated UI, no stale documentation — before the unmerged
Stripe/Communications branch is finished and merged.

**Parent authority:** DEMM CRM Master Build Plan v1.1 (approved with PM amendments,
2026-07-26), Phase 0. Task-level scope from the approved Phase 0 Execution Packet.

---

## ⚠️ Provenance — read before treating this as a pre-implementation plan

**This artifact was created on 2026-07-26, AFTER tasks T1 and T2/T3/T5 had already been
implemented.** It is a retrospective reconstruction, not the plan those tasks were executed
from.

- T1 and T2/T3/T5 were performed under **direct Product Manager task authorizations** that
  scoped each slice to a specific list of files. Those authorizations did not include
  creating this planning artifact, and it therefore did not exist while that work was done.
- This document is reconstructed from three sources that DO predate or accompany the work:
  the approved **Phase 0 Execution Packet**, the **T1 Approval Regression Test Report**, the
  **T2–T3–T5 Approval Repair Report**, and the **T2–T3–T5 Principal Architect Review**.
- **It must not be read as evidence that a Superpowers plan governed T1–T5.** It did not.
  The process gap was identified by the Principal Architect review and is corrected forward
  from T3.1 onward: every remaining task is planned here first.
- Nothing in this file is backdated. Git history has not been rewritten.

**Repository state at creation:** branch `main`, baseline commit `24808c4`
("docs(marketing): implementation plan for Stripe founder-tier billing"). T1–T5 and T3.1
changes are present in the working tree and **uncommitted** at time of writing.

---

## Architecture

Additive-only repair of the existing `AgentService`. No new modules, no new dependencies.
Reuses established repository patterns: nullable-additive Prisma migrations with a
companion `rollback.sql`; conditional-`updateMany` state claims (the idempotency-key
spirit of `ConversionIdempotencyKey`); `redactAuditPayload` before any persistence;
standalone `test-*-api.ts` suites that boot the real Nest app over HTTP.

**Tech stack:** NestJS 11, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL, Next.js 16.

---

## Completed tasks

### - [x] T1 — Failing regression test proving the approval loop

- **Objective:** Prove the confirmed high-risk approval defect before changing any
  production code (TDD red).
- **Files changed:** `backend/test-agent-approval-api.ts` (created).
- **Test evidence:** 7 checks; 3 passed (staging behaviour) and 4 failed against the
  unmodified service, exit code 1. Captured defect evidence: the resolve response contained
  a **nested** `PENDING_APPROVAL` instead of an execution result; 2 `AgentApproval` rows
  (one `APPROVED`, one new `PENDING`); 0 opportunities created; 0 AGENT audit rows.
- **Reference:** "T1 Approval Regression Test Report" (session deliverable).
- **Known limitations:** Did not cover the ordinary non-high-risk execution path (added
  later as check 19).
- **Deviations:** None. Filename matched the packet's preferred name and the repository's
  `test-*-api.ts` convention.

### - [x] T2 — `AgentApproval` migration (`requesterRole`, `expiresAt`)

- **Objective:** Record the requester's staging-time role and an approval expiry window,
  additively.
- **Files changed:** `backend/prisma/schema.prisma`;
  `backend/prisma/migrations/20260726134103_approval_requester_role_and_expiry/migration.sql`
  and `rollback.sql` (created).
- **Migration SQL:** `ALTER TYPE "ApprovalStatus" ADD VALUE 'EXPIRED';` plus
  `ALTER TABLE "AgentApproval" ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN
  "requesterRole" "Role";` — additive only.
- **Test evidence:** `prisma validate` clean; post-apply introspection confirmed both
  columns nullable and `ApprovalStatus = PENDING, APPROVED, REJECTED, EXPIRED`; schema diff
  ignoring whitespace was 23 insertions / 0 deletions.
- **Known limitations:** PostgreSQL cannot drop an enum value, so rollback leaves `EXPIRED`
  in the type (documented in `rollback.sql`). Requires PostgreSQL ≥ 12 to apply inside
  Prisma's migration transaction — **unverified for staging** (see Deviations).
- **Deviations:** (a) Adding `EXPIRED` went beyond the two named columns — justified by the
  T3 requirement for an expiry transition and Execution Packet §3.1, additive and
  non-destructive. (b) `prisma migrate dev` was refused because it demanded a destructive
  database reset; the SQL was produced by a read-only datamodel diff and applied with
  `prisma migrate deploy`.

### - [x] T3 — Approval service restructuring and exactly-once resolution

- **Objective:** Remove the recursive loop, fix identity handling, and make resolution
  atomic — without introducing any general-purpose bypass.
- **Files changed:** `backend/src/modules/agent/agent.service.ts`.
- **Architecture:** public `executeTool` (unchanged signature) stages or delegates; private
  `runTool` is the execution core with no risk staging; private `executeApprovedTool` is
  reachable only from `resolveApproval` and derives every parameter from the approval row.
  Resolution claims the row with a conditional `updateMany` (`status: PENDING`,
  `requesterRole: { not: null }`, not expired, matching workspace); only `count === 1`
  executes.
- **Test evidence:** all original checks 1–7 green plus 12 new checks (see T3.1 for the
  final 28-check suite). Concurrency proven in T3.1: `[201, 409]`, one execution audit row.
- **Known limitations:** at-most-once (not exactly-once) execution; audit writes not
  transactionally coupled to state changes; approval `arguments` store the redacted form.
  All three are documented in code and deferred (Phase 5 / Phase 6).
- **Deviations:** Fixed a pre-existing `Decimal` serialization defect in the execution audit
  path (`toJsonSafe`) because T5's audit requirement could not otherwise pass.

### - [x] T5 — Approval lifecycle audit events

- **Objective:** Make the full approval lifecycle auditable.
- **Files changed:** `backend/src/modules/agent/agent.service.ts`.
- **Events:** `APPROVAL_STAGED` (requester/USER), `APPROVAL_APPROVED` and
  `APPROVAL_REJECTED` (approver/USER), `APPROVAL_EXPIRED` (SYSTEM, null actor),
  `APPROVAL_LEGACY_REFUSED` (approver/USER), `APPROVAL_STAGING_REFUSED` (added in T3.1),
  plus the tool-execution row keyed on the tool name with the **original requester** as
  actor and the approver only as payload metadata.
- **Test evidence:** checks 9, 10, 11, 14, 16, 28 assert actor semantics and payload
  linkage; observed lifecycle sequence captured in the suite's evidence dump.
- **Known limitations:** `AuditLog` has no `correlationId` column and the controller was out
  of scope, so `approvalId` is the correlation key.
- **Deviations:** None beyond those recorded under T3.

---

## T3.1 — Approval hardening and clean-database verification

Authorized files: `agent.service.ts`, `test-agent-approval-api.ts`, the existing
`rollback.sql`, and this plan. **Not** the controller, schema, or migration SQL.

- [x] **R1** — Rewrite the `resolveApproval` documentation to state exactly-once *decision*,
      at-most-once *execution*, the crash window that can leave an APPROVED approval whose
      action never ran, and the Phase 5 deferral. Must not claim exactly-once execution.
- [x] **R2** — Add a genuine concurrent-APPROVE test using `Promise.all`, asserting one
      success, one `APPROVAL_NOT_PENDING` conflict, one opportunity, no new approval row,
      nothing left PENDING, exactly one execution audit row, and that a later repeated
      APPROVE still executes nothing. The sequential replay test is retained separately.
- [x] **R3** — Add the fail-closed redaction-divergence guard at staging: normalize, redact,
      compare; on divergence refuse with `APPROVAL_ARGUMENTS_NOT_STORABLE`, store no
      approval, execute nothing, and audit field **names** only. Document the temporary
      invariant that approval-gated tools must not accept secret-bearing or
      redaction-triggering execution arguments until Phase 6.
- [x] **R4** — Repair the orphaned `toRoleOrThrow` docblock; give `toJsonSafe` its own.
- [x] **R5** — Correct `rollback.sql`: remove "self-correcting"; state that rollback
      reintroduces the recursive loop, approver-role/requester-identity mixing, and loss of
      requester-role fidelity. Keep the enum-drop warning.
- [x] **R6** — Correct the `executeApprovedTool` catch documentation to include tool-handler,
      audit-persistence, and post-handler serialization failures — not only pre-execution
      refusals.
- [x] **R7** — Document the accepted Phase 0 audit limitations at the applicable transaction
      boundaries, without optimistic wording.
- [x] **R8** — Correct the `runTool` private-boundary claim: compile-time and code-review
      boundary, not runtime-inaccessible.
- [x] **R9** — **DEFERRED by PM decision.** Do not terminalize or deduplicate legacy approval
      refusals, and do not move legacy rows to `REJECTED` or any other misleading state.
- [x] **Clean-database verification** — disposable PostgreSQL database created from the
      migrations in this worktree only; `migrate deploy`, `migrate status`, `generate`,
      focused suite, full `npm run verify`; development database proven unchanged before and
      after; disposable database dropped.

---

## T3.2 — Authentication verification test repair — COMPLETE

**Root cause (stale test, not a production defect).** `backend/verify-http-staging.ts`
exercised the **obsolete, insecure** workspace-selection contract: it POSTed
`/api/auth/select-workspace` with a body of `{ userId, workspaceId }` and **no
Authorization header** (old lines 192–195). Production had since been hardened —
`auth.controller.ts` requires `Authorization: Bearer <preAuthToken>` and
`SelectWorkspaceDto` accepts only `workspaceId`, so under the global ValidationPipe's
`forbidNonWhitelisted` the `userId` field is rejected outright. The suite was never updated
when that fix landed, so `selectA.body.access_token` was always undefined and three session
assertions failed on every commit, cascading into the two refresh assertions that consume
that token. This was the **second, independent** reason `npm run verify` could not go green
(the first being the development-database drift). Discovered during T3.1 verification.

**Secure contract now under test** (verified by reading the code, not assumed):
`POST /api/auth/login` returns `preAuthToken` and deliberately **no** `access_token`;
`POST /api/auth/select-workspace` derives identity from the Bearer preAuthToken and accepts
only `workspaceId`, returning `access_token` + `refresh_token`; `POST /api/auth/refresh`
rotates and rejects a replayed token with 401 but **does not** revoke the token family
(reuse-detection is task T6, not yet built).

**Authorized file scope:** `backend/verify-http-staging.ts` and this plan only. No
production authentication code, DTO, or guard was modified — the security behaviour was
never weakened to satisfy the old test.

- [x] Verify the live contract by reading `auth.controller.ts`, `auth.service.ts`,
      `dto/auth.dto.ts`, and the already-passing `test-auth-security.ts` as the reference
      pattern.
- [x] Confirm `verify-http-staging.ts` boots a **local** Nest app
      (`Test.createTestingModule` → `app.listen(0)` → `http://127.0.0.1:<port>`) and does not
      call a deployed service, despite its filename.
- [x] Repair the happy path: assert login yields a `preAuthToken` and no access token; send
      workspace selection with the Bearer header and a `{ workspaceId }`-only body; assert
      both tokens are issued; rotate; assert the replayed token is rejected.
- [x] Assert the live no-family-revocation behaviour (newest token still valid after a
      replay), flagged to be inverted deliberately if T6 lands.
- [x] Add Part 4b security regression: the obsolete `userId`-in-body request is rejected
      (400) with no tokens; a request with no pre-auth token is rejected (401) with no
      tokens; and User A's valid preAuthToken cannot select User B's workspace.
- [x] Full verification on a disposable clean database; development database proven
      unchanged.

**Acceptance criteria — met.** HTTP suite **21 passed / 0 failed** (was 12/3); focused
approval suite **28 passed / 0 failed**; `lint`, `typecheck`, `prisma validate`,
`prisma migrate status`, `test:e2e` (19/0) and `nest build` all pass; **full `npm run verify`
exit 0** — the first fully green run of the complete backend suite in Phase 0.

**Verification commands** (all against disposable DB `demm_crm_verify_phase0_<suffix>`, after
a safety probe proved child processes resolve `DATABASE_URL` to it):
`npx prisma migrate deploy` (10 migrations) → `npx prisma migrate status` →
`npx prisma generate` → `npx ts-node test-agent-approval-api.ts` →
`npx ts-node verify-http-staging.ts` → `npm run verify`; then drop the disposable database
and re-snapshot the development database.

**Stop conditions honoured:** would have stopped had the contract differed from the T3.1
report, had repair required production auth changes, had the approval suite regressed, or
had the development database changed. None occurred.

**Evidence location:** `/tmp/t32-run.log` (full orchestrated transcript, including the
before/after development-database snapshots and the disposable-database drop confirmation).

> **Safety note for future tasks:** `verify-http-staging.ts` creates users, organizations and
> workspaces and has **no cleanup block**, so it leaks fixtures into whatever database it
> targets. It must only ever be pointed at a disposable database, never the development,
> staging, production, or branch database.

---

## T3.3 — Development database data-loss incident triage — COMPLETE (read-only)

**Incident statement.** During the T2/T3/T5 slice, `npm run verify` was run against the
**development** database. `verify-comprehensive.ts` opens with ~20 unconditional
`deleteMany()` calls and no environment guard. Four executed before the run aborted on the
`StripePriceMapping → Offer` RESTRICT foreign key:
`ClientCommercialStateChange`, `ConversionIdempotencyKey`, `ClientAccount`, `OfferSnapshot`.

**Read-only scope.** No row was inserted, updated, deleted or restored. No test suite, no
`migrate reset`, no `db push`, no dump restoration into development, no staging/production
connection, no cloud API enabled. The dump was inspected via its table-of-contents only.

**Evidence sources.** `verify-comprehensive.ts:74–94`; `client-account.service.ts` (the only
writer of the four tables); `prisma/seed.ts`; the marketing suites' scoped teardown;
`schema.prisma` relations; the live database's `information_schema` FK map; the surviving
`AuditLog`; `pg_restore -l backend/test_backup.dump`; local database inventory and
`archive_mode`/`wal_level`; the unmerged branch schema read via `git show`.

**Findings.**
1. **The four tables are written only by the lead→client conversion transaction.** `seed.ts`
   creates Organizations, BusinessUnits, Workspaces and Offers — never these four. Every
   marketing suite deletes exactly these four scoped by `businessUnitId` in its own teardown,
   so their expected steady state in a development database is zero.
2. **Real rows nevertheless existed, and were lost.** The database is internally
   inconsistent: 2 Opportunities are `WON` while `ClientAccount` is 0. The only code that
   sets `WON` is the conversion transaction (`client-account.service.ts:291–294`), and no test
   creates `WON` directly. The surviving `AuditLog` holds **2 × `USER / convertLeadToClient`**
   rows (2026-07-24 04:46:51Z and 04:49:04Z), matching Opportunities named
   `BrowserVerify Client` / `BrowserVerify2 Client`. These were **manual browser-walkthrough
   fixtures**, not automated-test fixtures — which is why nothing cleaned them up.
3. **The blast radius is wider than the four named tables.** `ClientAccount` has CASCADE
   children, so deleting it also removed, for those accounts: `OnboardingPlan` (+ checklist
   items, item history, launch-gate overrides), `ServiceDeliverable` (+ history), and
   `ClientHealth` (+ overrides, history) — all now 0. `ClientHealth` in particular is
   auto-calculated after every conversion, so 2 rows almost certainly existed.
4. **It also reached unmerged Stripe branch data — correcting the T3.2 report.** The live FK
   map shows branch-only CASCADE children of `ClientAccount`: `BillingSubscription`,
   `BillingCheckoutSession`, `BillingPaymentRecord` (plus `Conversation` as SET NULL). All
   three now read 0, while `StripeWebhookEvent` holds **132 PROCESSED events spanning
   2026-07-24T02:57Z → 2026-07-25T04:10Z**. Sustained webhook processing with zero derived
   billing records is internally inconsistent. T3.2 asserted "branch-only data was
   unaffected" on the strength of `StripePriceMapping` and `Offer` alone; that check was too
   narrow and the claim is **withdrawn**.
5. **What prevented total loss was the branch's own schema.** The cleanup list ends at
   `organization.deleteMany()`, which would have cascaded the entire database away. It never
   ran only because `StripePriceMapping.offerId` (a branch-only table) is RESTRICT and held 6
   rows. An unmerged branch accidentally protected the development database.
6. **Recovery sources are exhausted.** `backend/test_backup.dump` is from 2026-07-21 08:26
   EDT with 18 tables and **none of the four affected tables** — they arrived in
   `20260722165835_phase_2_marketing_lead_to_client`, after the dump. The local
   `demm_crm_restoration_test` database is a restoration of that same vintage (18 tables, 1
   migration) and likewise lacks them. `archive_mode = off`, `archive_command = (disabled)`,
   no base backup — so **no point-in-time recovery is possible**. No other SQL export exists.
7. **But the conversions are reconstructable from surviving records.** Both `AuditLog` rows
   retain `payload = { offerId, companyId, contactId }` and `response = { clientAccountId }`.
   The 2 WON Opportunities, 6 ACTIVE Offers, 5 Contacts and 1 Company all survive, so each
   conversion can be replayed through the API from preserved inputs.

**Impact classification.** Overall: **Reconstructable development-data loss**, with the
billing-branch dimension classified as **potentially material loss requiring additional
evidence**.

| Dimension | Verdict |
|---|---|
| Source code, Git history, Prisma migrations, schema | No loss — nothing was modified |
| Marketing conversion data (4 tables + cascade children) | Reconstructable loss: 2 conversions, inputs preserved |
| Stripe branch work | Potentially material: cannot verify whether Billing* rows existed at delete time; regeneration needs **fresh Stripe event IDs** because the surviving 132-row dedup ledger will no-op replays of the same events |
| Communications branch work | No loss — `ChannelConnection`/`Conversation`/`Message`/`MessageTemplate` all 0, and `Conversation` is SET NULL not CASCADE |
| Current local development behaviour | Degraded only in that Marketing/Billing screens show empty histories; app is functional |
| Staging | Not involved — the run was local; no staging connection was made |
| Production | Not involved — no production environment exists yet |
| Tenant / customer data | **None involved.** Fixtures were seeded orgs plus manual `BrowserVerify*` walkthrough records |

**Recovery recommendation.** Do **not** attempt database-level restoration: no viable source
exists, and the loss is development fixtures only. Recommended instead — **rebuild, do not
restore** (proposed, not executed): replay the 2 conversions through the API using the
`offerId`/`contactId`/`companyId` preserved in the 2 audit rows; accept new UUIDs and
timestamps; let `ClientHealth` recalculate automatically; regenerate onboarding/deliverables
on demand if needed; and for billing, re-run checkout and webhook flows with **new** Stripe
event IDs. Validation: `ClientAccount` = 2, `OfferSnapshot` = 2, each WON Opportunity linked
to exactly one ClientAccount, and no WON Opportunity without one.

**Prevention recommendations** — assigned to future tasks, not implemented here:
- **T13 (CI migration switch)** — add a hard environment guard at the top of every destructive
  suite: refuse to run unless the target database name matches a test-only allowlist
  (`/(_test|_verify|_ci|disposable)/`), plus an explicit deny for the known development and
  staging names; abort with a clear message rather than deleting. Wrap cleanup in a
  transaction where the FK graph permits, and require `finally` teardown. Isolate the CI
  database.
- **T16 (baseline seal)** — codify the disposable-database standard proven in T3.1/T3.2 (create
  → probe that children resolve `DATABASE_URL` to it → run → drop → re-verify development
  state), rename `verify-http-staging.ts` to reflect that it is local, give it teardown, and
  adopt a backup-before-destructive-test policy. Record that `prisma migrate status` is not a
  drift detector and must not be treated as a safety check.

**Evidence location.** `/tmp/t33-*` query transcripts in this session's report; incident
transcript for the originating run in the T2–T3–T5 report; clean-database transcripts at
`/tmp/t32-run.log`.

---

## T4 — Approval authority and self-approval prevention — COMPLETE

**Objective.** Make the high-risk approval gate a real control: restrict who may resolve an
approval, and stop a requester clearing their own request — without disturbing the identity
separation, atomic claim, at-most-once execution, expiry, redaction guard or audit records
established in T2/T3/T5 and T3.1.

**Role policy (PM decision).** `POST /agent/approvals/:id/resolve` requires one of
`WORKSPACE_ADMIN`, `ORG_ADMIN`, `ORG_OWNER`, `SUPERADMIN`. `SUPERADMIN` is explicitly
included. A plain `USER` receives HTTP 403.

**Self-approval rule.** A requester may never approve their own request. Enforced twice: a
preliminary check that produces an understandable 403, and — the actual enforcement point —
the predicate `requestedById: { not: approverId }` inside the atomic claim, so the database
is the final authority even under a race or a future caller that skips the check. A refused
attempt leaves the approval PENDING, executes nothing, creates no duplicate, and is audited
as `APPROVAL_SELF_APPROVAL_REFUSED` — an AUTHORIZATION refusal, deliberately distinct from
`APPROVAL_REJECTED`.

**Self-rejection decision.** Permitted. Rejecting is a decision *not* to act: it executes
nothing and closes the request, so a requester cancelling their own pending request is
legitimate, not an escalation. No security reason was found to require a second person to
decline an action that will not happen. Verified by repository evidence: the REJECT claim
carries no requester/approver restriction.

**Authorized files.** `agent.controller.ts`, `agent.service.ts`,
`test-agent-approval-api.ts`, this plan. **No migration was needed or created.**

**Test-first tasks — all complete.**
- [x] Role gate: `USER` refused on APPROVE and REJECT (403 each), approval stays PENDING, no
      new approval row, nothing executed.
- [x] Each of `WORKSPACE_ADMIN`, `ORG_ADMIN`, `ORG_OWNER`, `SUPERADMIN` resolves its own
      staged approval and the action executes exactly once.
- [x] Self-approval refused (403 `APPROVAL_SELF_APPROVAL_FORBIDDEN`); PENDING preserved;
      no execution; no duplicate; audited and not recorded as a rejection.
- [x] A different administrator then approves successfully, executing exactly once; the audit
      trail contains exactly one refusal and exactly one approval for that approval id.
- [x] Self-rejection succeeds once, executes nothing, records the requester as resolver; a
      later APPROVE conflicts (409 `APPROVAL_NOT_PENDING`) and cannot reverse it.
- [x] Regression: concurrency, cross-workspace denial, redaction-divergence guard and
      non-high-risk inline execution all still green.

**Verification commands** (disposable database `demm_crm_verify_phase0_<suffix>`, after a
safety probe proved child processes resolve `DATABASE_URL` to it): `npx prisma migrate deploy`
→ `npx prisma migrate status` → `npx prisma generate` → `npx ts-node
test-agent-approval-api.ts` → `npx ts-node test-workspace-guard-api.ts` → `npx ts-node
test-workspace-controller-security.ts` → `npx ts-node test-auth-security.ts` → `npx ts-node
verify-http-staging.ts` → `npm run verify`; then drop the disposable database and re-snapshot
the development database.

**Evidence.** Focused approval suite **40 passed / 0 failed** (was 28). Workspace guard
**12/0**, workspace controller security **12/0**, auth security **10/0**, HTTP suite **21/0**,
`verify-comprehensive` **19/0**, and **full `npm run verify` exit 0** including `nest build`.
Development database unchanged (12 migrations, 6 branch tables, 6 `StripePriceMapping` rows
before and after); disposable database dropped and confirmed removed. Transcript:
`/tmp/t4-run.log`.

**Stop conditions honoured.** Would have stopped had `RolesGuard` been unable to run after
`WorkspaceGuard`, had the gate altered unrelated agent routes, had atomic self-approval
prevention been inexpressible in Prisma, had role fixtures required weakening membership
rules, had `SUPERADMIN` hit a tenancy conflict, or had a migration or auth change appeared
necessary. None occurred.

**Known limitations.**
1. **A `USER`-role requester can no longer cancel their own request**, because the endpoint
   now requires an administrative role. A dedicated requester-cancellation route was
   explicitly out of T4 scope; it should be considered alongside the approvals UI.
2. Guard ordering is a Nest framework behaviour (controller-level guards run before
   route-level). It is not asserted by a unit test directly, but it is proven empirically:
   if the order inverted, `user.role` would be undefined and *every* role — not just `USER` —
   would receive 403, which checks 30–33 would catch.
3. `SUPERADMIN` still requires a workspace membership to pass `WorkspaceGuard`; the role
   alone does not grant cross-workspace reach. This is existing tenancy design, unchanged.
4. All Phase 5 durability obligations from T3.1 remain: at-most-once execution, best-effort
   audit coupling, and lazy expiry.

---

## T4.1 — Approval resolution input validation — COMPLETE

**Verified runtime-validation risk (proven before any code change).** The controller read
`@Body('action') action: 'APPROVE' | 'REJECT'`. A TypeScript union is erased at compile time
and validates nothing at the HTTP boundary, and because Nest only runs the global
ValidationPipe against a DTO metatype, binding a raw body property skipped validation
entirely. The service then treats REJECT as one branch and routes **every other value**
through the APPROVE path. A TDD red run on a disposable database captured the exploit
directly: `{"action":"APROVE"}` — a single-letter typo — returned **HTTP 201 and approved a
high-risk >$5,000 action**. The remaining eleven malformed cases then returned 409 only
because that bogus approval had already consumed the record.

**DTO decision.** New `backend/src/modules/agent/dto/resolve-approval.dto.ts`, following the
marketing module's `dto/` layout and the repository's established `@IsEnum` convention. It
defines a **runtime** enum `ApprovalResolutionAction { APPROVE, REJECT }` and a
`ResolveApprovalDto` whose `action` is validated with `@IsEnum`. Exact membership testing
rejects misspellings, casing variants, whitespace-padded values, empty strings, numbers,
booleans, objects, arrays, null and a missing property; the global `whitelist` +
`forbidNonWhitelisted` additionally rejects unknown extra body properties. The controller now
binds `@Body() body: ResolveApprovalDto` instead of a raw property.

**Defense-in-depth decision.** `resolveApproval` is a public service method, so it received a
guard as its **first statement** — before any row is read, any state transition, or any audit
write — that throws `BadRequestException` with `reason: APPROVAL_INVALID_ACTION` for anything
that is not exactly APPROVE or REJECT. The only current caller is the validated controller,
but any future caller (queue consumer, script, another module) would otherwise inherit the
original "unknown means approve" defect. The REJECT comparison now uses the enum member.

**Authorized files.** `agent.controller.ts`, `agent.service.ts`, the new
`dto/resolve-approval.dto.ts`, `test-agent-approval-api.ts`, this plan. **No migration, no
schema change, no auth change.**

**Test-first checklist — all complete.**
- [x] Red first: added the malformed-input cases and ran them on a disposable database,
      capturing `APROVE → HTTP 201` as proof of the defect (5 checks failing).
- [x] Twelve malformed bodies each rejected with HTTP 400: misspelling, lowercase, unknown
      value, empty string, missing property, null, number, boolean, object, array,
      whitespace-padded, and valid-APPROVE-plus-unknown-extra-field.
- [x] After every malformed attempt: approval still PENDING, `resolvedById` null, no tool
      executed, no duplicate approval, and no APPROVED/REJECTED audit event.
- [x] Valid APPROVE still succeeds and executes exactly once; valid REJECT still succeeds and
      executes nothing.
- [x] Regression preserved: role gate, self-approval refusal, self-rejection, concurrency,
      cross-workspace denial, redaction-divergence guard, non-high-risk inline execution.

**Acceptance criteria — met.** Focused suite **46 passed / 0 failed** (was 40). Workspace
guard **12/0**, workspace controller security **12/0**, auth security **10/0**, HTTP suite
**21/0**, `verify-comprehensive` **19/0**, and **full `npm run verify` exit 0** including
`nest build`. Development database unchanged; disposable database dropped and confirmed
removed.

**Verification commands** (disposable database `demm_crm_verify_phase0_<suffix>`, after a
probe proved child processes resolve `DATABASE_URL` to it): `npx prisma migrate deploy` →
`npx prisma migrate status` → `npx prisma generate` → `npx ts-node
test-agent-approval-api.ts` → `npx ts-node test-workspace-guard-api.ts` → `npx ts-node
test-workspace-controller-security.ts` → `npx ts-node test-auth-security.ts` → `npx ts-node
verify-http-staging.ts` → `npm run verify`; then drop and re-snapshot.

**Stop conditions honoured.** Would have stopped had DTO conventions been unable to validate
the action, had auth or a migration appeared necessary, had validation altered unrelated
agent endpoints, had an invalid action still reached a database mutation, or had existing
tests regressed. None occurred. Only the resolve route changed; the other four agent routes
still bind raw body properties exactly as before.

**Known limitation retained (unchanged by this task).** A standard `USER` still cannot cancel
their own pending approval, because resolution is restricted to administrative roles. A
requester-cancellation route must be designed alongside the approval UI. **The admin gate was
not weakened to work around this.**

**Evidence location.** Red run `/tmp/t41-red.log`; green run `/tmp/t41-green.log`; full
verification `/tmp/t41-full.log`.

---

## T6 — Refresh-token replay detection and session-family revocation — COMPLETE

**Threat model.** Refresh tokens rotate: exchanging one immediately revokes it and issues a
successor. A legitimate client therefore never presents a rotated token twice. A replay is
evidence that a *copy* of the token exists somewhere it should not — exfiltrated from storage,
a proxy log, or a stolen backup. Rejecting only the replayed token leaves the thief's (or the
victim's) newest token alive, so whoever else holds the family keeps working. T6 treats the
replay as a compromise signal for the whole account session family.

**Verified current behaviour before the change.** `refreshToken()` collapsed all three failure
states into `if (!stored || stored.revoked || stored.expiresAt < new Date())` and returned 401
without any further action. Tokens are stored as SHA-256 hashes (`hashToken`), looked up by
`findUnique({ hashedToken })`, and revoked rows are **retained** (`revoked: true`, never
deleted) — which is what makes owner identification possible. Rotation was, and remains, two
sequential writes rather than one transaction.

**Token-state distinction (T6.1).** The lookup deliberately does **not** filter on
`revoked`/`expiresAt`, because separating "never existed" from "existed and was rotated away"
is the whole basis of detection. Four states now behave distinctly:
| State | Response | Side effect |
|---|---|---|
| Unknown | 401 | **None.** No owner is identifiable, so reacting would let anyone log a victim out by posting random strings |
| Known + revoked | 401 | Suspected reuse → revoke every active token for that user + audit |
| Known + expired (never revoked) | 401 | None. Ordinary lifecycle end, not theft |
| Known + active + unexpired | rotate | Revoke presented token, issue successor (unchanged) |
All four return the **same** message, so the endpoint is not an oracle for which tokens existed.

**Revocation policy (T6.2).** `updateMany({ where: { userId, revoked: false } })` — the same
user-scoped shape `logoutAll()` already uses. No other user's tokens can be touched, and an
unknown token can never reach this path. No replacement token is issued and the replayed token
is not restored. The schema models no explicit token family, so "family" is interpreted as all
active refresh tokens for that user; **no schema change or migration was made.**

**Audit decision (T6.3).** `REFRESH_TOKEN_REUSE_DETECTED`, written through the existing
`AuditLog` model with `redactAuditPayload`. `actorType: 'SYSTEM'` with the account recorded as
*affected* rather than at-fault, since it cannot be known whether the legitimate holder or a
thief presented the token. Payload carries only `reason`, `outcome`, `affectedUserId` and
`revokedActiveTokenCount` — **no token, no hash, no credential, no infrastructure detail**.
`AuditLog.workspaceId` is a required FK while `RefreshToken.workspaceId` is nullable, so the
event is skipped rather than attributed to a fabricated workspace when absent.

**Ordering, stated honestly (T6.4).** Revocation is committed **before** the audit and
independently of it. Bundling them in one transaction would mean a failed audit rolls back the
revocation, leaving a suspected-stolen session alive — trading a real security action for a
bookkeeping one. The audit is therefore **best-effort**: a failure is logged to stderr, never
swallowed, and never changes the 401. This is *not* perfect transactional security, and Phase 5's
outbox is what makes the pair atomic.

**Authorized files.** `auth.service.ts`, `test-auth-security.ts`, `verify-http-staging.ts`,
this plan. No controller, DTO, guard, JWT-strategy, schema or migration change.

**Test-first tasks — all complete.**
- [x] Login + workspace selection issue a usable refresh token for both users.
- [x] Rotation turns token A into a distinct token B.
- [x] Replaying token A returns 401.
- [x] The replay revokes token B; token B is then rejected; zero active tokens remain for that user.
- [x] A second user's active token is unaffected by the first user's replay event.
- [x] The affected user can re-authenticate and get a clean session.
- [x] An unknown random token returns 401 and revokes nobody (active counts for both users unchanged).
- [x] An expired but never-revoked token returns 401 and does **not** trigger family revocation.
- [x] The audit record is written with the expected actor, reason and outcome.
- [x] No refresh token and no token hash appears in any reuse audit payload.
- [x] HTTP suite: the T3.2 assertion is **deliberately inverted** — the newest token is now 401
      after replay — plus a new fresh-login-after-detection path. The two-step pre-auth and
      obsolete-contract rejection checks are untouched.

**Notable behaviour confirmed by test.** *Every* presentation of a known-revoked token is a
replay signal, so checking that token B is dead itself emits a second audit event. That is
correct, not a double count; only unknown and expired tokens are silent. The assertion records
the delta explicitly.

**Evidence.** Auth security suite **21 passed / 0 failed** (was 10). HTTP suite **22/0** (was
21). Focused approval **46/0**, workspace guard **12/0**, workspace controller security
**12/0**, `verify-comprehensive` **19/0**, and **full `npm run verify` exit 0** including
`nest build`. Development database unchanged (12 migrations, 6 branch tables, 6
`StripePriceMapping` rows before and after); disposable database dropped and confirmed removed.
Transcripts: `/tmp/t6-run.log` (first run, one over-specified assertion of my own),
`/tmp/t6-run2.log` (final, all green).

**Verification commands.** Disposable database `demm_crm_verify_phase0_<suffix>` after a probe
proved child processes resolve `DATABASE_URL` to it: `npx prisma migrate deploy` → `npx prisma
migrate status` → `npx prisma generate` → focused approval suite → workspace guard suite →
workspace controller security suite → auth security suite → `npx ts-node
verify-http-staging.ts` → `npm run verify`; then drop and re-snapshot.

**Stop conditions honoured.** Would have stopped had the schema been unable to identify a
revoked token's owner, had user-scoped revocation needed a migration, had another user's
sessions been at risk, or had a controller/DTO/frontend change appeared necessary. None
occurred.

**Known limitations.**
1. **Concurrent-refresh false positive — the headline risk.** The single-token model cannot
   distinguish a genuine replay from two tabs refreshing with the same token in parallel: the
   loser presents a just-rotated token and triggers a full logout. This is the accepted
   industry trade-off, and its mitigation is the **single-flight refresh in Phase 0 task T8**,
   which is not built yet. Until T8 lands, a multi-tab user can be logged out legitimately.
2. Rotation itself is still two sequential writes, so two concurrent refreshes of the *same
   valid* token can both succeed and mint two successors. Fixing that needs a conditional
   claim, which would convert the race into a false-positive logout without a token-lineage
   model — deliberately not attempted in T6.
3. The audit is best-effort (see ordering above), and is skipped entirely if the token row
   carries no workspace id.
4. Revoked and expired token rows are retained indefinitely; see cleanup obligation below.
5. Access tokens are stateless and unaffected — a revoked family does not invalidate an
   already-issued access token until it expires (≤15 minutes).

**Future operational obligation (not built in T6).** Retained revoked/expired `RefreshToken`
rows grow without bound. A pruning job — retaining rows long enough to preserve replay
detection and audit value, then deleting — belongs with the Phase 5 durable-execution
substrate; record it in T16's operational runbook.

---

## T7 — Secure frontend BFF authentication routes — COMPLETE

> **RELEASE UNIT: T7 + T8 SHIP TOGETHER.** T7 alone is not a user-facing session
> solution and must not be described or deployed as one. The existing app still uses
> `localStorage` via `src/lib/api.ts`; nothing is rewired yet. More importantly, T6 treats a
> replayed rotated token as suspected theft, so parallel browser refreshes can revoke a live
> session — **T8's single-flight and multi-tab coordination is required before external
> release.**

**Threat model.** A refresh token in browser-reachable storage is exfiltrable by any XSS,
any malicious dependency, and any extension with page access — and it is the long-lived
credential (7 days) rather than the 15-minute access token. Moving it into a first-party
httpOnly cookie removes it from JavaScript's reach entirely, so an XSS can at worst borrow a
short-lived access token instead of taking over the session for a week.

**Route architecture.** Four narrowly scoped handlers under one namespace, matching the
existing `src/app/api/version/route.ts` convention. No generic action-dispatch route:
`POST /api/session/login`, `/select-workspace`, `/refresh`, `/logout`. Backend contracts are
unchanged — the routes forward to the existing `api/auth/*` endpoints.

**Cookie decision.** One cookie, `demm_crm_refresh`: `httpOnly`, `sameSite=lax`,
`secure` in production, `path=/api/session` (so the browser attaches it to these four routes
only — never to page loads, static assets, or other API calls), `max-age` 604800 to match the
backend's 7-day lifetime, cleared with identical name/path/flags. The access token is
deliberately NOT placed in a cookie and nothing is written to localStorage by these routes.

**Origin-validation decision.** Every state-changing route independently requires a JSON
content type and a trusted `Origin`; a missing Origin is rejected. `ALLOWED_FRONTEND_ORIGINS`
provides an explicit allowlist; otherwise the Origin's **host** is compared against the
request's `Host` header (the OWASP same-origin check). Scheme is intentionally not compared
because TLS terminates upstream on Cloud Run. `x-forwarded-host` is never consulted.
**`request.nextUrl.origin` was tried first and empirically rejected** — under the standalone
build it does not reflect the address the client used, so every same-origin request was
denied; the same mismatch would occur behind Cloud Run.

**Server-only fetch helper constraints.** A hardcoded allowlist of exactly four backend paths
(not a generic proxy), a 10s `AbortController` timeout, defensive JSON parsing that degrades
non-JSON responses into a clean status, preserved backend status codes, only
helper-constructed headers (nothing forwarded blindly from the browser), no request-body
logging, and no backend URL disclosure in client responses. The backend base URL resolves from
`BACKEND_API_URL` (server-only, runtime) then `NEXT_PUBLIC_API_URL` (inlined at build time,
which is what the Dockerfile provides today) — **both referenced statically**, since Next only
inlines literal `process.env.X`. There is deliberately **no localhost fallback**: that literal
would be compiled into `.next/standalone` and fail
`scripts/verify-no-localhost-in-bundle.js`, which blocks any production build containing a
loopback URL.

**Authorized files.** Four route handlers, two `_lib` helpers (config, backend fetch),
`test-session-routes.ts`, one `package.json` script, this plan. No change to `src/lib/api.ts`,
login page, sidebar, browser storage, retry logic, or any backend/schema/CI file.

**Test-first checklist — all complete (25/25).** Login returns preAuthToken/user/workspaces
and sets no cookie; invalid login fails safely; workspace selection sets the cookie with all
required attributes, returns the access token, and never returns the refresh token; invalid
pre-auth sets no cookie; unknown extra fields (the removed `userId` contract) are rejected 400;
refresh with no cookie is 401; a valid cookie rotates and replaces the cookie; a backend 401
clears the cookie and returns a generic 401 with no retry; logout forwards the token
server-side, clears the cookie, and is idempotent when absent; every route rejects
cross-origin; and no refresh token appears in any response body, client-readable header, or
server log, with no access token ever persisted to a cookie.

**Verification commands.** `NODE_ENV=production NEXT_PUBLIC_API_URL=<https url> npm run build`
(both production guards enforced) → `npm run test:session-routes` (starts the real standalone
server against a stub backend) → `npm run typecheck` → `npx eslint src/app/api/session
test-session-routes.ts`; backend regression via the disposable-database orchestrator.

**Evidence.** Session routes **25/25**, exit 0. Production build exit 0 with
`verify-production-config` ✅ and `verify-no-localhost-in-bundle` ✅, all four routes listed as
dynamic handlers. Frontend typecheck exit 0; the new files lint clean. Backend unaffected:
approval **46/0**, workspace guard **12/0**, workspace controller **12/0**, auth security
**21/0**, HTTP **22/0**, `verify-comprehensive` **19/0**, full backend `npm run verify` exit 0.
Development database unchanged; disposable database dropped. Transcripts: `/tmp/t7-build2.log`,
`/tmp/t7-routes4.log`, `/tmp/t7-backend.log`.

**Stop conditions honoured.** Would have stopped had standalone not served the handlers, had
trusted origins been undeterminable, had secure cookies been untestable, had the backend
contract differed, or had browser storage/retry changes been required. None occurred.

**Known limitations.**
1. **Not wired into the app.** `src/lib/api.ts` still uses `localStorage`; these routes are
   dormant until T8. Both refresh-token storage paths exist simultaneously until then.
2. **T8 is a release prerequisite** — see the banner above.
3. Origin validation compares host only, not scheme, and rejects requests with no Origin
   header (so non-browser clients cannot call these routes; that is intended).
4. Tests use a stub backend so cookie/Origin/401 behaviour is deterministic without a
   database. Real backend behaviour is covered separately by the backend suites.
5. Locally, `.next/standalone` nests the entrypoint under the project path because the
   repository root has its own `package.json`; in Docker the build context is the frontend
   directory alone, so `server.js` lands where the Dockerfile expects. The test locates it
   either way.
6. `BACKEND_API_URL`/`ALLOWED_FRONTEND_ORIGINS` are not set anywhere yet; the
   `NEXT_PUBLIC_API_URL` fallback and same-origin default cover current deployments, so no
   Dockerfile or CI change was needed.
7. **Pre-existing, unrelated:** `npm run lint` fails on 2 `react/no-unescaped-entities` errors
   in `src/app/marketing/offers/page.tsx` (untouched by T7), and `npm run test:e2e` targets
   deployed staging over HTTPS. Frontend `npm run verify` therefore cannot be green today for
   reasons that predate this task.

---

## T8 — Browser session orchestration and multi-tab coordination — COMPLETE

> **T7 + T8 ARE ONE RELEASE UNIT, AND IT IS NOW COMPLETE.** T7 built the secure routes; T8
> wires the app to them and removes browser-persisted credentials. Neither half is a session
> solution alone.

**Threat model.** Before T8 the access token sat in `localStorage` under `demm_crm_token`,
readable by any script on the page. Combined with T7 that leaves the long-lived refresh token
safe but still hands an attacker a working bearer token. T8 makes the access token
memory-only, so an XSS gets nothing that survives a reload and nothing it can exfiltrate from
storage.

**Session-state architecture.** One source of truth in `src/lib/session/`:
`client.ts` (state machine + all operations), `coordination.ts` (BroadcastChannel + Web Locks
+ fallback), `SessionProvider.tsx` (React binding). States: `UNINITIALIZED`, `RESTORING`,
`AUTHENTICATED`, `UNAUTHENTICATED`, `WORKSPACE_SELECTION_REQUIRED`. Operations:
`bootstrapSession`, `login`, `establishWorkspaceSession`, `getAccessToken`, `refreshSession`,
`logout`, `logoutAll`, `subscribeToSession`.

**Memory-only token decision.** The access token lives in a module-scoped variable. Nothing is
written to localStorage, sessionStorage, IndexedDB, a URL, or a browser-readable cookie. The
only browser storage this feature touches is the fallback lock's ownership metadata
(`{owner, expiresAt}` — never a credential) and a one-time delete of the legacy keys.

**Bootstrap behaviour.** On startup the provider purges the legacy keys, subscribes to
cross-tab messages, then calls `/api/session/refresh` once. `SessionProvider` deliberately
does **not** mount children while restoring: the nine existing pages gate themselves with a
synchronous `if (!getAuthToken()) router.push('/')` on mount, so rendering them before
restoration finished would bounce every reload to login. Holding them for one round-trip let
every one of those pages stay unmodified — which also respects the authorization boundary,
since most are outside T8's allowed file list.

**Single-flight design.** Two layers: an in-tab `refreshInFlight` promise collapses concurrent
callers onto one refresh; `withRefreshLock` serializes across tabs. After acquiring the lock a
tab re-checks whether another tab already refreshed and broadcast a token, and adopts it
rather than making a second call — this is what stops legitimate multi-tab activity from
tripping T6's replay defence.

**Multi-tab design.** Web Locks (`demm_crm_refresh_lock`) for serialization, BroadcastChannel
(`demm_crm_session`) for `ACCESS_TOKEN_UPDATED` and `SESSION_ENDED`, each message carrying a
random `TAB_ID`. Fallback when Web Locks is unavailable: a bounded localStorage lock holding
only owner + expiry, with automatic staleness expiry. The residual race in that fallback is
documented rather than hidden.

**Retry limit.** A 401 triggers exactly one coordinated refresh and exactly one replay of the
original request. A `hasRetried` flag guarantees termination. Any endpoint under `api/auth/` is
excluded by prefix — an enumeration silently omitted `register` until a test caught it.

**Logout behaviour.** Calls `/api/session/logout`, clears memory regardless of outcome, purges
legacy keys, and broadcasts `SESSION_ENDED`. The provider additionally redirects a remotely
logged-out tab to `/`, because the untouched pages only check auth on mount and would
otherwise keep displaying a fully-rendered dashboard after their token was gone.
`logoutAll(backendBaseUrl)` exists in the client (backend logout-all + cookie clear); no UI
control surfaces it yet.

**Temporary multi-workspace compatibility.** `api.login` still selects `workspaces[0]`,
now marked in code as a **TEMPORARY COMPATIBILITY BRIDGE — REMOVE IN T9**. This is not the
intended product behaviour; multi-workspace users cannot currently reach their other
workspaces from the login screen. T9 owns the real picker and must delete that branch.

**Authorized files.** `src/lib/api.ts`, new `src/lib/session/*`, `src/app/layout.tsx`,
`src/components/Sidebar.tsx` (logout control), the two authorized `offers/page.tsx` lint
escapes, `test-session-orchestration.ts`, two `package.json` scripts, this plan.

**Test-first checklist.** Automated same-tab suite **15/15**: single flight (five concurrent
refreshes → one network call), all callers share the result, failed refresh clears session
once, one-retry limit proven against a permanently-401 endpoint (exactly two attempts, one
refresh), retry carries the new token, auth routes never intercepted, logout clears memory.
Real-browser verification (genuine separate tabs, not a Node simulation): legacy keys purged
on boot; login through the T7 routes with localStorage/sessionStorage empty and
`document.cookie` empty; reload restores the session and stays on `/dashboard`; a second tab
authenticates; Web Locks proven to serialize (`A-acquired@0ms | A-released@1040ms |
B-acquired@1040ms`); logout in one tab drives the other to `UNAUTHENTICATED`, redirected to
`/`, showing the login form; and **zero token replays** across all multi-tab activity, so T6's
family revocation was never triggered.

**Verification commands.** `npm run test:session-orchestration`, `npm run test:session-routes`,
`npm run lint`, `npm run typecheck`, `NODE_ENV=production NEXT_PUBLIC_API_URL=<https>
npm run build`; backend regression through the disposable-database orchestrator.

**Evidence.** Frontend lint **exit 0 (0 errors — first time this phase)**, typecheck 0, build 0
with both production guards ✅. Session orchestration **15/15**, T7 routes **25/25**. Backend
untouched and green: approval 46/0, workspace guard 12/0, workspace controller 12/0, auth
security 21/0, HTTP 22/0, `verify-comprehensive` 19/0, full backend `npm run verify` exit 0.
Development database unchanged; disposable database dropped. Transcripts: `/tmp/t8-orch3.log`,
`/tmp/t8-t7r.log`, `/tmp/t8-build2.log`, `/tmp/t8-backend.log`.

**Known limitations.**
1. **Cross-tab behaviour is verified by real-browser observation, not by an automated
   regression suite.** No browser harness (Playwright etc.) is installed, and installing one
   was outside T8's authorized scope. The automated suite explicitly states it proves same-tab
   guarantees only. A real browser harness should be added in T16.
2. The fallback lock (no Web Locks) is best-effort: two tabs can still interleave between its
   read and write. Web Locks was available and used in the verified browser.
3. Proactive refresh scheduling uses `expires_in` with a 60s skew and a 5s floor; a resumed
   sleeping tab fires once through the same single-flight + lock path, so no storm — but this
   was reasoned and unit-covered, not observed over a real 15-minute expiry.
4. `logoutAll` has no UI control yet.
5. First-workspace selection remains a bridge for T9.
6. `npm run test:e2e` still targets **deployed staging** over HTTPS; it was not run and not
   redirected. Deployed-staging verification of the new session flow is a **T16** requirement.
7. The nine page components were intentionally left unmodified; they still gate on mount only,
   with the provider's redirect covering the remote-logout case.

---

## T9 — Multi-workspace picker and switcher — COMPLETE

**Goal.** Replace the temporary first-workspace bridge with an honest selection experience, and
let a signed-in user move between workspaces safely.

### Load-bearing backend finding (drove the whole design)

The backend was read directly before any code was written. Three facts constrain everything:

1. `POST /api/auth/login` is the **only** endpoint that returns the account's workspace list
   (`auth.service.ts:120-126`: `workspaceId`, `workspaceName`, `organizationId`,
   `organizationName`, `role`).
2. `POST /api/auth/select-workspace` is the **only** way to mint a workspace-bound session, and
   it requires a `preAuthToken` carrying `purpose: 'workspace-selection'`, which only a password
   login produces (`auth.service.ts:135-138, 157-169`). An access token is not that token.
3. `POST /api/auth/refresh` re-issues **the same workspace** the stored refresh token was bound
   to (`auth.service.ts:343`). It can never move a session to a different workspace.

There is **no authenticated endpoint that lists an account's workspaces**. `GET /workspaces` is
`SUPERADMIN`-only (`workspace.controller.ts:49-54`); `GET /workspaces/:id` returns one workspace
the caller already names; `req.user.memberships` is loaded by `jwt.strategy.ts` but never
exposed by any route. There is no `/api/auth/me`.

**Consequence, stated plainly:** after a reload there is no safe way to obtain the workspace
list, and no way to enter a different workspace, without a fresh password login. The stop
condition was therefore evaluated and the *safest available existing flow* was used rather than
inventing anything — no client-only list, no JWT claim decoding, no backend change.

### Workspace-list source of truth

The backend's login response, every time it is needed, held **in memory only**. It is never
persisted, never broadcast to another tab, and never reconstructed from a token. Two places
need it — finishing sign-in and switching — and both fetch it fresh.

### One / multiple / zero workspace behaviour

- **One** → entered automatically. There is no decision to present, so presenting one would be
  pure friction. It still goes through the same verified `switchWorkspace` path, not a shortcut.
- **Multiple** → state `WORKSPACE_SELECTION_REQUIRED`, picker rendered, **`select-workspace` is
  not called at all** until the user chooses. No access token exists in the meantime.
- **Zero** → honest empty state: "this account is not part of any workspace yet", pointing at
  the *existing* registration path. No workspace is fabricated and no new organization-creation
  flow was added.

### Switch-session architecture

One centralized operation, `switchWorkspace(workspaceId)`, is the only code path that puts a
workspace session in place — used by both login completion and switching, so client state and
the backend session cannot diverge. Each switch performs a full re-establishment: new backend
session, rotated httpOnly refresh cookie (set by the T7 route, never by client code), new
in-memory access token, new user/role/workspace metadata, rescheduled refresh, cross-tab
broadcast. Client-side workspace state is never mutated on its own.

The pre-auth token is dropped the instant it is spent, so a second switch requires proving the
password again. **Rejected alternative:** keeping the login's pre-auth token alive for the whole
session to make switching seamless — that leaves a reusable workspace-entry credential in memory
for hours, which is strictly worse than one prompt on a rare, deliberate action.

### Multi-tab switch policy — ALL TABS FOLLOW

A new `WORKSPACE_SWITCHED` broadcast carries the new access token and user. Receivers adopt it
**and reload**.

*Why follow rather than terminate:* the browser shares one refresh cookie, and after a switch it
is valid for the new workspace. Ending other tabs' sessions would show a login screen for a live
session, and the next reload would sign them straight back in. Following is also the only policy
that cannot leave a tab rendering one workspace's data while holding another workspace's token.
The reload is required because on-screen data belongs to the previous workspace; each reloading
tab's restore goes through the same cross-tab lock as any other refresh, so simultaneous reloads
serialize instead of racing.

### Authorized files (all within scope)

`src/lib/session/client.ts`, `src/lib/session/coordination.ts`, `src/lib/api.ts`,
`src/app/page.tsx`, `src/components/Sidebar.tsx`, new `src/components/WorkspacePicker.tsx` and
`src/components/WorkspaceSwitcher.tsx`, new `test-workspace-selection.ts`, `package.json`
(one test script), and this plan.

### Test-first record

`test-workspace-selection.ts` was written and run **before** any implementation existed; it
failed with 13 "property does not exist" errors — the correct RED. 44 assertions now pass.
Scope is stated in the file header: single Node process, so it proves single-tab guarantees and
which message the switching tab *emits*; cross-tab receipt, cookie rotation and reload
restoration are browser-verified instead of overclaimed.

### Verification commands

```
npm run test:workspace-selection        # 44 passed, 0 failed
npm run test:session-orchestration      # 15 passed, 0 failed  (T8 regression)
npm run test:session-routes             # 25 passed, 0 failed  (T7 regression)
npm run lint                            # exit 0, 0 errors (7 pre-existing warnings)
npm run typecheck                       # exit 0
NODE_ENV=production NEXT_PUBLIC_API_URL=… npm run build   # exit 0, both guards ✅
```

Backend regression ran against disposable database `demm_crm_verify_phase0_t9_1785090530`
(safety probe confirmed, database dropped, `dev-db-integrity UNCHANGED=true`):
approval 46/0, workspace guard 12/0, workspace controller 12/0, auth security 21/0,
HTTP 22/0, comprehensive 19/0, full backend `npm run verify` exit 0.

### Evidence

Real-browser run against a stub backend modelling three workspaces, using genuine separate tabs:

- Legacy keys purged; `localStorage`, `sessionStorage` and `document.cookie` all empty at every
  stage, including while a choice was pending.
- Multi-workspace login rendered the picker; backend call log showed **`login` only** —
  `select-workspace` count **0** before the choice.
- Choosing the **third** workspace issued `RT_ws-charlie_*`, and real API requests carried
  `x-workspace-id: ws-charlie` with `Bearer AT_ws-charlie_*`.
- Reload restored **ws-charlie** (not the first), rotating to a new token.
- Switch from a second tab: the other tab's role changed `USER` → `WORKSPACE_ADMIN` and its
  requests carried `x-workspace-id: ws-bravo` / `Bearer AT_ws-bravo_*`.
- Logout in one tab drove the other to `UNAUTHENTICATED` at `/` with the login form.
- **Zero refresh-token replays** across the entire run (login, selection, reload, switch,
  multi-tab follow, logout). T6 revocation was never provoked.

### Stop conditions evaluated

The "no authenticated workspace-list endpoint" condition **is** met. It did not block delivery
because every decision point re-fetches the list from the backend with a fresh credential, so
nothing is invented. It **does** block a password-free switch. Required backend capability, for
a separate bounded task: an authenticated `GET` returning the caller's own memberships
(workspace id/name, organization name, role), and an authenticated workspace-switch endpoint
that re-verifies membership and issues a new workspace-bound session without a password.

### Known limitations

1. Switching requires re-entering the password — a backend limitation, not a UX choice.
2. Cross-tab follow is proven by real-browser observation, not an automated regression suite.
3. The sidebar cannot show the **current** workspace's name: the `select-workspace`/`refresh`
   user payload carries `workspaceId` and `role` but no workspace name. Showing a name only
   sometimes would be worse than not showing one, so it is omitted.
4. `npm run test:e2e` still targets deployed staging → **T16**.
5. The nine page components remain unmodified and still gate on mount only.

---

## T10 + T11 — Honest dashboard and Agent Console — COMPLETE

**Goal.** Remove fabricated automation and AI behaviour from the frontend, and make every
visible state distinguish real data, user input, approval, execution, failure, and unavailable
capability.

### Verified misleading content (audited against backend behaviour, not assumed)

A full-frontend search for `self-heal | autonomous | automat | playbook | workflow | ai-generat |
simulat | mock | fake | confidence | recover | system health | uptime` confined every finding to
the two target pages. `ClientHealthTab.tsx`'s health states are real domain data from
`marketing/clients/:id/health` and were correctly left alone.

**Dashboard**
| Claim | Backing | Verdict |
|---|---|---|
| "Active Automated Playbooks" panel | none | fabricated |
| "Trigger Alert: Atlanta Photo Booth Workflow Failed" + mailer-timeout detail | hard-coded strings | fabricated |
| "AI Agent Self-Heal" button | `setTimeout(2500)`, no request | fabricated |
| "All workflows resolved and healthy. (Agent audit trail logged)" | nothing logged | false claim |
| "ACTIVE TENANT SYSTEM SECURE" badge | nothing measured | fabricated |
| "AI Summary & Recommendations" over `data.brief` | `dashboard.service.ts:61-67` builds a template string from counts — no model | false AI claim |
| four KPI cards | `dashboard.service.ts` real Prisma counts | REAL — kept |
| `openDealsCount` | returned by backend, never rendered | REAL — now shown |
| every card falling back to `?? 0` | — | **outage rendered as real zeros** |

**Agent Console**
| Claim | Backing | Verdict |
|---|---|---|
| chat greeting "your DEMM CRM Agent Employee" | none | fabricated persona |
| `lower.includes(...)` intent chain | none | fake understanding |
| default args `Sarah Connor / sarah@sky.net / 555-0199`, `Atlanta Photo Booth Booking`, `value: 12000\|750`, `probability: 80` | invented | **wrote invented records into the live CRM** |
| unrecognised input silently ran `getDashboard` | — | silent wrong action |
| "Agent processing workflow outcomes..." + spinner | none | fake processing stage |
| `agentText = "Executed ... successfully"` assigned before status was read | — | **unknown status announced as success** |
| `JSON.stringify(args)` in transcript | — | argument values echoed on screen |
| "Audit Trail History" | local component state | mislabelled |
| `GET /agent/tools` | real registry | REAL — kept |
| `POST /agent/execute` (SUCCESS / ERROR / PENDING_APPROVAL) | real | REAL — kept |
| `POST /agent/plan/preview` | `agent.service.ts:201-229` keyword-matches and returns hard-coded steps inventing "Sarah Wedding-Lead" | **fabricated — deliberately NOT surfaced** |

### Empty / error-state policy

`classifyDashboard` and `classifyToolList` are the only way either page reads a response. Only a
real payload can produce READY or EMPTY; LOADING, FORBIDDEN (403) and UNAVAILABLE (everything
else, including a missing payload with no recorded error) are distinct and render **no figures
at all**. Genuine zeros are shown as zeros and explicitly labelled real.

### Agent Console status vocabulary

`SUCCESS` → "The action ran." · `PENDING_APPROVAL` → "Waiting for approval. An administrator has
to approve this." + "Nothing has been changed yet." · `ERROR` → "The action failed." + the real
backend message · `CANCELLED` · `REJECTED` · `EXPIRED` · anything else → "We could not tell what
happened." **`hasExecuted` is true only for a real `SUCCESS`.** No jargon, no percentages, no
simulated stages.

### Authorized files

`src/app/dashboard/page.tsx`, `src/app/agent/page.tsx`, new
`src/components/dashboard/dashboardState.ts`, new `src/components/agent/agentStatus.ts`,
`src/lib/api.ts` (added `ApiError` carrying the HTTP status — message unchanged),
`package.json` (one test script), new `test-honest-frontend.ts`, and this plan.

### Test-first record

`test-honest-frontend.ts` was written and run **before** the modules existed; it failed with
"Cannot find module" for both — the correct RED. 36 assertions now pass. The absence assertions
strip comments first, so the pages can keep a written record of exactly what was removed without
the tests punishing the documentation.

### Verification commands

```
npm run test:honest-frontend            # 36 passed, 0 failed
npm run test:workspace-selection        # 44 passed, 0 failed  (T9)
npm run test:session-orchestration      # 15 passed, 0 failed  (T8)
npm run test:session-routes             # 25 passed, 0 failed  (T7)
npm run lint                            # exit 0, 0 errors (7 pre-existing warnings)
npm run typecheck                       # exit 0
NODE_ENV=production NEXT_PUBLIC_API_URL=… npm run build   # exit 0, both guards ✅
```

Backend regression on disposable database `demm_crm_verify_phase0_t10_1785094249` (safety probe
confirmed, dropped, `dev-db-integrity UNCHANGED=true`): approval 46/0, workspace guard 12/0,
workspace controller 12/0, auth security 21/0, HTTP 22/0, comprehensive 19/0, full backend
`npm run verify` exit 0.

### Evidence

Real-browser run of the production standalone build against a switchable stub backend:

- **Real data** → five KPI cards with the backend's exact figures ($18,251 etc.).
- **All zeros** → "Nothing has happened in this workspace yet. These numbers are real and they
  are all zero."
- **403** → "You do not have access to these numbers." with no figures shown.
- **Network failure** (reproduced unstaged, when the browser genuinely could not reach the API)
  → "We could not load your numbers... This is not the same as having no data" plus the real
  `Failed to fetch`, and **no KPI cards at all**. This is the exact case that previously
  rendered four zeros.
- **Agent Console** → only the three tools the stub registered; empty list → "The server offered
  no actions"; failed list → error, never samples.
- **PENDING_APPROVAL** → "Waiting for approval... Nothing has been changed yet."
- **ERROR** → "The action failed." + "Stage id is required for this pipeline".
- **Unrecognised status** → "We could not tell what happened." — no success claimed.
- History shows `Details sent: value` — the field NAME only; the typed `12000` never appears.
- T9 switcher, logout, and empty browser storage all still correct.

### Stop conditions evaluated

None triggered. Two backend defects were found and **reported rather than fixed**, because
backend production code is out of scope for this bundle:
1. `dashboard.service.ts:66` bakes the sentence "No automations failed today." into the brief
   string. The frontend no longer renders that string at all, so nothing false reaches the
   screen, but the backend should stop asserting it.
2. `POST /agent/plan/preview` returns hard-coded invented steps. It is not surfaced.

### Known limitations

1. The Agent Console cannot tell the user which fields an action needs — the tool registry
   publishes `name`, `description`, `permissions` but no parameter schema. The page says so.
2. Step preview stays unavailable until the backend can produce a real plan.
3. `POST /agent/execute/cancel` exists and `CANCELLED` is handled in the vocabulary, but no
   cancel control is offered: the console does not manage execution session ids.
4. Approval resolution remains admin-only and backend-only; the console deliberately offers no
   client-side approve path.
5. This suite has no React renderer, so DOM output is browser-verified rather than unit-tested.
6. `npm run test:e2e` still targets deployed staging → **T16**.

---

## T9.1 — Deferred workspace capability (recorded, NOT implemented)

Required before internal alpha; needs backend work that is out of scope for T9–T11:

1. **Authenticated workspace-membership listing** — a `GET` returning the caller's own
   memberships (workspace id/name, organization name, role). None exists today:
   `GET /workspaces` is `SUPERADMIN`-only, and `req.user.memberships` is loaded by
   `jwt.strategy.ts` but exposed by no route.
2. **Password-free workspace switching** — an authenticated endpoint that re-verifies membership
   and issues a new workspace-bound session. Today `select-workspace` requires a pre-auth token
   that only a password login mints, which is why T9's switcher asks for the password again.
3. **Current workspace display name** — the `select-workspace`/`refresh` user payload carries
   `workspaceId` and `role` but no workspace name, so the sidebar cannot name the active
   workspace.

---

## T12R + T14R + T13 — Repository safety remediation and CI guardrails — COMPLETE

Three sequenced checkpoints, each verified before the next began.

### T12R — Dump removal

**Pre-deletion evidence, re-confirmed independently (not read from the report):** 42,692 bytes,
SHA-256 `fe3b8933…`, tracked by Git, one migration (`20260721051848…`) versus 10 in the
repository, `ClientAccount`/`Offer` absent. **Zero** references in `.github/workflows`, either
`package.json`, `handoff.md`, any `.ts/.js/.sh/.yml`, or any doc outside this plan.

**Removed:** `backend/test_backup.dump`. Deleted with plain `rm` rather than `git rm` so the
shared index was not modified while another lane held uncommitted work; Git records ` D
backend/test_backup.dump`.

**Ignore rules:** new root `.gitignore` with `*.dump`, `*.pgdump`, `*.backup`, `*.dump.gz`,
`*.pgdump.gz` and a comment explaining why. **`*.sql` is deliberately NOT ignored** — Prisma
migration SQL is legitimate tracked source; verified that 9 `migration.sql` files remain tracked
and un-ignored.

**No history rewrite** (PM decision). The blob stays reachable through commit `4ff53c8`
("fix(integrity): complete Release 0.1.2 Evidence Integrity Correction"), which introduced it
82 seconds after it was written. Deleting the working file is therefore **partial** remediation;
full removal needs a separate, higher-risk history decision.

**Deferred to T16:** `demm_crm_restoration_test`, a live database holding a row-for-row identical
restoration of the same archive, was **not** touched. It is also on the destructive-test deny list
now, because its name ends in `_test` and would otherwise have satisfied the disposable-name rule.

**Out-of-scope copy retained:** the unmerged worktree still holds
`.claude/worktrees/phase-2-lead-to-client-core/backend/test_backup.dump` (byte-identical). The
worktree branch is out of scope; it will need its own removal when that branch is reconciled.

### T14R — Malformed Git-reference repair

**Backups (kept until at least T16):** `~/demm-crm-git-ref-backup-20260726-162743/` — outside the
repository and outside `.git`, copied with `cp -p`. Hashes verified equal on both files
(`3fca054c…` for the ref, `d4da9c93…` for its reflog).

**Final uniqueness re-proof before deletion:** ref value matched the investigation exactly; commit
type with 2 parents; a single changed file (`backend/src/app.module.ts`, +2 lines, both naming
`CommunicationsModule`); and `app.module.ts` **byte-identical** to the unmerged branch tip —
confirmed by identical blob hash `2c201f13…`, not merely an empty diff. Worktree clean.

**Removed, by explicit path, no wildcards:** `.git/refs/stash 2` and `.git/logs/refs/stash 2`.

| Check | Before | After |
|---|---|---|
| `git show-ref` | `fatal: bad ref refs/stash 2` | clean, exit 0 |
| `git for-each-ref` | `warning: ignoring ref with broken name` | no warnings |
| `git log --all` | **exit 128**, `fatal: bad object` | **exit 0** |
| `git fsck --full` | 4 errors | **0 errors, exit 0** |
| `git stash list` | empty | empty |
| dangling commits | 15 | 15 (retained, reported not deleted) |

All three worktrees present; both extra worktrees clean; unmerged tip still `1a251ad`.

**Seven inert duplicates retained** as instructed: `.git/index 2|3|4`, and the phase-2 worktree's
`AUTO_MERGE 2|3` and `index 2|3`. They cause no Git errors because Git opens those by literal
path rather than enumerating them.

**Root cause unresolved.** The `" N"` suffix pattern is filesystem copy/sync collision naming. It
is still active: during this task's verification, `frontend/.next/types/routes.d 2.ts` and
`cache-life.d 2.ts` appeared and broke `tsc` until the next build regenerated the directory. Those
were gitignored generated artifacts, not source. The host-level cause needs identifying outside
this repository, or the artifacts will keep returning.

### T13 — Destructive-test and CI safeguards

**Verified risk before this work:** three suites use unscoped global `deleteMany()` —
`verify-comprehensive.ts` (21), `verify-scenarios.ts` (19), `test-isolation.ts` (17) — and
`verify-http-staging.ts` registered real users and workspaces over HTTP with **no teardown at
all**. `test-isolation.ts` additionally carries a hard-coded fallback connection string pointing
at the development database. Nothing checked which database was connected. This is the mechanism
of the T3.3 loss.

**The guard — `backend/test-db-guard.ts`.** Two independent conditions, both required:

1. The **live** database name from `SELECT current_database()` (never a parsed URL) must start
   with `demm_crm_` **and** end with `_test`/`_verify`/`_ci` (or contain a disposable infix). The
   prefix requirement is load-bearing: this server also hosts `buckets_test` and `wtae_test`
   belonging to other projects, which a suffix-only rule would have permitted.
2. `ALLOW_DESTRUCTIVE_TESTS=true`, matched exactly — `1`, `yes`, `TRUE` are all rejected.

Plus a deny list that overrides everything (`demm_crm`, `demm_crm_restoration_test`, `postgres`,
and any configured staging/production name), and a live-vs-URL consistency check so a safe-looking
URL cannot mask a connection to something real. `NODE_ENV=test` grants nothing. Refusal prints the
database **name** only — never a host, user, password, or `DATABASE_URL`. The policy is a pure
function, so it is fully testable without a database or a credential.

**Suites protected** (guard is the first statement of the entry function, before any mutation and,
for the HTTP suite, before Nest bootstrap): `verify-comprehensive.ts`, `verify-http-staging.ts`,
`verify-scenarios.ts`, `test-isolation.ts`.

**Cleanup improvements.** `verify-http-staging.ts` now collects the ids of every user, workspace,
and organization it creates and removes exactly those, in dependency order, on both the normal
exit path and the exception path (a literal `finally` is unusable because `main()` exits the
process itself). Observed removing 2 users and 2 organizations per run. `verify-comprehensive.ts`
**retains** its global cleanup — converting a 20-table dependency-ordered wipe to scoped deletion
exceeds this task's scope — so the guard is the control there, documented in the file itself.

**CI isolation** (`.github/workflows/ci.yml`): the Postgres service database is renamed
`demm_crm_ci` (it was `demm_crm`, identical to the developer's database); `DATABASE_URL` is set at
job level to that service only; a pre-flight step asks the server for `current_database()` via
`PG*` variables — so no connection string reaches a command line — and fails the job if it is not
`demm_crm_ci`; `ALLOW_DESTRUCTIVE_TESTS=true` is set on the verification step **only**. `db push`
is replaced by `prisma migrate deploy`; `migrate dev` and `migrate reset` are never used. The
service container is created and destroyed with the job, so the database is ephemeral by
construction. No staging or production credential is referenced.

**Drift truthfulness**, documented in the guard and in the workflow: `prisma migrate status`
confirms that the migrations *this repository knows about* are applied. It does **not** detect
extra migrations applied from elsewhere — proven in T3.1, where a database carrying two unmerged
branch migrations still reported "up to date" — and it says nothing about whether a target is safe
to destroy. It is reporting, not a safety control. The live database-name guard is the safety
control.

**Focused tests:** `backend/test-repo-safety.ts`, script `test:repo-safety`, **43 assertions**,
written and run before the guard existed (failed with "Cannot find module" — correct RED). Covers
all ten required proofs plus foreign `_test` databases, opt-in string strictness, `NODE_ENV`
non-bypass, and the T12R/T14R hygiene outcomes as regression locks.

### Verification commands and evidence

```
npm run test:repo-safety                # 43 passed, 0 failed
ALLOW_DESTRUCTIVE_TESTS=true npx ts-node verify-comprehensive.ts   # exit 1, DENIED_DATABASE
```
Live guard proof against the real development database: all four protected suites exited **1**
with the database name printed and nothing touched (dev DB still 12 migrations, 73 tables,
2 Organizations, 6 Users afterwards).

Disposable run on `demm_crm_verify_phase0_t13_1785098350` — safety probe confirmed; **guard proof
A** showed a destructive suite refusing with `MISSING_OPT_IN` on a correctly-named disposable
database before any mutation; then with the opt-in: repo-safety 43/0, approval 46/0, workspace
guard 12/0, workspace controller 12/0, auth security 21/0, HTTP 22/0, comprehensive 19/0, full
backend `npm run verify` exit 0. Database dropped. `dev-db-integrity UNCHANGED=true` across
migrations, branch tables, `StripePriceMapping`, and `Offer`.

Frontend regression: T7 25/0, T8 15/0, T9 44/0, T10+T11 36/0, lint exit 0, typecheck exit 0,
production build exit 0 with both guards ✅. Transcripts: `/tmp/t13-orch.log`,
`/tmp/t13-verification.log`.

### Known limitations

1. The dump's blob remains in history via `4ff53c8`; no history rewrite was performed.
2. `demm_crm_restoration_test` still exists and still holds the same fixture credentials.
3. The unmerged worktree retains its own copy of the dump.
4. `verify-comprehensive.ts` still performs a global wipe; the guard is the only thing making it
   safe.
5. The host-level file-duplication cause is unidentified and still active.
6. `test-isolation.ts`'s hard-coded development fallback URL is left in place (now unreachable,
   since the guard refuses when `DATABASE_URL` is unset and denies `demm_crm` when it is set).
7. The CI workflow changes are verified by inspection only — no CI run was triggered.
8. `frontend npm run test:e2e` still targets deployed staging → **T16**.

---

## Phase 0A + Phase 0B — Preservation and truthful handoff — COMPLETE

### Phase 0A — preservation

All Phase 0 work (T1–T14) was uncommitted on `main` at `24808c4`: 20 tracked files
(+2,350/−560) and 21 new source files, with no branch, tag, stash, or remote copy. It is now
preserved on `phase0/baseline-preservation-2026-07-26`, pushed and remotely verified
(remote tip == local tip == `4f59a2fe23963bc79277c754fa6f274858f10725`).

Seven logical commits: `1ae8be0` approvals · `fa7c8ca` auth · `f27939d` frontend session ·
`7ae4fb0` workspaces · `59e9b0d` honest UI · `0956183` safety + CI + dump removal ·
`4f59a2f` this evidence plan. 45 files, +9,078/−560.

**Commit-boundary deviations**, all forced by buildability rather than preference:
- `verify-http-staging.ts` carries both T6 auth assertions and T13 guard/cleanup work. It sits in
  the safety commit because it imports `test-db-guard.ts`; committing it earlier would produce a
  commit that does not build. Same reasoning for `verify-comprehensive.ts`, `verify-scenarios.ts`,
  and `test-isolation.ts`.
- `frontend/src/lib/session/` is a new file set containing T7, T8, and T9 work inseparably; it
  lands whole in the session commit, so `switchWorkspace` exists one commit before the workspace
  UI that uses it.
- `frontend/src/lib/api.ts` spans T8/T9/T10 and lands in the session commit; `ApiError` is present
  there before anything consumes it (harmless, buildable).
- Both `package.json` files land in the safety commit so no script ever points at a test file that
  does not yet exist.
- `Sidebar.tsx` is in the workspace commit because it imports `WorkspaceSwitcher`.

**Excluded deliberately:** `DEMM_Autonomous_Execution_Loop_Prompt.md` and
`flyer for event planners.png` (unrelated), plus all `.env`, generated output, `node_modules`,
external backups, and duplicate artifacts. Verified: zero matches for each exclusion pattern in
`git diff main..HEAD`.

**Pre-existing credential note (not newly introduced).** The CI workflow contains an ephemeral
service-container credential and a CI-only `JWT_SECRET` literal. Both already exist in committed
`HEAD`; the Phase 0A diff reduces the database-URL literal from three occurrences to one and
changes only the database name. No new secret enters Git. Recorded for Phase 0C.

**Verification, run twice — before the first commit and again after the last** — each on its own
uniquely named disposable database with the live-name guard and explicit opt-in, then dropped:
repo-safety 43/0, approval 46/0, workspace guard 12/0, workspace controller 12/0, auth 21/0,
HTTP 22/0, comprehensive 19/0, full backend `npm run verify` exit 0, backend lint/typecheck 0.
Frontend: T7 25/0, T8 15/0, T9 44/0, T10+T11 36/0, lint 0 (7 pre-existing warnings), typecheck 0,
production build 0 with both guards. `dev-db-integrity UNCHANGED=true` both times.

Git health after: `show-ref`, `for-each-ref`, `log --all`, `fsck --full` all exit 0, no bad-ref
errors; 15 dangling commits retained; both extra worktrees clean and unchanged; `main` unmoved;
no tag created; Communications branch untouched.

### Phase 0B — truthful handoff

`handoff.md` was rewritten. Removed as stale or unverifiable: the "Release 1.0" framing, the GCP
project id, two staging URLs, the staging database instance name, the "Baseline Backup
Identifier", and a memory-sync API paired with a local token path. Removed as already completed:
"next steps" calling for DOM26-R controllers (four now exist) and Marketing offer work (module
now has eight controllers).

The new document distinguishes locally verified from CI-verified, staging-verified, and
production-verified — the last three all being **none** — and states plainly that the build is not
sealed for external release. It records repository truth, database truth including the 10-vs-12
migration drift and its cause, completed capabilities, verification counts, security decisions,
the full defect list, the host-duplication blocker, dump and recovery truth, memory boundaries,
the Phase 0C gate, the 25-step roadmap, a confirmed core-file map, and takeover instructions.

**Deployed-staging verification remains outstanding** and is a Phase 0C requirement.

---

## Phase 0C — Baseline seal — BLOCKED (reconciliation and containment complete)

### Reconciliation (Checkpoint 1) — COMPLETE

The believed state was wrong in one important way: `origin/main` was **28 Stripe billing
commits** ahead of the local baseline, and those commits were never part of the Phase 0
preservation branch. Ancestry turned out to be strictly linear, not divergent:

```
24808c4 (local main / preservation base)
  -> 28 Stripe commits -> d0d0b26 (origin/main)
  -> 28 Communications commits -> 2ddac5f (origin/worktree-phase-2-...)
  -> 2 local commits -> 1a251ad (local worktree tip)
```

`phase0/seal-candidate-2026-07-26` was cut from `origin/main` and the preservation branch was
merged into it with a normal reviewable merge (`49f80d6`). **0 commits lost from either side**;
all 8 preservation commits and all 28 origin/main commits are reachable. 11 migrations now.

Two conflicts, both resolved deliberately rather than by side preference:
- `schema.prisma` — whitespace realignment plus one real field (`checkoutSessions`) present only
  on origin/main. Took origin/main; then verified `AgentApproval.requesterRole`,
  `AgentApproval.expiresAt`, and `ApprovalStatus.EXPIRED` all survived.
- `handoff.md` — origin/main carried a **newer** handoff than the one Phase 0B replaced,
  documenting real deployment tooling. Neither side taken wholesale; operational truth merged in
  and re-verified live.

### Host duplication (Checkpoint 2) — ROOT CAUSE IDENTIFIED, CONTAINED

Evidence, not inference:
- `FXICloudDriveDesktop = 1` — iCloud "Desktop & Documents" sync is enabled.
- `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop/demm CRM` exists — **the repository is
  inside the iCloud container**.
- `bird`, `cloudd`, `fileproviderd`, and the iCloudDrive FileProvider are all running.
- iCloud resolves collisions by appending `" 2"`, `" 3"` — exactly the observed pattern, and Git
  rewrites `.git/index` and `refs/*` constantly via write-then-rename.

During this phase the mechanism **escalated to source files**: 16 untracked duplicates appeared
in the original checkout, including `client 2.ts`, `coordination 2.ts`, `WorkspacePicker 2.tsx`,
`resolve-approval.dto 2.ts`, and every new test file. They were visible to Git as `??` and would
have been swept in by `git add .` — which retroactively justifies Phase 0A's explicit-path
staging. The committed tree contains **0**.

**Containment:** a clean clone at `/private/tmp/demm-crm-clean-candidate` (outside the synced
path) has **0 duplicates** anywhere, clean `fsck`, and is now the release vehicle. The original
checkout is **quarantined from release operations**. This is *containment*, not a root-cause fix:
the sync setting is still on and only the user can change it.

### Dispositions (Checkpoint 3)

- `demm_crm_restoration_test` — dependency scan found only the guard deny-list, string-literal
  test assertions, and historical docs. Final evidence recorded (18 tables, 1 migration, 30
  non-migration rows), then **dropped and confirmed gone**. No other database touched.
- Historical dump blob — retained in history by standing decision; residual exposure recorded.
- Communications worktree dump copy — untouched; belongs to Phase 1.
- External malformed-ref backups — retained.
- Seven inert `.git` duplicates — left in the quarantined checkout as evidence; **not** copied
  into the clean clone.

### Local verification (Checkpoint 4) — GREEN in the clean clone

Backend on disposable `demm_crm_verify_phase0_p0c2_1785126714`: repo-safety 43/0, approval 46/0,
workspace guard 12/0, workspace controller 12/0, auth 21/0, HTTP 22/0, comprehensive 19/0, full
`npm run verify` exit 0, lint 0, typecheck 0. Frontend: T7 25/0, T8 15/0, T9 44/0, T10+T11 36/0,
lint 0, typecheck 0, production build 0 with both guards. `dev-db-integrity UNCHANGED=true`.

**Two release blockers found and fixed (`04257e6`), neither introduced by the merge:**
1. `verify-stripe-billing-staging-smoke.ts` filtered `RelationshipSignal` by a non-existent
   `clientAccount` relation. It is a compile error, so **`origin/main` does not currently
   typecheck** and its `npm run verify` chain fails. Corrected to `profile.businessUnitId`.
2. `test-repo-safety.ts` assertion 10f asserted exactly seven inert `.git` duplicates — an
   environment-specific fact that fails on every clean checkout, CI included. Replaced with a
   portable invariant: no duplicate-suffixed artifact inside `refs/` or `logs/refs/`.

### Staging discovery (Checkpoint 6) — VERIFIED

Contrary to the earlier Phase 0B write-up, a real staging environment exists and was verified
live: both Cloud Run services return HTTP 200 serving `d0d0b26`, Cloud SQL `demm-crm-staging-db`
is RUNNABLE, four secrets are configured (names only), and the deploy identity has access.

### THE BLOCKER (Checkpoint 7)

`scripts/deploy-staging.sh` enforces, with no bypass flag:

```
git merge-base --is-ancestor "$COMMIT_SHA" origin/main
  || fail "... not an ancestor of origin/main -- Refusing to deploy an unreviewed commit."
```

The seal candidate is a merge **ahead of** `origin/main`, so it can never satisfy that guard.
Deploying it requires merging to `main` first — which Phase 0C explicitly withheld pending
independent approval. A second blocker sits behind the same gate: deployed-browser verification
needs a login, and the standing constraint forbids Claude from typing real credentials.

**Consequently `v0.1.4-phase0-baseline` was NOT created, and Phase 1 was NOT started.**

---

## Remaining Phase 0 tasks (not started — approved scope, unchanged)

- [x] **T4 — COMPLETE** (full record in the "T4 — Approval authority" section above).
      Role-gate approval resolution and prohibit self-approval.
      Restrict `POST /agent/approvals/:id/resolve` to `WORKSPACE_ADMIN`, `ORG_ADMIN`,
      `ORG_OWNER` via `RolesGuard` (must be listed **after** `WorkspaceGuard`, which is what
      populates `request.user.role`). Prohibit self-**approve** (self-reject remains a
      legitimate cancel) by adding `requestedById: { not: approverId }` to the APPROVE claim
      plus a clear pre-check refusal. Tests: `USER` role → 403; requester approving own
      request → 403 with nothing executed; a second admin can still approve.
      **Open PM decision:** the approved role list omits `SUPERADMIN`, which would prevent a
      superadmin from approving — confirm inclusion or record the exclusion as intentional.
- [x] **T6 — COMPLETE** (full record in the "T6 — Refresh-token replay detection" section
      above). Backend refresh-token reuse detection with user-scoped session revocation.
- [x] **T7 — COMPLETE** (full record in the "T7 — Secure frontend BFF authentication routes"
      section above). **Ships as one release unit with T8 — do not deploy T7 alone.**
- [x] **T8 — COMPLETE** (full record in the "T8 — Browser session orchestration" section
      above). The T7+T8 secure-session release unit is now complete.
- [x] **T9 — COMPLETE** (full record in the "T9 — Multi-workspace picker and switcher" section
      above). The temporary `workspaces[0]` bridge is deleted. Switching requires a fresh
      password until the backend gains an authenticated workspace-list and switch capability —
      that gap is written up as a separate bounded backend task.
- [x] **T10 — COMPLETE** (full record in the "T10 + T11 — Honest dashboard and Agent Console"
      section above). The fabricated playbook/self-heal panel, the unearned "AI Summary" label,
      and the invented system-health badge are gone; failures no longer render as zeros.
- [x] **T11 — COMPLETE** (same section). The fake intent parser, invented default arguments,
      fake processing stage, default-success message, and echoed argument values are gone; only
      real backend capabilities are surfaced.
- [ ] **T9.1** — Deferred workspace capability (recorded above; needs a bounded backend task).
- [x] **T12 — COMPLETE** (investigation + T12R remediation; full record in the
      "T12R + T14R + T13" section above). Dump classified as an obsolete fixture snapshot,
      removed from the working tree, archive patterns ignored. Historical blob retained in
      `4ff53c8` by PM decision; restoration database deferred to T16.
- [x] **T13 — COMPLETE** (full record in the "T12R + T14R + T13" section above). CI now uses an
      ephemeral `demm_crm_ci` service with `prisma migrate deploy`; `db push` removed. A live
      database-name guard plus an explicit `ALLOW_DESTRUCTIVE_TESTS=true` opt-in protects all four
      destructive/fixture-leaking suites. `verify-comprehensive.ts` retains its global cleanup by
      design, with the guard as the control.
- [x] **T14 — COMPLETE** (investigation + T14R remediation; full record above). Both malformed
      artifacts backed up outside `.git` and removed; `git log --all` and `git fsck --full` now
      exit 0. Seven inert duplicates retained; host-level duplication cause still unresolved.
- [ ] **T15** — Rewrite `handoff.md` to match reality.
- [ ] **T16** — Seal the baseline: full verification, staging deploy, tag
      `v0.1.4-phase0-baseline`, Phase 0 completion capture.

---

## Deviations and discoveries

1. **`EXPIRED` enum value added** beyond the two named nullable columns — additive,
   non-destructive, justified by the required expiry transition. PostgreSQL cannot drop an
   enum value, so rollback leaves it in place.
2. **Refused to reset the drifted development database.** `prisma migrate dev` demanded
   `prisma migrate reset` ("All data will be lost"), which would have destroyed the unmerged
   branch's applied state and development data.
3. **Used a read-only datamodel diff plus `migrate deploy`** instead: the committed `HEAD`
   schema was diffed against the edited schema to generate the SQL, which was then hand-placed
   with a companion `rollback.sql` and applied non-destructively. In Prisma 7,
   `migrate diff --shadow-database-url` no longer exists and `--to-schema-datamodel` is now
   `--to-schema`.
4. **Pre-existing `Decimal` serialization defect found and fixed.** `redactAuditPayload`
   turns a Prisma `Decimal` into an object carrying a `constructor` function; Prisma then
   refuses the audit write, the surrounding catch converts it to `{ status: 'ERROR' }`, and a
   tool that **succeeded** was reported as failed. Unreachable until this repair let a
   high-risk `createOpportunity` — the first tool returning a `Decimal` — actually execute.
   Fixed with `toJsonSafe`.
5. **Added a non-high-risk-path test** (check 19), because `verify-scenarios.ts` — the only
   other direct consumer of `executeTool` — cannot run under the database drift, leaving the
   ordinary inline execution path otherwise uncovered.
6. **Local development database contains the unmerged branch's migrations.** 12 applied
   migrations: 9 from `main`, 2 from `worktree-phase-2-lead-to-client-core`
   (`20260723164851_stripe_founder_tier_billing`,
   `20260724194855_communications_core_foundation`), plus this slice's
   `20260726134103_approval_requester_role_and_expiry`. Six branch-only tables are physically
   present, and six `StripePriceMapping` rows hold `ON DELETE RESTRICT` foreign keys to
   `Offer`, so the global `offer.deleteMany()` in the cleanup preambles of
   `verify-comprehensive.ts`, `test-isolation.ts` and `verify-scenarios.ts` fails on this
   machine at any commit on `main`. **Resolved by Phase 3 (merge), not by Phase 0.**
7. **`prisma migrate status` does not detect extra applied migrations.** It reported
   "Database schema is up to date!" throughout, because it only checks that local migrations
   are applied. `npm run verify`'s `prisma:status` step therefore gives false assurance and
   is not a drift check.
8. **Execution guarantee clarified:** exactly-once approval **decision**; at-most-once tool
   **execution**; *not* exactly-once; *not* idempotent. At-most-once is the deliberate
   fail-safe direction for high-risk actions. Durable resumable execution → Phase 5.
9. **Redacted execution-argument limitation.** `AgentApproval.arguments` is simultaneously the
   audit record and the replayed execution input, and stores the redacted form.
   `redactAuditPayload` matches key substrings including `key`, and `key` is a legitimate
   business column on `BusinessUnit`, `Offer`, `OfferSnapshot` and `ConversionIdempotencyKey`
   — a realistic corruption vector. Mitigated in T3.1 by the fail-closed staging guard;
   properly resolved in Phase 6 by separating encrypted execution arguments from redacted
   audit arguments.
10. **Audit transaction limitations.** Approval state changes and their audit rows are
    separate transactions, so a crash between them leaves a transition with no audit event; a
    tool can succeed before its result audit persists; and an audit-persistence failure can
    make a successful action report as an error. Documented in code, deferred to Phase 5's
    transactional outbox.
11. **Principal Architect review (2026-07-26)** returned **APPROVE WITH REQUIRED FIXES** —
    no critical defects, five high-priority concerns, required fixes R1–R8 with R9 deferred.
    T3.1 exists to discharge that verdict.
12. **Stale HTTP verification suite was the second independent blocker to a green
    `npm run verify`.** `verify-http-staging.ts` still tested the removed, insecure
    `userId`-in-body workspace-selection contract and therefore failed 3 of 15 checks on every
    commit. Diagnosed in T3.1 (outside its authorized file scope) and repaired in T3.2, which
    also converted the hole into an explicit security regression test. **After T3.2 the full
    backend suite passes end to end (exit 0) on a clean database** — the two blockers were the
    database drift and this stale suite, and neither was a production defect.
13. **`verify-http-staging.ts` is misnamed and leaks fixtures.** It boots a local Nest app
    rather than calling deployed staging, and it creates users/organizations/workspaces with no
    cleanup, so it must only ever run against a disposable database.
14. **Staging PostgreSQL major version unverified.** `ALTER TYPE ... ADD VALUE` requires
    PostgreSQL ≥ 12 inside Prisma's migration transaction. Local is 18.3. The available
    `gcloud` credential authenticates to an unrelated project and the Cloud SQL Admin API is
    disabled there; enabling it would be an unauthorized infrastructure change. **Recorded as
    a deployment precondition to confirm before any staging deploy.**

---

## G-Stack review gates (required before T4 — none has run yet)

- [ ] `/plan-eng-review` — this plan plus the T4 approach.
- [ ] Security review — approval privilege model, `requesterRole` non-forgeability, stored
      execution arguments, and the T4 role gate / self-approval rule.
- [ ] `/review` — full working diff against `24808c4`.
- [ ] Verification review — the clean-database evidence set.
- [ ] Browser/UI QA — **not applicable** to this backend-only work; required from T7 onward.

## Knowledge capture (Phase 0 completion gate — not yet performed)

No customer-level DOM26 or DOM26-R memories arise from Phase 0. Capture at the gate is
limited to: repository decision records (approval execution architecture; session
architecture), G-Brain engineering/product pages (root-cause retro, drift discovery, the
`migrate status` blind spot), and one DOM26 v3 org-level decision record. **No tenant data,
approval arguments, database contents, credentials, tokens, or contact information may be
sent to builder-side systems.** No remote capture has been performed.
