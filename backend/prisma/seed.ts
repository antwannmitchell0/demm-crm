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

      // Seed DEMM OS Offers for MARKETING BusinessUnit.
      //
      // Commercial Truth Lock (2026-07-23): replaces the earlier fabricated
      // "Founder $99/$299/$999" placeholder with the real, sourced DEMM OS
      // tiers, confirmed directly by Antwann plus gbrain page `demm-pricing`
      // (id 928) and ~/.openclaw/workspace-council/plans/THE_UNIFIED_BUILD.md
      // (both locked 2026-06-24, Rule R3). Prices are HELD until proof --
      // do not step these up without a fresh, explicit decision.
      //
      // Fields left `undefined` (supportBoundaries/reportingCadence/
      // cancellationTerms/expectedLaunchTime on Survivor and Empire, and
      // setupFee on all three) are genuine open gaps, not oversights --
      // no confirmed answer exists yet. See the same migration that made
      // these columns nullable for why an invented value isn't acceptable
      // here. Growth's supportBoundaries ("Priority support") is the one
      // tier with an explicitly sourced value.
      console.log(`Seeding DEMM OS offers for MARKETING business unit (${marketingBU.id})...`);
      const demmOsTiers = [
        {
          key: 'SURVIVOR',
          version: 1,
          name: 'Survivor',
          price: 99.0,
          setupFee: null,
          includedServices: [
            'Mirror microsite',
            'AI Receptionist (HERMES/VAPI)',
            'Missed-call text-back (Never Miss A Lead)',
            'Review Manager (automated review requests + reputation management)',
            'CRM sync',
            'Core GHL pipeline + automations (new-contact welcome, appointment reminders, invoice-paid review request)',
          ],
          excludedServices: [
            'Full multi-touch nurture',
            'ATLAS cross-client pattern injection',
            'Proof/content engine',
            'Priority support',
            'White-glove deployment',
            'ORACLE / Oracle-Audit (AEO)',
            'Custom workflows',
          ],
          onboardingRequirements: ['GHL sub-account provisioned by ALEXIS'],
          supportBoundaries: null,
          reportingCadence: null,
          cancellationTerms: null,
          expectedLaunchTime: null,
        },
        {
          key: 'GROWTH',
          version: 1,
          name: 'Growth',
          price: 299.0,
          setupFee: null,
          includedServices: [
            'Everything in Survivor',
            'Full multi-touch nurture',
            'ATLAS cross-client pattern injection',
            'Proof/content engine',
            'Priority support',
          ],
          excludedServices: [
            'White-glove deployment',
            'ORACLE / Oracle-Audit (AEO)',
            'Custom workflows',
          ],
          onboardingRequirements: ['GHL sub-account provisioned by ALEXIS'],
          supportBoundaries: 'Priority support',
          reportingCadence: null,
          cancellationTerms: null,
          expectedLaunchTime: null,
        },
        {
          key: 'EMPIRE',
          version: 1,
          name: 'Empire',
          price: 999.0,
          setupFee: null,
          includedServices: [
            'Everything in Growth',
            'White-glove deployment',
            'ORACLE / Oracle-Audit (AEO — get recommended by AI assistants)',
            'Custom workflows',
          ],
          excludedServices: [],
          onboardingRequirements: [
            'GHL sub-account provisioned by ALEXIS',
            'White-glove deployment scheduling',
          ],
          supportBoundaries: null,
          reportingCadence: null,
          cancellationTerms: null,
          expectedLaunchTime: null,
        },
      ];

      for (const tier of demmOsTiers) {
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
            // These are the real, currently-marketed DEMM OS prices Antwann
            // confirmed are actively for sale (2026-07-23) -- publicly
            // available is the honest state, not an assumption.
            isPubliclyAvailable: true,
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
            isPubliclyAvailable: true,
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
