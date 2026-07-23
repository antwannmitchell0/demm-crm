// One-off: sets trialEligible/trialDays on existing SURVIVOR/GROWTH/EMPIRE
// Offer rows that were seeded before this sub-project. Safe to re-run --
// idempotent (always sets the same locked values).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const TRIAL_TERMS: Record<string, { trialEligible: boolean; trialDays: number }> = {
  SURVIVOR: { trialEligible: true, trialDays: 7 },
  GROWTH: { trialEligible: false, trialDays: 0 },
  EMPIRE: { trialEligible: false, trialDays: 0 },
};

async function main() {
  for (const [key, terms] of Object.entries(TRIAL_TERMS)) {
    const result = await prisma.offer.updateMany({
      where: { key },
      data: terms,
    });
    console.log(`${key}: updated ${result.count} row(s) to`, terms);
  }
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
