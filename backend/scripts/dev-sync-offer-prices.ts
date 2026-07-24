// One-off local-dev helper: provisions real Stripe test-mode Products/Prices
// for every ACTIVE Offer, needed after verify-comprehensive.ts /
// verify-scenarios.ts wipe StripePriceMapping as part of their reset.
// Not part of the test suite or app runtime -- run manually when local dev
// billing verification needs real mappings restored.
import 'dotenv/config';
import { PrismaService } from '../src/prisma.service';
import { StripeEnvironmentGuard } from '../src/modules/marketing/stripe-environment.guard';
import { StripeProvisioningService } from '../src/modules/marketing/stripe-provisioning.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const provisioning = new StripeProvisioningService(
    prisma,
    new StripeEnvironmentGuard(),
  );
  const results = await provisioning.syncOfferPrices();
  console.log(JSON.stringify(results, null, 2));
  await prisma.onModuleDestroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
