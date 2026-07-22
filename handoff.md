# DEMM Platform Release 1.0 — Technical Handoff Package

Welcome! This document provides all the context, schemas, and verification evidence needed to resume implementation of **DEMM Platform Release 1.0 (Revenue & Entry Operations)** under the **DEMM Ecosystem Constitution v3.0** and **Platform Blueprint v1.0**.

---

## 1. Project Context & Environment

- **Selected GCP Project**: `gen-lang-client-0096028843` (Demm)
- **Active Staging Domains**:
  - Frontend: `https://demm-crm-frontend-staging-431876670120.us-east1.run.app`
  - Backend API: `https://demm-crm-backend-staging-431876670120.us-east1.run.app`
- **Staging Database Instance**: `demm-crm-staging-db` (Project: `gen-lang-client-0096028843`, Region: `us-east1`).
- **Baseline Backup Identifier**: `1784638703743`.
- **Memory Sync API**: `https://intelligence.demmmarketing.com/api/capture` (Using authorization token from `~/.empire/token`).

---

## 2. Current Implementation State

We have completed the local preparation and rigorous verification for **Phase 1A (Business Unit Foundation)** and **Phase 1B (DOM26-R Architecture)**. 

### 2.1 Database Models
The Prisma database schema [schema.prisma](file:///Users/antwannmitchellsr/Desktop/demm%20CRM/backend/prisma/schema.prisma) has been updated and formatted successfully with:
- **BusinessUnit**: Scoped to Organization, linking workspaces.
- **Photo Booth bookings & equipment**: Enum-based BookingStatus and BookingEquipment link tables supporting overlapping-time checks.
- **WTAE Event galleries**: WtaeEvent, PhotoAsset, privacy-preserving AttendeeRegistration (no IP address dependencies), ConsentRecord, and auditable Flower structures.
- **DOM26-R Known & Remembered Engine**: RelationshipSubject, RelationshipProfile, Engram, EngramSource, MemoryCandidate, MemoryApproval, MemoryCorrection, MemoryAccessPolicy, MemoryAuditEvent, ConsentDirective, RelationshipSignal, and RelationshipBrief.

### 2.2 Verification Scripts
- **Rollback Rehearsal Script**: [rehearse-rollback.ts](file:///Users/antwannmitchellsr/Desktop/demm%20CRM/backend/rehearse-rollback.ts)
  - Successfully tests applying migration, seeding canonical BUs, backfilling workspaces, dropping tables via rollback SQL, and re-applying/re-syncing.
- **DOM26-R Comprehensive Tests**: [test-dom26r-comprehensive.ts](file:///Users/antwannmitchellsr/Desktop/demm%20CRM/backend/test-dom26r-comprehensive.ts)
  - Asserts cross-business read isolation, organization/BU/Workspace scope mismatch blockages, multi-source engram provenance (3 sources), expired/withdrawn consent rejection, forget/redact workflows (wiping private summary/Json fields while keeping log tombstones safe), and brief visibility level formatting (hiding confidence scores from customer views).

---

## 3. Core Next Steps

1. **Phase 1A Staging Migration**:
   - Run the migration `20260721184919_phase_1a_business_unit_foundation` on the active GCP staging database instance `demm-crm-staging-db`.
   - Run the database seed script `prisma/seed.ts` on staging to establish the 5 canonical Business Units (MARKETING, PHOTO_BOOTHS, WTAE, GREATER, SOFTER) and backfill existing workspaces to the `MARKETING` business unit.
2. **Phase 1B API & Routing Scaffolding**:
   - Develop the NestJS services and controllers for `MemoryCandidate`, `Engram`, `ConsentDirective`, and `RelationshipBrief` models.
   - Enforce workspace/BU scope validation in `WorkspaceGuard`.
3. **Phase 2 (Marketing Operating Slice)**:
   - Implement Marketing offer templates ($99, $299, $999 tiers) and client onboarding checkboxes.
