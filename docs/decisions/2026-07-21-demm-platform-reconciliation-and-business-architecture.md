# DEMM Platform — Source Reconciliation & Business Architecture

**Date:** 2026-07-21
**Repo audited:** `~/Desktop/demm CRM` (remote `github.com/antwannmitchell0/demm-crm`) — the actual NestJS + Next.js CRM foundation. Not `~/Demm OS` (old Express/Railway agent stack) or `DEMM-Ecosystem-Antigravity-Test` / `Kimi-K3-Test` (separate AI-tool build experiments, no live-deploy evidence).

---

## Verdict

The prior claim "frontend connected successfully to Cloud Run backend; auth + dashboard passed; Release 0.1.3 deployed and tested" does not hold up. Deployment image identity is **CANNOT VERIFY** (no `cloudbuild.yaml`, no deploy step in CI, no accessible GCP project matching the staging URLs found in source). Independent of that, the specific "frontend connects to Cloud Run" claim is **contradicted by the source itself**: the frontend hardcoded its API base URL to `http://localhost:3001/api` with no override mechanism anywhere in the repo.

---

## Part 1 — Source / deployment reconciliation

| # | Item | Answer |
|---|---|---|
| 1-2 | Branch / HEAD | `main` / `c847fee092fd6e146b79af93479d290c2c9af715` (2026-07-21 09:35:29) |
| 3 | Tag on HEAD | `v0.1.3-release` |
| 4-6 | Cloud Run image digests / commit SHA in image | **CANNOT VERIFY.** No `cloudbuild.yaml` anywhere in the repo. `.github/workflows/ci.yml` is build+verify only, zero deploy step. This machine's `gcloud` only reaches `begreat-app-493417` (unrelated project), no `run.services.list` permission even there. Neither Dockerfile embeds a git-SHA build arg/label — no traceability even with access. |
| 7 | Frontend API URL source (as found) | `frontend/src/lib/api.ts:1` — `const API_URL = 'http://localhost:3001/api';` — literal string. **Patched this session**, see below. |
| 8 | `NEXT_PUBLIC_API_URL` override (as found) | Did not exist anywhere in the repo. No `.env.example`/staging/production files at all. |
| 9 | Deployed frontend calls Cloud Run or localhost | Calls `localhost:3001` regardless of container — inside Cloud Run that's the container's own loopback; nothing listens there. |
| 10 | Audit source = deployed source | `backend/verify-gcp-staging.ts` / `frontend/test-pilot-e2e.ts` hit real-looking Cloud Run URLs (project `431876670120`, not accessible from here) but `test-pilot-e2e.ts` curls the backend directly and separately GETs the frontend's static HTML — it never exercises the frontend bundle's own API client. A PASS there does not prove frontend→backend connectivity. |

**Pattern flagged:** commit messages inflate what shipped. `71756d8 "feat(gcp): complete Release 0.1.3 Google Cloud Staging Deployment Sprint"` — diff is 7 files: two Dockerfiles, one `output: "standalone"` line, one verify script — no deploy automation ran. `2f07a42 "docs: complete Release 0.1.3 Final Internal Pilot Decision Package"` — diff is 8 lines. Treat "complete / Sprint / Gate" commit messages in this history as unverified until the diff is checked.

**Repo proliferation risk:** five folders look like "the DEMM Platform" on this machine: `~/Desktop/demm CRM` (real, canonical), `~/DEMM-Ecosystem-Antigravity-Test`, `~/Desktop/DEMM-Ecosystem-Kimi-K3-Test`, an archived copy under `~/_ARCHIVE-2026-07/`, and one nested inside `~/Desktop/ciara king foundation/DEMM-Ecosystem/`. They share a `docs/03-DEMM-PLATFORM-ARCHITECTURE.md` file but aren't git-linked to `demm-crm`. **Unresolved:** confirm the other four are abandoned before anyone archives/deletes them.

---

## Part 2 — Completed repository audit

| Area | Verdict | Evidence |
|---|---|---|
| Task module | COMPLETE | `modules/task/*` — full CRUD, workspace-scoped, cross-entity validation, guards applied |
| Workspace module | COMPLETE | `workspace.service.ts` — real `$transaction` creating workspace+pipeline+6 stages; `create` endpoint has no guard (open signup flow, likely intentional) |
| Company module | COMPLETE | full CRUD, workspace-scoped, guards applied |
| Guards | COMPLETE, applied | `jwt-auth.guard.ts`, `roles.guard.ts`, `workspace.guard.ts` used across 9 controllers. **Looseness:** `workspace.guard.ts:26` — no `x-workspace-id` header falls through to first membership with a truthy `workspaceId`. Unresolved whether intentional. |
| Decorators | COMPLETE | `current-user`, `current-workspace`, `roles` — all consumed |
| Middleware | COMPLETE | `correlation-id.middleware.ts`, wired in `app.module.ts:48` |
| Config validator | COMPLETE | `config.validator.ts` — fail-fast on missing/weak `JWT_SECRET`, `process.exit(1)`, called from `main.ts:9` |
| Audit redactor | COMPLETE | `audit-redactor.ts` — real recursive redaction of sensitive keys; called in `agent.service.ts:207,265` |
| Frontend agent pages | **STUB — no real LLM** | `agent/page.tsx:73-110` — pure keyword `if/else` matching, comment: `// Fallback simulated call or default dashboard`. Backend `agent.service.ts` tool registry is the same rule-based dispatch. Zero `anthropic`/`openai`/`@google/generative` SDK anywhere in `backend/src`. |
| Frontend pipeline pages | COMPLETE | real API calls, live Kanban, no placeholder data |
| Sidebar | PARTIAL | hardcoded nav array, identical for every role — no RBAC filtering despite `Role`/`permissions` existing |
| Migrations | COMPLETE | one squashed migration, 17 tables, matches `schema.prisma` 1:1 |
| Docker config | PARTIAL | both Dockerfiles present; no `docker-compose.yml` anywhere |
| CI/CD | PARTIAL | one workflow file, build+verify only, no deploy job |
| Deployment env config | **MISSING** (as found) | zero `.env.example`/staging/production files repo-wide; only an untracked live `backend/.env`. Frontend `.env.example` added this session. |
| Dashboard self-healing | **STUB** | `dashboard/page.tsx:45-52` — comment `// Simulate AI Agent executing healing tool`, bare `setTimeout(..., 2500)`, no API call, hardcoded success text regardless of real state |

---

## Part 3 — Business unit profiles

**Known** (from CLAUDE.md + this repo's git history):
- **DEMM Marketing** — the agency arm: audits, GRACE onboarding, GHL lead capture. $45K/90d revenue target.
- **Greater** (app, MARCUS bot live) / **Softer** (women's platform, ARIA bot live) — both 70% built, parked for revenue focus.
- **WTAE** — Atlanta event platform: QR check-in, Creator Portal (photo uploads), Arena voting, multi-city expansion, Stripe Connect payouts to creators/vendors.
- **DEMM Photo Booths** — named in the org chart, zero operational detail found anywhere on this machine as of this audit.

**Locked decisions (this session):**
- **Cross-business identity:** ONE shared Person record across all five businesses (not isolated per business).
- **General's access boundary:** rollups only (pipeline/revenue) — never raw contact-level data across business units.

**Still open — direct questions for Antwann:**
1. DEMM Photo Booths — what's the actual business model (rental / staffing / franchise)? Revenue event (per-event fee / deposit+balance / subscription)?
2. WTAE — consumer ticketing/fan-engagement, or B2B event-marketing services, or both? Who are "creators" in the Creator Portal?

---

## Part 4 — Architecture validation

Current schema: `Organization → Workspace`, `Membership` scoped at org-level (`workspaceId` null) or workspace-level, `Role` enum already anticipating agent access: `SUPERADMIN, ORG_OWNER, ORG_ADMIN, WORKSPACE_ADMIN, AGENT, USER`.

**`Organization → Business Unit → Workspace` evolves cleanly — no CRM rebuild.** Additive:
- New `BusinessUnit` model (`id, organizationId, name, slug, brandingJson`), FK from `Organization`.
- Add `businessUnitId` to `Workspace` (nullable → required after backfill).
- Extend `Membership` with optional `businessUnitId`, mirroring the existing optional `workspaceId`.
- Every existing relation (Contact, Company, Task, Pipeline...) keeps keying off `workspaceId` unchanged.

**Migration:** create `BusinessUnit` → backfill one row per real business (5 total) under the existing Organization → point every existing Workspace at its BusinessUnit (WTAE's multi-city workspaces all → WTAE) → make the FK required → ship.

**Backward compatible:** yes — old workspace-scoped queries untouched.

**Permission hierarchy:** extend Membership with `businessUnitId` scoping, same pattern as `workspaceId` today; new business-unit-admin role sits between `ORG_ADMIN` and `WORKSPACE_ADMIN`.

**Business-switching:** session carries `organizationId` + `businessUnitId` + `workspaceId`, same pattern as the existing `x-workspace-id` header — fix `WorkspaceGuard`'s loose no-header fallback (Part 2) before stacking another default on top of it.

**Module assignment:** at **Business Unit** level, not Workspace — a WTAE "Atlanta" workspace inherits WTAE's modules; Workspace is operational subdivision, not capability selection.

**Cross-business sharing:** isolated by Workspace by default; sharing goes through the new shared-Person layer above per-business Contact records (per locked decision above).

**General's boundary:** matches the existing `AGENT` role — reads aggregated/internal-tier summaries per business unit, never raw confidential/owner-only records (locked decision above). Enforce via summary views, same mechanism `RolesGuard`/`WorkspaceGuard` already use.

**Agent scope:** existing `AGENT` role + scoped `Membership` is the mechanism — pin a specialist agent's membership row to one business unit (and optionally one workspace).

---

## Part 5 — Simplicity check

- **New DB entity for Business Unit?** Yes — WTAE already needs multiple workspaces under it (multi-city) while the other four don't yet. A workspace type tag can't represent "these workspaces share a parent."
- **Workspace type instead?** No — can't hold business-unit-level settings (branding, modules) without duplicating them onto every workspace under it.
- **Modules → BusinessUnit or Workspace?** BusinessUnit primarily; don't build a per-workspace override until one is actually needed.
- **Contacts isolated by default?** Per-workspace as today, feeding into the shared Person layer (locked decision).
- **General: raw or summary?** Summary only (locked decision) — the one boundary not to blur.
- **Minimum 12-month build:** `BusinessUnit`/shared-`Person` schema change above, one new role, module-assignment at BusinessUnit with no override yet, General reading pre-built summary views. Everything else in Part 4 is real but later-phase work.

---

## What should NOT be built yet
Module-override-per-workspace mechanism · any DEMM Photo Booths logic (zero business detail exists) · any new Cloud Run deploy automation until the connectivity fix below is confirmed working end-to-end.

---

## Risks / unresolved assumptions
- Confirm the 4 non-canonical DEMM-Ecosystem folders are abandoned before archiving/deleting.
- `WorkspaceGuard`'s no-header fallback — decide if intentional before Business Unit adds a second layer of default-scoping ambiguity.
- Project `431876670120` (where the staging URLs point) isn't reachable from this machine's `gcloud` — need access or manual `gcloud run services describe` output to actually check a digest.

---

## Patch applied this session

- `frontend/src/lib/api.ts:1` — now reads `NEXT_PUBLIC_API_URL`, falls back to `localhost:3001/api` for local dev.
- `frontend/.env.example` — added (didn't exist before).
- `frontend/.gitignore` — added `!.env.example` exception; the old `.env*` pattern would have silently swallowed the example file too.
- **Not yet done:** wiring `NEXT_PUBLIC_API_URL` as an actual build-time value in Cloud Build / Docker `--build-arg` / Vercel env — Next.js inlines `NEXT_PUBLIC_*` vars at build time, and nothing in the repo does that substitution yet. No `cloudbuild.yaml` exists.
