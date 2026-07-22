# Phase 2 Sub-project 1: Lead → Client Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Antwann enter a Marketing lead and convert it to an active client account, with an immutable offer snapshot, a truthful service lifecycle, and genuine DOM26-R relationship memory.

**Architecture:** New Marketing-local Prisma models (`Offer`, `OfferSnapshot`, `ClientAccount`, `ClientCommercialStateChange`) plus additive fields on the shared `Opportunity`. A new NestJS `marketing` module (mirroring the `dom26r` module pattern) with services + controllers guarded by `JwtAuthGuard + WorkspaceGuard + BusinessUnitGuard`. Conversion is one atomic `prisma.$transaction` with idempotency. DOM26-R integration reuses the existing Phase 1B services. Frontend adds `/marketing/leads` and `/marketing/offers` routes plus a Convert action and Relationship Brief on the contact detail page.

**Tech Stack:** NestJS, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16, Next.js 16, class-validator DTOs. Tests are standalone `backend/test-*.ts` scripts that boot the real Nest app (Phase 1B pattern).

**Pre-existing-schema notes (verified against schema.prisma before planning):**
- `Contact.source` ALREADY EXISTS (line ~729). Leave it untouched; do NOT use it for acquisition-source logic. Acquisition source goes on `Opportunity`.
- `Company.industry` ALREADY EXISTS (line ~711). Reuse it; do NOT re-add it.
- `Opportunity.status` enum `OpportunityStatus` already includes `WON` (no enum change needed at conversion).
- `RelationshipBrief` visibility today is 2-tier (`INTERNAL_AGENT` | `CUSTOMER_VISIBLE`) in `relationship-brief.service.ts`. This plan adds `INTERNAL_HUMAN` as a middle tier.

---

## File structure

**Backend — new files:**
- `backend/src/modules/marketing/marketing.module.ts` — wires the module
- `backend/src/modules/marketing/offer.service.ts` — Offer CRUD + lifecycle
- `backend/src/modules/marketing/offer.controller.ts` — `/marketing/offers`
- `backend/src/modules/marketing/lead.service.ts` — lead list/create (Contact+Opportunity+optional Company)
- `backend/src/modules/marketing/lead.controller.ts` — `/marketing/leads`
- `backend/src/modules/marketing/client-account.service.ts` — the conversion transaction + commercial-state changes
- `backend/src/modules/marketing/client-account.controller.ts` — `/marketing/leads/:contactId/convert`, client read
- `backend/src/modules/marketing/marketing-relationship.service.ts` — DOM26-R candidate creation + Marketing brief generation
- `backend/src/modules/marketing/dto/*.ts` — DTOs
- `backend/test-marketing-lead-to-client-api.ts` — HTTP-level suite

**Backend — modified:**
- `backend/prisma/schema.prisma` — new models + `Opportunity` fields + `INTERNAL_HUMAN` handling
- `backend/src/app.module.ts` — register `MarketingModule`
- `backend/src/modules/dom26r/relationship-brief.service.ts` — add `INTERNAL_HUMAN` tier
- `backend/prisma/seed.ts` — seed 3 founder-tier Offers per Marketing BU

**Frontend — new files:**
- `frontend/src/app/marketing/leads/page.tsx`
- `frontend/src/app/marketing/offers/page.tsx`
- `frontend/src/lib/api.ts` — add marketing API calls (modify)
- Contact detail page — add Convert action + Brief (modify existing)

---

## Task 1: Schema — additive Opportunity fields + new enums

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add acquisition fields to `Opportunity`**

In the `Opportunity` model, add:
```prisma
  source          String?   // acquisition source for THIS business relationship
  industryContext String?   // temp qualification context when Company unknown
  clientAccount   ClientAccount? @relation("AcquisitionOpportunity")
```

- [ ] **Step 2: Add the new enums** (near the other enums, top of file)

```prisma
enum OfferLifecycleState {
  DRAFT
  ACTIVE
  RETIRED
}

enum MarketingServiceStatus {
  PENDING_ONBOARDING
  ACTIVE
  AT_RISK
  PAUSED
  CHURNED
}

enum MarketingOnboardingState {
  NOT_STARTED
  IN_PROGRESS
  COMPLETE
}
```

- [ ] **Step 3: Validate schema parses**

Run: `cd backend && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀" (models referenced but not yet defined will error — that's expected until Task 2; if so, do Task 2 before validating)

- [ ] **Step 4: Commit** (combined with Task 2 — do not commit a non-parsing schema)

---

## Task 2: Schema — Offer, OfferSnapshot, ClientAccount, ClientCommercialStateChange

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/prisma/schema.prisma` — add back-relations on `BusinessUnit`, `Company`, `Contact`, `User`, `Workspace`

- [ ] **Step 1: Add the four models**

```prisma
model Offer {
  id                     String              @id @default(uuid())
  businessUnitId         String
  businessUnit           BusinessUnit        @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  key                    String
  version                Int                 @default(1)
  name                   String
  price                  Decimal             @db.Decimal(12, 2)
  setupFee               Decimal?            @db.Decimal(12, 2)
  includedServices       String[]
  excludedServices       String[]
  onboardingRequirements String[]
  supportBoundaries      String
  reportingCadence       String
  cancellationTerms      String
  expectedLaunchTime     String
  lifecycleState         OfferLifecycleState @default(DRAFT)
  isPubliclyAvailable    Boolean             @default(false)
  snapshots              OfferSnapshot[]
  clientAccounts         ClientAccount[]
  createdAt              DateTime            @default(now())
  updatedAt              DateTime            @updatedAt

  @@unique([businessUnitId, key, version])
  @@index([businessUnitId, lifecycleState])
}

model OfferSnapshot {
  id                     String         @id @default(uuid())
  offerId                String
  offer                  Offer          @relation(fields: [offerId], references: [id], onDelete: Restrict)
  offerVersion           Int
  key                    String
  name                   String
  price                  Decimal        @db.Decimal(12, 2)
  setupFee               Decimal?       @db.Decimal(12, 2)
  includedServices       String[]
  excludedServices       String[]
  onboardingRequirements String[]
  supportBoundaries      String
  reportingCadence       String
  cancellationTerms      String
  expectedLaunchTime     String
  clientAccount          ClientAccount?
  createdAt              DateTime       @default(now())
}

model ClientAccount {
  id                       String                        @id @default(uuid())
  businessUnitId           String
  businessUnit             BusinessUnit                  @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  companyId                String?
  company                  Company?                      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  primaryContactId         String
  primaryContact           Contact                       @relation(fields: [primaryContactId], references: [id], onDelete: Restrict)
  acquisitionOpportunityId String                        @unique
  acquisitionOpportunity   Opportunity                   @relation("AcquisitionOpportunity", fields: [acquisitionOpportunityId], references: [id], onDelete: Restrict)
  offerId                  String
  offer                    Offer                         @relation(fields: [offerId], references: [id], onDelete: Restrict)
  offerSnapshotId          String                        @unique
  offerSnapshot            OfferSnapshot                 @relation(fields: [offerSnapshotId], references: [id], onDelete: Restrict)
  serviceStatus            MarketingServiceStatus        @default(PENDING_ONBOARDING)
  onboardingState          MarketingOnboardingState      @default(NOT_STARTED)
  renewalDate              DateTime?
  commercialChanges        ClientCommercialStateChange[]
  idempotencyKeys          ConversionIdempotencyKey[]
  createdAt                DateTime                      @default(now())
  updatedAt                DateTime                      @updatedAt

  @@unique([businessUnitId, companyId])
  @@unique([businessUnitId, primaryContactId])
  @@index([businessUnitId, serviceStatus])
}

model ClientCommercialStateChange {
  id              String        @id @default(uuid())
  clientAccountId String
  clientAccount   ClientAccount @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  field           String        // "CONTRACT" | "PAYMENT"
  newValue        String        // e.g. "SIGNED_MANUAL", "DEPOSIT_PAID_MANUAL"
  recordedById    String
  recordedBy      User          @relation(fields: [recordedById], references: [id])
  source          String        @default("MANUAL")
  createdAt       DateTime      @default(now())

  @@index([clientAccountId, field, createdAt])
}

model ConversionIdempotencyKey {
  key             String   @id
  clientAccountId String
  clientAccount   ClientAccount @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  createdAt       DateTime @default(now())
}
```

- [ ] **Step 2: Add back-relations** to existing models so Prisma validates:
  - `BusinessUnit`: `offers Offer[]`, `clientAccounts ClientAccount[]`
  - `Company`: `clientAccount ClientAccount?`
  - `Contact`: `clientAccount ClientAccount?`
  - `User`: `commercialStateChanges ClientCommercialStateChange[]`

- [ ] **Step 3: Validate + format**

Run: `cd backend && npx prisma validate && npx prisma format`
Expected: valid.

- [ ] **Step 4: Create the migration (do not apply to staging)**

Run: `cd backend && npx prisma migrate dev --name phase_2_marketing_lead_to_client --create-only`
Then review the generated `migration.sql` — confirm it is purely additive (new tables, new enum types, two new nullable columns on `Opportunity`). No `ALTER COLUMN ... NOT NULL` on existing populated columns.

- [ ] **Step 5: Write rollback.sql** in the new migration folder (mirror the Phase 1B convention): `DROP TABLE IF EXISTS ... CASCADE` for the 5 new tables (`Offer`, `OfferSnapshot`, `ClientAccount`, `ClientCommercialStateChange`, `ConversionIdempotencyKey`), `ALTER TABLE "Opportunity" DROP COLUMN IF EXISTS "source"`, `DROP COLUMN IF EXISTS "industryContext"`, and `DROP TYPE IF EXISTS` for the 3 new enums.

- [ ] **Step 6: Apply locally + regenerate client**

Run: `cd backend && npx prisma migrate dev`
Expected: migration applied, client regenerated.

- [ ] **Step 7: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/*_phase_2_marketing_lead_to_client
git commit -m "feat(marketing): add Offer/OfferSnapshot/ClientAccount schema + Opportunity acquisition fields"
```

---

## Task 3: Seed the 3 founder-tier Offers

**Files:**
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: Extend seed** to upsert 3 `Offer` rows (`lifecycleState: ACTIVE`) for each MARKETING BusinessUnit, upserted on `businessUnitId_key_version`, with this exact content (flagged to Antwann as seed defaults he should correct via the Offers & Settings screen once it ships in Task 10 — these are deliberately conservative placeholders because the Build Spec locks the three price points but not the exact scope copy):

```ts
const founderTiers = [
  {
    key: 'FOUNDER_99', version: 1, name: 'Founder $99', price: 99.00, setupFee: null,
    includedServices: ['Monthly strategy check-in', 'CRM access', 'Email support'],
    excludedServices: ['Done-for-you ad management', 'Custom automation builds'],
    onboardingRequirements: ['Complete intake form', 'Connect CRM workspace'],
    supportBoundaries: 'Email support, 48-hour response time',
    reportingCadence: 'Monthly summary report',
    cancellationTerms: 'Cancel anytime, no refund for the current billing period',
    expectedLaunchTime: '7 days from signed contract',
  },
  {
    key: 'FOUNDER_299', version: 1, name: 'Founder $299', price: 299.00, setupFee: null,
    includedServices: ['Everything in Founder $99', 'Bi-weekly strategy call', 'One automation build per month'],
    excludedServices: ['Full done-for-you ad management', 'Dedicated account manager'],
    onboardingRequirements: ['Complete intake form', 'Connect CRM workspace', 'Kickoff call scheduled'],
    supportBoundaries: 'Email + chat support, 24-hour response time',
    reportingCadence: 'Bi-weekly summary report',
    cancellationTerms: 'Cancel anytime, no refund for the current billing period',
    expectedLaunchTime: '5 days from signed contract',
  },
  {
    key: 'FOUNDER_999', version: 1, name: 'Founder $999', price: 999.00, setupFee: null,
    includedServices: ['Everything in Founder $299', 'Weekly strategy call', 'Dedicated account manager', 'Unlimited automation builds'],
    excludedServices: ['Paid ad spend management (billed separately)'],
    onboardingRequirements: ['Complete intake form', 'Connect CRM workspace', 'Kickoff call scheduled', 'Brand assets received'],
    supportBoundaries: 'Priority email + chat + phone support, same-day response time',
    reportingCadence: 'Weekly summary report',
    cancellationTerms: '30-day notice required for cancellation',
    expectedLaunchTime: '3 days from signed contract',
  },
];
```

- [ ] **Step 2: Run seed locally, verify**

Run: `cd backend && npx ts-node prisma/seed.ts`
Then a one-off count query: 3 offers per MARKETING BU, all `ACTIVE`.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(marketing): seed three founder-tier offers per Marketing business unit"
```

---

## Task 4: OfferService + controller (CRUD + lifecycle)

**Files:**
- Create: `backend/src/modules/marketing/offer.service.ts`
- Create: `backend/src/modules/marketing/offer.controller.ts`
- Create: `backend/src/modules/marketing/dto/offer.dto.ts`
- Create: `backend/src/modules/marketing/marketing.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1:** Write `CreateOfferDto` / `UpdateOfferDto` with class-validator (`@IsString`, `@IsNumber`, `@IsArray`, `@IsEnum(OfferLifecycleState)` for the lifecycle transition endpoint). No `@Body() body: any` — DTOs are mandatory (matches the WorkspaceController hardening lesson).

- [ ] **Step 2:** `OfferService` methods, all `businessUnitId`-scoped:
  - `findAll(businessUnitId)` — list
  - `findByIdScoped(businessUnitId, id)`
  - `create(businessUnitId, dto)` — new offer at `DRAFT`
  - `update(businessUnitId, id, dto)` — if a material commercial field changed on an `ACTIVE` offer, bump `version`
  - `setLifecycle(businessUnitId, id, state)` — DRAFT→ACTIVE→RETIRED transitions
  - `assertSellable(tx, businessUnitId, offerId)` — throws `UnprocessableEntityException` (422) if `lifecycleState !== ACTIVE`; used by conversion

- [ ] **Step 3:** `OfferController` at `@Controller('marketing/offers')`, guarded `@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)`, using `@CurrentBusinessUnitId()`. Routes: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/lifecycle`.

- [ ] **Step 4:** `MarketingModule` (mirror `dom26r.module.ts`: provide `PrismaService`, `BusinessUnitGuard`, `OfferService`; controllers `[OfferController]`). Register in `app.module.ts` imports.

- [ ] **Step 5:** Typecheck + lint

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6:** Nest build

Run: `cd backend && npx nest build`
Expected: BUILD OK (proves module wiring).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/marketing/ backend/src/app.module.ts
git commit -m "feat(marketing): OfferService + controller with lifecycle and DTO validation"
```

---

## Task 5: LeadService + controller

**Files:**
- Create: `backend/src/modules/marketing/lead.service.ts`
- Create: `backend/src/modules/marketing/lead.controller.ts`
- Create: `backend/src/modules/marketing/dto/lead.dto.ts`
- Modify: `backend/src/modules/marketing/marketing.module.ts`

- [ ] **Step 1:** `CreateLeadDto` — firstName, lastName, emails[], phones[], optional companyName/companyId, optional source, optional industryContext, pipelineId, stageId, expectedValue.

- [ ] **Step 2:** `LeadService`:
  - `findAllLeads(workspaceId)` — Contacts with `status=LEAD`, join company + primary open Task + acquisition Opportunity (source, stage, value). Exclude Contacts that already have a `ClientAccount` (converted leads disappear).
  - `createLead(workspaceId, dto)` — `$transaction`: optionally find/create Company (with `industry`), create Contact (`status=LEAD`), create Opportunity (`source`, `industryContext`, pipeline/stage), create the designated primary Task ("Follow up"). Normalized-email/phone duplicate detection: before create, look up existing Contact by normalized email/phone in the workspace; return a `duplicateWarning` field alongside the created lead (warn + allow).

- [ ] **Step 3:** `LeadController` at `@Controller('marketing/leads')`, guarded, `@CurrentWorkspaceId()` + `@CurrentBusinessUnitId()`. `GET /`, `POST /`.

- [ ] **Step 4:** Register in module. Typecheck + lint + build.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/
git commit -m "feat(marketing): LeadService + controller with duplicate detection"
```

---

## Task 6: MarketingRelationshipService (DOM26-R integration)

**Files:**
- Create: `backend/src/modules/marketing/marketing-relationship.service.ts`
- Modify: `backend/src/modules/dom26r/relationship-brief.service.ts` (add INTERNAL_HUMAN)
- Modify: `backend/src/modules/marketing/marketing.module.ts` (import Dom26rModule's exported services)

- [ ] **Step 1: Add INTERNAL_HUMAN tier** to `relationship-brief.service.ts`. Change the `BriefVisibility` type to `'INTERNAL_AGENT' | 'INTERNAL_HUMAN' | 'CUSTOMER_VISIBLE'`. In `getFormatted`: `CUSTOMER_VISIBLE` unchanged (PUBLIC-only, text only); `INTERNAL_HUMAN` returns briefText + generatedAt + relationship stage + non-confidence fields but strips generator/version/raw evidence chain; `INTERNAL_AGENT` returns everything (unchanged). Update the existing `test-dom26r-api.ts` expectations accordingly.

- [ ] **Step 2:** `MarketingRelationshipService` takes constructor deps `MemoryCandidateService`, `EngramService`, `RelationshipBriefService` (exported by `Dom26rModule`). Methods:
  - `recordConversionFacts(tx-context args)` — creates DOM26-R `MemoryCandidate`s (PENDING, controlled) for: acquisition source, confirmed business context, stated goal, communication preference, offer selected, commitments made by DEMM, next promised action. Each with `EngramSource` provenance (`type: EVENT`, `referenceId` = clientAccount id). The **conversion milestone** is created as an observed engram (via `EngramService.create`, high confidence) rather than a pending candidate — it is a system-observed event, not an inferred claim.
  - `generateMarketingBrief(businessUnitId, profileId, ...)` — builds a brief via `RelationshipBriefService.generate` containing identity/business, relationship stage, selected Offer, stated goal, confirmed preferences, previous interaction, open commitment, next action, memories-requiring-reconfirmation.

  Note: `MemoryCandidateService.create` and `EngramService.create` open their own `$transaction` internally today. For the conversion to be atomic (Task 7), add tx-aware variants or have these methods accept an optional Prisma tx client. **Decision:** add an optional `tx?` param to `MemoryCandidateService.create` / `EngramService.create` that, when passed, uses it instead of opening a new transaction. This keeps the conversion truly atomic. Update the existing DOM26-R tests to confirm the no-arg path still works.

- [ ] **Step 3:** Typecheck + lint + build. Re-run `test-dom26r-api.ts` and `test-dom26r-comprehensive.ts` (the INTERNAL_HUMAN + tx-param changes must not regress them).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/marketing/ backend/src/modules/dom26r/
git commit -m "feat(marketing): DOM26-R integration service + INTERNAL_HUMAN brief tier + tx-aware candidate/engram creation"
```

---

## Task 7: ClientAccountService — the atomic conversion

**Files:**
- Create: `backend/src/modules/marketing/client-account.service.ts`
- Create: `backend/src/modules/marketing/client-account.controller.ts`
- Create: `backend/src/modules/marketing/dto/convert-lead.dto.ts`
- Modify: `backend/src/modules/marketing/marketing.module.ts`

- [ ] **Step 1:** `ConvertLeadDto` — offerId, optional manually-recorded contractState/paymentState (enum-validated strings with `_MANUAL` suffix), optional companyId.

- [ ] **Step 2:** `ClientAccountService.convert(organizationId, businessUnitId, workspaceId, actorId, correlationId, contactId, idempotencyKey, dto)` — one `prisma.$transaction(async (tx) => { ... })` performing all 11 steps in order:
  1. resolve the Contact in scope (throw 403 if not in this workspace/BU);
  2. resolve the acquisition Opportunity (the Contact's open Opportunity) + Company in scope;
  3. `offerService.assertSellable(tx, businessUnitId, offerId)` → 422 if not ACTIVE;
  4. duplicate-conversion guard: check the BU-scoped `@@unique` targets AND the idempotency key store (see Step 3) → 409 if already converted;
  5. create `ClientAccount` (`serviceStatus: PENDING_ONBOARDING`);
  6. read the live Offer, write the immutable `OfferSnapshot` (copy every commercial field + version), link `offerSnapshotId`;
  7. `tx.opportunity.update` → `status: WON`;
  8. `tx.contact.update` → `status: ContactStatus.CUSTOMER` (verified enum: `LEAD | CONTACTED | PROPOSAL | CUSTOMER` in `schema.prisma`);
  9. create the onboarding kickoff `Task` (designated primary next-action);
  10. write `AuditLog` + `MemoryAuditEvent` (via the tx-aware DOM26-R audit path);
  11. `marketingRelationshipService.recordConversionFacts(tx, ...)` — candidates + milestone engram, and the manually-recorded contract/payment `ClientCommercialStateChange` rows (with `recordedById = actorId`).

  If any step throws, the whole `$transaction` rolls back — no partial ClientAccount/snapshot/WON leak.

- [ ] **Step 3: Idempotency.** Accept an `Idempotency-Key` header. Before starting the transaction, check `ConversionIdempotencyKey` (created in Task 2) for that key: if found, return the linked `ClientAccount` unchanged (no new work). If not found, run the full conversion inside the transaction and write the `ConversionIdempotencyKey` row as its final step (11b), so a duplicate submit racing the same transaction is caught by the model's own `@id` uniqueness on `key`.

- [ ] **Step 4:** `ClientAccountController` at `@Controller('marketing/leads')` for `POST /:contactId/convert` (reads `Idempotency-Key` header) and `@Controller('marketing/clients')` for `GET /:id` (client detail incl. snapshot + derived current commercial state + brief).

- [ ] **Step 5:** Typecheck + lint + build.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/marketing/ backend/prisma/
git commit -m "feat(marketing): atomic idempotent lead-to-client conversion with immutable offer snapshot"
```

---

## Task 8: HTTP-level test suite

**Files:**
- Create: `backend/test-marketing-lead-to-client-api.ts`

- [ ] **Step 1:** Mirror `test-dom26r-api.ts` structure (boot real Nest app on port 0, real guard chain, JWT minted directly, `check()` helper). Cover every item from the spec's Testing section:
  - lead creation + duplicate-contact detection by normalized email/phone
  - offer CRUD + lifecycle transitions
  - Company-based ClientAccount creation
  - Contact-only sole-proprietor path
  - cross-BU denial (403)
  - inactive/retired Offer rejection (422, assert status code is exactly 422 not 403)
  - immutable snapshot: convert, then edit the canonical Offer, assert the ClientAccount's snapshot fields are unchanged
  - conversion rollback: force a failure in the candidate-creation step (e.g. inject an invalid profile ref) and assert NO ClientAccount / OfferSnapshot / WON-status persisted
  - duplicate-submit / idempotency: same Idempotency-Key twice → one ClientAccount, second call returns the same id
  - converted lead disappears from `GET /marketing/leads`
  - ClientAccount begins at PENDING_ONBOARDING
  - DOM26-R candidate provenance: candidates PENDING (not auto-promoted), evidence chain present, conversion milestone is an ACTIVE engram
  - Relationship Brief visibility across INTERNAL_AGENT / INTERNAL_HUMAN / CUSTOMER_VISIBLE
  - Clean up all created rows at the end (respect RESTRICT FKs: delete children first).

- [ ] **Step 2:** Run against local DB.

Run: `cd backend && npx ts-node test-marketing-lead-to-client-api.ts`
Expected: all checks pass.

- [ ] **Step 3: Commit**

```bash
git add backend/test-marketing-lead-to-client-api.ts
git commit -m "test(marketing): HTTP-level lead-to-client suite (conversion, snapshot immutability, rollback, idempotency, DOM26-R)"
```

---

## Task 9: Full backend regression

- [ ] **Step 1:** Run every existing suite + new one:

```bash
cd backend
npx ts-node test-auth-security.ts
npx ts-node test-workspace-guard-api.ts
npx ts-node test-workspace-controller-security.ts
npx ts-node test-dom26r-api.ts
npx ts-node test-dom26r-comprehensive.ts
npx ts-node test-isolation.ts
npx ts-node verify-comprehensive.ts
npx ts-node test-marketing-lead-to-client-api.ts
npm run lint
npx tsc --noEmit
npx nest build
```
Expected: all green. Fix any regression before proceeding.

- [ ] **Step 2:** No commit (verification only) unless a fix was needed.

---

## Task 10: Frontend — Offers & Settings screen

**Files:**
- Create: `frontend/src/app/marketing/offers/page.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1:** Add marketing API calls to `api.ts`: `getOffers`, `createOffer`, `updateOffer`, `setOfferLifecycle` (all send `x-workspace-id` via the existing `request()` helper).
- [ ] **Step 2:** Build `/marketing/offers` page: list offers with lifecycle badge, edit form for all scope fields, lifecycle transition buttons (DRAFT→ACTIVE→RETIRED). Follow the existing pages' styling (invoke the `hallmark` skill per the global CLAUDE.md rule before shipping any new UI surface).
- [ ] **Step 3:** `npx tsc --noEmit` in frontend; `npm run lint`.
- [ ] **Step 4: Commit.**

---

## Task 11: Frontend — Leads screen + Convert action + Relationship Brief

**Files:**
- Create: `frontend/src/app/marketing/leads/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: existing contact detail page

- [ ] **Step 1:** API calls: `getLeads`, `createLead`, `convertLead` (sends `Idempotency-Key`), `getMarketingBrief`.
- [ ] **Step 2:** `/marketing/leads` page: table (name, company, source, industry, stage, value, owner, next action, age), "New Lead" form. Converted leads absent.
- [ ] **Step 3:** Contact detail: "Convert to Client" action (select ACTIVE offer, optional manually-recorded contract/payment state clearly labeled "manually recorded"), and render the Marketing Relationship Brief (INTERNAL_HUMAN tier for the logged-in operator).
- [ ] **Step 4:** Invoke `hallmark` skill before shipping. `tsc --noEmit`, lint.
- [ ] **Step 5: Commit.**

---

## Task 12: Browser verification + deliverable write-up

- [ ] **Step 1:** Start frontend + backend locally, walk the golden path in a browser: create a lead → move stage → convert → confirm ClientAccount at PENDING_ONBOARDING, brief renders, converted lead gone from Leads. Capture screenshots.
- [ ] **Step 2:** Write the 10-item deliverable (final schema changes, migration+rollback plan, API inventory, screens completed, transaction design, DOM26-R integration behavior, test results, screenshots/walkthrough, commit SHAs, known limitations) as `docs/releases/phase-2-sp1/deliverable.md`.
- [ ] **Step 3:** Capture completion to Dom26v3 + gbrain.
- [ ] **Step 4: Commit.**

---

## Staging deployment (separate, gated)

Do NOT deploy or migrate staging as part of this plan. After Antwann reviews the local implementation and deliverable, follow the same 10-point staging brief format used for the security hotfix (fresh backup, `prisma migrate deploy`, `cloudbuild.yaml` deploy with real commit SHA, smoke tests, session handling) as a separate approved action.

## Known-limitation carry-forwards (document, don't fix here)
- Contract/payment states are manually recorded (no Stripe/DocuSign yet) — labeled as such.
- No BU-switcher UI (single Marketing BU in practice until a second BU has workspaces).
- Onboarding checklist, Service Delivery, Client Health, Dashboard, Reports are later sub-projects.
- `Contact.source` (pre-existing global field) is intentionally left unused by acquisition logic; a future cleanup may deprecate it.
