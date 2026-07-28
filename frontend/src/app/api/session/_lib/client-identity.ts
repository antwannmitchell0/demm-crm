import * as crypto from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * Carrying the CUSTOMER's rate-limit identity across the BFF hop.
 *
 * THE PROBLEM THIS SOLVES. The backend rate-limits per client, resolving that
 * client from X-Forwarded-For. That works while the browser talks to the
 * backend directly. The moment the BFF sits in between, every registration in
 * the product reaches the backend from ONE address -- the BFF's -- so the
 * per-client budgets collapse into a single product-wide cap and one noisy
 * actor locks everybody out. Measured before this existed: client B's FIRST
 * registration returned 429 because client A had spent the budget.
 *
 * WHY AN OPAQUE KEY AND NOT THE ADDRESS. The backend only needs to tell callers
 * apart; it never needs to know who they are. Forwarding the raw address would
 * spread a piece of personal data into a tier with no use for it, and put it in
 * reach of anything that logs a header. An HMAC is stable for the same client,
 * different for different clients, and meaningless on its own.
 *
 * WHY IT IS SIGNED. An unauthenticated `x-demm-rate-limit-key` header would be
 * strictly worse than the bug: anyone could send a fresh random key per request
 * and never be rate-limited at all. The signature is what makes the header
 * worth honouring, and it is bound to the method and path so a key signed for
 * one operation cannot be replayed onto another.
 *
 * WHY NOT AN IN-MEMORY COUNTER IN THIS TIER. Cloud Run runs many instances. A
 * map in one Next process is not a product-wide limit; it is N independent
 * limits whose total is unbounded and unknowable. The limit stays in one place,
 * the backend, and this module only tells it WHO is asking.
 */

/** Header names, narrow and namespaced so they cannot collide with anything. */
export const CLIENT_KEY_HEADER = 'x-demm-rate-limit-key';
export const CLIENT_TIMESTAMP_HEADER = 'x-demm-rate-limit-timestamp';
export const CLIENT_SIGNATURE_HEADER = 'x-demm-rate-limit-signature';

export interface InternalClientIdentity {
  key: string;
  timestamp: string;
  signature: string;
}

/**
 * Deployment truth, not a guess. Same reasoning as ProxyAwareThrottlerGuard on
 * the backend side: X-Forwarded-For is APPENDED to, so any entry a client can
 * reach is an entry the client can write. Only the hops our own infrastructure
 * added -- counted from the RIGHT -- are trustworthy, and how many there are is
 * a property of the topology.
 *
 * 0 (the default) means "not configured": no identity is derived and no headers
 * are sent, so the backend falls back to its own direct-request handling rather
 * than trusting something unverified.
 */
function trustedHops(): number {
  const raw = Number.parseInt(
    process.env.FRONTEND_TRUSTED_PROXY_HOPS ?? '0',
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function signatureTtlSeconds(): number {
  const raw = Number.parseInt(
    process.env.BFF_RATE_LIMIT_SIGNATURE_TTL_SECONDS ?? '30',
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/**
 * Fails CLOSED where it matters. A staging or production deployment without the
 * secret cannot propagate identity, which silently reinstates the product-wide
 * cap -- an availability defect that looks like nothing at all until real
 * customers collide. Better to refuse to serve than to serve wrongly.
 *
 * In development and test the secret is optional: without it no headers are
 * sent and the backend's direct-request path applies.
 */
function signingSecret(): string | null {
  const secret = process.env.BFF_RATE_LIMIT_SIGNING_SECRET;
  if (secret && secret.trim() !== '') return secret;

  if (process.env.NODE_ENV === 'production') {
    // Deliberately names the variable and nothing else. Never the value.
    throw new Error(
      'BFF_RATE_LIMIT_SIGNING_SECRET is not configured. Registration rate limiting cannot identify clients without it.',
    );
  }
  return null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Strict parse and normalize. Anything not recognisably an address is rejected
 * rather than passed through: an unparsed value that reaches the HMAC still
 * produces a perfectly stable-looking key -- it would just be the wrong one,
 * and nothing downstream could tell.
 *
 * IPv4 and IPv6 are normalized so one client always hashes to one key. An
 * address written `::FFFF:203.0.113.10`, `[::ffff:203.0.113.10]` or
 * `203.0.113.10` is one client, not three.
 */
export function normalizeAddress(value: string): string | null {
  let v = value.trim();
  if (v === '') return null;

  // Strip brackets, then any zone index (fe80::1%eth0) -- the interface name is
  // local to the sender and not part of the identity.
  if (v.startsWith('[')) {
    const close = v.indexOf(']');
    if (close === -1) return null;
    v = v.slice(1, close);
  }
  const zone = v.indexOf('%');
  if (zone !== -1) v = v.slice(0, zone);

  // A trailing :port only ever appears on IPv4 here; bare IPv6 is full of
  // colons, which is why the bracket form exists.
  const v4WithPort = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) v = v4WithPort[1];

  const m = v.match(IPV4);
  if (m) {
    const parts = m.slice(1);
    if (parts.some((o) => Number(o) > 255)) return null;
    // Reject leading zeros: 010.0.0.1 and 10.0.0.1 must not be two identities.
    if (parts.some((o) => o.length > 1 && o.startsWith('0'))) return null;
    return parts.map((o) => Number(o)).join('.');
  }

  const lower = v.toLowerCase();

  // IPv4-mapped IPv6 collapses to its IPv4 form, so one client is one key.
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return normalizeAddress(mapped[1]);

  // Conservative IPv6 shape check. Full RFC 5952 canonicalisation is not
  // attempted -- consistency matters more than elegance and the edge emits one
  // form -- but anything unrecognised is refused rather than guessed at.
  if (
    /^[0-9a-f:]+$/.test(lower) &&
    lower.includes(':') &&
    !lower.includes(':::')
  ) {
    return lower;
  }

  return null;
}

/**
 * The address of the customer, according to the part of the chain we control.
 *
 * Returns null when the chain cannot be trusted to say -- unconfigured hop
 * count, missing header, too few entries, or an entry that does not parse. Null
 * means "no claim", never "use the leftmost value": the leftmost entry is
 * exactly the one an attacker writes.
 */
export function deriveTrustedClientAddress(
  request: NextRequest,
): string | null {
  const hops = trustedHops();
  if (hops === 0) return null;

  const header = request.headers.get('x-forwarded-for');
  if (!header) return null;

  const chain = header
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');

  // Count in from the right past the hops our infrastructure appended.
  const index = chain.length - hops - 1;
  if (index < 0) {
    // Fewer entries than declared hops: this request did not arrive through the
    // expected topology. Fail closed rather than reinterpret the chain.
    return null;
  }

  return normalizeAddress(chain[index]);
}

/**
 * The canonical string the signature covers.
 *
 * Method and path are included so a signature is usable only for the operation
 * it was issued for -- a key signed for register cannot be replayed onto
 * register-invited, which has a different budget. Newline separation needs no
 * escaping because none of the four fields can contain a newline: the method is
 * from a fixed set, the path is an allowlisted literal, the key is hex, and the
 * timestamp is digits.
 */
function canonicalPayload(
  method: string,
  backendPath: string,
  key: string,
  timestamp: string,
): string {
  return [method.toUpperCase(), backendPath, key, timestamp].join('\n');
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Builds the signed identity for one specific backend call, or null when no
 * trustworthy claim can be made.
 *
 * Null is a normal outcome, not an error: a request that never passed through
 * our edge has no identity to forward, and the backend still applies its own
 * proxy-aware limit. What must never happen is a claim that is not true, which
 * is why every failure path returns null instead of guessing.
 */
export function buildInternalClientIdentity(
  request: NextRequest,
  method: string,
  backendPath: string,
): InternalClientIdentity | null {
  const secret = signingSecret();
  if (!secret) return null;

  const address = deriveTrustedClientAddress(request);
  if (!address) return null;

  // The backend never receives the address itself -- only a stable, opaque
  // function of it.
  const key = hmacHex(secret, address);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = hmacHex(
    secret,
    canonicalPayload(method, backendPath, key, timestamp),
  );

  return { key, timestamp, signature };
}

/** Exported so tests can mirror the contract exactly rather than restate it. */
export const __canonicalPayloadForTests = canonicalPayload;
export const __signatureTtlSecondsForTests = signatureTtlSeconds;
