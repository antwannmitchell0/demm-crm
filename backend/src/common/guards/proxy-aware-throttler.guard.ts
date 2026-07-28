import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { verifyInternalClientIdentity } from '../security/bff-client-identity';

/**
 * Where a verified BFF-asserted identity is stashed between canActivate() and
 * getTracker(). A plain property rather than a symbol: this rides on an Express
 * request object typed as Record<string, any>, which cannot be symbol-indexed.
 * The name is namespaced so it cannot collide with anything Express or Nest set.
 */
const VERIFIED_CLIENT_KEY = '__demmVerifiedClientKey';

/**
 * Rate-limits per CLIENT, not per proxy.
 *
 * THE DEFECT THIS FIXES. ThrottlerGuard keys on `req.ip`. Behind Cloud Run --
 * or any load balancer -- that is the address of the front end, which is
 * identical for every user on the planet. Measured before this existed: two
 * requests with different `X-Forwarded-For` values shared one budget, so after
 * client A sent five registrations, an unrelated client B received HTTP 429.
 *
 * The registration limit of 5/min was therefore not "5 per person per minute",
 * it was "5 for the entire product per minute", and any single actor could
 * lock every real customer out of signing up. The global 100/min limit had the
 * same shape across the whole API.
 *
 * WHY THIS LIVES IN THE GUARD AND NOT IN `app.set('trust proxy', ...)`.
 * main.ts is not the only place the application is constructed -- every
 * integration suite builds it with NestFactory.create(AppModule) directly. An
 * Express setting applied in main.ts would be absent in every test, so the
 * thing under test would differ from the thing deployed in precisely the
 * property being relied upon. Putting it in a guard that AppModule provides
 * means both get identical behaviour by construction.
 *
 * WHY THE HOP COUNT IS EXPLICIT AND DEFAULTS TO ZERO.
 * `X-Forwarded-For` is appended to, not replaced, so any entry a client can
 * reach is a value the client can write. Trusting the leftmost entry would let
 * anyone forge a fresh identity per request and bypass rate limiting entirely
 * -- strictly worse than the bug above.
 *
 * The only entries that cannot be forged are the ones the infrastructure
 * appended, counting from the RIGHT. How many of those there are is a property
 * of the deployment, not of this code, so the operator declares it:
 *
 *   TRUSTED_PROXY_HOPS=0  (default) ignore the header entirely and use the
 *                         socket peer -- correct for direct exposure, and the
 *                         safe answer when the topology is unknown
 *   TRUSTED_PROXY_HOPS=1  one infrastructure hop appended the client address
 *   TRUSTED_PROXY_HOPS=n  n hops
 *
 * Defaulting to 0 fails safe: an unconfigured deployment over-throttles, which
 * is visible and recoverable, rather than under-throttling, which is silent.
 */
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  private static trustedHops(): number {
    const raw = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  /**
   * Verification happens HERE, not in getTracker(), because a bad claim must be
   * REJECTED rather than downgraded.
   *
   * getTracker() can only answer "who is this"; it has no way to refuse. If an
   * invalid signature simply fell through to address-based limiting, an
   * attacker could choose which counter applies by deliberately sending a
   * broken header -- picking whichever one is emptier. Throwing before the
   * limiter runs removes that choice.
   */
  canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const identity = verifyInternalClientIdentity(req);
    if (identity) {
      req[VERIFIED_CLIENT_KEY] = identity.key;
    }
    return super.canActivate(context);
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    // A verified BFF-asserted identity wins. It names the CUSTOMER; the address
    // this request arrived from names the BFF, which is the same for everyone.
    // Prefixed so an opaque key and a raw address can never collide in the
    // limiter's keyspace.
    const verified = req[VERIFIED_CLIENT_KEY];
    if (typeof verified === 'string' && verified !== '') {
      return Promise.resolve(`bff:${verified}`);
    }

    const hops = ProxyAwareThrottlerGuard.trustedHops();
    if (hops === 0) {
      return Promise.resolve(
        `ip:${String(req.ip ?? req.socket?.remoteAddress ?? '')}`,
      );
    }

    const header = req.headers?.['x-forwarded-for'];
    const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((v: string) => v.trim())
      .filter(Boolean);

    // Count in from the right past the hops we control. Anything further left
    // is client-writable and must not be trusted as an identity.
    const index = chain.length - hops - 1;
    if (index < 0) {
      // Fewer entries than declared hops: the request did not arrive through
      // the expected topology. Fall back to the socket peer rather than
      // guessing, so a malformed header cannot mint a new identity.
      return Promise.resolve(
        `ip:${String(req.ip ?? req.socket?.remoteAddress ?? '')}`,
      );
    }

    return Promise.resolve(`ip:${chain[index]}`);
  }
}
