# DEMM CRM — Technical Handoff

**Written:** 2026-07-27 · **Supersedes the previous handoff in full.**

> **Correction (Phase 0C).** An earlier revision of this file said the previous handoff's
> environment claims "could not be verified". That was true only of the branch it was written on
> (`main` at `24808c4`). `origin/main` carries a **newer** handoff and real deployment tooling, and
> the staging environment has now been **directly verified live**. Those operational facts are
> restored in §16 and the earlier dismissal is withdrawn. What remains removed is the unverifiable
> "Baseline Backup Identifier" and a memory-sync API paired with a local token path.
>
> Nothing below is asserted unless it was checked against the repository, the database, a recorded
> test run, or a live read-only query during this task.

---

## 1. Executive status

| Item | State |
|---|---|
| Phase 0 implementation (T1–T14) | **Complete** through repository safety remediation |
| Phase 0A — preservation | **Complete** |
| Phase 0B — documentation | **Complete** as of the commit adding this file |
| Phase 0C — remote-main reconciliation | **Complete** — seal candidate merges 28 Stripe commits + 8 Phase 0 commits |
| Phase 0C — seal | **BLOCKED** — see §17 |
| Sealed for external release | **No** |
| Local verification | **Green where recorded in §6** |
| Real CI verification | **Never run** |
| Deployed-staging verification | **Never run** |
| Production verification | **Never run** |

**Do not describe this build as production-ready, shippable, or released.** It is a
locally-verified baseline that has never executed in CI or on any deployed environment.

---

## 2. Product destination

The finished product is an AI-first business operating system in which **the workflow engine is
the product**. A non-technical business owner should be able to:

1. Create an account
2. Choose a workspace
3. Connect billing and communications
4. Choose an industry starting point
5. Answer plain-language questions
6. Preview deterministic workflow steps
7. Test them
8. Activate them
9. Receive real leads
10. Communicate by SMS and email
11. Handle approvals
12. Understand workflow failures in plain language
13. See real results

Four intended launch packs: **marketing agency**, **photo booth**, **barber**,
**consultant/coach**.

**None of that is a Phase 0 capability.** The workflow engine, guided builder, AI planner,
integration layer, and all four launch packs **do not exist in this repository**. Phase 0
hardened the foundation — identity, tenancy, governed actions, honest UI, repository safety —
that those capabilities will later stand on.

---

## 3. Repository state

| Item | Value |
|---|---|
| Preservation branch | `phase0/baseline-preservation-2026-07-26` |
| Branch HEAD | `4f59a2fe23963bc79277c754fa6f274858f10725` |
| Cut from | `24808c4bf16efbc079fe06318950dd96ef58fb52` |
| Remote status | **Pushed and verified** — remote tip equals local tip |
| `main` | `24808c4…` locally — **unchanged and not pushed** |
| Unmerged Communications branch | `worktree-phase-2-lead-to-client-core` @ `1a251ad6…` local / `2ddac5fa…` remote — **untouched** |
| Tags | Four pre-existing `v0.1.x-release` tags. **No new tag created.** |

### Phase 0A commit sequence (oldest first)

| SHA | Subject |
|---|---|
| `1ae8be0` | `feat(approvals): harden governed action execution` |
| `fa7c8ca` | `feat(auth): add replay-safe session rotation` |
| `f27939d` | `feat(frontend): secure browser session lifecycle` |
| `7ae4fb0` | `feat(workspaces): add explicit workspace selection` |
| `59e9b0d` | `fix(ui): remove fabricated automation states` |
| `0956183` | `chore(safety): guard destructive verification` |
| `4f59a2f` | `docs(phase0): record verified baseline evidence` |

45 files changed, +9,078 / −560 against `main`.

### Worktrees

| Path | Branch | Tip | Clean |
|---|---|---|---|
| `…/Desktop/demm CRM` | `phase0/baseline-preservation-2026-07-26` | `4f59a2f` | 2 unrelated untracked files |
| `/private/tmp/demm-crm-baseline` | detached | `24808c4` | yes |
| `.claude/worktrees/phase-2-lead-to-client-core` | `worktree-phase-2-lead-to-client-core` | `1a251ad` | yes |

`DEMM_Autonomous_Execution_Loop_Prompt.md` and `flyer for event planners.png` are deliberately
left untracked; they are not Phase 0 work.

### Git health

`git show-ref`, `git for-each-ref`, `git log --all`, and `git fsck --full` all exit **0**, with
no bad-ref errors and no broken-name warnings. `git stash list` is empty.

**15 dangling commits remain** — ordinary rebase/amend debris plus the ex-stash `3e8c5260…`.
Retained deliberately. Do not `gc` or `prune` without a decision.

**Seven inert duplicate `.git` artifacts remain**, retained on purpose: `.git/index 2|3|4` and
`.git/worktrees/phase-2-lead-to-client-core/{AUTO_MERGE 2, AUTO_MERGE 3, index 2, index 3}`.
They cause no Git errors because Git opens those paths literally rather than enumerating them.

**External malformed-ref backup:** `~/demm-crm-git-ref-backup-20260726-162743/` — two files,
hash-verified against their originals before deletion. **Retain until Phase 0C accepts the
repair.**

See §9 for the host-level duplication blocker.

---

## 4. Database state

*No connection strings or credentials appear in this document. Configuration lives in
`backend/.env`, which is untracked and correctly gitignored.*

| Metric | Value |
|---|---|
| Migration directories in the repository | **10** |
| Migrations applied to the development database | **12** |
| Public tables in the development database | **73** |
| Branch-only tables present | **6** |
| `StripePriceMapping` rows | **6** |
| `Offer` rows | **6** |

**Why the counts differ.** The development database has two migrations applied that do not exist
on this branch, both belonging to the unmerged Communications work:
`20260723164851_stripe_founder_tier_billing` and `20260724194855_communications_core_foundation`.
This is why `prisma migrate dev` demands a destructive reset — **do not accept that prompt.** The
six branch-only tables (`StripePriceMapping`, `StripeWebhookEvent`, `ChannelConnection`,
`Conversation`, `Message`, `MessageTemplate`) come from those two migrations.

**`prisma migrate status` is not drift detection.** It confirms that the migrations *this
repository knows about* have been applied. It cannot see migrations applied from elsewhere —
proven directly here: this database carries two extra migrations and still reports "up to date" —
and it says nothing about whether a target is safe to destroy. The live database-name guard is
the safety control.

**T3.3 incident (local fixture loss).** Development-database records were destroyed by an
unguarded destructive suite. Two converted client records were confirmed lost with no recovery
source; the only dump available predated the relevant tables by nine migrations. **These records
were never recovered.** All verification now runs against uniquely-named disposable databases.

**`demm_crm_restoration_test` still exists** on the local server and holds a row-for-row
restoration of the removed dump. It is on the destructive-test **deny list**, because its name
ends in `_test` and would otherwise have satisfied the disposable-name rule. Disposition is a
Phase 0C decision.

---

## 5. Fully completed Phase 0 capabilities

All **locally verified**. None CI-verified or staging-verified.

**Governed action execution**
- The approval dead loop was proved with a failing regression test first, then fixed: approved
  high-risk tools now execute instead of staging a second approval.
- Migration `20260726134103_approval_requester_role_and_expiry` adds `requesterRole`,
  `expiresAt`, and an `EXPIRED` status.
- Resolution is one atomic conditional UPDATE carrying every precondition, so two concurrent
  resolutions cannot both win.
- Role gate on resolve (`WORKSPACE_ADMIN`, `ORG_ADMIN`, `ORG_OWNER`, `SUPERADMIN`), ordered after
  `WorkspaceGuard` because that is what populates `request.user.role`.
- Self-approval forbidden at the database claim boundary, not only by a pre-check.
- Runtime action validation via a DTO enum; only exact `APPROVE`/`REJECT` accepted.
- Full audit lifecycle with redacted payloads.

**Authentication and sessions**
- Refresh-token replay detection with user-scoped session-family revocation.
- Unknown tokens trigger no user-scoped action; all branches return an identical message.
- Four first-party BFF routes under `/api/session`.
- Refresh token held only in an httpOnly, SameSite=Lax cookie scoped to `/api/session`.
- Access token held only in memory; legacy `localStorage` keys purged on boot.
- Origin-vs-Host CSRF validation.
- Same-tab single-flight refresh, cross-tab coordination via Web Locks + BroadcastChannel.
- Logout propagates to every open tab.

**Workspaces**
- Explicit picker: one workspace auto-enters, several require a choice, zero shows an honest
  empty state. The first workspace is never silently selected.
- Switching fully re-establishes the backend session and rotates the cookie; all tabs follow.

**Honest UI**
- Fabricated dashboard automation, self-heal, and system-health claims removed.
- Backend failures can no longer render as zero data.
- Agent Console shows only real backend tools and real execution status.

**Repository safety**
- Obsolete tracked dump removed; archive patterns ignored.
- Two malformed Git stash artifacts backed up and removed; Git health restored.
- Live database-name guard plus explicit destructive-test opt-in.
- CI redesigned around an ephemeral database and `prisma migrate deploy`.

---

## 6. Verification evidence

Recorded on this branch, against disposable databases and local builds:

| Suite | Result |
|---|---|
| Agent approval regression | **46 / 0** |
| Auth security | **21 / 0** |
| HTTP verification | **22 / 0** |
| Workspace guard | **12 / 0** |
| Workspace controller security | **12 / 0** |
| Comprehensive backend | **19 / 0** |
| Repository safety | **43 / 0** |
| T7 session routes (frontend) | **25 / 0** |
| T8 session orchestration (frontend) | **15 / 0** |
| T9 workspace selection (frontend) | **44 / 0** |
| T10+T11 honest frontend | **36 / 0** |
| Backend full `npm run verify` | exit **0** |
| Backend lint / typecheck | exit **0** / **0** |
| Frontend lint | exit **0** — 0 errors, **7 pre-existing warnings** (unused imports) |
| Frontend typecheck | exit **0** |
| Frontend production build | exit **0**, production-config guard ✅, no-localhost bundle guard ✅ |

**Development-database integrity**, recorded before and after every disposable run:

```
before: {"database":"demm_crm","appliedMigrations":12,"branchTables":6,"stripePriceMappingRows":6,"offerRows":6}
after:  {"database":"demm_crm","appliedMigrations":12,"branchTables":6,"stripePriceMappingRows":6,"offerRows":6}
[dev-db-integrity] UNCHANGED=true
```

Explicitly **not** verified:

- **Real CI has never run.** The rewritten workflow is inspection-verified only.
- **Deployed-staging frontend verification has never run.** `frontend npm run test:e2e` targets a
  deployed environment and was deliberately not run and not redirected, so the frontend
  `npm run verify` chain has never completed end to end.
- **Production has never been verified.**
- Cross-tab session behaviour was confirmed by real-browser observation with genuine tabs, **not**
  by an installed automated browser harness.

---

## 7. Security decisions

- Self-**approval** is forbidden. Self-**rejection** is allowed and treated as cancellation.
- Only exact `APPROVE` and `REJECT` are accepted; anything else is a 400.
- Approval resolution is atomic at the database.
- Execution is **at-most-once**, not durable exactly-once. A crash between claim and execution
  leaves an approved-but-unexecuted record.
- Auditing is **not** transactionally coupled to execution. Audit writes are best-effort and
  ordered so a failed audit can never undo a security action.
- A replayed rotated refresh token revokes that user's active refresh sessions.
- An unknown token can never trigger user-scoped revocation.
- **Already-issued access tokens remain valid until expiry (15 minutes)** even after family
  revocation.
- Refresh token stays in the httpOnly cookie; access token stays in memory only.
- Requests retry exactly once on 401; `api/auth/*` is excluded by prefix.
- Tabs coordinate refresh and logout.
- Multi-workspace users must choose explicitly.
- Workspace switching currently requires password re-entry.
- Fabricated AI, automation, recovery, and system-health claims are prohibited in the UI. **Do not
  reintroduce them.**

---

## 8. Known limitations and defects

### Authentication and workspaces
- Workspace switching requires password re-entry.
- No authenticated endpoint lists a user's memberships (`GET /workspaces` is SUPERADMIN-only;
  `req.user.memberships` is loaded in `jwt.strategy.ts` and exposed by nothing).
- No password-free workspace-switch endpoint.
- The current workspace **name** is unavailable after refresh — the payload carries `workspaceId`
  and `role` only, so the sidebar cannot name the active workspace.
- The no-Web-Locks fallback lock is best-effort; two tabs can interleave between its read and write.
- Access tokens outlive family revocation until they expire.

### Approvals and Agent
- At-most-once execution, not durable or resumable.
- Audit not transactionally coupled.
- Expiry is lazy — evaluated on resolve, not by a sweeper.
- No requester-cancellation route for standard users.
- Four agent endpoints still read raw body properties instead of DTOs (`execute`, `plan/preview`,
  `execute/cancel`, and the `sessionId` parameter), bypassing the global `ValidationPipe`.
- `POST /agent/plan/preview` is **fabricated**: it keyword-matches the description and returns
  hard-coded steps inventing a contact. Deliberately not surfaced. **Do not expose it.**
- The agent tool registry publishes no parameter schemas, so the console cannot tell a user which
  fields an action needs.
- No cancel-session UI.
- No approval inbox — approvals can be created from the UI but only resolved via the API.

### Dashboard and frontend
- The backend dashboard brief string still emits **"No automations failed today."**
  (`backend/src/modules/dashboard/dashboard.service.ts`). The frontend no longer renders that
  string, so nothing false reaches the screen, but the backend should stop asserting it.
- The workflow engine does not exist (0 models, 0 services, 0 endpoints).
- The guided workflow builder does not exist.
- The Contacts page crashed the browser tab once during verification and **was not investigated**
  — it was outside that task's authorized scope.
- Cross-tab behaviour is browser-observed, not covered by an installed automated harness.
- Deployed-staging frontend verification outstanding.

### Repository and operations
- The removed dump's blob **remains reachable in Git history** via commit `4ff53c8`.
- The Communications worktree retains its own byte-identical copy of that dump.
- `demm_crm_restoration_test` remains present.
- `verify-comprehensive.ts` still performs a guarded global wipe (21 unscoped `deleteMany()`).
- `test-isolation.ts` retains a hard-coded development fallback URL — now unreachable, because the
  guard refuses when `DATABASE_URL` is unset and denies `demm_crm` when it is set.
- CI changes have never run remotely.
- Seven inert duplicate `.git` artifacts remain.
- The host-level duplicate-file mechanism remains unidentified (§9).
- Generated Next type files were duplicated during verification and briefly broke `tsc`.
- No history rewrite has occurred.

### Product gaps
- The Communications + Stripe branch is unmerged (95 files, ~5,600 lines, 2 migrations).
- Stripe is not proven end to end on this mainline.
- SMS and email are not complete on this mainline.
- The unified inbox is not complete on this mainline.
- Invitations and team management are incomplete — the `Invitation` model exists but **no invite
  flow does**, so a teammate cannot currently be added.
- No workflow engine, no AI planner, no launch packs.

---

## 9. BLOCKER — host-level file duplication

**Unresolved. Must be handled before any baseline tag.**

Observed facts:

- Files suffixed `" 2"`, `" 3"`, `" 4"` appeared inside `.git`, created across five days
  (2026-07-20 → 07-24), all with mode `0600`.
- **Two of them were malformed refs that genuinely broke Git**: `.git/refs/stash 2` and
  `.git/logs/refs/stash 2`. `git log --all` exited 128 and `git fsck --full` reported four errors.
- Those two were backed up externally and removed; Git health is now clean.
- **Seven inert duplicates remain** and cause no errors.
- **The mechanism is still active.** During later verification, duplicated generated files
  appeared under `frontend/.next/types/` and broke `tsc --noEmit` until the next build regenerated
  the directory. Duplicates are currently present throughout `frontend/.next` and `backend/dist` —
  all gitignored, none tracked, none able to enter a commit.

**The cause is unidentified.** The `" N"` naming is consistent with filesystem copy/sync collision
handling, but **no specific application has been evidenced, and none should be blamed without
evidence.**

**Risk:** the artifacts that mattered were inside `refs/` and `logs/refs/` — the directories Git
enumerates. If the mechanism ever duplicates a file under `refs/heads/`, the consequence is worse
than a broken stash ref.

Phase 0C must identify, stop, or safely contain this mechanism before the baseline is tagged.

---

## 10. Dump and recovery truth

- `backend/test_backup.dump` was an obsolete fixture snapshot of the **development** database
  (despite its filename) — 31 rows across 18 tables, one migration applied.
- It contained synthetic test identities, one real bcrypt hash, and eight refresh-token hashes.
- **It had no T3.3 recovery value** — every table involved in that incident was absent from it.
- It was removed from the working tree in commit `0956183`.
- `*.dump`, `*.pgdump`, `*.backup` and `.gz` variants are now ignored repository-wide.
  **`*.sql` is deliberately not ignored** — Prisma migration SQL is legitimate tracked source.
- **The blob remains in Git history** via commit `4ff53c8`, which introduced it 82 seconds after
  it was written.
- `demm_crm_restoration_test`, a live restoration of the same archive, still exists.
- The unmerged Communications worktree retains its own copy.
- **No history rewrite was approved or performed.**

---

## 11. Architecture and memory boundaries

**DOM26-R — tenant-controlled relationship memory (in-app).** Provenance, consent, approval,
correction, deletion, and customer relationship context. Models exist (`Engram`,
`MemoryCandidate`, `ConsentDirective`, `RelationshipBrief`, and related) with four controllers.
Customer-level memories are tenant data and belong here, never in builder-side memory.

**DOM26 v3 — organization-level memory (external).** Safe decisions, commitments, incidents, and
operational summaries. **Never** raw tenant content, credentials, tokens, identities, or database
rows.

**G-Brain — builder-side engineering knowledge.** Evidence, architecture decisions, tradeoffs,
tests, retrospectives.

**Superpowers — execution process.** Plan → test first → implement → verify → report.

**G-Stack — review gates.** Architecture, security, code, UI, release.

Status, stated plainly:

- **No remote DOM26 v3 capture has been confirmed.** Notes were drafted for later review only.
- **No remote G-Brain capture has been confirmed.**
- **No G-Stack review gate has run.** Do not claim one.
- No DOM26-R tenant memories, engrams, or candidates were created during Phase 0.
- Customer data, tokens, credentials, raw database rows, and tenant content must never enter
  builder-side memory.

---

## 12. Phase 0C mandatory gate

1. Investigate and contain the host duplicate-file mechanism (§9).
2. Re-run Git health after containment.
3. Decide the disposition of: `demm_crm_restoration_test`; the historical dump blob; the
   Communications worktree's dump copy; the external malformed-ref backups; the seven inert
   duplicate `.git` artifacts.
4. Trigger a real CI run.
5. Prove in that run: ephemeral `demm_crm_ci`; live database-name preflight; `prisma migrate
   deploy`; no `db push`; explicit destructive-test opt-in; full verification.
6. Deploy the preserved branch to a verified staging environment.
7. Run deployed-staging frontend verification.
8. Run safe staging backend verification.
9. Verify on staging: login · workspace selection · reload restoration · multi-tab refresh ·
   workspace switching · cross-tab logout · replay detection · approval paths · honest dashboard ·
   honest Agent Console.
10. Review logs.
11. Prove development-database integrity.
12. Produce a final diff inventory.
13. Run an independent security and architecture review.
14. Commit approved Phase 0C corrections.
15. Push the final approved baseline branch.
16. Create a baseline tag **only** after Product Manager approval and complete evidence.
    **Do not assume a tag name.**

---

## 13. Post-Phase-0 roadmap

1. T9.1 workspace capabilities (membership list, password-free switch, workspace name)
2. Communications + Stripe branch reconciliation
3. Stripe completion
4. Twilio SMS completion
5. Email and inbound reply completion
6. Consent and unified inbox
7. Invitations and team management
8. Approval inbox
9. Agent tool schemas
10. Durable workflow infrastructure
11. Integration action layer
12. Workflow definitions and versioning
13. Triggers, conditions, branches, delays, approvals, simulation
14. Governed DOM26-R
15. Real LLM platform
16. AI workflow planner
17. Guided workflow builder
18. Photo booth launch pack
19. Marketing agency pack
20. Barber pack
21. Consultant/coach pack
22. Production hardening
23. Internal alpha
24. Pilot
25. General launch

---

## 14. Core files and folders

Every path below was confirmed to exist on this branch.

**Authentication**
`backend/src/modules/auth/auth.service.ts` · `backend/src/modules/auth/auth.controller.ts`

**Agent and approvals**
`backend/src/modules/agent/agent.service.ts` (largest, most security-critical file) ·
`backend/src/modules/agent/agent.controller.ts` ·
`backend/src/modules/agent/dto/resolve-approval.dto.ts`

**Tenancy guards**
`backend/src/common/guards/jwt-auth.guard.ts` · `workspace.guard.ts` · `roles.guard.ts`

**Data**
`backend/prisma/schema.prisma` (59 models) · `backend/prisma/migrations/` (10 directories)

**Test-database safety**
`backend/test-db-guard.ts` · `backend/test-repo-safety.ts`

**Backend verification**
`backend/verify-comprehensive.ts` (guarded global wipe) · `backend/verify-http-staging.ts`

**Frontend BFF routes**
`frontend/src/app/api/session/` — `login`, `select-workspace`, `refresh`, `logout`, `_lib/`

**Frontend session modules**
`frontend/src/lib/session/client.ts` · `coordination.ts` · `SessionProvider.tsx`

**API wrapper**
`frontend/src/lib/api.ts`

**Workspace UI**
`frontend/src/components/WorkspacePicker.tsx` · `frontend/src/components/WorkspaceSwitcher.tsx`

**Honest UI logic**
`frontend/src/components/dashboard/dashboardState.ts` ·
`frontend/src/components/agent/agentStatus.ts` · `frontend/src/app/dashboard/page.tsx` ·
`frontend/src/app/agent/page.tsx`

**CI**
`.github/workflows/ci.yml`

**Evidence**
`docs/superpowers/plans/2026-07-26-phase-0-baseline-truth.md` — the full T1–T14 record and the
single source of truth for how each result was obtained.

**Unmerged work**
`.claude/worktrees/phase-2-lead-to-client-core` — Communications + Stripe.

---

## 15. Takeover instructions

1. Read this file end to end.
2. Read `docs/superpowers/plans/2026-07-26-phase-0-baseline-truth.md`.
3. Confirm branch, HEAD SHA, worktrees, and Git health before touching anything.
4. **Never run a destructive suite without a verified disposable database and
   `ALLOW_DESTRUCTIVE_TESTS=true`.** The guard will refuse `demm_crm`; do not work around it.
5. **Do not expose the fabricated `POST /agent/plan/preview` endpoint.**
6. **Do not merge the Communications worktree casually** — it carries two migrations already
   applied to the development database, which is the source of the migration-count drift.
7. **Do not claim CI, deployment, memory capture, or a G-Stack review without evidence.**
8. Begin with **Phase 0C** (§12). Do not start roadmap work first.

---

## 16. Verified staging environment and deploy pipeline

*(Restored from `origin/main`'s handoff and **re-verified live** during Phase 0C. Secret values are
never read or printed — only names.)*

| Item | Verified value |
|---|---|
| GCP project | `gen-lang-client-0096028843` |
| Staging backend | `demm-crm-backend-staging` (Cloud Run, us-east1) — **HTTP 200** |
| Staging frontend | `demm-crm-frontend-staging` (Cloud Run, us-east1) — **HTTP 200** |
| Deployed revisions | backend `…-00016-9d2`, frontend `…-00007-l4c`, both 100% traffic |
| Deployed commit | `d0d0b26…` on both — i.e. **`origin/main`**, *not* the Phase 0 work |
| Staging DB | Cloud SQL `demm-crm-staging-db`, POSTGRES_16, **RUNNABLE** |
| Secrets configured (names only) | `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Deploy pipeline | `scripts/deploy-staging.sh deploy --commit=<sha> [--dry-run] [--yes]` |

**Deploy identity.** Only one gcloud account has real access to this project. Several identities
exist on this machine; the *active* one is an unrelated service account with **zero** access here.
Always confirm `gcloud config get-value account` before trusting a "permission denied" or "not
found" result — that has already produced a false negative once.

### Standing constraints carried forward from `origin/main` (still binding)

1. **No production deployment and no live-mode Stripe activity.** Test mode / staging only.
   `StripeEnvironmentGuard` enforces it in code and it is also a standing human instruction.
2. **`ClientAccountService.convert()`'s transaction body** may only be touched in the one
   already-reviewed way. Do not reopen it.
3. **Claude never types, views, or handles real credential values.** Typing into a password field
   via browser automation and writing auth-token-shaped `localStorage` keys were both refused
   outright by the sandbox in an earlier session. **Do not retry either.** The established pattern
   is: create a throwaway user, hand the credentials to the human, and have them log in so Claude
   can verify visually afterwards.
4. **`.env` files are never read directly.** Preload them blind into a child process instead.
5. **`APP_ENVIRONMENT=staging` must be set explicitly** for any staging-targeted provisioning run.
   Omitting it silently creates a mapping the staging backend cannot see.

### Pre-existing staging issues inherited, not caused by Phase 0

- **Staging browser login fails with "Failed to fetch"**, reproduced twice, on the currently
  deployed `d0d0b26`. Server side was independently verified clean (curl login succeeds, CORS
  correct, correct API URL baked into the live bundle, 100% traffic on the right revision).
  **Note for whoever picks this up:** the deployed build predates Phase 0's session architecture.
  Phase 0 moves login from a cross-origin call to a same-origin first-party `/api/session/login`
  route, which plausibly removes this failure mode entirely. That is a hypothesis, not a finding —
  it cannot be confirmed until the Phase 0 code is actually deployed.
- **Throwaway walkthrough fixtures are still live on staging** (an org, workspace, user, offer and
  its Stripe price mapping) and are owed cleanup. Delete `StripePriceMapping` before `Offer` — an
  FK ordering bug was already hit once there.

---

## 17. Phase 0C-R status — foundation remediated; one human gate remains

### Fixed since the last handoff

**Refresh-token amplification (security).** `refreshToken()` read the row, checked
`revoked`, then wrote `revoked = true` as a separate unconditional UPDATE keyed only on
`id`. Concurrent requests with the same token all passed the read and all minted a
session. Measured against real PostgreSQL with 8 concurrent callers:

| | before | after |
|---|---|---|
| requests that succeeded | **8** | **1** |
| unrevoked tokens afterwards | **8** | **1** |

Rotation is now a conditional claim (`WHERE id = ? AND revoked = false`). Losing the
claim returns a generic 401 and is deliberately *not* treated as theft — a thief has no
reason to race the victim, and revoking would log out a legitimate second tab. Genuine
replay (an already-rotated token) still triggers full user-scoped family revocation.

**Refresh oracle removed.** A refresh whose membership had been revoked answered "User
is not a member of this workspace", confirming the token was otherwise valid. It now
returns the same generic 401 as every other refusal.

**CI coverage.** Previously CI ran only `npm run verify`. It now also runs the
atomic-refresh, approval, auth-security, workspace-guard, and workspace-controller
suites, plus an entire **frontend job**: lint, typecheck, production build with both
release guards, and T7/T8/T9/T10-T11. All 15 were verified present in the run log, not
assumed.

**Vercel.** Was failing on every commit including main (`next build` at the monorepo
root → "Couldn't find any `pages` or `app` directory"). `vercel.json` now sets
`git.deploymentEnabled: false`. This repo deploys to Cloud Run; a Vercel build would
create an unmanaged duplicate frontend. **Owner action still available:** fully
disconnecting the integration in the Vercel dashboard.

**A CI-only defect the new frontend job caught immediately.** `test:session-routes` was
the only frontend suite invoked without `TS_NODE_COMPILER_OPTIONS`. Locally Node
reparsed it as ESM with a warning and it passed; on CI's Node 20 it was a hard
`ERR_UNKNOWN_FILE_EXTENSION`. Fixed.

### The one remaining gate — credentialed browser verification

Claude must not type real credentials; this was enforced by a hard sandbox refusal in an
earlier session. The 17-point checklist below must be run by a person. Everything else
in Phase 0C-R is complete and verified.


### Credentialed browser checklist — for the Product Manager

**Commit under test:** `bfa7449e36c7b851fa03d2ee771ff95060698af9`. Confirm at
`/api/version` on the staging frontend before starting (URL in §16).
**Revisions:** backend `…-00018-5d5`, frontend `…-00009-jkw`, both 100% traffic.
**Setup:** Chrome or Safari, **two tabs, same profile** (not incognito for the cross-tab
checks). Keep **Console**, **Network** (preserve log on), and **Application → Storage**
open the whole time.

**Safe:** logging in, navigating, switching workspace, logging out, reloading, opening a
second tab, running a low-risk Agent action.
**Do not:** approve anything against real client records, convert or delete real records,
or run destructive Agent actions. If the only account available holds real client data,
do 12–15 read-only and mark the rest N/A rather than mutating anything.

| # | Check | Pass/Fail |
|---|---|---|
| 1 | Login succeeds | |
| 2 | One-workspace account enters directly | |
| 3 | Multi-workspace account shows the picker (N/A if none) | |
| 4 | The workspace you chose becomes active — not the first listed | |
| 5 | Reload restores the session | |
| 6 | Second tab restores the session | |
| 7 | **Use both tabs actively for ~2 minutes — no unexpected logout.** This is the one that exercises today's atomic-rotation fix | |
| 8 | Workspace switch works (it asks for your password — expected) | |
| 9 | The other tab follows the switch | |
| 10 | Logout in one tab logs out the other | |
| 11 | Storage: no access/refresh token in localStorage, sessionStorage, or Cookies; none in any URL | |
| 12 | Dashboard shows real values; honest empty state if you can reach a zero-data workspace; honest unavailable state with DevTools offline — **never zeros for an error** | |
| 13 | Agent Console lists only real tools, offers no plan preview, shows approval-required as **not executed**, shows errors as errors | |
| 14 | Contacts page navigation does not crash | |
| 15 | Agent history shows detail **names** only, never values | |
| 16 | Console has no unhandled auth or cross-tab errors | |
| 17 | Network shows no repeating refresh loop | |

**Return:** date/time, browser, the commit SHA, 17 pass/fail lines, and redacted
screenshots or console/network excerpts for anything that fails. **Redact any token,
cookie, email, or client name before sending.**

Check 7 matters most today: before this build, two tabs refreshing at the same moment
could each mint a session from one token. Now exactly one wins and the other retries.

---

## 18. Phase 2 — the gaps that made the product unusable for a team

Branch `phase2/agent-contract-and-honesty`, PR #5, CI run `30295741309` (both jobs green,
all 15 suites present in the log). Not merged at time of writing.

### Fabrications removed

- `POST /agent/plan/preview` **deleted**, not hidden. It advertised a planner and
  keyword-matched the description: "wedding" returned two hard-coded steps, one of which
  created a contact ("Sarah Wedding-Lead", sarah@wed.com) the user had never mentioned.
  It was reachable by any token holder and had no route to becoming correct.
- The dashboard brief no longer asserts **"No automations failed today."** There is no
  automation engine; the line reported the absence of failures in a system that cannot
  fail. A comment in `dashboard.service.ts` says why it must not return.

### Closed defects

| Was | Now |
|---|---|
| `execute` / `execute/cancel` bound raw body properties, bypassing the ValidationPipe. Missing `toolName` → `404 Tool undefined not found`; missing `sessionId` → `201 CANCELLED` having cancelled nothing | Whole-body DTOs; `whitelist` + `forbidNonWhitelisted` apply |
| `GET /agent/tools` published no parameter schemas | Every tool publishes name/type/required/description per parameter, plus `canRequireApproval` |
| Workspace switching required the password again | `GET /api/auth/memberships` + `POST /api/auth/switch-workspace` |
| Session payload carried `workspaceId` and role only | Also carries `workspaceName` and `organizationName`; the sidebar shows the active workspace |
| `Invitation` model existed with **zero** code referencing it | Six `/team` endpoints + `POST /team/invitations/accept`; token hashed at rest, returned once |
| No endpoint listed approvals | `GET /agent/approvals`, member-readable, PENDING first, DTO-validated status filter |
| A requester could not withdraw their own request | `POST /agent/approvals/:id/cancel`; `CANCELLED` is a distinct terminal state |
| No UI for any of the above | `/approvals`, `/team`, `/invite` |

### Last-owner protection needed a lock

Removing or demoting the final `ORG_OWNER` orphans a workspace. The rule is a
check-then-act, and under READ COMMITTED two transactions removing *different* owners
each see the other's row still present, both count two, and both commit. Same shape as
the Phase 0C-R refresh-token amplification, same answer: `SELECT ... FOR UPDATE` on the
Workspace row.

**Proven by mutation:** with the lock removed, three concurrent removals all succeed and
the workspace is left with **zero owners**. With it, one always remains.

### Migrations

- `20260727180000_invitation_token_hash_and_provenance` — replaces plaintext `token` with
  `tokenHash`, adds `invitedById` / `acceptedById` / `acceptedAt`, adds `REVOKED`.
  **Deletes existing Invitation rows**: a plaintext token cannot become a hash and stay
  verifiable. Safe because nothing had ever created one.
- `20260727190000_approval_cancelled_status` — additive enum value.

Both ship rollbacks stating what they cannot restore. Applied only to
`demm_crm_phase2_test`; **`demm_crm` is untouched at `applied=12 tables=73`**.

### Also fixed in passing

- `test-refresh-concurrency.ts` used fixed subdomains and deleted nothing, so it could
  only ever run **once** against a given database. Invisible on CI, where the database
  dies with the job. Now run-scoped with teardown, verified by running it twice.
- `test-workspace-selection.ts` called `teardownSession()` at the end of `main()` rather
  than in a `finally`, so any throw left the refresh timer pending and the suite **hung
  instead of failing**.
- `start:prod` ran `node dist/main`, which does not exist. Because the root-level
  `test-*.ts` / `verify-*.ts` files are inside the compile, TypeScript's common source
  root is `.` and the entry is `dist/src/main.js` — which the Dockerfile has always used,
  so deploys were unaffected and only the npm script was dead.

### Known limitations carried out of Phase 2

- **The three new pages have not been exercised in a browser.** They are type-checked and
  production-built, and their data contracts are covered by 77 backend assertions against
  a real PostgreSQL instance, but that is not the same as proving the React renders. The
  preview tooling in the authoring session was pinned to the quarantined Desktop checkout
  (§9), not to the release clone, so no click-through was possible.
- **No email delivery.** An invitation produces a link the administrator sends themselves.
  The `/team` page says so rather than implying a message was sent.
- **A brand-new person must create an account before accepting.** `register` always
  creates a new Organization and Workspace, so an invitee ends up with a spare workspace
  alongside the one they were invited to. Acceptance itself works; the tidy path
  (`register` with an invitation token) is not built.
- **Approval expiry is still lazy** — evaluated on the next resolve attempt, not swept.
- Phases 3–11 of the finishing plan are untouched. The workflow engine still does not
  exist, and no launch pack exists.

---

## 19. Memory and review receipts — actually captured

Earlier reports in this effort said `PREPARED LOCALLY — REMOTE CAPTURE NOT CONFIRMED`.
That was wrong, and the correct word was "untried", not "unavailable". The documented
mechanisms work.

### DOM26 v3 — reachable

`GET https://intelligence.demmmarketing.com/health` → `200`,
`{"status":"online","engrams":62468,"version":"3.0.0","stack":"pgvector+ollama"}`.
Direct IP (`34.138.159.127:8004`) times out, exactly as CLAUDE.md documents; the
domain is the canonical path.

Captured engrams, domain `DEMM`, all embedded:

| id | subject | salience |
|---|---|---|
| `eng_a7d0672c73` | Team-authorization privilege escalation found and fixed | 0.95 |
| `eng_d9f31052ba` | Destructive invitation migration replaced with in-place backfill | 0.90 |
| `eng_dd7f19b486` | Replay-detection residual risk accepted with measurements | 0.92 |

No tenant content, credentials, tokens, hashes, emails or customer data was sent.

### G-Brain — reachable

`mcp__gbrain__*` is available through ToolSearch. Page
`demm-crm-phase2-security-decisions` written, 2 chunks embedded. `auto_link` and
`auto_timeline` reported `skipped: remote` and `write_through` reported
`no_repo_configured` — server-side configuration, not a failed write.

### G-Stack — skills on disk, partially registered

`~/.claude/skills/gstack/` contains `review`, `cso`, `qa`, `qa-only`,
`design-review`, `devex-review`, `health`, `careful`, `plan-*-review` and others.

- `gstack` (router) and `review` ARE registered with the Skill tool and were invoked.
- `cso` exists on disk with valid frontmatter but is NOT registered in this session;
  it was executed by reading and following the skill file directly.

**Gates executed against `05b6d5d` → `f7d3051`:**

| Gate | How | Result |
|---|---|---|
| gstack router | Skill tool | routed to `/review` |
| `/review` | Skill tool | 1 HIGH finding, fixed |
| `cso` security sweep | skill file followed directly | 1 NOT A FINDING, rest clean |

**Findings:**

- **HIGH — fixed (`f7d3051`).** `acceptInvitation` created a membership with no
  existing-membership check. An invitation issued before the person joined by
  another route stays PENDING; accepting it violated
  `@@unique([userId, organizationId, workspaceId])` → P2002 → HTTP 500. Because
  acceptance is one transaction, the status claim rolled back too, so the
  invitation returned to PENDING and every retry failed identically — a
  permanently stuck link reporting a server error. Proven by mutation: 500
  without the guard, 400 with it. Regression assertions 35a/35b added.
- **NOT A FINDING.** `stripe-webhook.controller.ts` is the only unauthenticated
  mutating surface. It fails closed when `STRIPE_WEBHOOK_SECRET` is absent,
  requires the `stripe-signature` header, and verifies via
  `stripe.webhooks.constructEvent`.
- **Clean.** No raw token or hash reaches a log or an audit payload; `tokenHash`
  never leaves the service; no tenant table is read by id alone without a
  workspace scope.
- **Process note.** A grep for `WorkspaceGuard` gave a false negative on
  `invitation.controller.ts` because the word appears in a comment there. The
  absence of that guard on `POST /team/invitations/accept` is deliberate and
  documented — an invitee has no membership yet.

### Still not run

`/qa`, `/design-review`, `/devex-review`, `/health`, and the accessibility gate.

---

## 20. Invitation acceptance — idempotent and terminal (`26e8715`)

CI run `30326569865`: all three jobs green.

### Three states of one bug

| Version | Symptom | Why it was still wrong |
|---|---|---|
| v1 | HTTP **500** | `membership.create` hit `@@unique([userId, organizationId, workspaceId])` |
| v2 (`f7d3051`) | HTTP **400** | the `throw` sat INSIDE the transaction, rolling the status claim back — invitation returned to PENDING and every retry failed identically |
| v3 (`e7e0a54`) | HTTP **200** + outcome | conflict-safe insert; invitation always terminal |

v2 also missed a **second race entirely**: two DIFFERENT pending invitations for
the same user and workspace. Each accept claims its OWN row, so both claims
succeed; both then read "no membership" and both insert. Measured: statuses
`201` and `500`, with the second row stuck at PENDING.

### Why read-then-create cannot work here

The read is not the arbiter. Any check-then-act across two different rows has a
window where both actors observe the same pre-state — the same shape as the
last-owner rule (`SELECT ... FOR UPDATE`) and refresh-token rotation
(conditional UPDATE). Here the arbiter already existed: the compound unique
index.

`INSERT ... ON CONFLICT DO NOTHING`, with the affected row count deciding the
outcome. No exception, so the claim always stands. `DO NOTHING` and never
`DO UPDATE`: an old invitation must not rewrite an existing membership's role.

### Contract

| outcome | meaning | HTTP |
|---|---|---|
| `JOINED` | created a new membership | 200 |
| `ALREADY_MEMBER` | account already had access; role unchanged | 200 |
| `ALREADY_ACCEPTED` | same account retried a consumed link | 200 |

200 rather than 201 because the endpoint is idempotent — 201 asserts creation,
true only on the JOINED path. The `outcome` field carries the distinction.
No contract depended on 201: the route shipped in this unreleased phase and its
only caller (`frontend/src/lib/api.ts:354`) treats any 2xx as success.

### Evidence

`test-invitation-acceptance.ts` — 33 assertions, **11 failing beforehand**.
Mutation: with `ON CONFLICT DO NOTHING` removed, assertion 9 → 500,
assertion 29 → `200,500`, assertions 11 and 31 → rows stuck at PENDING.
Restored: 33/33.

Suites updated to the new contract: `test-team-management.ts` 25/30/35a,
`test-invitation-migration.ts` 21.

### Memory receipts

- DOM26 v3: `eng_c965e53805` (this fix), `eng_d2c70ca4d5` (the G-Stack finding)
- G-Brain: `demm-crm-invitation-acceptance-idempotency` (2 chunks)

### Remaining before merge — NOT done

- Browser journeys: invitation end-to-end, UI role changes, cross-tab, approval
  filtering, contacts. Current suite is 6 journeys / 26 controls.
- All accessibility and keyboard testing.
- G-Stack gates not yet run: `/qa`, `/design-review`, `/devex-review`, `/health`.
- Phase 0 tag `v0.1.4-phase0-baseline` absent; PR #5 unmerged; no staging deploy.
- Communications Core not started.

---

## 21. Strict same-link idempotency (`5442356`, `b90753d`)

### "Does not crash" was not idempotent

Six simultaneous requests for the SAME link by the SAME person produced one 200
and several 400s — the loser of the conditional claim threw:

```
new member      -> 200,400,400,400,200,200
existing member -> 200,400,400,400,400,200
```

Every one had the same intent and the same correct end state.

**Fix:** on claim loss, re-read inside the transaction; when the row is ACCEPTED
by this same `userId`, return `ALREADY_ACCEPTED` rather than throwing. Consumed
by anyone else, revoked, or expired still refuses, with the same generic message
so a caller never learns who used it.

Contract, all HTTP 200: exactly one `JOINED` or `ALREADY_MEMBER`, every loser
`ALREADY_ACCEPTED`, one membership, **one** acceptance audit, invitation terminal.

### `hasAccess` / `role` come from the membership, never the invitation

The old code fell back to `invitation.role`. An evicted user reopening their
link was told they still held `ORG_OWNER`. The invitation records what was
*offered*, not what is *held*. Now `hasAccess:false`, `role:null`, and the
membership is **not** recreated — an administrator's removal stands.

### The downstream defect this exposed

`/invite` discarded the response: call, `setPhase DONE`, redirect. Once 200 also
meant "already used, no access", it announced **"You are in"** and dropped an
evicted user into a workspace they cannot open. Now reads `hasAccess` and renders
a distinct `NO_ACCESS` state.

**Lesson:** widening a contract is not backwards-compatible just because the
status code didn't change. Grep the callers before shipping the widening.

### Evidence

`test-invitation-acceptance.ts` 53/53 (20 new assertions 34–53, **6 failing
beforehand**). Mutation: re-read removed → `400,200,400,400,200,200` and
`400,200,400,400,400,400`. Restored → 53/53.
Backend: team 56/0, team-authz 32/0, invitation-migration 24/0, lint/build clean.
Frontend: typecheck clean, production build clean with both guards.
CI `30364270826` green on `5442356`.

### Receipts

DOM26 v3 `eng_b300831cc0` · G-Brain `demm-crm-strict-idempotency-and-honest-clients`

### Still outstanding

G-Stack `/qa`, `/design-review`, `/devex-review`, `/health`; full browser
journeys (6 / 26 controls); all accessibility and keyboard testing; Phase 0 tag;
PR #5 merge; staging deploy; Communications Core.

### 21a. Invitation browser journey — WIP, declared not coverage

`frontend/e2e/invitation.spec.ts` exists and is marked `test.fixme` — **not**
`skip`. Both journeys time out on the first `fill()` on the Team page; cause not
yet identified.

`fixme` is deliberate: it reports as expected-to-fail rather than vanishing
silently from the run. **Do not count this file as coverage until it runs.**

What it will prove, and why it matters: the `/invite` page rendering
`hasAccess:false` honestly. That behaviour is proven at the API layer (53
assertions) but the browser gap is exactly what let the "You are in" defect ship
to an evicted user. Browser UAT remains **6 journeys / 26 controls**.

---

## 22. P1 — a brand-new teammate cannot accept an invitation

**Found by removing the `fixme` and letting the browser journey run.** This is a
product defect, not a test defect, and it blocks PR #5.

### Root cause

Login is two-step: password → `preAuthToken` → **select workspace** → access
token. An invited person who belongs to no workspace yet has nothing to select,
so no access token is ever issued.

`/invite` gates on `getAuthToken()` (`src/app/invite/page.tsx:48`) and the
backend route is behind `JwtAuthGuard`. Both require an access token the invitee
can never obtain. They are bounced to `/`.

The exact person invitations exist for is the one person who cannot use one.

### Evidence

Browser snapshot at failure — the invitee is on the login page, not `/invite`:

```yaml
- main:
  - heading "DEMM CRM"
  - paragraph: WELCOME BACK TO THE FUTURE
  - textbox "Email address"
  - textbox "Password"
  - button "Sign In"
```

Trace, screenshot and console preserved under
`frontend/test-results/invitation-an-invited-pers-*/`.

**Ruled out first, with evidence, before concluding this:** the `/team` page
renders correctly on full navigation (URL `/team`, `data-session-state`
`AUTHENTICATED`, email input count 1), and `fill()` succeeds in **12ms** and
**48ms**. The original 60s timeout was a stale server holding port 3101 from a
prior run, not a locator or hydration problem.

### Fix options — needs an owner decision

1. **Issue a workspace-less access token** when an account has no memberships
   (no `workspaceId` claim), so it can reach `/invite` and nothing else.
   Preserves "possession of the link is necessary but not sufficient".
2. **Accept the `preAuthToken`** on `/team/invitations/accept` only.
   Smaller blast radius; adds a second credential type to one route.
3. **Make acceptance public**, keyed on token + email match. Rejected: it drops
   the authenticated-recipient check that stops a forwarded link being used.

Recommendation: option 1.

### Status

`frontend/e2e/invitation.spec.ts` is committed **without** `fixme` and **fails**.
That is deliberate. CI going red is the correct signal while a core journey is
broken — the same principle as the Gate 3 guard. Do not re-add a bypass to make
the pipeline green.

Browser UAT: **6 journeys / 26 controls passing**, 2 journeys failing on this P1.
