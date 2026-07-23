import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StripeEnvironmentGuard } from './src/modules/marketing/stripe-environment.guard';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}`);
    fail++;
  }
}

async function runApiTests() {
  console.log('🧪 STARTING STRIPE BILLING API SUITE');
  console.log('=====================================');

  // --- StripeEnvironmentGuard unit-level checks (no HTTP needed) ---
  const guard = new StripeEnvironmentGuard();

  process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
  process.env.APP_ENVIRONMENT = 'local';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check('Guard allows test key + local + livemode:false', true);
  } catch (e) {
    check('Guard allows test key + local + livemode:false', false);
  }

  try {
    guard.assertConsistent({ environment: 'local', livemode: true });
    check('Guard REJECTS test key used with livemode:true mapping', false);
  } catch (e) {
    check('Guard REJECTS test key used with livemode:true mapping', true);
  }

  process.env.STRIPE_SECRET_KEY = 'sk_live_realkey';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      false,
    );
  } catch (e) {
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      true,
    );
  }
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc123'; // restore for later tasks' tests

  console.log('=====================================');
  console.log(`📊 STRIPE BILLING API SUITE: ${pass} passed, ${fail} failed.`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

runApiTests().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
