# Phase 2, Sub-project 1 — Lead → Client Core

**Status:** Approved for implementation planning
**Parent:** DEMM Platform Release 1.0, Phase 2 — DEMM Marketing Operating Slice (`DEMM_Release_1.0_Build_Spec_v1.0 (1).md` §7)
**Authority:** DEMM Ecosystem Constitution v3.0, DEMM Platform Blueprint v1.0 §4 (Shared Data Model)

## Why this slice, and why first

Phase 2 as specified is 11 screens and 3 workflows — too large for one spec or one implementation pass. This is the first of several sub-projects, chosen because it's the direct path to the Build Spec's own headline acceptance criterion: *"Antwann can enter a lead and move it to active client."* It also matches the standing revenue priority in CLAUDE.md ($45K/90 days).

Deferred to later sub-projects: Client Operation (Onboarding checklist UI, Service Delivery tracking, Client Health scoring), Marketing Dashboard, Reports.

## Architecture decision: shared vs. business-local

The Blueprint (§4) explicitly classifies `Contact`, `Opportunity`, `Pipeline`, `Task`, `Note`, `Activity` as **shared objects** used across all five DEMM business units, and separately names `Offer`, `Client Account`, `Client Health Snapshot`, `Service Deliverable` as **DEMM Marketing business-local objects**.

This settles the schema design question directly: Marketing-specific fields (offer tier, contract state, payment state, onboarding state, client health, renewal date) do not get bolted onto the shared `Contact`/`Opportunity` models. They live in two new Marketing-owned models. This keeps the shared CRM core clean for WTAE/Photo Booths/GREATER/SOFTER, who will build their own business-local objects on the same shared foundation later.

Two fields are the exception: `source` and `industry` are added directly to `Contact` (shared). These are generic lead-qualification concepts any business unit could use (a WTAE organizer or Photo Booth inquiry has a source too), low-risk, and required by the Build Spec at the lead stage — before a `ClientAccount` would even exist.

Alternatives considered and rejected:
- **Bolt everything onto `Opportunity` directly** — fewer models, but pollutes a shared object with Marketing-only fields, contradicting the Blueprint's own classification.
- **Fully separate `Lead` + `Client` models** — cleaner conceptual split, but requires a data migration at conversion time and duplicates most of what `Contact` already tracks.

## Data model

### `Contact` (existing, shared) — additive
```
source    String?
industry  String?
```

### `Offer` (new, business-local to Marketing)
```
id                     String   @id @default(uuid())
businessUnitId         String   -> BusinessUnit
key                    String   // "FOUNDER_99", "FOUNDER_299", "FOUNDER_999"
name                   String
price                  Decimal
includedServices       String[]
excludedServices       String[]
onboardingRequirements String[]
supportBoundaries      String
reportingCadence       String
cancellationTerms      String
setupFee               Decimal?
expectedLaunchTime     String
isPubliclyAvailable    Boolean  @default(false)
createdAt / updatedAt
```
Seeded with the 3 real founder tiers. Fully editable via the Offers & Settings screen — no fields are hardcoded in application code.

### `ClientAccount` (new, business-local to Marketing)
```
id              String   @id @default(uuid())
businessUnitId  String   -> BusinessUnit
contactId       String   @unique -> Contact   // one ClientAccount per Contact
opportunityId   String   -> Opportunity        // the Opportunity that converted
offerId         String   -> Offer
contractState   ContractState    @default(NOT_SENT)   // NOT_SENT, SENT, SIGNED
paymentState    PaymentState     @default(UNPAID)      // UNPAID, DEPOSIT_PAID, PAID_IN_FULL
onboardingState OnboardingState  @default(NOT_STARTED) // NOT_STARTED, IN_PROGRESS, COMPLETE
serviceStatus   ServiceStatus    @default(ACTIVE)       // ACTIVE, AT_RISK, PAUSED, CHURNED
renewalDate     DateTime?
createdAt / updatedAt
```
Created exactly once, at the moment a lead converts (`POST /marketing/leads/:contactId/convert`). Never created directly by a client.

"Next action" is not a new field — it's the existing `Task` model, one open task per Contact/Opportunity, same pattern already used elsewhere in the CRM.

## Screens

1. **Leads** (new route `/marketing/leads`) — table of Contacts with `status=LEAD` in the current workspace. Columns: name, company, source, industry, stage, expected value, owner, next action, age. "New Lead" form creates a Contact + linked Opportunity together.
2. **Pipeline** — the existing `/pipelines` screen, unchanged. Already shows Opportunities by stage with drag-to-move.
3. **Offers & Settings** (new route `/marketing/offers`) — one screen, list + full edit form for the 3 `Offer` records. Combines the Build Spec's separate "Offers" and "Settings" screens for this slice; split later only if Settings grows beyond tier configuration.
4. **Lead/Contact detail** (extends existing Contact detail page) — adds a **"Convert to Client"** action: select an `Offer`; `contractState`/`paymentState` default to `NOT_SENT`/`UNPAID` but the form allows setting them explicitly (e.g. the contract was already signed before this step). Submit creates `ClientAccount`, sets `Opportunity.status = WON` (existing enum, no schema change), and creates one `Task` for "kick off onboarding" (`onboardingState` always starts at `NOT_STARTED` — onboarding itself is sub-project 2's job).

## Workflows

**Lead to Discovery:** create lead (Contact + Opportunity) → assign owner (existing `ownerId`) → record `source` → set next action (Task) → move through pipeline (existing stage drag) → schedule/record discovery (existing Note/Activity).

**Discovery to Client:** select an `Offer` → scope summary is rendered live from the `Offer` record's fields (not duplicated/stored separately, so it can never drift from the canonical tier definition) → record `contractState`/`paymentState` → convert (creates `ClientAccount`, flips `Opportunity.status`) → onboarding checklist is a stub in this slice (`onboardingState = NOT_STARTED`; the actual checklist UI is sub-project 2).

**Client Operation:** out of scope for this slice beyond the stub above.

## Access control

`ClientAccount` and `Offer` are scoped by `businessUnitId`, following the same pattern DOM26-R already established (`BusinessUnitGuard`, `resolveAuthorizedWorkspace`). Since every existing workspace was backfilled to the MARKETING business unit during the Phase 1 migration, no business-unit switcher UI is needed for this slice — the existing workspace scoping is already, in practice, Marketing scoping. A BU switcher becomes necessary only once a second business unit (Photo Booths, WTAE) has real workspaces, which is out of scope here.

## Error handling

- Converting a Contact that already has a `ClientAccount` (via the `@unique` constraint on `contactId`) → 409, clear message, no silent overwrite.
- Converting with an `Offer` that isn't `isPubliclyAvailable` → 403 (mirrors the Build Spec's founder-tier scope requirement: a tier must be complete before it can be sold).
- Deleting/deactivating an `Offer` that has active `ClientAccount` rows referencing it → blocked (`onDelete: Restrict`), consistent with the Restrict-over-Cascade pattern already established for `ConsentDirective` in Phase 1B.

## Testing

Same pattern as Phase 1B: an HTTP-level test suite (`test-marketing-lead-to-client-api.ts`) booting the real Nest app, covering: lead creation, pipeline stage movement, offer CRUD, the conversion endpoint (happy path + the three error cases above), and business-unit scoping (a Photo-Booths-scoped user cannot see or convert a Marketing lead once BU-scoping is exercised). Existing suites (`test-dom26r-*`, `test-workspace-*`, `test-auth-security`, `verify-comprehensive`) re-run as regression, matching the standard established throughout Phase 1B.

## Explicitly out of scope for this slice

- Onboarding checklist UI (sub-project 2)
- Service Delivery tracking (sub-project 2)
- Client Health scoring (sub-project 2)
- Marketing Dashboard, Reports (sub-project 3 — depend on this slice's data existing)
- GHL/GRACE webhook lead ingestion (manual entry only, per explicit decision)
- Business-unit switcher UI (not needed until a second BU has real workspace data)
