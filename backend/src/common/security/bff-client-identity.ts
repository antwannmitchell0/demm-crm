import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Verifying the customer identity the BFF asserts on a request.
 *
 * WHY THIS EXISTS. The rate limit is per client, and the client is resolved
 * from the request's address. Once the BFF sits between the browser and this
 * service, every registration arrives from the BFF's single address, so the
 * per-client budget silently becomes a product-wide cap -- measured before the
 * fix, an unrelated client's FIRST registration returned 429.
 *
 * The BFF therefore tells us who the customer is. This module decides whether
 * to believe it.
 *
 * WHY A SIGNATURE IS NOT OPTIONAL. An unauthenticated identity header would be
 * strictly worse than the bug it fixes: anyone could send a fresh random key per
 * request and never be limited at all. The header is worth exactly as much as
 * its proof.
 *
 * WHY PARTIAL SETS ARE REJECTED RATHER THAN IGNORED. If a missing or broken
 * signature fell back to address-based limiting, an attacker could choose which
 * identity path applies simply by sending a malformed header -- picking
 * whichever counter is emptier. The presence of ANY of these headers commits
 * the request to this path, and it then either verifies or is refused.
 */

export const CLIENT_KEY_HEADER = 'x-demm-rate-limit-key';
export const CLIENT_TIMESTAMP_HEADER = 'x-demm-rate-limit-timestamp';
export const CLIENT_SIGNATURE_HEADER = 'x-demm-rate-limit-signature';

const IDENTITY_HEADERS = [
  CLIENT_KEY_HEADER,
  CLIENT_TIMESTAMP_HEADER,
  CLIENT_SIGNATURE_HEADER,
] as const;

/** 64 hex characters: exactly what an HMAC-SHA256 digest looks like. */
const HEX_64 = /^[0-9a-f]{64}$/;

export interface VerifiedClientIdentity {
  /** Opaque, stable per client. Never an address. */
  key: string;
}

function signatureTtlSeconds(): number {
  const raw = Number.parseInt(
    process.env.BFF_RATE_LIMIT_SIGNATURE_TTL_SECONDS ?? '30',
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/**
 * Compares two hex digests without leaking their contents through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * timing-visible early exit, so both sides are hashed to a fixed width first.
 * Every comparison is then the same shape regardless of what arrived.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * The canonical string the signature covers. Must match the BFF's
 * canonicalPayload() exactly -- see
 * frontend/src/app/api/session/_lib/client-identity.ts.
 *
 * Method and path are included so an identity is usable only for the operation
 * it was issued for: a key signed for register cannot be replayed onto
 * register-invited, which has a different budget, nor onto a GET.
 */
function canonicalPayload(
  method: string,
  backendPath: string,
  key: string,
  timestamp: string,
): string {
  return [method.toUpperCase(), backendPath, key, timestamp].join('\n');
}

/**
 * Normalizes the request target to the form the BFF signs: no leading slash, no
 * query string. The BFF signs its allowlist entry ('api/auth/register') while
 * the server sees '/api/auth/register'.
 */
function normalizePath(url: string): string {
  return url.split('?')[0].replace(/^\/+/, '');
}

/**
 * Returns the verified identity, or null when the request makes no claim.
 *
 * Throws when a claim is made and fails: missing companion headers, wrong
 * shape, bad signature, stale timestamp, or a signature issued for a different
 * method or path. Never falls back to address-based limiting once a claim has
 * been made, so a caller cannot select the weaker path by breaking the stronger
 * one.
 *
 * Every rejection is the SAME opaque message. A specific reason would tell a
 * prober which of secret, freshness or binding they got wrong, and the operator
 * can see the specifics far more safely than the caller can.
 */
export function verifyInternalClientIdentity(req: {
  headers?: Record<string, unknown>;
  method?: string;
  url?: string;
  originalUrl?: string;
}): VerifiedClientIdentity | null {
  const read = (name: string): string | null => {
    const raw = req.headers?.[name];
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
    return null;
  };

  // PRESENCE IS NOT VALIDITY, and the two must be judged separately.
  //
  // A header sent twice arrives as an array, which read() refuses -- correctly,
  // since picking one of two conflicting values is a guess. But if presence
  // were measured with read(), duplicating ALL THREE headers would make the set
  // look absent and quietly hand the request to the address-based path. That is
  // the caller choosing which identity path applies, which is the one thing
  // this must never allow. Presence is therefore "the key exists at all".
  const isPresent = (name: string): boolean =>
    req.headers?.[name] !== undefined && req.headers?.[name] !== null;

  const present = IDENTITY_HEADERS.filter(isPresent);
  if (present.length === 0) return null;

  const reject = (): never => {
    // No detail, and above all never the expected signature.
    throw new BadRequestException('Invalid request.');
  };

  if (present.length !== IDENTITY_HEADERS.length) reject();
  // Present but unusable (duplicated, empty, non-string) is a failed claim, not
  // an absent one.
  if (IDENTITY_HEADERS.some((h) => read(h) === null)) reject();

  const secret = process.env.BFF_RATE_LIMIT_SIGNING_SECRET;
  if (!secret || secret.trim() === '') {
    // A claim arrived that this service cannot possibly verify. Refusing is the
    // only safe answer: honouring it would let anyone set their own identity.
    reject();
  }

  const key = read(CLIENT_KEY_HEADER) as string;
  const timestamp = read(CLIENT_TIMESTAMP_HEADER) as string;
  const signature = read(CLIENT_SIGNATURE_HEADER) as string;

  if (!HEX_64.test(key) || !HEX_64.test(signature)) reject();
  if (!/^\d{1,12}$/.test(timestamp)) reject();

  const issued = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  const ttl = signatureTtlSeconds();
  // Bounded on BOTH sides. A far-future timestamp would otherwise mint an
  // identity valid indefinitely; the small backward allowance covers ordinary
  // clock skew between two services.
  if (issued > now + 5 || now - issued > ttl) reject();

  const expected = crypto
    .createHmac('sha256', secret as string)
    .update(
      canonicalPayload(
        req.method ?? '',
        normalizePath(req.originalUrl ?? req.url ?? ''),
        key,
        timestamp,
      ),
    )
    .digest('hex');

  if (!constantTimeEquals(expected, signature)) reject();

  // Only the opaque key leaves this function. The signature and the secret stop
  // here.
  return { key };
}
