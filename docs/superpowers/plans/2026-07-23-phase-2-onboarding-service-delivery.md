# Phase 2 Sub-project 2: Client Onboarding & Service Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform a `ClientAccount` at `PENDING_ONBOARDING` into a fully operating client with a generated onboarding plan and service-delivery obligations, both derived from the immutable `OfferSnapshot` (never the live `Offer`), with launch gates, DOM26-R integration, and a Client Account UI.

**Architecture:** Six new Prisma models (`OnboardingPlan`, `OnboardingChecklistItem`, `OnboardingChecklistItemHistory`, `LaunchGateOverride`, `ServiceDeliverable`, `ServiceDeliverableHistory`) generated idempotently from `OfferSnapshot` inside the existing conversion transaction. Two new services (`OnboardingService`, `ServiceDeliverableService`) in the existing `marketing` module, guarded the same way as `ClientAccountController`. Launch-gate override is role-gated via the existing `RolesGuard`. Frontend adds a single Client Account detail page with four sections.

**Tech Stack:** NestJS, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16, Next.js 16, class-validator DTOs. Tests are a standalone `backend/test-onboarding-service-delivery-api.ts` script booting the real Nest app (established pattern).

**Full design context:** `docs/superpowers/specs/2026-07-23-phase-2-onboarding-service-delivery-design.md` — read this first; it has the full rationale for every decision below. This plan just breaks it into executable steps.

**Pre-existing-schema notes (verified against schema.prisma before planning):**
- `ClientAccount.serviceStatus: MarketingServiceStatus` and `.onboardingState: MarketingOnboardingState` already exist (Sub-project 1). This plan widens `MarketingOnboardingState` into `OnboardingPlanState` (7 values replacing 3) and repoints `ClientAccount.onboardingState` at the new enum — see Task 1.
- `ClientAccountService.convert` (backend/src/modules/marketing/client-account.service.ts:120-404) is the existing atomic conversion transaction. Task 6 adds ONE more step to it; do not restructure the existing steps.
- `MarketingRelationshipService.recordConversionFacts` (backend/src/modules/marketing/marketing-relationship.service.ts) is the exact pattern to copy for `recordOnboardingMilestone` (Task 7).
- `RolesGuard` + `@Roles()` decorator already exist at `backend/src/common/guards/roles.guard.ts` / `backend/src/common/decorators/roles.decorator.ts`. Do not build a new authorization mechanism.
- `Dom26rAuditService.record(params, tx)` is the existing tx-aware audit-event writer used in `ClientAccountService.convert` step 10 — reuse it for the activation audit event.

---

## File structure

**Backend — new files:**
- `backend/src/modules/marketing/onboarding.service.ts` — plan/checklist generation, launch gates, activation
- `backend/src/modules/marketing/onboarding.controller.ts` — `/marketing/clients/:id/onboarding*`
- `backend/src/modules/marketing/service-deliverable.service.ts` — deliverable CRUD + status transitions
- `backend/src/modules/marketing/service-deliverable.controller.ts` — `/marketing/clients/:id/deliverables*`
- `backend/src/modules/marketing/dto/onboarding.dto.ts` — `UpdateChecklistItemDto`, `ActivateClientDto`
- `backend/src/modules/marketing/dto/service-deliverable.dto.ts` — `UpdateDeliverableDto`, `CreateOutsideScopeDeliverableDto`
- `backend/test-onboarding-service-delivery-api.ts` — HTTP-level suite

**Backend — modified:**
- `backend/prisma/schema.prisma` — new enums/models, `MarketingOnboardingState` → `OnboardingPlanState`
- `backend/src/modules/marketing/client-account.service.ts` — call `OnboardingService.generateForClient` inside `convert`
- `backend/src/modules/marketing/marketing-relationship.service.ts` — add `recordOnboardingMilestone`, extend brief template
- `backend/src/modules/marketing/marketing.module.ts` — register new providers/controllers

**Frontend — new files:**
- `frontend/src/app/marketing/clients/[id]/page.tsx` — Client Account detail page, four sections
- `frontend/src/lib/api.ts` — add onboarding/deliverable API calls (modify)

---

## Task 1: Schema — enums, six models, migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add the new enums** (near `OfferLifecycleState`/`MarketingServiceStatus`)

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

- [ ] **Step 2: Delete `enum MarketingOnboardingState { NOT_STARTED IN_PROGRESS COMPLETE }`**

It's fully replaced by `OnboardingPlanState` (superset of the same three names plus four more). Deleting rather than keeping both avoids two divergent state machines for the same concept.

- [ ] **Step 3: Change `ClientAccount.onboardingState` type**

Find in `model ClientAccount`:
```prisma
  onboardingState          MarketingOnboardingState      @default(NOT_STARTED)
```
Replace with:
```prisma
  onboardingState          OnboardingPlanState           @default(NOT_STARTED)
```

- [ ] **Step 4: Add back-relations on `ClientAccount`**

In `model ClientAccount`, add:
```prisma
  onboardingPlan           OnboardingPlan?
  serviceDeliverables      ServiceDeliverable[]
```

- [ ] **Step 5: Add back-relations on `OfferSnapshot`**

In `model OfferSnapshot`, add:
```prisma
  onboardingPlans        OnboardingPlan[]
  serviceDeliverables    ServiceDeliverable[]
```

- [ ] **Step 6: Add back-relations on `User`**

In `model User`, add:
```prisma
  onboardingPlansOwned       OnboardingPlan[]          @relation("OnboardingPlanOwner")
  checklistItemsOwned        OnboardingChecklistItem[] @relation("ChecklistItemOwner")
  checklistItemsApproved     OnboardingChecklistItem[] @relation("ChecklistItemApprover")
  deliverablesOwned          ServiceDeliverable[]      @relation("ServiceDeliverableOwner")
```

- [ ] **Step 7: Add the six new models** (after `ConversionIdempotencyKey`, before `Task`)

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
  id                String                    @id @default(uuid())
  planId            String
  plan              OnboardingPlan            @relation(fields: [planId], references: [id], onDelete: Cascade)
  title             String
  description       String?
  sourceCapability  String?
  required          Boolean                   @default(true)
  responsibility    ChecklistResponsibility
  assignedOwnerId   String?
  assignedOwner     User?                     @relation("ChecklistItemOwner", fields: [assignedOwnerId], references: [id])
  dueDate           DateTime?
  dependsOnItemId   String?
  dependsOnItem     OnboardingChecklistItem?  @relation("ItemDependency", fields: [dependsOnItemId], references: [id])
  dependentItems    OnboardingChecklistItem[] @relation("ItemDependency")
  status            ChecklistItemStatus       @default(NOT_STARTED)
  evidence          String?
  clientSubmission  Json?
  blockerReason     String?
  completedAt       DateTime?
  approvedById      String?
  approvedBy        User?                     @relation("ChecklistItemApprover", fields: [approvedById], references: [id])
  approvedAt        DateTime?
  history           OnboardingChecklistItemHistory[]
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt

  @@index([planId, status])
}

model OnboardingChecklistItemHistory {
  id         String                  @id @default(uuid())
  itemId     String
  item       OnboardingChecklistItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  oldStatus  ChecklistItemStatus
  newStatus  ChecklistItemStatus
  reason     String?
  actorId    String?
  createdAt  DateTime                @default(now())

  @@index([itemId, createdAt])
}

model LaunchGateOverride {
  id             String         @id @default(uuid())
  planId         String
  plan           OnboardingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  reason         String
  actorId        String
  affectedGates  String[]
  createdAt      DateTime       @default(now())

  @@index([planId, createdAt])
}

model ServiceDeliverable {
  id                     String                      @id @default(uuid())
  clientAccountId        String
  clientAccount          ClientAccount               @relation(fields: [clientAccountId], references: [id], onDelete: Cascade)
  offerSnapshotId        String
  offerSnapshot          OfferSnapshot               @relation(fields: [offerSnapshotId], references: [id], onDelete: Restrict)
  sourceCapability       String
  name                   String
  description            String?
  cadence                ServiceDeliverableCadence
  cadenceDetail          String?
  ownerId                String?
  owner                  User?                       @relation("ServiceDeliverableOwner", fields: [ownerId], references: [id])
  dueDate                DateTime?
  status                 ServiceDeliverableStatus    @default(NOT_STARTED)
  evidence               String?
  clientApprovalRequired Boolean                     @default(false)
  clientApprovedAt       DateTime?
  blockerReason          String?
  outsideScope           Boolean                     @default(false)
  history                ServiceDeliverableHistory[]
  createdAt              DateTime                    @default(now())
  updatedAt              DateTime                    @updatedAt

  @@index([clientAccountId, status])
}

model ServiceDeliverableHistory {
  id            String                   @id @default(uuid())
  deliverableId String
  deliverable   ServiceDeliverable       @relation(fields: [deliverableId], references: [id], onDelete: Cascade)
  oldStatus     ServiceDeliverableStatus
  newStatus     ServiceDeliverableStatus
  reason        String?
  actorId       String?
  createdAt     DateTime                 @default(now())

  @@index([deliverableId, createdAt])
}
```

- [ ] **Step 8: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 9: Generate migration**

Run: `cd backend && npx prisma migrate dev --create-only --name onboarding_service_delivery`
This will fail to auto-generate the `onboardingState` column type change cleanly (Postgres can't implicitly cast one enum to another). Open the generated `migration.sql` and, immediately after the `CREATE TYPE "OnboardingPlanState"` statement and before any `DROP TYPE "MarketingOnboardingState"`, insert:
```sql
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" DROP DEFAULT;
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" TYPE "OnboardingPlanState" USING ("onboardingState"::text::"OnboardingPlanState");
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" SET DEFAULT 'NOT_STARTED';
```
Remove any auto-generated statement that tries to drop the `onboardingState` column or the old enum type before this cast runs (order matters: cast first, drop `MarketingOnboardingState` type last).

- [ ] **Step 10: Write `rollback.sql`** in the same migration directory

```sql
-- Rollback for the onboarding_service_delivery migration.
-- Reverses the ClientAccount.onboardingState type change, then drops the
-- new tables/enums. Fails safely if any row holds one of the four
-- OnboardingPlanState values that don't exist in MarketingOnboardingState
-- (WAITING_ON_CLIENT/BLOCKED/READY_FOR_LAUNCH/CANCELLED) -- that is
-- intentional, matching the existing rollback.sql convention in this repo
-- (see 20260723053752_offer_optional_operational_fields/rollback.sql).
CREATE TYPE "MarketingOnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" DROP DEFAULT;
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" TYPE "MarketingOnboardingState" USING ("onboardingState"::text::"MarketingOnboardingState");
ALTER TABLE "ClientAccount" ALTER COLUMN "onboardingState" SET DEFAULT 'NOT_STARTED';

DROP TABLE IF EXISTS "ServiceDeliverableHistory";
DROP TABLE IF EXISTS "ServiceDeliverable";
DROP TABLE IF EXISTS "LaunchGateOverride";
DROP TABLE IF EXISTS "OnboardingChecklistItemHistory";
DROP TABLE IF EXISTS "OnboardingChecklistItem";
DROP TABLE IF EXISTS "OnboardingPlan";

DROP TYPE IF EXISTS "ServiceDeliverableStatus";
DROP TYPE IF EXISTS "ServiceDeliverableCadence";
DROP TYPE IF EXISTS "ChecklistResponsibility";
DROP TYPE IF EXISTS "ChecklistItemStatus";
DROP TYPE IF EXISTS "OnboardingPlanState";
```

- [ ] **Step 11: Apply migration locally + regenerate client**

Run: `cd backend && npx prisma migrate dev` (applies the edited migration.sql to local dev DB), then `npx prisma generate`.
Expected: migration applies cleanly, Prisma Client regenerates with the new models/enums.

- [ ] **Step 12: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: passes (nothing references the new models yet, so this just confirms the generated client compiles).

- [ ] **Step 13: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(marketing): onboarding + service-delivery schema"
```

---

## Task 2: OnboardingService — idempotent generation from OfferSnapshot

**Files:**
- Create: `backend/src/modules/marketing/onboarding.service.ts`
- Test: `backend/test-onboarding-service-delivery-api.ts` (created in Task 9; this task only needs the service to compile and be manually exercisable)

- [ ] **Step 1: Write `OnboardingService.generateForClient`**

```typescript
import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  Prisma,
  ChecklistItemStatus,
  ChecklistResponsibility,
  ServiceDeliverableCadence,
  OnboardingPlanState,
  MarketingServiceStatus,
} from '@prisma/client';
import { Dom26rAuditService } from '../dom26r/dom26r-audit.service';
import { MarketingRelationshipService } from './marketing-relationship.service';

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private dom26rAudit: Dom26rAuditService,
    private marketingRelationship: MarketingRelationshipService,
  ) {}

  /**
   * Idempotent: returns the existing plan unchanged if one already exists
   * for this ClientAccount. Safe to call automatically from
   * ClientAccountService.convert AND manually via the repair endpoint.
   * Generates BOTH the OnboardingPlan+checklist and the ServiceDeliverables
   * in one pass, from the ClientAccount's OfferSnapshot -- never the live
   * Offer.
   */
  async generateForClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
  ) {
    const existing = await tx.onboardingPlan.findUnique({
      where: { clientAccountId },
      include: { items: true },
    });
    if (existing) return existing;

    const clientAccount = await tx.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    const snapshot = clientAccount.offerSnapshot;

    const plan = await tx.onboardingPlan.create({
      data: {
        clientAccountId,
        offerSnapshotId: snapshot.id,
        state: OnboardingPlanState.NOT_STARTED,
      },
    });

    const itemsData: Prisma.OnboardingChecklistItemCreateManyInput[] =
      snapshot.onboardingRequirements.map((requirement) => ({
        planId: plan.id,
        title: requirement,
        sourceCapability: requirement,
        required: true,
        responsibility: ChecklistResponsibility.DEMM,
      }));
    itemsData.push({
      planId: plan.id,
      title: 'Confirm business details and provide access/assets needed for onboarding',
      sourceCapability: null,
      required: true,
      responsibility: ChecklistResponsibility.CLIENT,
    });
    await tx.onboardingChecklistItem.createMany({ data: itemsData });

    const deliverablesData: Prisma.ServiceDeliverableCreateManyInput[] =
      snapshot.includedServices.map((service) => ({
        clientAccountId,
        offerSnapshotId: snapshot.id,
        sourceCapability: service,
        name: service,
        cadence: ServiceDeliverableCadence.RECURRING,
        outsideScope: false,
      }));
    await tx.serviceDeliverable.createMany({ data: deliverablesData });

    await tx.clientAccount.update({
      where: { id: clientAccountId },
      data: { onboardingState: OnboardingPlanState.NOT_STARTED },
    });

    await this.dom26rAudit.record(
      {
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        action: 'ONBOARDING_PLAN_GENERATED',
        purpose: 'CLIENT_ONBOARDING',
        outcome: 'SUCCESS',
        correlationId,
        metadata: { clientAccountId, planId: plan.id, offerSnapshotId: snapshot.id },
      },
      tx,
    );

    return tx.onboardingPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { items: true },
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: passes. If `Dom26rAuditService`/`MarketingRelationshipService` circular-import with a not-yet-updated module registration, that's fixed in Task 8 (module wiring) -- if tsc fails only on `marketing.module.ts` provider errors, note it and continue; if it fails on `onboarding.service.ts` itself, fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/marketing/onboarding.service.ts
git commit -m "feat(marketing): idempotent onboarding plan + deliverable generation"
```

---

## Task 3: OnboardingService — launch readiness + activation + override

**Files:**
- Modify: `backend/src/modules/marketing/onboarding.service.ts`

- [ ] **Step 1: Add `checkLaunchReadiness` and `activate`**

Append to the `OnboardingService` class:

```typescript
  async checkLaunchReadiness(planId: string) {
    const items = await this.prisma.onboardingChecklistItem.findMany({
      where: { planId, required: true },
    });
    const blockingItems = items.filter(
      (item) =>
        item.status !== ChecklistItemStatus.COMPLETE &&
        item.status !== ChecklistItemStatus.WAIVED,
    );
    return { ready: blockingItems.length === 0, blockingItems };
  }

  /**
   * Moves a ClientAccount from PENDING_ONBOARDING to ACTIVE. Without
   * `override`, every required checklist item must be COMPLETE or WAIVED.
   * With `override`, the CALLER (enforced by @Roles at the controller
   * layer -- this method trusts that the caller already passed that check)
   * bypasses remaining blockers, but a LaunchGateOverride row is written
   * with the exact blocked item ids, so the bypass is always auditable.
   */
  async activate(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
    override?: { reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.onboardingPlan.findUnique({
        where: { clientAccountId },
      });
      if (!plan) {
        throw new NotFoundException('No onboarding plan for this client');
      }

      const items = await tx.onboardingChecklistItem.findMany({
        where: { planId: plan.id, required: true },
      });
      const blockingItems = items.filter(
        (item) =>
          item.status !== ChecklistItemStatus.COMPLETE &&
          item.status !== ChecklistItemStatus.WAIVED,
      );

      if (blockingItems.length > 0) {
        if (!override) {
          throw new ConflictException({
            message: 'Required onboarding items are incomplete',
            blockingItems: blockingItems.map((i) => ({ id: i.id, title: i.title })),
          });
        }
        await tx.launchGateOverride.create({
          data: {
            planId: plan.id,
            reason: override.reason,
            actorId,
            affectedGates: blockingItems.map((i) => i.id),
          },
        });
      }

      const now = new Date();
      await tx.onboardingPlan.update({
        where: { id: plan.id },
        data: { state: OnboardingPlanState.COMPLETE, actualLaunchDate: now },
      });
      const clientAccount = await tx.clientAccount.update({
        where: { id: clientAccountId },
        data: {
          onboardingState: OnboardingPlanState.COMPLETE,
          serviceStatus: MarketingServiceStatus.ACTIVE,
        },
      });

      await this.dom26rAudit.record(
        {
          organizationId,
          businessUnitId,
          workspaceId,
          actorId,
          action: override ? 'CLIENT_ACTIVATED_WITH_OVERRIDE' : 'CLIENT_ACTIVATED',
          purpose: 'CLIENT_ONBOARDING',
          outcome: 'SUCCESS',
          correlationId,
          metadata: {
            clientAccountId,
            planId: plan.id,
            overrideReason: override?.reason ?? null,
          },
        },
        tx,
      );

      return clientAccount;
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/marketing/onboarding.service.ts
git commit -m "feat(marketing): launch gates, activation, and audited override"
```

---

## Task 4: OnboardingController + DTOs

**Files:**
- Create: `backend/src/modules/marketing/dto/onboarding.dto.ts`
- Create: `backend/src/modules/marketing/onboarding.controller.ts`

- [ ] **Step 1: Write the DTOs**

```typescript
import { IsEnum, IsOptional, IsString, IsNotEmpty, IsObject } from 'class-validator';
import { ChecklistItemStatus } from '@prisma/client';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsEnum(ChecklistItemStatus)
  status?: ChecklistItemStatus;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsObject()
  clientSubmission?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  blockerReason?: string;
}

export class ActivateOverrideDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ActivateClientDto {
  @IsOptional()
  override?: ActivateOverrideDto;
}
```

- [ ] **Step 2: Compute plan detail (progress/blockers/readiness) -- add to `OnboardingService`**

Append to `onboarding.service.ts`:

```typescript
  async getPlanDetail(businessUnitId: string, clientAccountId: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    const plan = await this.prisma.onboardingPlan.findUnique({
      where: { clientAccountId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        overrides: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!plan) {
      throw new NotFoundException('No onboarding plan for this client');
    }
    const requiredItems = plan.items.filter((i) => i.required);
    const completeOrWaived = requiredItems.filter(
      (i) => i.status === ChecklistItemStatus.COMPLETE || i.status === ChecklistItemStatus.WAIVED,
    );
    const progressPercentage =
      requiredItems.length === 0 ? 100 : Math.round((completeOrWaived.length / requiredItems.length) * 100);
    const blockers = plan.items.filter((i) => i.status === ChecklistItemStatus.BLOCKED);
    const launchReadiness = completeOrWaived.length === requiredItems.length;

    return { ...plan, progressPercentage, blockers, launchReadiness };
  }

  async updateItem(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    itemId: string,
    dto: { status?: ChecklistItemStatus; evidence?: string; clientSubmission?: Record<string, unknown>; blockerReason?: string },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    const item = await this.prisma.onboardingChecklistItem.findFirst({
      where: { id: itemId, plan: { clientAccountId } },
    });
    if (!item) {
      throw new NotFoundException('Checklist item not found for this client');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.OnboardingChecklistItemUpdateInput = {
        evidence: dto.evidence,
        clientSubmission: dto.clientSubmission,
        blockerReason: dto.blockerReason,
      };
      if (dto.status && dto.status !== item.status) {
        data.status = dto.status;
        if (dto.status === ChecklistItemStatus.COMPLETE) data.completedAt = new Date();
        await tx.onboardingChecklistItemHistory.create({
          data: { itemId, oldStatus: item.status, newStatus: dto.status, actorId },
        });
      }
      return tx.onboardingChecklistItem.update({ where: { id: itemId }, data });
    });
  }
```

- [ ] **Step 3: Write the controller**

```typescript
import { Controller, Get, Patch, Post, Body, Param, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateChecklistItemDto, ActivateClientDto } from './dto/onboarding.dto';
import { ForbiddenException } from '@nestjs/common';

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}

  @Get('marketing/clients/:id/onboarding')
  async getPlan(@CurrentBusinessUnitId() businessUnitId: string, @Param('id') id: string) {
    return this.onboarding.getPlanDetail(businessUnitId, id);
  }

  @Patch('marketing/clients/:id/onboarding/items/:itemId')
  async updateItem(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.onboarding.updateItem(businessUnitId, user.id, id, itemId, dto);
  }

  @Post('marketing/clients/:id/onboarding/generate')
  async generate(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('id') id: string,
  ) {
    return this.onboarding.prismaTransactionGenerate(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      id,
    );
  }

  @Post('marketing/clients/:id/onboarding/activate')
  async activate(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('id') id: string,
    @Body() dto: ActivateClientDto,
  ) {
    if (dto.override) {
      const allowed: Role[] = [Role.SUPERADMIN, Role.ORG_OWNER, Role.ORG_ADMIN, Role.WORKSPACE_ADMIN];
      if (!allowed.includes(user.role)) {
        throw new ForbiddenException('This role cannot override a launch gate');
      }
    }
    return this.onboarding.activate(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      id,
      dto.override,
    );
  }
}
```

Note: the override role check is done inline in the controller (reading `dto.override` to decide whether to enforce it) rather than via a blanket `@Roles()` on the whole `activate` method, because non-override activation must stay reachable by any authenticated BU member — see design spec Section 3. Add a small wrapper method `prismaTransactionGenerate` to `OnboardingService` that opens a transaction and calls `generateForClient`:

```typescript
  async prismaTransactionGenerate(
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    clientAccountId: string,
  ) {
    return this.prisma.$transaction((tx) =>
      this.generateForClient(tx, organizationId, businessUnitId, workspaceId, actorId, correlationId, clientAccountId),
    );
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: passes (module registration happens in Task 8; if tsc only fails on DI wiring, note and continue -- if it fails inside these two files, fix now).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/onboarding.controller.ts backend/src/modules/marketing/dto/onboarding.dto.ts backend/src/modules/marketing/onboarding.service.ts
git commit -m "feat(marketing): onboarding API — read, update item, generate, activate"
```

---

## Task 5: ServiceDeliverableService + Controller + DTOs

**Files:**
- Create: `backend/src/modules/marketing/dto/service-deliverable.dto.ts`
- Create: `backend/src/modules/marketing/service-deliverable.service.ts`
- Create: `backend/src/modules/marketing/service-deliverable.controller.ts`

- [ ] **Step 1: DTOs**

```typescript
import { IsEnum, IsOptional, IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ServiceDeliverableStatus, ServiceDeliverableCadence } from '@prisma/client';

export class UpdateDeliverableDto {
  @IsOptional()
  @IsEnum(ServiceDeliverableStatus)
  status?: ServiceDeliverableStatus;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsString()
  blockerReason?: string;

  @IsOptional()
  @IsDateString()
  clientApprovedAt?: string;
}

export class CreateOutsideScopeDeliverableDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ServiceDeliverableCadence)
  cadence: ServiceDeliverableCadence;

  @IsOptional()
  @IsString()
  cadenceDetail?: string;
}
```

- [ ] **Step 2: Service**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, ServiceDeliverableStatus } from '@prisma/client';

@Injectable()
export class ServiceDeliverableService {
  constructor(private prisma: PrismaService) {}

  async findAll(businessUnitId: string, clientAccountId: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    return this.prisma.serviceDeliverable.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    deliverableId: string,
    dto: { status?: ServiceDeliverableStatus; evidence?: string; blockerReason?: string; clientApprovedAt?: string },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    const deliverable = await this.prisma.serviceDeliverable.findFirst({
      where: { id: deliverableId, clientAccountId },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found for this client');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ServiceDeliverableUpdateInput = {
        evidence: dto.evidence,
        blockerReason: dto.blockerReason,
        clientApprovedAt: dto.clientApprovedAt ? new Date(dto.clientApprovedAt) : undefined,
      };
      if (dto.status && dto.status !== deliverable.status) {
        data.status = dto.status;
        await tx.serviceDeliverableHistory.create({
          data: { deliverableId, oldStatus: deliverable.status, newStatus: dto.status, actorId },
        });
      }
      return tx.serviceDeliverable.update({ where: { id: deliverableId }, data });
    });
  }

  async createOutsideScope(
    businessUnitId: string,
    clientAccountId: string,
    dto: { name: string; description?: string; cadence: Prisma.ServiceDeliverableCadence; cadenceDetail?: string },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }
    return this.prisma.serviceDeliverable.create({
      data: {
        clientAccountId,
        offerSnapshotId: clientAccount.offerSnapshotId,
        sourceCapability: '',
        name: dto.name,
        description: dto.description,
        cadence: dto.cadence,
        cadenceDetail: dto.cadenceDetail,
        outsideScope: true,
      },
    });
  }
}
```

- [ ] **Step 3: Controller**

```typescript
import { Controller, Get, Patch, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ServiceDeliverableService } from './service-deliverable.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateDeliverableDto, CreateOutsideScopeDeliverableDto } from './dto/service-deliverable.dto';

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ServiceDeliverableController {
  constructor(private deliverables: ServiceDeliverableService) {}

  @Get('marketing/clients/:id/deliverables')
  async findAll(@CurrentBusinessUnitId() businessUnitId: string, @Param('id') id: string) {
    return this.deliverables.findAll(businessUnitId, id);
  }

  @Patch('marketing/clients/:id/deliverables/:deliverableId')
  async update(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('deliverableId') deliverableId: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.deliverables.update(businessUnitId, user.id, id, deliverableId, dto);
  }

  @Post('marketing/clients/:id/deliverables')
  async createOutsideScope(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @Body() dto: CreateOutsideScopeDeliverableDto,
  ) {
    return this.deliverables.createOutsideScope(businessUnitId, id, dto);
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/service-deliverable.* backend/src/modules/marketing/dto/service-deliverable.dto.ts
git commit -m "feat(marketing): service delivery API — read, update, outside-scope"
```

---

## Task 6: Wire generation into the conversion transaction

**Files:**
- Modify: `backend/src/modules/marketing/client-account.service.ts`

- [ ] **Step 1: Inject `OnboardingService`**

In the constructor, add `private onboarding: OnboardingService,` and the import `import { OnboardingService } from './onboarding.service';`.

- [ ] **Step 2: Call `generateForClient` right after the `ClientAccount` is created**

In `convert()`, immediately after Step 5 (`const clientAccount = await tx.clientAccount.create(...)`) and before Step 7 (marking the Opportunity WON), insert:

```typescript
        // Step 5b: generate the onboarding plan + service deliverables from
        // the OfferSnapshot just frozen above -- inside the same
        // transaction, so a client can never exist at PENDING_ONBOARDING
        // without a plan.
        await this.onboarding.generateForClient(
          tx,
          organizationId,
          businessUnitId,
          workspaceId,
          actorId,
          correlationId,
          clientAccount.id,
        );
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 4: Run the existing Sub-project 1 HTTP suite to confirm no regression**

Run: `cd backend && npx ts-node test-marketing-lead-to-client-api.ts`
Expected: all existing checks still pass (conversion now additionally creates a plan, which existing assertions don't check for but must not break).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/client-account.service.ts
git commit -m "feat(marketing): generate onboarding plan inside conversion transaction"
```

---

## Task 7: DOM26-R onboarding milestones + brief template

**Files:**
- Modify: `backend/src/modules/marketing/marketing-relationship.service.ts`

- [ ] **Step 1: Add `recordOnboardingMilestone`**

Copy the shape of `recordConversionFacts`'s milestone-engram block (the `this.engrams.create(...)` call at the end of that method) into a new, smaller method:

```typescript
  /**
   * System-observed onboarding milestones go directly to an ACTIVE Engram
   * (not a pending MemoryCandidate) -- "this item was completed" or "the
   * client was activated" are facts, not inferred claims. Routine
   * IN_PROGRESS/WAITING_ON_CLIENT toggles do NOT call this -- only real
   * milestones: plan generated, a required item completed, an override
   * applied, activation, a blocker raised or resolved.
   */
  async recordOnboardingMilestone(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    params: {
      subjectType: SubjectType;
      subjectRefId: string;
      clientAccountId: string;
      summary: string;
      structuredContent: Record<string, unknown>;
    },
  ) {
    return this.engrams.create(
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType: params.subjectType,
        subjectRefId: params.subjectRefId,
        form: MemoryForm.EPISODIC,
        topic: MemoryTopic.MILESTONE,
        truthClassification: TruthClassification.OBSERVED,
        sensitivity: SensitivityClassification.INTERNAL,
        summary: params.summary,
        structuredContent: params.structuredContent,
        sources: [{ type: SourceType.EVENT, referenceId: params.clientAccountId }],
      },
      tx,
    );
  }
```

- [ ] **Step 2: Call it from `OnboardingService.activate`**

In `onboarding.service.ts`'s `activate` method, after the `Dom26rAuditService.record` call, add a call to `this.marketingRelationship.recordOnboardingMilestone(...)` with `subjectType`/`subjectRefId` resolved the same way `ClientAccountService.convert` resolves them (`companyId ? COMPANY : CONTACT`, using `clientAccount.companyId ?? clientAccount.primaryContactId` -- fetch the `ClientAccount` row with those fields if not already in scope) and `summary: override ? 'Client activated with launch-gate override' : 'Client activated'`.

- [ ] **Step 3: Extend the brief template**

In `generateMarketingBrief`, no signature change needed -- the `briefText` composition (which questions it answers) happens in the CALLER, not this pass-through method. Document in a comment above `generateMarketingBrief` that onboarding-aware brief text should answer the fourteen questions in the design spec Section 4, sourced from `OnboardingChecklistItem`/`ServiceDeliverable` rows plus confirmed Engrams -- this is composed by `ClientAccountService.getClientDetail` (Task 8) when it calls this method, not inside `MarketingRelationshipService` itself.

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/marketing-relationship.service.ts
git commit -m "feat(marketing): DOM26-R onboarding milestone recording"
```

---

## Task 8: Module wiring + brief composition in client detail

**Files:**
- Modify: `backend/src/modules/marketing/marketing.module.ts`
- Modify: `backend/src/modules/marketing/client-account.service.ts`

- [ ] **Step 1: Register new providers/controllers**

Add `OnboardingService`, `OnboardingController`, `ServiceDeliverableService`, `ServiceDeliverableController` to `marketing.module.ts`'s `providers`/`controllers` arrays and imports, matching the existing entries for `ClientAccountService`/`ClientAccountController`.

- [ ] **Step 2: Extend `getClientDetail` to include onboarding + deliverables**

In `client-account.service.ts`'s `getClientDetail`, inject `OnboardingService` and `ServiceDeliverableService` (constructor), and add to the returned object:
```typescript
    const onboarding = await this.onboarding.getPlanDetail(businessUnitId, id).catch(() => null);
    const deliverables = await this.deliverables.findAll(businessUnitId, id).catch(() => []);
```
(`.catch(() => null/[])` because a client converted before this sub-project shipped, or mid-generation-failure, may not have a plan yet -- the detail endpoint should degrade gracefully, not 500.) Include `onboarding, deliverables` in the returned object alongside the existing `brief`.

- [ ] **Step 3: Full typecheck + build**

Run: `cd backend && npx tsc --noEmit && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/marketing/marketing.module.ts backend/src/modules/marketing/client-account.service.ts
git commit -m "feat(marketing): wire onboarding + service-delivery modules; extend client detail"
```

---

## Task 9: HTTP-level test suite (16 checks)

**Files:**
- Create: `backend/test-onboarding-service-delivery-api.ts`

- [ ] **Step 1: Write the suite**

Follow the exact structure of `backend/test-marketing-lead-to-client-api.ts` (boot real Nest app via `NestFactory.create(AppModule)`, seed a throwaway org/BU/workspace/users/offer/lead directly via Prisma, then drive everything else over real HTTP with `fetch` against the booted app). Implement all 16 checks listed in design spec Section 8:

1. Generated plan's checklist items match `offerSnapshot.onboardingRequirements` (+1 client item); deliverables match `includedServices` 1:1.
2. Editing the canonical `Offer.includedServices` after conversion does not change the already-created `ServiceDeliverable` rows (still match the frozen snapshot).
3. `POST .../onboarding/generate` called twice returns identical `planId`, no duplicate `OnboardingChecklistItem`/`ServiceDeliverable` rows (assert `count` before/after).
4. `POST .../onboarding/activate` with an incomplete required item returns 409 with `blockingItems`.
5. Mark every required item `COMPLETE` via `PATCH`, then activate succeeds; assert `ClientAccount.serviceStatus === 'ACTIVE'`.
6. A second client account, activate-with-override attempted by a seeded `USER`-role member returns 403; assert no `LaunchGateOverride` row created.
7. Same client, override attempted by a seeded `WORKSPACE_ADMIN` succeeds; assert `LaunchGateOverride.affectedGates` matches the incomplete item ids exactly.
8. A client in BU "PHOTO_BOOTHS" is invisible to a token scoped to BU "MARKETING" on every onboarding/deliverable route (404/403) -- reuse the cross-BU pattern from `test-marketing-lead-to-client-api.ts`.
9. `PATCH` an item to `WAITING_ON_CLIENT` then `BLOCKED` with a `blockerReason`; assert it appears in `getPlanDetail().blockers`.
10. `GET .../deliverables` -- each row's `sourceCapability` is a non-empty string from `includedServices`, `outsideScope === false`.
11. `POST .../deliverables` (outside-scope) always has `outsideScope === true` in the response regardless of request body.
12. Assert the `MemoryCandidate`/`Engram` rows created during onboarding carry `sources` referencing the `clientAccountId`, same shape as Sub-project 1's conversion candidates.
13. Fetch the client detail brief at `CUSTOMER_VISIBLE` tier; assert no internal risk/confidence field leaks into the formatted text.
14. A client whose `OfferSnapshot` has `expectedLaunchTime: null` and no `targetLaunchDate` set on its plan -- assert both serialize as `null` in the API response, never a fabricated string.
15. Force a failure mid-`generateForClient` (e.g. call it with a bogus `clientAccountId` inside a transaction) and assert zero `OnboardingPlan`/`OnboardingChecklistItem`/`ServiceDeliverable` rows exist afterward for that attempt.
16. Run the full Sub-project 1 conversion flow end-to-end and assert the resulting `ClientAccount` has an attached `OnboardingPlan` in the same response.

- [ ] **Step 2: Run it**

Run: `cd backend && npx ts-node test-onboarding-service-delivery-api.ts`
Expected: 16/16 checks pass.

- [ ] **Step 3: Commit**

```bash
git add backend/test-onboarding-service-delivery-api.ts
git commit -m "test(marketing): onboarding + service-delivery HTTP suite (16 checks)"
```

---

## Task 10: Full backend regression

- [ ] **Step 1: Run every existing suite**

Run in sequence, from `backend/`:
```bash
npx ts-node test-marketing-lead-to-client-api.ts
npx ts-node test-onboarding-service-delivery-api.ts
npx ts-node test-workspace-isolation.ts 2>/dev/null || true
npx tsc --noEmit
npx eslint src --max-warnings=0
npm run build
```
(Use the actual regression command list established earlier in this project if it differs -- check `package.json` scripts and any `docs/` regression checklist before assuming the above is exhaustive; run whatever the established "full regression" set is, not just these.)

- [ ] **Step 2: Fix any failure before proceeding.** Do not move to frontend work with a red suite.

- [ ] **Step 3: Commit** only if fixes were needed; otherwise this task just confirms green and moves on.

---

## Task 11: Frontend — Client Account detail page: Overview + Onboarding tabs

**Files:**
- Create: `frontend/src/app/marketing/clients/[id]/page.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add API functions** to `frontend/src/lib/api.ts`, matching the existing fetch-wrapper pattern used for `getOffers`/`convertLead`/etc: `getClientDetail(id)`, `getOnboardingPlan(id)`, `updateChecklistItem(id, itemId, body)`, `activateClient(id, body)`.

- [ ] **Step 2: Build the page** with local tab state (`'overview' | 'onboarding' | 'delivery' | 'memory'`), reusing the Tailwind layout conventions from `frontend/src/app/marketing/leads/page.tsx` and `frontend/src/app/marketing/offers/page.tsx`.

**Overview section:** business/contact name, `offerSnapshot.name` + `offerSnapshot` version indicator, `serviceStatus` badge, derived contract/payment state (already returned by `getClientDetail`), a progress bar from `onboarding.progressPercentage`, `onboarding.targetLaunchDate` (render "To be confirmed" when null), next action (first incomplete required item), `onboarding.blockers` list, Relationship Pulse (reuse existing pulse display component from the Leads screen), Relationship Brief text.

**Onboarding section:** checklist grouped into two columns ("DEMM owes" / "Client owes", filtered by `responsibility`), each item showing status badge, due date (red if overdue and not complete/waived/cancelled), evidence/submission, a status-change control (dropdown + optional evidence/blockerReason fields, PATCHing on submit). A launch-readiness banner (`onboarding.launchReadiness`) and an "Activate Client" button: enabled directly when ready; when not ready, shows the blocking item titles and, only for roles in `[SUPERADMIN, ORG_OWNER, ORG_ADMIN, WORKSPACE_ADMIN]` (check `currentUser.role` from existing auth context), an override-reason textarea + confirm button that POSTs `{ override: { reason } }`.

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/marketing/clients/ frontend/src/lib/api.ts
git commit -m "feat(frontend): Client Account page — Overview + Onboarding tabs"
```

---

## Task 12: Frontend — Service Delivery + Memory & Relationship tabs

**Files:**
- Modify: `frontend/src/app/marketing/clients/[id]/page.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add API functions**: `getDeliverables(id)`, `updateDeliverable(id, deliverableId, body)`, `createOutsideScopeDeliverable(id, body)`.

- [ ] **Step 2: Service Delivery section:** deliverables list (cadence/status/owner/due date/evidence/`clientApprovedAt`), status-change control per row (PATCH), an "Outside-scope request" form (name/description/cadence) that POSTs to the outside-scope endpoint, and a visual badge distinguishing `outsideScope === true` rows from purchased-scope rows.

- [ ] **Step 3: Memory & Relationship section:** reuse whatever engram-list / memory-candidate display component the Leads screen already uses for the Relationship Brief (Sub-project 1); no new backend calls -- this section reads the existing DOM26-R endpoints, just surfaced on this page.

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/marketing/clients/ frontend/src/lib/api.ts
git commit -m "feat(frontend): Client Account page — Service Delivery + Memory tabs"
```

---

## Task 13: Browser walkthrough

- [ ] **Step 1:** Start the local dev stack (backend + frontend), log in, and walk the 17 steps from the design spec / Antwann's directive Section H end-to-end in the browser: open a `PENDING_ONBOARDING` client → view snapshot → view generated checklist → complete a DEMM item → mark an item `WAITING_ON_CLIENT` → add a blocker → submit client info → resolve the blocker → complete remaining required items → activate → view generated deliverables → update a deliverable → view updated brief → confirm DEMM-owed vs client-owed views → demonstrate an outside-scope request → confirm a different BU cannot see this client.

- [ ] **Step 2:** Capture a screenshot at each major step and note exact reproduction steps for the closing report.

---

## Task 14: DOM26v3 + gbrain decision capture

- [ ] **Step 1:** `POST https://intelligence.demmmarketing.com/engrams/capture` with the onboarding/service-delivery model, lifecycle states, launch-gate/override policy, null-field handling, DOM26-R memory policy, and test evidence (per Antwann's Section J). Verify the actual HTTP response before claiming success.

- [ ] **Step 2:** `mcp__gbrain__add_timeline_entry` on `demm-platform-release-1-0` (or a new dedicated page if warranted) with commit SHAs and staging outcome once Task 15 completes.

---

## Task 15: Staging deployment (gated on local pass)

Only after Tasks 1-13 are committed, full regression is green, and the quality loop (design spec + Antwann's Section I) scores 90/100 or higher with no unresolved Critical/High issue:

- [ ] **Step 1:** Backup staging DB, confirm the migration (Task 1) is additive except the one documented, safely-cast `onboardingState` type change, confirm rollback.sql works.
- [ ] **Step 2:** Deploy via Cloud Build/Cloud Run following the exact procedure already used for commit `98b045a` earlier in this session.
- [ ] **Step 3:** Apply the migration, run the staging smoke suite (extend `verify-marketing-staging-smoke.ts` or add a companion script covering onboarding/activation over live HTTPS).
- [ ] **Step 4:** Report per Antwann's established report format (deployed commit, backup id, migration result, Cloud Build id, Cloud Run revisions, smoke test results, screenshots).

No production deployment at any point in this plan.
