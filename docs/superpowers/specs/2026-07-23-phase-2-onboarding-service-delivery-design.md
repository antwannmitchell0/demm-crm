# Phase 2 Sub-project 2: Client Onboarding & Service Delivery — Design Spec

**Status:** Approved by Antwann (directive issued 2026-07-23, "DEMM RELEASE 1.0 — CONTINUE TO 100% EXECUTION"). This spec translates that directive into concrete schema/service/API decisions for implementation. No further design approval loop — proceed straight to writing-plans per Antwann's explicit "proceed now" instruction.

**Depends on:** Phase 2 Sub-project 1 (Lead-to-Client Core, commit `98b045a`, Commercial Truth Lock accepted and deployed to staging).

**Core product principle (locked, non-negotiable):** Onboarding and service delivery are generated from the client's immutable `OfferSnapshot`, never from the live editable `Offer`. Editing Survivor/Growth/Empire later must never change what an already-converted client owes or is owed.

---

## 1. Data model

### 1.1 New enums

```prisma
enum OnboardingPlanState {
  NOT_STARTED
  IN_PROGRESS
  WAITING_ON_CLIENT
  BLOCKED
  READY_FOR_LAUNCH
  COMPLETE
  CANCELLED
}

enum ChecklistItemStatus {
  NOT_STARTED
  IN_PROGRESS
  WAITING_ON_CLIENT
  BLOCKED
  SUBMITTED
  COMPLETE
  WAIVED
  CANCELLED
}

enum ChecklistResponsibility {
  DEMM
  CLIENT
}

enum ServiceDeliverableCadence {
  ONE_TIME
  RECURRING
}

enum ServiceDeliverableStatus {
  NOT_STARTED
  IN_PROGRESS
  BLOCKED
  WAITING_ON_CLIENT
  DELIVERED
  ACCEPTED
  REJECTED
  CANCELLED
}
```

**Decision:** `MarketingOnboardingState` (the 3-value placeholder enum added in Sub-project 1: `NOT_STARTED`/`IN_PROGRESS`/`COMPLETE`, currently written but never read anywhere) is **replaced** by `OnboardingPlanState` everywhere, including on `ClientAccount.onboardingState`. It was never part of a public contract (added yesterday, unused outside the conversion transaction), so widening it now is a clean schema change, not a breaking one. `ClientAccount.onboardingState` becomes a denormalized cache of `OnboardingPlan.state`, kept in sync in the same transaction as every plan-state change — this exists purely so list views (e.g. a future Clients table) can filter/sort without a join; `OnboardingPlan.state` remains the single source of truth.

### 1.2 New models

```prisma
model OnboardingPlan {
  id               String              @id @default(uuid())
  clientAccountId  String              @unique
  clientAccount    ClientAccount       @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  offerSnapshotId  String
  offerSnapshot    OfferSnapshot       @relation(fields: [offerSnapshotId], references: [id], onDelete: Restrict)
  planVersion      Int                 @default(1)
  ownerId          String?
  owner            User?               @relation("OnboardingPlanOwner", fields: [ownerId], references: [id])
  targetLaunchDate DateTime?
  actualLaunchDate DateTime?
  state            OnboardingPlanState @default(NOT_STARTED)
  items            OnboardingChecklistItem[]
  overrides        LaunchGateOverride[]
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
}

model OnboardingChecklistItem {
  id                String                  @id @default(uuid())
  planId            String
  plan              OnboardingPlan          @relation(fields: [planId], references: [id], onDelete: Cascade)
  title             String
  description       String?
  sourceCapability  String?                 // verbatim string from OfferSnapshot.onboardingRequirements/includedServices this item was generated from
  required          Boolean                 @default(true)
  responsibility    ChecklistResponsibility
  assignedOwnerId   String?
  assignedOwner     User?                   @relation("ChecklistItemOwner", fields: [assignedOwnerId], references: [id])
  dueDate           DateTime?
  dependsOnItemId   String?
  dependsOnItem     OnboardingChecklistItem?  @relation("ItemDependency", fields: [dependsOnItemId], references: [id])
  dependentItems    OnboardingChecklistItem[] @relation("ItemDependency")
  status            ChecklistItemStatus     @default(NOT_STARTED)
  evidence          String?
  clientSubmission  Json?
  blockerReason     String?
  completedAt       DateTime?
  approvedById      String?
  approvedBy        User?                   @relation("ChecklistItemApprover", fields: [approvedById], references: [id])
  approvedAt        DateTime?
  history           OnboardingChecklistItemHistory[]
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt

  @@index([planId, status])
}

model OnboardingChecklistItemHistory {
  id         String              @id @default(uuid())
  itemId     String
  item       OnboardingChecklistItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  oldStatus  ChecklistItemStatus
  newStatus  ChecklistItemStatus
  reason     String?
  actorId    String?
  createdAt  DateTime            @default(now())

  @@index([itemId, createdAt])
}

model LaunchGateOverride {
  id             String         @id @default(uuid())
  planId         String
  plan           OnboardingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  reason         String
  actorId        String
  affectedGates  String[]       // OnboardingChecklistItem ids bypassed by this override
  createdAt      DateTime       @default(now())

  @@index([planId, createdAt])
}

model ServiceDeliverable {
  id                     String                     @id @default(uuid())
  clientAccountId        String
  clientAccount          ClientAccount              @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  offerSnapshotId        String
  offerSnapshot          OfferSnapshot              @relation(fields: [offerSnapshotId], references: [id], onDelete: Restrict)
  sourceCapability       String                     // verbatim string from OfferSnapshot.includedServices this deliverable was generated from ("" for outside-scope/custom items)
  name                   String
  description            String?
  cadence                ServiceDeliverableCadence
  cadenceDetail          String?                    // e.g. "monthly" -- null means genuinely undecided, matches OfferSnapshot.reportingCadence being null
  ownerId                String?
  owner                  User?                      @relation("ServiceDeliverableOwner", fields: [ownerId], references: [id])
  dueDate                DateTime?
  status                 ServiceDeliverableStatus   @default(NOT_STARTED)
  evidence               String?
  clientApprovalRequired Boolean                    @default(false)
  clientApprovedAt       DateTime?
  blockerReason          String?
  outsideScope           Boolean                    @default(false)
  history                ServiceDeliverableHistory[]
  createdAt              DateTime                   @default(now())
  updatedAt              DateTime                   @updatedAt

  @@index([clientAccountId, status])
}

model ServiceDeliverableHistory {
  id            String                    @id @default(uuid())
  deliverableId String
  deliverable   ServiceDeliverable        @relation(fields: [deliverableId], references: [id], onDelete: Cascade)
  oldStatus     ServiceDeliverableStatus
  newStatus     ServiceDeliverableStatus
  reason        String?
  actorId       String?
  createdAt     DateTime                  @default(now())

  @@index([deliverableId, createdAt])
}
```

`ClientAccount` gains `onboardingPlan OnboardingPlan?` and `serviceDeliverables ServiceDeliverable[]` back-relations, and its `onboardingState` column switches type from `MarketingOnboardingState` to `OnboardingPlanState`. `OfferSnapshot` gains `onboardingPlans OnboardingPlan[]` and `serviceDeliverables ServiceDeliverable[]` back-relations. `User` gains the three named back-relations above.

**Why per-entity history tables, not one generic polymorphic audit table:** the codebase's existing precedent for "record every state change with old/new + reason + actor" is `PulseChangeHistory` (narrowly typed to `RelationshipProfile`), not a generic polymorphic table — Prisma has no native polymorphic-FK support, and a generic table would trade real referential integrity for premature DRY. Two small typed tables following the established pattern is more consistent with the codebase than one generic one.

**Why `progressPercentage`, `blockers`, `launchReadiness` are not stored columns:** they're all derivable from `items` in O(n) at read time (percentage = complete-or-waived / total-required; blockers = items where `status = BLOCKED`; launch readiness = no incomplete required item exists). Storing them risks silent drift from the items that are the actual source of truth. `OnboardingService.getPlanDetail()` computes and returns them on every read instead.

### 1.3 Migration

Purely additive: new enums, six new tables, two new nullable back-relation columns on existing tables, and one column-type change (`ClientAccount.onboardingState` from `MarketingOnboardingState` to `OnboardingPlanState`). The column-type change requires an explicit `USING` cast in the migration SQL since Postgres won't auto-cast between two different enum types; because the old enum's three values (`NOT_STARTED`/`IN_PROGRESS`/`COMPLETE`) are an exact-name subset of the new enum's seven, the cast is `ALTER COLUMN "onboardingState" TYPE "OnboardingPlanState" USING ("onboardingState"::text::"OnboardingPlanState")` — lossless for all existing rows. Rollback reverses the same cast and drops the six new tables/enums; it fails safely if any row would need the removed enum values (a genuine block, not silently truncated), which can only happen for rows created after this migration ships.

---

## 2. Generation (OfferSnapshot → obligations)

One idempotent service call, `OnboardingService.generateForClient(tx, clientAccountId)`, generates **both** the onboarding plan+checklist and the service deliverables in a single pass, from the `ClientAccount`'s `offerSnapshot`. It is:

- **Invoked automatically** inside `ClientAccountService.convert`'s existing transaction (extends the Sub-project 1 transaction — one more step, same atomicity guarantee), immediately after the `ClientAccount` row is created.
- **Idempotent and independently callable** — checks for an existing `OnboardingPlan` for the `clientAccountId` first; if one exists, returns it unchanged rather than erroring or duplicating. This backs both the "duplicate generation is idempotent" test and a manual repair/backfill path for any client that somehow reached `PENDING_ONBOARDING` without a plan (pre-Sub-project-2 data, or a future bug).

**Checklist generation logic (deterministic, directly traceable to the OfferSnapshot — nothing invented):**
1. One `required=true, responsibility=DEMM` item per string in `offerSnapshot.onboardingRequirements`, `title` = that string verbatim, `sourceCapability` = that string.
2. One `required=true, responsibility=CLIENT` item, `title` = "Confirm business details and provide access/assets needed for onboarding", `sourceCapability` = null. This is the one generic scaffolding item every onboarding needs regardless of plan — it does not assert any specific asset requirement the Offer didn't already state, it just names the client's general obligation to participate.

No other items are invented. If a future Offer needs a more granular client checklist, that's authored explicitly on the Offer record (a future enhancement, not fabricated here).

**Service deliverable generation logic:**
- One `ServiceDeliverable` per string in `offerSnapshot.includedServices`, `name`/`sourceCapability` = that string, `cadence = RECURRING` (every included capability in a monthly-billed plan is ongoing service, not a one-off), `cadenceDetail = null` (undecided, mirrors `OfferSnapshot.reportingCadence` being null — no fabricated frequency).
- `outsideScope` items are never auto-generated; they're created manually via the API when DEMM agrees to do work beyond the purchased plan (Section 5.3), always with `outsideScope = true` so the UI can flag them distinctly per Antwann's truth-rules requirement.

---

## 3. Launch gates

`OnboardingService.checkLaunchReadiness(planId)` returns `{ ready: boolean, blockingItems: OnboardingChecklistItem[] }` — `ready` is true iff every item with `required = true` has `status` in `(COMPLETE, WAIVED)`.

`OnboardingService.activate(clientAccountId, actorId, override?: { reason: string })`:
1. Loads the plan and runs `checkLaunchReadiness`.
2. If not ready and no `override` supplied → throws `ConflictException` listing the blocking item titles.
3. If not ready and `override` supplied → the caller must hold a role gated by `@Roles(SUPERADMIN, ORG_OWNER, ORG_ADMIN, WORKSPACE_ADMIN)` on the controller method (reusing the existing `RolesGuard`/`@Roles` decorator — `AGENT` and `USER` roles cannot override). Writes a `LaunchGateOverride` row (`reason`, `actorId`, `affectedGates` = the blocking item ids) inside the same transaction, then proceeds as if ready.
4. If ready (with or without override): in one transaction — sets `OnboardingPlan.state = COMPLETE`, `actualLaunchDate = now()`, sets `ClientAccount.onboardingState = COMPLETE` and `ClientAccount.serviceStatus = ACTIVE`, and writes a `MemoryAuditEvent`-style DOM26-R record via `Dom26rAuditService` (action `CLIENT_ACTIVATED`) plus an `AuditLog` row, matching the audit pattern established in `ClientAccountService.convert`.

An unauthorized override attempt (caller lacks the required role) is rejected by `RolesGuard` before the service method ever runs — this is what Test #6 in Section 8 verifies.

---

## 4. DOM26-R integration

Reuses `MemoryCandidateService`/`EngramService`/`RelationshipBriefService` exactly as `MarketingRelationshipService` already does for conversion. New method `MarketingRelationshipService.recordOnboardingMilestone(tx, ..., kind, summary, content)` records ONE engram (not a candidate — these are system-observed facts, not inferred claims) for each of: plan generated, required item completed, launch-gate override applied, client activated, major blocker raised/resolved. Per Antwann's explicit instruction, **checklist item toggles that aren't milestones do not create memory** — routine `IN_PROGRESS`/`WAITING_ON_CLIENT` transitions stay in `OnboardingChecklistItemHistory` only, never DOM26-R.

Candidates (pending human confirmation, not direct engrams) are created for anything that's a claim rather than an observed system fact: a client's stated goal captured during onboarding, a promise DEMM's team makes verbally and logs, a client-submitted preference. These reuse the exact `MemoryCandidateService.create` call shape already in `MarketingRelationshipService.recordConversionFacts`.

### Updated Relationship Brief

`MarketingRelationshipService.generateMarketingBrief` gains an onboarding-aware brief template answering the fourteen questions in Antwann's directive (who/what business/what purchased/what promised/what's complete/blocked/waiting/at-risk/next-action/reconfirm). The brief text is composed from: the `OfferSnapshot` (what they purchased), `OnboardingChecklistItem` rows (complete/blocked/waiting, grouped by responsibility), `ServiceDeliverable` rows (DEMM-owed vs. delivered), and existing confirmed Engrams (goals, promises, milestones). Visibility tiers are unchanged from Sub-project 1 (`INTERNAL_AGENT`/`INTERNAL_HUMAN`/`CUSTOMER_VISIBLE`); the `CUSTOMER_VISIBLE` formatter (already tier-aware per `RelationshipBriefService.getFormatted`) strips internal risk/confidence language — this sub-project adds onboarding/delivery content to the brief body, it does not change the existing tier-stripping mechanism.

---

## 5. API surface

All routes under the existing `@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)` controller pattern, BU-scoped exactly like `ClientAccountController`.

### 5.1 Onboarding

- `GET /marketing/clients/:id/onboarding` — plan + items + computed `progressPercentage`/`blockers`/`launchReadiness`.
- `PATCH /marketing/clients/:id/onboarding/items/:itemId` — body: `{ status?, evidence?, clientSubmission?, blockerReason? }`. Writes `OnboardingChecklistItemHistory` when `status` changes; `completedAt`/`approvedAt` set server-side, never client-supplied.
- `POST /marketing/clients/:id/onboarding/activate` — body: `{ override?: { reason: string } }`. `@Roles(...)` + `RolesGuard` applied only when the request actually contains `override` — enforced inside the service (the route itself stays reachable for the non-override happy path used by any authenticated BU member; the role check gates the override branch specifically, matching "an authorized human may override" rather than restricting who can activate a fully-ready plan).
- `POST /marketing/clients/:id/onboarding/generate` — idempotent manual trigger (repair/backfill path); safe to call on an already-generated client (no-op, returns existing plan).

### 5.2 Service delivery

- `GET /marketing/clients/:id/deliverables`
- `PATCH /marketing/clients/:id/deliverables/:deliverableId` — body: `{ status?, evidence?, blockerReason?, clientApprovedAt? }`. Writes `ServiceDeliverableHistory` on status change.

### 5.3 Outside-scope work

- `POST /marketing/clients/:id/deliverables` — body: `{ name, description?, cadence, cadenceDetail? }`. Always creates with `outsideScope = true, sourceCapability = ''` — this endpoint cannot create a deliverable that claims to come from the OfferSnapshot; only the automatic generator can set `outsideScope = false`.

---

## 6. Null commercial fields

`OfferSnapshot.supportBoundaries/reportingCadence/cancellationTerms/expectedLaunchTime` stay exactly as locked in Sub-project 1 (nullable, no invented defaults). Nothing in this sub-project writes a value into those columns. Where a specific client needs one of these confirmed (e.g. Antwann verbally commits to a launch date for one client), that goes in `OnboardingPlan.targetLaunchDate` (a per-client field, not a canonical Offer field) — this is exactly the "client-specific confirmation record rather than changing the canonical Offer" Antwann's directive calls for.

UI rendering rule (frontend, Section 7): any `null` commercial field renders as *"Not yet defined"* (canonical Offer context) or *"To be confirmed"* (client-specific context, e.g. no `targetLaunchDate` set) — never blank, never a fabricated value.

---

## 7. Frontend

New route `frontend/src/app/marketing/clients/[id]/page.tsx` (client detail), reusing the existing `frontend/src/lib/api.ts` fetch-wrapper pattern and the Offers/Leads screens' Tailwind conventions. Four sections on one page (tabs via local state, not separate routes — matches the existing Offers & Settings screen's single-page-with-sections pattern):

1. **Overview** — business/contact, plan name + exact `OfferSnapshot` version, `serviceStatus`, derived contract/payment state (`deriveCurrentCommercialState`, already exists in `ClientAccountService`), onboarding progress bar, target launch, next action (first incomplete required item, DEMM- or client-owned), blockers, Relationship Pulse, Relationship Brief (reuses the existing brief display component from the Leads screen).
2. **Onboarding tab** — checklist grouped by `responsibility` (DEMM-owed / client-owed), overdue (`dueDate < now && status not in (COMPLETE, WAIVED, CANCELLED)`), blockers, progress, evidence/submission display, launch-readiness banner, an "Activate Client" button (disabled with a tooltip listing blockers unless the current user's role qualifies for override, in which case an override reason field appears).
3. **Service Delivery tab** — deliverables list with cadence/status/owner/due date/evidence/client-approval state; an "Outside-scope request" form posting to 5.3; outside-scope items visually distinct (badge) from purchased-scope items.
4. **Memory & Relationship tab** — confirmed Engrams for this profile (reuse `RelationshipBriefService`/engram list patterns from Sub-project 1's Leads screen brief display), correction/dispute/forget controls already exposed by the DOM26-R module's existing memory-candidate/correction endpoints (no new backend needed here — this tab is a new frontend surface over existing APIs).

---

## 8. Testing

New `backend/test-onboarding-service-delivery-api.ts`, following the established pattern (`test-marketing-lead-to-client-api.ts`): boots the real Nest app, exercises the guard chain over real HTTP. Covers all 16 items from Antwann's directive:

1. Onboarding plan generated from OfferSnapshot (checklist items match `onboardingRequirements`, deliverables match `includedServices`).
2. Updating the canonical `Offer` (e.g. changing `includedServices`) does not alter an existing client's checklist/deliverables (they still match the frozen `OfferSnapshot`).
3. Calling `generate` twice returns the same plan, no duplicate rows.
4. Activation is rejected (409) while a required item is incomplete.
5. Activation succeeds once all required items are `COMPLETE`/`WAIVED`; `ClientAccount.serviceStatus` becomes `ACTIVE`.
6. Override attempt by a `USER`/`AGENT`-role caller is rejected (403) before any state changes.
7. Override attempt by a qualifying role succeeds, requires `reason`, and creates a `LaunchGateOverride` row with correct `affectedGates`.
8. A client in a different Business Unit gets 404/403 on every onboarding/deliverable route for this client (reuses the existing cross-BU isolation pattern from Sub-project 1's suite).
9. `WAITING_ON_CLIENT` and `BLOCKED` item statuses round-trip correctly and appear in the computed `blockers` list.
10. Deliverables generated match `includedServices` 1:1, `outsideScope = false`, `sourceCapability` populated.
11. A `POST /deliverables` outside-scope request always has `outsideScope = true` regardless of request body.
12. DOM26-R candidates/engrams created during onboarding preserve `sources`/provenance exactly like Sub-project 1's conversion candidates.
13. Relationship Brief visibility: `CUSTOMER_VISIBLE` formatting strips internal fields even when the brief includes onboarding content.
14. `targetLaunchDate` left unset renders/serializes as `null`, never a fabricated date; same for all four `OfferSnapshot` null fields passed through to the client detail response.
15. A forced mid-generation error (e.g. invalid `clientAccountId`) leaves zero `OnboardingPlan`/`OnboardingChecklistItem`/`ServiceDeliverable` rows — transaction rollback verified by row count before/after.
16. The existing Lead → Client conversion flow (Sub-project 1) still produces a `ClientAccount` at `PENDING_ONBOARDING` with a plan attached in the same transaction — full regression, not just a new-feature check.

Full existing regression suite (auth, WorkspaceGuard, BusinessUnitGuard, DOM26-R, marketing, comprehensive, typecheck, lint, build) must stay green throughout.

---

## 9. Transaction & data integrity

- `OnboardingService.generateForClient` and `activate` each run inside a single `prisma.$transaction`, following the exact pattern in `ClientAccountService.convert`.
- All new FKs to `OfferSnapshot` use `onDelete: Restrict` (matches existing `ClientAccount.offerSnapshot`/`offer` — immutability is enforced at the DB layer, not just convention).
- All new FKs to `ClientAccount`/`OnboardingPlan` use `onDelete: Cascade` (deleting a test client account cleans up its onboarding/delivery rows; this matches how `RelationshipProfile → Engram` cascades in the existing schema — commercial/relationship history that must outlive a ClientAccount already lives in `ClientCommercialStateChange`/`MemoryAuditEvent`, which are untouched by this sub-project).
- `generateForClient` is idempotent by construction (existence check), which is what makes it safe to call automatically from `convert` and manually from the repair endpoint without a separate advisory lock.

---

## 10. Out of scope for this sub-project

Per Antwann's explicit "Do not begin Photo Booths or WTAE" and "No production deployment is authorized": this spec covers Marketing-BU onboarding/service-delivery only. Phase 2 Sub-project 3 (Marketing Dashboard, Client Health, Reporting) is the next sub-project after this one passes staging, not part of this spec.
