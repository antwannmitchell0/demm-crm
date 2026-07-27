# DEMM CRM — Technical Handoff

**Written:** 2026-07-27 · **Supersedes the previous handoff in full.**

> The previous version of this file was titled "Release 1.0", listed a GCP project, two staging
> URLs, a staging database instance, a "Baseline Backup Identifier", and a memory-sync API with a
> local token path. It then listed as "Core Next Steps" work that has since been completed. None
> of the environment claims could be verified from this repository, and the token path must not
> be published, so they were removed rather than carried forward.
>
> Nothing below is asserted unless it was checked against the repository, the database, or a
> recorded test run during this task.

---

## 1. Executive status

| Item | State |
|---|---|
| Phase 0 implementation (T1–T14) | **Complete** through repository safety remediation |
| Phase 0A — preservation | **Complete** |
| Phase 0B — documentation | **Complete** as of the commit adding this file |
| Phase 0C — seal | **Outstanding** |
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
