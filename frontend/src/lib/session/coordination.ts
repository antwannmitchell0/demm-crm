/**
 * Cross-tab session coordination primitives.
 *
 * NOTHING here ever carries a refresh token. The refresh token lives only in
 * the httpOnly cookie set by the T7 routes and is unreadable from this code.
 * The access token is passed between tabs in memory via BroadcastChannel
 * (never persisted); the fallback lock stores ownership metadata only.
 */

/** Random per-tab id so a tab can ignore its own broadcasts. */
export const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;

const CHANNEL_NAME = 'demm_crm_session';
const LOCK_NAME = 'demm_crm_refresh_lock';
/** Fallback-lock bookkeeping only: owner id + expiry. Never a credential. */
const FALLBACK_LOCK_KEY = 'demm_crm_refresh_lock_meta';
const FALLBACK_LOCK_TTL_MS = 10_000;

export interface SessionUserMeta {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  workspaceId: string;
}

export type SessionMessage =
  | {
      type: 'ACCESS_TOKEN_UPDATED';
      from: string;
      accessToken: string;
      expiresAt: number | null;
      user: SessionUserMeta | null;
    }
  /**
   * T9: one tab entered a DIFFERENT workspace. Structurally the same as
   * ACCESS_TOKEN_UPDATED, but kept as its own type because the required
   * reaction is different: a token update can be adopted silently, while a
   * workspace change invalidates everything the receiving tab is currently
   * displaying. Receivers adopt the new session AND reload, so no tab can
   * render one workspace's data while holding another workspace's token.
   *
   * Carries no pre-auth token and no refresh token -- only the same
   * short-lived access token and user metadata as ACCESS_TOKEN_UPDATED.
   */
  | {
      type: 'WORKSPACE_SWITCHED';
      from: string;
      accessToken: string;
      expiresAt: number | null;
      user: SessionUserMeta | null;
    }
  | { type: 'SESSION_ENDED'; from: string };

let channel: BroadcastChannel | null = null;
let listener: ((message: SessionMessage) => void) | null = null;

function supportsBroadcast(): boolean {
  return typeof window !== 'undefined' && 'BroadcastChannel' in window;
}

/**
 * Subscribes to session events from other tabs. Returns a teardown function --
 * callers must invoke it on unmount/hot-reload so channels are not leaked.
 */
export function subscribeToSessionMessages(
  onMessage: (message: SessionMessage) => void,
): () => void {
  if (!supportsBroadcast()) return () => undefined;

  listener = onMessage;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<SessionMessage>) => {
    const message = event.data;
    // Ignore our own echo; BroadcastChannel does not deliver to the sender,
    // but this keeps the contract explicit if that ever changes.
    if (!message || message.from === TAB_ID) return;
    listener?.(message);
  };

  return () => {
    if (channel) {
      channel.onmessage = null;
      channel.close();
      channel = null;
    }
    listener = null;
  };
}

export function broadcastSessionMessage(message: SessionMessage): void {
  if (!supportsBroadcast()) return;
  // Use the subscribed channel when present, otherwise a short-lived one so a
  // tab that never subscribed can still notify others (e.g. logout on unmount).
  if (channel) {
    channel.postMessage(message);
    return;
  }
  const temp = new BroadcastChannel(CHANNEL_NAME);
  temp.postMessage(message);
  temp.close();
}

/**
 * Serializes refresh across tabs.
 *
 * Preferred: the Web Locks API, which is genuinely cross-tab and releases
 * automatically if a tab crashes.
 *
 * Fallback: a bounded localStorage lock holding ONLY `{ owner, expiresAt }`.
 * It is best-effort -- two tabs can still interleave between the read and the
 * write, so a rare simultaneous refresh remains possible. That residual race is
 * documented rather than hidden; the T7 cookie makes it far less dangerous than
 * it sounds, because a tab that loses the race sends whatever cookie the
 * browser currently holds rather than a stale copy.
 */
export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    navigator.locks?.request
  ) {
    return navigator.locks.request(LOCK_NAME, fn) as Promise<T>;
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return fn();
  }

  const deadline = Date.now() + FALLBACK_LOCK_TTL_MS;
  while (Date.now() < deadline) {
    const raw = window.localStorage.getItem(FALLBACK_LOCK_KEY);
    let held = false;
    if (raw) {
      try {
        const meta = JSON.parse(raw) as { owner: string; expiresAt: number };
        held = meta.expiresAt > Date.now() && meta.owner !== TAB_ID;
      } catch {
        held = false; // corrupt value: treat as free
      }
    }
    if (!held) {
      window.localStorage.setItem(
        FALLBACK_LOCK_KEY,
        JSON.stringify({
          owner: TAB_ID,
          expiresAt: Date.now() + FALLBACK_LOCK_TTL_MS,
        }),
      );
      try {
        return await fn();
      } finally {
        const current = window.localStorage.getItem(FALLBACK_LOCK_KEY);
        if (current && current.includes(TAB_ID)) {
          window.localStorage.removeItem(FALLBACK_LOCK_KEY);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Lock never freed within the TTL (holder crashed, or a stale entry).
  // Proceed rather than deadlocking the user's session.
  return fn();
}
