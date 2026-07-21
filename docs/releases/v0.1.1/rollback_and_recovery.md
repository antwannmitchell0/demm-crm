# Safe Rollback & Production Recovery Guide — Release 0.1.1

> [!CAUTION]
> **PROHIBITION**: The command `npx prisma db push --force-reset` is strictly forbidden in staging and production environments. It is a destructive operation that drops all database tables and deletes customer data.

---

## 1. Pre-Deployment Database Backup Procedure

Before executing any database migration in staging or production, create a complete PostgreSQL database dump:

```bash
# 1. Export database snapshot before applying Release 0.1.1 migration
pg_dump -U postgres -h localhost -d demm_crm -F c -b -v -f /backups/demm_crm_pre_v0_1_1_$(date +%Y%m%d_%H%M%S).dump
```

---

## 2. Tested Database Restoration Procedure

In the event of an unrecoverable failure during deployment, restore the pre-migration snapshot:

```bash
# 1. Terminate existing backend application connections
# 2. Restore database from pre-migration backup dump
pg_restore -U postgres -h localhost -d demm_crm --clean --if-exists -v /backups/demm_crm_pre_v0_1_1_YYYYMMDD_HHMMSS.dump
```

---

## 3. Application Rollback Strategy

To revert the application code to the prior stable release:

```bash
# 1. Checkout prior release tag
git checkout v0.1.0-release

# 2. Restore database from pre-migration backup (Step 2)

# 3. Rebuild and restart services
cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
```

---

## 4. Forward-Fix Migration Strategy

For production issues arising from schema migrations, prefer a **Forward-Fix Migration Strategy** over database rollback:

1. **Irreversible Enum & Decimal Casts**: Once column data types are converted to PostgreSQL ENUMs or `NUMERIC(12,2)`, reverting schema columns back to raw strings or double precision floats can cause data truncation.
2. **Applying a Forward-Fix**:
   - Create a new, explicit Prisma migration to correct any schema defects:
     ```bash
     npx prisma migrate dev --name fix_schema_issue
     ```
   - Deploy forward-fix migrations using standard production commands:
     ```bash
     npx prisma migrate deploy
     ```

---

## 5. Post-Recovery Verification

Following any rollback or recovery operation, run the verification suite to ensure system integrity:

```bash
npm run verify
```
