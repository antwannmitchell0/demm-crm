/**
 * Browser session client -- the single source of truth for session state.
 *
 * CREDENTIAL RULES (T8):
 *  - The refresh token lives ONLY in the T7 httpOnly cookie. This module never
 *    sees it, never receives it in a response body, and cannot read it.
 *  - The access token lives ONLY in the module-scoped variable below. It is
 *    never written to localStorage, sessionStorage, IndexedDB, a URL, or a
 *    browser-readable cookie.
 *  - The only browser storage this feature touches is the fallback refresh lock
 *    (ownership metadata) and a one-time delete of the legacy token keys.
 */
import {
  TAB_ID,
  broadcastSessionMessage,
  subscribeToSessionMessages,
  withRefreshLock,
  type SessionMessage,
  type SessionUserMeta,
} from './coordination';

export type SessionState =
  | 'UNINITIALIZED'
  | 'RESTORING'
  | 'AUTHENTICATED'
  | 'UNAUTHENTICATED'
  | 'WORKSPACE_SELECTION_REQUIRED';

export interface SessionSnapshot {
  state: SessionState;
  user: SessionUserMeta | null;
}

/**
 * One workspace the signed-in account may enter, exactly as the backend
 * reported it. These are display facts, not authorization: the backend
 * re-verifies membership when the workspace session is established, so a
 * tampered list cannot grant access to anything.
 */
export interface WorkspaceChoice {
  workspaceId: string;
  workspaceName?: string;
  organizationId?: string;
  organizationName?: string;
  role?: string;
}

export type LoginOutcome =
  /** Exactly one workspace existed, so it was entered without asking. */
  | { outcome: 'ENTERED'; choices: WorkspaceChoice[] }
  /** More than one workspace exists; the user must choose. */
  | { outcome: 'SELECTION_REQUIRED'; choices: WorkspaceChoice[] }
  /** The account is valid but belongs to no workspace. */
  | { outcome: 'NO_WORKSPACE'; choices: WorkspaceChoice[] };

/**
 * A workspace choice that is pending, and how it will be entered.
 *
 * The two reasons authenticate differently, which is why `preAuthToken` is
 * optional:
 *
 *  - LOGIN carries one. It is a credential, held in memory for the seconds
 *    between proving a password and picking a workspace, never returned to the
 *    UI, never broadcast, never written to storage, and dropped the moment it
 *    is spent.
 *  - SWITCH carries none. An already-established session moves workspace by
 *    spending its httpOnly refresh cookie, which browser JavaScript cannot
 *    read; the BFF supplies it server-side. Nothing sensitive is held here at
 *    all, so an abandoned switch leaves nothing behind to expire.
 */
interface PendingWorkspaceSelection {
  reason: 'LOGIN' | 'SWITCH';
  preAuthToken?: string;
  choices: WorkspaceChoice[];
}

/** Legacy keys from the pre-T8 localStorage implementation, deleted on boot. */
const LEGACY_KEYS = ['demm_crm_token', 'demm_crm_user'];

/** Refresh this far before expiry, absorbing clock skew and latency. */
const REFRESH_SKEW_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 5_000;

// ---- in-memory state (never persisted) ----
let accessToken: string | null = null;
let currentUser: SessionUserMeta | null = null;
let accessTokenExpiresAt: number | null = null;
let state: SessionState = 'UNINITIALIZED';
let pendingSelection: PendingWorkspaceSelection | null = null;

let refreshInFlight: Promise<boolean> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeMessages: (() => void) | null = null;

const subscribers = new Set<(snapshot: SessionSnapshot) => void>();

function snapshot(): SessionSnapshot {
  return { state, user: currentUser };
}

function emit() {
  const current = snapshot();
  for (const subscriber of subscribers) subscriber(current);
}

export function subscribeToSession(
  subscriber: (snapshot: SessionSnapshot) => void,
): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot());
  return () => subscribers.delete(subscriber);
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getSessionUser(): SessionUserMeta | null {
  return currentUser;
}

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Schedules a pre-emptive refresh shortly before the access token expires, so
 * the app rarely has to learn about expiry from a 401.
 *
 * A tab that was asleep wakes with an overdue timer; it fires once and routes
 * through the same single-flight + cross-tab lock as every other refresh, so a
 * group of waking tabs cannot produce a refresh storm.
 */
function scheduleProactiveRefresh() {
  clearRefreshTimer();
  if (typeof window === 'undefined' || accessTokenExpiresAt === null) return;

  const delay = Math.max(
    accessTokenExpiresAt - Date.now() - REFRESH_SKEW_MS,
    MIN_REFRESH_DELAY_MS,
  );
  refreshTimer = setTimeout(() => {
    void refreshSession();
  }, delay);
}

function applySession(
  token: string,
  expiresInSeconds: number | null,
  user: SessionUserMeta | null,
) {
  accessToken = token;
  accessTokenExpiresAt =
    typeof expiresInSeconds === 'number' && expiresInSeconds > 0
      ? Date.now() + expiresInSeconds * 1000
      : null;
  if (user) currentUser = user;
  state = 'AUTHENTICATED';
  scheduleProactiveRefresh();
  emit();
}

function clearSessionLocally(nextState: SessionState = 'UNAUTHENTICATED') {
  accessToken = null;
  currentUser = null;
  accessTokenExpiresAt = null;
  // An unspent workspace authorization dies with the session that produced it.
  pendingSelection = null;
  state = nextState;
  clearRefreshTimer();
  emit();
}

function purgeLegacyStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  for (const key of LEGACY_KEYS) {
    window.localStorage.removeItem(key);
    window.sessionStorage?.removeItem(key);
  }
}

async function postSessionRoute(
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Same-origin so the httpOnly cookie is attached; Origin is set by the
    // browser and validated server-side by the T7 routes.
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

function readUser(data: Record<string, unknown>): SessionUserMeta | null {
  const user = data.user as SessionUserMeta | undefined;
  return user && typeof user === 'object' ? user : null;
}

/**
 * Exchanges the httpOnly cookie for a fresh access token.
 *
 * Single flight in two layers:
 *  1. `refreshInFlight` collapses every concurrent caller in THIS tab onto one
 *     promise, so simultaneous 401s produce exactly one refresh.
 *  2. `withRefreshLock` serializes across tabs. After acquiring the lock we
 *     re-check whether another tab already refreshed and broadcast a new token;
 *     if so we adopt it instead of making a second network call. That check is
 *     what stops legitimate multi-tab activity from tripping T6's replay
 *     defence.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const tokenBeforeLock = accessToken;

  refreshInFlight = withRefreshLock(async () => {
    if (accessToken && accessToken !== tokenBeforeLock) {
      // Another tab refreshed while we waited; its token is already ours.
      return true;
    }

    const { status, data } = await postSessionRoute(
      '/api/session/refresh',
      {},
    );

    if (status === 200 && typeof data.access_token === 'string') {
      const user = readUser(data);
      applySession(
        data.access_token,
        typeof data.expires_in === 'number' ? data.expires_in : null,
        user,
      );
      broadcastSessionMessage({
        type: 'ACCESS_TOKEN_UPDATED',
        from: TAB_ID,
        accessToken: data.access_token,
        expiresAt: accessTokenExpiresAt,
        user: currentUser,
      });
      return true;
    }

    // 401 (no cookie, expired, revoked, or replay-detected) ends the session
    // everywhere. Anything else is treated the same locally: without a usable
    // access token there is no session to keep.
    clearSessionLocally('UNAUTHENTICATED');
    broadcastSessionMessage({ type: 'SESSION_ENDED', from: TAB_ID });
    return false;
  })
    .catch(() => {
      clearSessionLocally('UNAUTHENTICATED');
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * Startup restoration. Deletes legacy storage, wires cross-tab listeners, then
 * attempts one refresh so a page reload keeps the user signed in while a valid
 * cookie exists. A failure simply lands in UNAUTHENTICATED -- never a loop and
 * never a visible error.
 */
export async function bootstrapSession(): Promise<SessionSnapshot> {
  purgeLegacyStorage();

  if (!unsubscribeMessages) {
    unsubscribeMessages = subscribeToSessionMessages(
      (message: SessionMessage) => {
        if (message.type === 'ACCESS_TOKEN_UPDATED') {
          accessToken = message.accessToken;
          accessTokenExpiresAt = message.expiresAt;
          if (message.user) currentUser = message.user;
          state = 'AUTHENTICATED';
          scheduleProactiveRefresh();
          emit();
          return;
        }

        // MULTI-TAB SWITCH POLICY: every tab follows the new workspace.
        //
        // The alternative -- ending other tabs' sessions -- was rejected: the
        // shared cookie is still perfectly valid, so those tabs would show a
        // login screen for a session that is alive, and the next reload would
        // sign them straight back in. Following is also the only policy that
        // cannot leave a tab displaying one workspace while holding another
        // workspace's token.
        //
        // The token is adopted first so nothing in flight uses a stale one,
        // then the tab reloads: workspace-scoped data already on screen belongs
        // to the previous workspace and cannot be kept. The reload's own
        // restore goes through the same cross-tab lock as any other refresh,
        // so several tabs reloading at once do not race.
        if (message.type === 'WORKSPACE_SWITCHED') {
          accessToken = message.accessToken;
          accessTokenExpiresAt = message.expiresAt;
          if (message.user) currentUser = message.user;
          state = 'AUTHENTICATED';
          pendingSelection = null;
          clearRefreshTimer();
          emit();
          if (typeof window !== 'undefined' && window.location?.reload) {
            window.location.reload();
          }
          return;
        }
        // SESSION_ENDED: logout or replay detection elsewhere.
        clearSessionLocally('UNAUTHENTICATED');
      },
    );
  }

  state = 'RESTORING';
  emit();
  await refreshSession();
  return snapshot();
}

/**
 * Proves a password and asks the backend which workspaces the account may
 * enter. Returns WITHOUT establishing a session unless the answer removes the
 * choice entirely.
 *
 * The three outcomes are deliberately distinct, because they are three
 * different truths about the account:
 *  - ENTERED: exactly one workspace exists, so there is nothing to decide and
 *    stopping to ask would be friction with no purpose.
 *  - SELECTION_REQUIRED: several exist. The app must NOT pick one; entering the
 *    wrong workspace silently is the defect T9 exists to remove.
 *  - NO_WORKSPACE: the password was right but no workspace is available. That
 *    is reported honestly; nothing is invented, created, or guessed.
 */
export async function beginLogin(
  email: string,
  passwordPlain: string,
): Promise<LoginOutcome> {
  const { status, data } = await postSessionRoute('/api/session/login', {
    email,
    passwordPlain,
  });

  if (status !== 200 || typeof data.preAuthToken !== 'string') {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Login failed',
    );
  }

  const choices: WorkspaceChoice[] = Array.isArray(data.workspaces)
    ? (data.workspaces as WorkspaceChoice[]).filter(
        (choice) => choice && typeof choice.workspaceId === 'string',
      )
    : [];

  if (choices.length === 0) {
    clearSessionLocally('UNAUTHENTICATED');
    return { outcome: 'NO_WORKSPACE', choices };
  }

  pendingSelection = {
    reason: 'LOGIN',
    preAuthToken: data.preAuthToken,
    choices,
  };

  if (choices.length === 1) {
    // Exactly one member, so this is not a decision -- reuse the same
    // verified path the picker uses rather than a separate shortcut.
    await switchWorkspace(choices[choices.length - 1].workspaceId);
    return { outcome: 'ENTERED', choices };
  }

  state = 'WORKSPACE_SELECTION_REQUIRED';
  emit();
  return { outcome: 'SELECTION_REQUIRED', choices };
}

/**
 * The workspaces currently offered, WITHOUT the pre-auth token that authorizes
 * entering them. The UI gets the names it needs to render and nothing it could
 * leak.
 */
export function getPendingWorkspaceChoices(): {
  reason: 'LOGIN' | 'SWITCH';
  choices: WorkspaceChoice[];
} | null {
  if (!pendingSelection) return null;
  return {
    reason: pendingSelection.reason,
    choices: pendingSelection.choices,
  };
}

/** Abandons an unspent workspace authorization (user cancelled). */
export function cancelPendingWorkspaceSelection(): void {
  pendingSelection = null;
  emit();
}

/**
 * Lists the workspaces this signed-in account may move to.
 *
 * This used to take the user's password and perform a full re-login. That was
 * never a security decision -- it was the only mechanism that existed. The
 * backend could mint a workspace-bound session exactly one way
 * (`select-workspace`, needing the pre-auth token only a password produces),
 * and nothing exposed the account's workspace list to an authenticated caller,
 * so re-authenticating was the only way to learn where the user could go.
 *
 * Both halves now exist: `GET api/auth/memberships` returns the list for the
 * bearer token, and `switch-workspace` spends the session's refresh token to
 * enter one. Re-typing a password bought nothing and put the credential back on
 * the wire on every switch.
 *
 * The live session is left completely untouched until a workspace is actually
 * chosen, so cancelling costs the user nothing.
 */
// `backendBaseUrl` is passed in rather than read here, matching logoutAll()
// below. This module deliberately holds no knowledge of the API host: it is the
// credential boundary, and everything it does must be inspectable without also
// reasoning about environment configuration.
export async function beginWorkspaceSwitch(
  backendBaseUrl: string,
): Promise<WorkspaceChoice[]> {
  if (!accessToken) {
    throw new Error('You need to be signed in to change workspaces.');
  }

  const response = await fetch(`${backendBaseUrl}/api/auth/memberships`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Could not load your workspaces. Please try again.');
  }

  const data = (await response.json().catch(() => ({}))) as {
    memberships?: unknown;
  };
  const choices: WorkspaceChoice[] = Array.isArray(data.memberships)
    ? (data.memberships as WorkspaceChoice[]).filter(
        (choice) => choice && typeof choice.workspaceId === 'string',
      )
    : [];

  // No preAuthToken: entering one of these spends the refresh cookie instead.
  pendingSelection = { reason: 'SWITCH', choices };
  return choices;
}

/**
 * THE single operation that enters a workspace -- used both to finish login and
 * to switch later. There is no other path that puts a workspace session in
 * place, so client state and the backend session can never diverge.
 *
 * Every switch is a full re-establishment: a new backend session, a rotated
 * httpOnly refresh cookie (set by the BFF route, not by this code), a new
 * in-memory access token, new user/role/workspace metadata, a rescheduled
 * refresh, and a broadcast telling every other tab to follow. Client-side
 * workspace state is never mutated on its own.
 */
export async function switchWorkspace(workspaceId: string): Promise<void> {
  if (!pendingSelection) {
    throw new Error(
      'Your sign-in has expired. Please sign in again to change workspaces.',
    );
  }

  // Only a workspace the backend actually offered may be requested. This is a
  // correctness guard, not the security boundary -- the backend re-checks
  // membership before issuing anything.
  const offered = pendingSelection.choices.some(
    (choice) => choice.workspaceId === workspaceId,
  );
  if (!offered) {
    throw new Error('That workspace is not available on this account.');
  }

  // Two routes, because the two situations authenticate differently and only
  // one of them has a credential to spend:
  //
  //  - LOGIN completes with the pre-auth token the password produced. There is
  //    no session yet, so there is no refresh cookie to trade in.
  //  - SWITCH has a live session and no pre-auth token. The BFF reads the
  //    httpOnly refresh cookie -- unreadable from here -- and the backend
  //    SPENDS it, which is what keeps one live refresh token per browser
  //    instead of one per workspace ever visited.
  const { status, data } =
    pendingSelection.reason === 'LOGIN'
      ? await postSessionRoute('/api/session/select-workspace', {
          preAuthToken: pendingSelection.preAuthToken,
          workspaceId,
        })
      : await postSessionRoute('/api/session/switch-workspace', {
          workspaceId,
        });

  if (status !== 200 || typeof data.access_token !== 'string') {
    // The pending choice is kept so the user can try a different workspace
    // without starting over. For LOGIN the pre-auth token expires on its own
    // shortly; for SWITCH nothing sensitive is being held at all.
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : 'Could not open that workspace.',
    );
  }

  // Spent. For LOGIN this drops the pre-auth token, so no reusable
  // workspace-entry credential survives in memory for the life of the tab.
  pendingSelection = null;

  applySession(
    data.access_token,
    typeof data.expires_in === 'number' ? data.expires_in : null,
    readUser(data),
  );

  // WORKSPACE_SWITCHED rather than ACCESS_TOKEN_UPDATED, unconditionally:
  // establishing a workspace session replaces the ONE refresh cookie the whole
  // browser shares, so every other tab's session now belongs to this workspace
  // whether it knows it or not. Telling them to adopt and reload is what keeps
  // a tab from rendering the old workspace's data over the new session.
  broadcastSessionMessage({
    type: 'WORKSPACE_SWITCHED',
    from: TAB_ID,
    accessToken: data.access_token,
    expiresAt: accessTokenExpiresAt,
    user: currentUser,
  });
}

/**
 * Accepts an invitation using a password, and enters the workspace.
 *
 * FOR THE PERSON WHO CANNOT SIGN IN YET. Someone invited to their first
 * workspace holds no membership, so select-workspace cannot mint them a
 * session -- beginLogin() leaves them at "signed in, but not part of any
 * workspace". Accepting is what creates the membership, so it has to happen
 * BEFORE a session can exist, not after.
 *
 * The whole exchange happens in one server-side chain behind the BFF: the
 * password buys a pre-session token, that mints a capability scoped to this one
 * invitation, the capability accepts it, and only then is a session issued.
 * Neither the pre-session token nor the capability is ever returned to this
 * tab; the refresh token arrives only as an httpOnly cookie.
 *
 * Returns without adopting anything when the server reports no access -- an
 * administrator removed the account after the link was used. Adopting a session
 * there would put somebody inside a workspace they cannot open.
 */
export async function acceptInvitationAndEnter(
  email: string,
  passwordPlain: string,
  token: string,
): Promise<{ outcome: string | null; hasAccess: boolean }> {
  const { status, data } = await postSessionRoute(
    '/api/session/accept-invitation',
    { email, passwordPlain, token },
  );

  if (status !== 200) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : 'That invitation could not be accepted.',
    );
  }

  const outcome = typeof data.outcome === 'string' ? data.outcome : null;

  if (data.hasAccess !== true || typeof data.access_token !== 'string') {
    return { outcome, hasAccess: false };
  }

  applySession(
    data.access_token,
    typeof data.expires_in === 'number' ? data.expires_in : null,
    readUser(data),
  );

  // Same reasoning as switchWorkspace(): accepting replaces the ONE refresh
  // cookie the whole browser shares, so every other tab's session now belongs
  // to this workspace whether it knows it or not.
  broadcastSessionMessage({
    type: 'WORKSPACE_SWITCHED',
    from: TAB_ID,
    accessToken: data.access_token,
    expiresAt: accessTokenExpiresAt,
    user: currentUser,
  });

  return { outcome, hasAccess: true };
}

/** Ends this session and every tab's view of it. Always clears locally. */
export async function logout(): Promise<void> {
  try {
    await postSessionRoute('/api/session/logout', {});
  } catch {
    // A failed logout call must never strand the user with a live session.
  }
  purgeLegacyStorage();
  clearSessionLocally('UNAUTHENTICATED');
  broadcastSessionMessage({ type: 'SESSION_ENDED', from: TAB_ID });
}

/**
 * Ends every session for this user on every device.
 *
 * Calls the backend's existing logout-all with the in-memory access token, then
 * the T7 logout route to clear this browser's cookie. No UI surfaces this yet --
 * the control belongs with the account menu work.
 */
export async function logoutAll(backendBaseUrl: string): Promise<void> {
  if (accessToken) {
    try {
      await fetch(`${backendBaseUrl}/api/auth/logout-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Best effort; the local session is cleared regardless.
    }
  }
  await logout();
}

/** Teardown for unmount / hot reload. */
export function teardownSession(): void {
  clearRefreshTimer();
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
}

/** Test-only visibility into whether a refresh is currently in flight. */
export function isRefreshInFlight(): boolean {
  return refreshInFlight !== null;
}
