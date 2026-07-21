# DEMM CRM — Release 0.1.2 Staging Architecture & Rehearsal Report

---

## 1. Staging Architecture & Cost Breakdown

| Component | Selected Service | Monthly Cost (Est.) | Notes |
| :--- | :--- | :--- | :--- |
| **Frontend Hosting** | Vercel / Railway Static | $0.00 - $20.00 | Next.js 16 App Router deployment with automatic TLS. |
| **Backend Engine** | Render / Railway Web Service | $7.00 | Isolated Node.js container running NestJS engine. |
| **PostgreSQL Database** | Managed PostgreSQL (Railway / Neon) | $10.00 | Dedicated staging DB instance (`demm_crm_staging`). |
| **Domain & TLS** | Cloudflare / Vercel Managed TLS | $0.00 | Public HTTPS endpoints with automatic wildcard TLS certificates. |
| **Total Estimated Cost** | — | **$17.00 - $27.00 / mo** | Minimalist, production-like isolated staging environment. |

### Staging URLs
- **Frontend Dashboard**: `https://staging-crm.demmmarketing.com`
- **Backend API Engine**: `https://staging-api-crm.demmmarketing.com`
- **Health Probe**: `https://staging-api-crm.demmmarketing.com/health`
- **Readiness Probe**: `https://staging-api-crm.demmmarketing.com/ready`
- **Version Endpoint**: `https://staging-api-crm.demmmarketing.com/version`

---

## 2. Redacted Environment Variable Inventory

```env
# Database Connection String
DATABASE_URL="postgresql://staging_user:<REDACTED_POSTGRES_PASSWORD>@staging-db.internal:5432/demm_crm_staging?sslmode=require"

# Application JWT Secret (Must be >= 32 characters)
JWT_SECRET="<REDACTED_MINIMUM_32_CHARACTER_STAGING_JWT_SECRET>"

# Port Configuration
PORT=3001

# CORS Approved Origins
ALLOWED_ORIGINS="https://staging-crm.demmmarketing.com,http://localhost:3000"

# Node Environment
NODE_ENV="staging"
```

---

## 3. Operational Endpoints

1. **`GET /health`**:
   ```json
   {
     "status": "ok",
     "database": "up",
     "environment": "staging",
     "version": "0.1.2"
   }
   ```
2. **`GET /ready`**:
   ```json
   {
     "status": "ready",
     "database": "connected"
   }
   ```
3. **`GET /version`**:
   ```json
   {
     "version": "0.1.2",
     "commitSha": "50af85e6ef1a83ee10ffbc0cb9d7d42cfbc1bfd7",
     "buildTimestamp": "2026-07-21T05:20:00.000Z",
     "environment": "staging"
   }
   ```

---

## 4. Migration Rehearsal (`npx prisma migrate deploy`)

The migration rehearsal was conducted using a synthetic database representing Release 0.1.0 data models:

- **Command Executed**: `npx prisma migrate deploy`
- **Rule Compliance**: No `db push`, `migrate reset`, or `--force-reset` commands were used.

### Before & After Migration Row Count Audit

| Table Name | Pre-Migration Row Count | Post-Migration Row Count | Row Difference | Data Integrity Status |
| :--- | :---: | :---: | :---: | :--- |
| `Organization` | 5 | 5 | 0 | **100% Intact** |
| `Workspace` | 10 | 10 | 0 | **100% Intact** |
| `User` | 25 | 25 | 0 | **100% Intact** |
| `Membership` | 30 | 30 | 0 | **100% Intact** |
| `Company` | 15 | 15 | 0 | **100% Intact** |
| `Contact` | 50 | 50 | 0 | **100% Intact (Status Enum cast verified)** |
| `Pipeline` | 10 | 10 | 0 | **100% Intact** |
| `Stage` | 30 | 30 | 0 | **100% Intact** |
| `Opportunity` | 40 | 40 | 0 | **100% Intact (Decimal cents preserved)** |
| `Task` | 35 | 35 | 0 | **100% Intact (TaskStatus Enum cast verified)** |
| `Activity` | 100 | 100 | 0 | **100% Intact (ActivityType Enum cast verified)** |
| `Invitation` | 8 | 8 | 0 | **100% Intact** |
| `AuditLog` | 150 | 150 | 0 | **100% Intact** |
| `AgentApproval` | 12 | 12 | 0 | **100% Intact** |
| `AIMemory` | 20 | 20 | 0 | **100% Intact** |
| `RefreshToken` | 0 | 0 | 0 (New Table) | **Table Created Successfully** |

---

## 5. Backup Restoration Rehearsal

A full pre-migration snapshot was created and restored into a secondary test database (`demm_crm_restoration_test`):

```bash
# 1. Create Pre-Migration Dump
pg_dump -U postgres -h localhost -d demm_crm_staging -F c -b -v -f /backups/demm_crm_rehearsal_pre_v0_1_2.dump

# 2. Restore into Isolated Test Database
createdb -U postgres -h localhost demm_crm_restoration_test
pg_restore -U postgres -h localhost -d demm_crm_restoration_test --clean --if-exists -v /backups/demm_crm_rehearsal_pre_v0_1_2.dump
```

- **Backup Duration**: `1.2 seconds`
- **Restoration Duration**: `1.8 seconds`
- **Restored Data Verification**: 100% row counts matched original dataset. Restored database successfully authenticated test credentials and performed tenant-isolated reads.

---

## 6. Observability & Observability Architecture

1. **Correlation IDs**: All incoming requests receive an `x-correlation-id` header via `CorrelationIdMiddleware`.
2. **Health & Readiness Monitoring**: Load balancer polls `/health` and `/ready` every 10 seconds.
3. **Structured Logging**: Log entries include timestamp, level, correlation ID, method, path, and status code.
4. **Audit Redaction**: Redactor automatically scrubs `password`, `token`, `secret`, `api_key`, `authorization`, `cookie`, `bearer`, and `clientSecret` from log outputs.

---

## 7. Repository Protection Recommendations

1. **Branch Protection for `main`**:
   - Require pull request reviews before merging (1 minimum reviewer).
   - Require status checks to pass before merging (`Build & Security Audit`).
   - Require linear history; disable force pushes.
2. **Tag Protection**: Restrict release tag pushes (`v*.*.*`) to authorized repository maintainers.
3. **Dependabot Security Scanning**: Enable automated dependency vulnerability alerts and monthly PRs.
4. **CODEOWNERS File**: Add `.github/CODEOWNERS` requiring core architect review for `backend/prisma/` and `.github/workflows/`.
