# DEMM CRM — AI-First Multi-Tenant Platform

DEMM CRM is an AI-native multi-tenant business platform where artificial intelligence acts as the primary interface and the CRM serves as the secure system of record.

---

## 1. Architecture Overview

- **Backend**: NestJS (TypeScript) with Modular DDD layout.
- **ORM & Database**: Prisma 7 with PostgreSQL adapter.
- **Frontend**: Next.js App Router (TypeScript) with glassmorphic UI system.
- **Multi-Tenancy**: Hierarchy of `Organization` ➔ `Workspace` ➔ `Memberships` ➔ `Tenant Resources`.
- **Security Protections (Release 0.1.1 Hardened)**:
  - **JWT Startup Verification**: Strict length (>= 32 chars) and non-default secret validation on bootstrap.
  - **CORS Allowlist**: Environment-driven origin matching (`ALLOWED_ORIGINS`).
  - **Helmet Headers**: Security HTTP headers including HSTS, XSS protection, and MIME-type sniffing defense.
  - **Rate Limiting**: Rate-limit protection on auth, agent, and approval routes using `@nestjs/throttler`.
  - **Audit Log Redaction**: Automatic scrubbing of sensitive fields (`password`, `token`, `secret`, `apiKey`) to `[REDACTED]`.
  - **Session Security**: Short-lived Access Tokens (15 min) + Database-backed Refresh Tokens (7 days) with token rotation and revocation.
  - **Tenant Integrity**: Relation Hijacking defense verifying linked entities (pipeline, stage, contact, owner) belong to the active workspace.
  - **Prisma Enums & Decimal Currency**: Monetary values stored as `Decimal(12, 2)` and statuses bound to Prisma Enums.

---

## 2. Quick Start & Setup

### Prerequisites
- Node.js >= v20
- PostgreSQL >= 15

### Environment Configuration
Copy `env.example` to `backend/.env`:
```bash
cp env.example backend/.env
```

Ensure `backend/.env` contains a secure 32+ character JWT secret:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/demm_crm?schema=public"
JWT_SECRET="demm_crm_production_secure_jwt_secret_key_32chars_minimum"
PORT=3001
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"
```

### Installation & Database Initialization
```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Push database schema & generate Prisma Client
npx prisma db push
npx prisma generate
```

---

## 3. Running Locally

### Start Backend Engine
```bash
cd backend
npm run start:dev
```
API runs on `http://localhost:3001`.

### Start Frontend Dashboard
```bash
cd frontend
npm run dev
```
UI runs on `http://localhost:3000`.

---

## 4. Verification & Testing

To run the unified verification pipeline (compiling, validating Prisma schema, and executing comprehensive security and tenant-isolation E2E tests):

```bash
cd backend
npm run verify
```

---

## 5. Deployment & Release Workflow

1. Run `npm run verify` to confirm all security and tenant isolation assertions pass.
2. Commit changes and tag the release:
   ```bash
   git tag v0.1.1-release
   git push origin main --tags
   ```
