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

      // Seed Founder-tier Offers for MARKETING BusinessUnit
      console.log(`Seeding founder-tier offers for MARKETING business unit (${marketingBU.id})...`);
      const founderTiers = [
        {
          key: 'FOUNDER_99',
          version: 1,
          name: 'Founder $99',
          price: 99.00,
          setupFee: null,
          includedServices: ['Monthly strategy check-in', 'CRM access', 'Email support'],
          excludedServices: ['Done-for-you ad management', 'Custom automation builds'],
          onboardingRequirements: ['Complete intake form', 'Connect CRM workspace'],
          supportBoundaries: 'Email support, 48-hour response time',
          reportingCadence: 'Monthly summary report',
          cancellationTerms: 'Cancel anytime, no refund for the current billing period',
          expectedLaunchTime: '7 days from signed contract',
        },
        {
          key: 'FOUNDER_299',
          version: 1,
          name: 'Founder $299',
          price: 299.00,
          setupFee: null,
          includedServices: ['Everything in Founder $99', 'Bi-weekly strategy call', 'One automation build per month'],
          excludedServices: ['Full done-for-you ad management', 'Dedicated account manager'],
          onboardingRequirements: ['Complete intake form', 'Connect CRM workspace', 'Kickoff call scheduled'],
          supportBoundaries: 'Email + chat support, 24-hour response time',
          reportingCadence: 'Bi-weekly summary report',
          cancellationTerms: 'Cancel anytime, no refund for the current billing period',
          expectedLaunchTime: '5 days from signed contract',
        },
        {
          key: 'FOUNDER_999',
          version: 1,
          name: 'Founder $999',
          price: 999.00,
          setupFee: null,
          includedServices: ['Everything in Founder $299', 'Weekly strategy call', 'Dedicated account manager', 'Unlimited automation builds'],
          excludedServices: ['Paid ad spend management (billed separately)'],
          onboardingRequirements: ['Complete intake form', 'Connect CRM workspace', 'Kickoff call scheduled', 'Brand assets received'],
          supportBoundaries: 'Priority email + chat + phone support, same-day response time',
          reportingCadence: 'Weekly summary report',
          cancellationTerms: '30-day notice required for cancellation',
          expectedLaunchTime: '3 days from signed contract',
        },
      ];

      for (const tier of founderTiers) {
        await prisma.offer.upsert({
          where: {
            businessUnitId_key_version: {
              businessUnitId: marketingBU.id,
              key: tier.key,
              version: tier.version,
            },
          },
          update: {
            name: tier.name,
            price: tier.price,
            setupFee: tier.setupFee,
            includedServices: tier.includedServices,
            excludedServices: tier.excludedServices,
            onboardingRequirements: tier.onboardingRequirements,
            supportBoundaries: tier.supportBoundaries,
            reportingCadence: tier.reportingCadence,
            cancellationTerms: tier.cancellationTerms,
            expectedLaunchTime: tier.expectedLaunchTime,
            lifecycleState: 'ACTIVE',
          },
          create: {
            businessUnitId: marketingBU.id,
            key: tier.key,
            version: tier.version,
            name: tier.name,
            price: tier.price,
            setupFee: tier.setupFee,
            includedServices: tier.includedServices,
            excludedServices: tier.excludedServices,
            onboardingRequirements: tier.onboardingRequirements,
            supportBoundaries: tier.supportBoundaries,
            reportingCadence: tier.reportingCadence,
            cancellationTerms: tier.cancellationTerms,
            expectedLaunchTime: tier.expectedLaunchTime,
            lifecycleState: 'ACTIVE',
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
