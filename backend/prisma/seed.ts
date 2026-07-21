import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Get all organizations
  const organizations = await prisma.organization.findMany();

  if (organizations.length === 0) {
    console.log('No organizations found to seed. Creating a default demo organization...');
    const defaultOrg = await prisma.organization.create({
      data: {
        name: 'DEMM CRM Demo Org',
      },
    });
    organizations.push(defaultOrg);
  }

  const buKeys = [
    { key: 'MARKETING', name: 'DEMM Marketing' },
    { key: 'PHOTO_BOOTHS', name: 'DEMM Photo Booths' },
    { key: 'WTAE', name: 'WTAE Event Galleries' },
    { key: 'GREATER', name: 'GREATER' },
    { key: 'SOFTER', name: 'SOFTER' },
  ];

  for (const org of organizations) {
    console.log(`Seeding business units for organization: ${org.name} (${org.id})`);
    
    // Seed Business Units
    for (const bu of buKeys) {
      await prisma.businessUnit.upsert({
        where: {
          organizationId_key: {
            organizationId: org.id,
            key: bu.key,
          },
        },
        update: {
          name: bu.name,
        },
        create: {
          organizationId: org.id,
          key: bu.key,
          name: bu.name,
        },
      });
    }

    // Get the MARKETING BusinessUnit
    const marketingBU = await prisma.businessUnit.findFirst({
      where: {
        organizationId: org.id,
        key: 'MARKETING',
      },
    });

    if (marketingBU) {
      // Backfill workspaces that have no businessUnitId assigned
      const workspaces = await prisma.workspace.findMany({
        where: {
          organizationId: org.id,
          businessUnitId: null,
        },
      });

      console.log(`Backfilling ${workspaces.length} workspaces to MARKETING business unit...`);
      for (const workspace of workspaces) {
        await prisma.workspace.update({
          where: { id: workspace.id },
          data: {
            businessUnitId: marketingBU.id,
          },
        });
      }
    }
  }

  console.log('Seeding complete!');
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
