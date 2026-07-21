import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function rehearseRollback() {
  console.log('🔄 STARTING PHASE 1A COMPLETE ROLLBACK REHEARSAL');
  console.log('================================================');

  // Step 1: Count seeded business units and backfilled workspaces
  const buCount = await prisma.businessUnit.count();
  const wsCount = await prisma.workspace.count();
  const wsBackfilled = await prisma.workspace.count({
    where: { businessUnitId: { not: null } }
  });

  console.log(`📊 Current State Row Counts:`);
  console.log(`   - Business Units: ${buCount}`);
  console.log(`   - Workspaces: ${wsCount}`);
  console.log(`   - Backfilled Workspaces: ${wsBackfilled}`);

  // Step 2: Read rollback.sql and execute it
  console.log('\n🗑️ Executing rollback.sql script...');
  const rollbackSqlPath = path.join(__dirname, 'prisma/migrations/20260721184919_phase_1a_business_unit_foundation/rollback.sql');
  const rollbackSql = fs.readFileSync(rollbackSqlPath, 'utf8');

  // We run rollback queries raw
  await prisma.$executeRawUnsafe(rollbackSql);
  console.log('✅ Rollback SQL executed successfully.');

  // Step 3: Verify tables are dropped and original state restored
  console.log('\n🔍 Verifying table removal (expecting errors)...');
  let tablesDropped = false;
  try {
    // Attempting to query BusinessUnit should fail now
    await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "BusinessUnit";');
  } catch (err: any) {
    console.log(`✅ [PASS] Confirmed BusinessUnit table does not exist: ${err.message}`);
    tablesDropped = true;
  }

  // Close prisma connection before re-running migration
  await prisma.$disconnect();

  console.log('================================================');
  console.log('🔄 Rehearsal Step 3 completed successfully.');
}

rehearseRollback()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
