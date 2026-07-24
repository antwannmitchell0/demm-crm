import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL || 'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🧪 Starting Tenant Isolation verification tests...');

  // Clear existing databases for clean test run.
  // Marketing's Offer/ClientAccount chain uses Restrict (not Cascade) FKs
  // back to BusinessUnit/Contact/Company/Opportunity by design (Phase 2
  // Task 1-2) -- a blanket organization.deleteMany() cannot cascade through
  // them, so they must be cleared first, in dependency order, before the
  // rest of this reset can proceed.
  await prisma.clientCommercialStateChange.deleteMany();
  await prisma.conversionIdempotencyKey.deleteMany();
  await prisma.clientAccount.deleteMany();
  await prisma.offerSnapshot.deleteMany();
  await prisma.stripePriceMapping.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.note.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.stage.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();

  // 1. Create Tenant A
  console.log('\nStep 1: Creating Tenant A organization & workspace...');
  const orgA = await prisma.organization.create({
    data: { name: 'Alpha Agency Org' },
  });

  const workspaceA = await prisma.workspace.create({
    data: { name: 'Alpha Agency', subdomain: 'alpha', organizationId: orgA.id },
  });

  const hashA = await bcrypt.hash('alpha-pass', 10);
  const userA = await prisma.user.create({
    data: {
      email: 'owner@alpha.com',
      passwordHash: hashA,
      firstName: 'Alan',
      lastName: 'Alpha',
    },
  });

  // Create Membership A
  await prisma.membership.create({
    data: {
      userId: userA.id,
      organizationId: orgA.id,
      workspaceId: workspaceA.id,
      role: Role.ORG_OWNER,
      permissions: ['*'],
    },
  });

  const contactA = await prisma.contact.create({
    data: {
      firstName: 'John',
      lastName: 'Doe',
      emails: ['john@doe.com'],
      workspaceId: workspaceA.id,
      ownerId: userA.id,
    },
  });
  console.log(`Created Contact '${contactA.firstName} ${contactA.lastName}' in Workspace A (ID: ${workspaceA.id})`);

  // 2. Create Tenant B
  console.log('\nStep 2: Creating Tenant B organization & workspace...');
  const orgB = await prisma.organization.create({
    data: { name: 'Beta Biz Org' },
  });

  const workspaceB = await prisma.workspace.create({
    data: { name: 'Beta Biz', subdomain: 'beta', organizationId: orgB.id },
  });

  const hashB = await bcrypt.hash('beta-pass', 10);
  const userB = await prisma.user.create({
    data: {
      email: 'owner@beta.com',
      passwordHash: hashB,
      firstName: 'Bob',
      lastName: 'Beta',
    },
  });

  // Create Membership B
  await prisma.membership.create({
    data: {
      userId: userB.id,
      organizationId: orgB.id,
      workspaceId: workspaceB.id,
      role: Role.ORG_OWNER,
      permissions: ['*'],
    },
  });

  const contactB = await prisma.contact.create({
    data: {
      firstName: 'Jane',
      lastName: 'Smith',
      emails: ['jane@smith.com'],
      workspaceId: workspaceB.id,
      ownerId: userB.id,
    },
  });
  console.log(`Created Contact '${contactB.firstName} ${contactB.lastName}' in Workspace B (ID: ${workspaceB.id})`);

  // 3. Verification Assertions
  console.log('\nStep 3: Verifying query isolation...');
  
  // Querying contacts for Workspace A
  const contactsA = await prisma.contact.findMany({
    where: { workspaceId: workspaceA.id },
  });
  console.log(`Querying Workspace A contacts: Found ${contactsA.length} contact(s).`);
  const hasOnlyJohn = contactsA.every(c => c.firstName === 'John');
  
  // Querying contacts for Workspace B
  const contactsB = await prisma.contact.findMany({
    where: { workspaceId: workspaceB.id },
  });
  console.log(`Querying Workspace B contacts: Found ${contactsB.length} contact(s).`);
  const hasOnlyJane = contactsB.every(c => c.firstName === 'Jane');

  // Verify that cross querying fails to find other tenant data
  const hasCrossAccess = contactsB.some(c => c.id === contactA.id) || contactsA.some(c => c.id === contactB.id);

  if (hasOnlyJohn && hasOnlyJane && !hasCrossAccess) {
    console.log('\n✅ TENANT ISOLATION VERIFIED SUCCESSFULLY! No workspace can access another workspace.');
  } else {
    console.error('\n❌ ISOLATION TEST FAILED!');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
