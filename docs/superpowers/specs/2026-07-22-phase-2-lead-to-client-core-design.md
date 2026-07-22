# Phase 2, Sub-project 1 — Lead → Client Core

**Status:** Approved for implementation (conditional green light + locked corrections applied 2026-07-22)
**Parent:** DEMM Platform Release 1.0, Phase 2 — DEMM Marketing Operating Slice (`DEMM_Release_1.0_Build_Spec_v1.0 (1).md` §7)
**Authority:** DEMM Ecosystem Constitution v3.0, DEMM Platform Blueprint v1.0 §4 (Shared Data Model), §5 (Cross-Business Person Model)

## Why this slice, and why first

Phase 2 as specified is 11 screens and 3 workflows — too large for one spec or one implementation pass. This is the first of several sub-projects, chosen because it's the direct path to the Build Spec's own headline acceptance criterion: *"Antwann can enter a lead and move it to active client."* It also matches the standing revenue priority in CLAUDE.md ($45K/90 days).

Deferred to later sub-projects: Client Operation (Onboarding checklist UI, Service Delivery tracking, Client Health scoring), Marketing Dashboard, Reports.

## Architecture decision: shared vs. business-local

The Blueprint (§4) explicitly classifies `Contact`, `Company`, `Opportunity`, `Pipeline`, `Task`, `Note`, `Activity` as **shared objects** used across all five DEMM business units, and separately names `Offer`, `Client Account`, `Client Health Snapshot`, `Service Deliverable` as **DEMM Marketing business-local objects**.

Marketing-specific commercial state (offer tier, contract state, payment state, onboarding state, client health, renewal date) does not get bolted onto the shared `Contact`/`Opportunity` models. It lives in new Marketing-owned models. This keeps the shared CRM core clean for WTAE/Photo Booths/GREATER/SOFTER, who will build their own business-local objects on the same shared foundation later.

**Acquisition source is business-scoped, not global** (locked correction). The Blueprint §5 (Cross-Business Person Model) is explicit: the same Person may enter DEMM Marketing, WTAE, GREATER, etc. through *different* relationships and *different* sources, and one relationship must not assume another. Therefore acquisition source belongs on the business-scoped `Opportunity` (the acquisition relationship record), **not** as a single global `Contact.source` field that would collapse every business's source into one value. `industry` belongs on `Company` (a business attribute); when the Company is not yet known at the lead stage, industry may live temporarily as Opportunity qualification context.

Alternatives considered and rejected:
- **Bolt everything onto `Opportunity` directly** — pollutes a shared object with Marketing-only commercial fields, contradicting the Blueprint's own classification.
- **Fully separate `Lead` + `Client` models** — requires a data migration at conversion time and duplicates most of what `Contact`/`Company` already track.
- **Global `Contact.source`** — rejected per locked correction; violates Blueprint §5.

## Data model

### `Company` (existing, shared) — additive
```
industry  String?   // business attribute, nullable
```

### `Opportunity` (existing, shared) — additive, acquisition-relationship-scoped
```
source                String?   // acquisition source for THIS business relationship
industryContext       String?   // temporary qualification context when Company unknown
```
No commercial/client fields are added here — only the source and the temporary industry qualification context, both of which are properties of the acquisition relationship itself.

### `Offer` (new, business-local to Marketing)
```
id                     String       @id @default(uuid())
businessUnitId         String       -> BusinessUnit
key                    String       // "FOUNDER_99", "FOUNDER_299", "FOUNDER_999"
version                Int          @default(1)   // bumped on each material edit
name                   String
price                  Decimal
setupFee               Decimal?
includedServices       String[]
excludedServices       String[]
onboardingRequirements String[]
supportBoundaries      String
reportingCadence       String
cancellationTerms      String
expectedLaunchTime     String
lifecycleState         OfferLifecycleState  @default(DRAFT)  // DRAFT, ACTIVE, RETIRED
isPubliclyAvailable    Boolean      @default(false)  // DISPLAY hint only, NOT the sellability gate
createdAt / updatedAt

@@unique([businessUnitId, key, version])
```
**Sellability is determined by `lifecycleState == ACTIVE`, not by `isPubliclyAvailable`** (locked correction). `isPubliclyAvailable` is a display hint only. `DRAFT`/`RETIRED` offers cannot be sold. Editing an `ACTIVE` offer's material commercial fields bumps `version`.

Seeded with the 3 real founder tiers as `ACTIVE`. Fully editable via the Offers & Settings screen — no fields hardcoded in application code.

### `OfferSnapshot` (new, business-local to Marketing) — immutable
```
id                     String   @id @default(uuid())
offerId                String   -> Offer            // provenance pointer to the canonical offer
offerVersion           Int                          // the version sold
key                    String
name                   String
price                  Decimal
setupFee               Decimal?
includedServices       String[]
excludedServices       String[]
onboardingRequirements String[]
supportBoundaries      String
reportingCadence       String
cancellationTerms      String
expectedLaunchTime     String
createdAt              DateTime @default(now())
```
Written once at conversion, never updated (enforced at the service layer — no update path exposed). Captures the exact commercial scope sold. **Editing the canonical `Offer` later never changes an existing `ClientAccount`'s agreement** — the ClientAccount reads its scope from its `OfferSnapshot`, not the live `Offer`.

### `ClientAccount` (new, business-local to Marketing) — models the business relationship
```
id                      String   @id @default(uuid())
businessUnitId          String   -> BusinessUnit
companyId               String?  -> Company          // the client entity, when a business
primaryContactId        String   -> Contact          // primary human contact (always present)
acquisitionOpportunityId String  -> Opportunity      // the Opportunity that converted (renamed
                                                      // from opportunityId; future renewals/upsells
                                                      // attach their own additional Opportunities)
offerId                 String   -> Offer             // canonical offer pointer (for reporting)
offerSnapshotId         String   @unique -> OfferSnapshot  // the immutable agreement actually sold
serviceStatus           ServiceStatus  @default(PENDING_ONBOARDING)
                        // PENDING_ONBOARDING, ACTIVE, AT_RISK, PAUSED, CHURNED
onboardingState         OnboardingState @default(NOT_STARTED)  // NOT_STARTED, IN_PROGRESS, COMPLETE
renewalDate             DateTime?
createdAt / updatedAt

@@unique([businessUnitId, companyId])       // one Marketing client account per company per BU
@@unique([businessUnitId, primaryContactId]) // ...or per contact (sole-proprietor path)
```
- **The client entity is the Company** when known; `companyId` is nullable to support the **sole-proprietor / contact-only path**. `primaryContactId` is always present.
- **Additional related Contacts** attach through the existing Contact↔Company relationship (a Contact already has an optional `companyId`); no new join table is needed for this slice.
- **Uniqueness is Business-Unit-scoped** (locked correction) — `@@unique([businessUnitId, companyId])` and `@@unique([businessUnitId, primaryContactId])`, never a global `contactId` unique. The same Contact/Company may legitimately be a client of a *different* business unit later.
- **`serviceStatus` starts at `PENDING_ONBOARDING`** (locked correction), never `ACTIVE`. It becomes `ACTIVE` only when onboarding completes (sub-project 2's job).

### `ClientAccount` contract/payment — manually recorded, audited
Contract and payment state are **manually recorded** until real provider integrations exist, and must be labeled as such in the UI (locked correction). They are modeled as an append-only history so *who changed them and when* is captured:
```
model ClientCommercialStateChange {
  id              String   @id @default(uuid())
  clientAccountId String   -> ClientAccount
  field           String   // "CONTRACT" | "PAYMENT"
  newValue        String   // e.g. "SIGNED_MANUAL", "DEPOSIT_PAID_MANUAL"
  recordedById    String   -> User    // who
  source          String   @default("MANUAL")  // vs future "STRIPE", "DOCUSIGN"
  createdAt       DateTime @default(now())      // when
}
```
The current contract/payment state is derived as the most recent change of each `field` (or a default when none exists). Enum values carry a `_MANUAL` suffix to make manual-recording explicit in data, not just UI copy.

## Conversion: atomic, idempotent, DOM26-R-integrated

`POST /marketing/leads/:contactId/convert` runs as a single `prisma.$transaction`. Every step succeeds or the whole thing rolls back (locked correction):

1. verify Business Unit + Workspace scope (via `BusinessUnitGuard` / `resolveAuthorizedWorkspace`);
2. verify the Contact/Company and the acquisition Opportunity belong to that scope;
3. verify the Offer is sellable (`lifecycleState == ACTIVE`) — else **422** (business-rule, not 403);
4. prevent duplicate conversion (BU-scoped uniqueness + idempotency key — see below);
5. create `ClientAccount` (`serviceStatus = PENDING_ONBOARDING`);
6. write the immutable `OfferSnapshot` and link it;
7. mark the acquisition Opportunity `WON`;
8. update lead lifecycle state (Contact `status` LEAD → the converted state);
9. create the onboarding kickoff `Task` (the designated primary next-action task);
10. write audit events (`AuditLog` + DOM26-R `MemoryAuditEvent`);
11. create **approved-candidate-controlled** DOM26-R relationship facts (see below).

**Idempotency:** the endpoint accepts an `Idempotency-Key` header; a completed conversion for a given key returns the same result rather than creating a duplicate. Combined with the BU-scoped uniqueness constraints, a double-submit cannot create two client accounts.

**Rollback coverage:** because steps 5–11 all run inside the one `$transaction`, a failure in Task creation (step 9) or DOM26-R candidate creation (step 11) rolls back the ClientAccount, snapshot, Opportunity status, and lifecycle change too. Tested explicitly.

## DOM26-R integration — first operational Marketing relationship memory

This slice produces the first real Marketing relationship-memory experience. It uses the **existing** Phase 1B DOM26-R services (`MemoryCandidateService`, `EngramService`, `RelationshipBriefService`, `ConsentDirectiveService`) — no DOM26-R schema changes.

**Controlled candidates, not auto-promotion** (locked correction). Conversion creates DOM26-R `MemoryCandidate` rows (which require approval to become durable Engrams) — it does **not** auto-promote every form value into permanent memory. Candidates are created for appropriate relationship facts only:
- acquisition source, confirmed business context, stated goal, communication preference, Offer selected, conversion milestone, commitments made by DEMM, next promised action.

Each candidate carries proper provenance (`CandidateEvidence` → `EngramSource` of type `EVENT`/`MANUAL`, referencing the conversion). The conversion milestone specifically may be created as an observed engram (high-confidence, system-observed fact) rather than a pending candidate, since it is a system-recorded event, not an inferred claim — this distinction is tested.

**Marketing Relationship Brief** on the Lead/Client detail page, generated via `RelationshipBriefService`, containing: identity and business, relationship stage, selected Offer, stated goal, confirmed preferences, previous interaction, open commitment, next action, and memories requiring reconfirmation. Visibility respects the three tiers — `INTERNAL_AGENT`, `INTERNAL_HUMAN`, `CUSTOMER_VISIBLE` — extending the existing two-tier brief-visibility mechanism from Phase 1B (which currently distinguishes INTERNAL_AGENT vs CUSTOMER_VISIBLE; INTERNAL_HUMAN is added as a middle tier).

## Screens

1. **Leads** (new route `/marketing/leads`) — table of Contacts with `status=LEAD` in the current workspace. Columns: name, company, source (from Opportunity), industry (from Company or Opportunity qualification context), stage, expected value, owner, next action (designated primary Task), age. "New Lead" form creates a Contact + linked Opportunity together (and optionally a Company). **A converted lead disappears from this view** (tested).
2. **Pipeline** — the existing `/pipelines` screen, unchanged. Already shows Opportunities by stage with drag-to-move.
3. **Offers & Settings** (new route `/marketing/offers`) — list + full edit form for `Offer` records, including `lifecycleState` transitions (DRAFT→ACTIVE→RETIRED). Combines the Build Spec's "Offers" and "Settings" screens for this slice.
4. **Lead/Contact detail** (extends existing Contact detail page) — adds the **"Convert to Client"** action (select an `ACTIVE` Offer; optionally set manually-recorded contract/payment state; submit → transactional conversion above) and renders the **Marketing Relationship Brief**.

## Workflows

**Lead to Discovery:** create lead (Contact + Opportunity, optional Company) → assign owner (existing `ownerId`) → record acquisition `source` on the Opportunity → set the designated primary next-action Task → move through pipeline (existing stage drag) → schedule/record discovery (existing Note/Activity). DOM26-R candidates for source/business-context/stated-goal/preference are created as these facts are captured.

**Discovery to Client:** select an `ACTIVE` Offer → scope summary rendered live from the Offer's current fields for preview → on convert, the immutable `OfferSnapshot` freezes exactly what was sold → record manually-recorded contract/payment state → transactional conversion (creates ClientAccount at PENDING_ONBOARDING, snapshot, marks Opportunity WON, creates onboarding Task, writes audit events, creates DOM26-R candidates + conversion-milestone engram) → onboarding checklist itself is sub-project 2.

**Client Operation:** out of scope beyond `serviceStatus = PENDING_ONBOARDING` and the onboarding kickoff Task.

## Access control

`ClientAccount`, `Offer`, `OfferSnapshot`, and `ClientCommercialStateChange` are scoped by `businessUnitId`, following the `BusinessUnitGuard` / `resolveAuthorizedWorkspace` pattern from Phase 1B. Every existing workspace was backfilled to the MARKETING business unit in the Phase 1 migration, so no BU switcher UI is needed for this slice — existing workspace scoping is, in practice, Marketing scoping. Cross-BU access is denied by default and tested.

## Error handling / business rules

- Duplicate conversion (BU-scoped uniqueness or repeated idempotency key) → **409**, no silent overwrite.
- Offer not sellable (`lifecycleState != ACTIVE`, i.e. DRAFT or RETIRED) → **422** business-rule response (locked correction — not a 403 authorization-style error).
- `Offer` deletion while referenced by any `OfferSnapshot`/`ClientAccount` → blocked (`onDelete: Restrict`).
- `Offer` **retirement** (→ RETIRED) is always allowed and prevents new sales without altering any existing `ClientAccount` (which reads its snapshot, not the live offer).
- Cross-BU conversion attempt → **403** (scope/authorization failure, distinct from the 422 sellability case).
- Duplicate contact detection by normalized email/phone at lead creation → surfaced to the user (warn + allow, or block per existing Contact conventions), tested.

## Testing

HTTP-level suite (`test-marketing-lead-to-client-api.ts`) booting the real Nest app through the real guard chain, covering:
- lead creation; duplicate-contact detection by normalized email/phone;
- pipeline stage movement; offer CRUD incl. lifecycle transitions;
- **Company-based** ClientAccount creation; **Contact-only sole-proprietor** path;
- cross-Business-Unit denial (403);
- inactive/retired Offer rejection (422, not 403);
- **immutable Offer snapshot** — edit the canonical Offer after conversion, assert the ClientAccount's snapshot is unchanged;
- **conversion rollback** when Task creation or DOM26-R candidate creation fails (assert no ClientAccount/snapshot/WON-status leaks);
- **duplicate-submit / idempotency** behavior;
- **converted lead disappears** from the Leads view;
- ClientAccount begins at **PENDING_ONBOARDING**;
- **DOM26-R candidate provenance** (candidates created, not auto-promoted; evidence chain correct; conversion milestone as observed engram);
- **Relationship Brief visibility** across INTERNAL_AGENT / INTERNAL_HUMAN / CUSTOMER_VISIBLE.

Regression: all existing suites (`test-dom26r-*`, `test-workspace-*`, `test-auth-security`, `verify-comprehensive`, `test-isolation`) plus typecheck, lint, build.

## Explicitly out of scope for this slice

- Onboarding checklist UI (sub-project 2)
- Service Delivery tracking (sub-project 2)
- Client Health scoring (sub-project 2)
- Marketing Dashboard, Reports (sub-project 3 — depend on this slice's data existing)
- GHL/GRACE webhook lead ingestion (manual entry only, per explicit decision)
- Business-unit switcher UI (not needed until a second BU has real workspace data)
- Real Stripe/DocuSign contract & payment integration (states are manually-recorded, labeled as such)
