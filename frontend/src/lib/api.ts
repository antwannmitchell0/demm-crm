// The backend (see backend/src/main.ts) has no app.setGlobalPrefix('api') --
// every controller is unprefixed EXCEPT AuthController, which declares
// @Controller('api/auth') itself (backend/src/modules/auth/auth.controller.ts).
// That inconsistency is load-bearing: test-auth-security.ts,
// test-workspace-controller-security.ts, and the staging verification
// scripts all hit /api/auth/* explicitly, so it can't be "fixed" by
// changing the backend without breaking an already-passing, security-
// critical test suite. The local-dev fallback below must match the
// backend's real (inconsistent) shape, or every request 404s when
// NEXT_PUBLIC_API_URL isn't explicitly set -- auth calls below are
// prefixed with 'api/' individually to match.
import * as sessionClient from './session/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  workspaceId: string;
  /**
   * Display names for the active context, mirroring SessionUserMeta. Optional
   * for the same reason: a session established by an older backend carries the
   * ids only, so the UI must fall back rather than render "undefined".
   */
  workspaceName?: string;
  organizationName?: string;
}

/**
 * T8: these accessors are now backed by the in-memory session client, NOT
 * localStorage. The names and signatures are kept because nine page components
 * gate themselves with `if (!getAuthToken()) router.push('/')`; SessionProvider
 * withholds those pages until session restoration finishes, so a memory-only
 * token no longer bounces every reload to the login screen.
 *
 * No token is written to localStorage, sessionStorage, IndexedDB, a URL, or a
 * browser-readable cookie. The refresh token exists only in the T7 httpOnly
 * cookie and is unreachable from this file.
 */
export function getAuthToken(): string | null {
  return sessionClient.getAccessToken();
}

export function getActiveUser(): User | null {
  return sessionClient.getSessionUser() as User | null;
}

/** Ends the session everywhere (backend + cookie + every open tab). */
export async function logoutSession(): Promise<void> {
  await sessionClient.logout();
}

/**
 * Ends every session for this account on every device, not just this browser.
 * Uses the same backend URL as every other call so no second configuration
 * source (and no second localhost literal) enters the bundle.
 */
export async function logoutEverywhere(): Promise<void> {
  await sessionClient.logoutAll(API_URL);
}

/**
 * Kept for source compatibility with the pre-T8 logout control. Clearing local
 * state alone is not a real logout, so both delegate to the full flow.
 */
export function removeAuthToken() {
  void sessionClient.logout();
}

export function removeActiveUser() {
  /* No separate stored user exists any more; logout clears everything. */
}

/**
 * T10: carries the HTTP status alongside the message so a caller can tell
 * "you are not allowed to see this" (403) apart from "the server is down"
 * (5xx/0). Without it the dashboard could only show one generic failure, which
 * is how a permission problem used to look identical to an outage.
 *
 * `message` is unchanged, so the nine pages that read `err.message` and the
 * existing test suites behave exactly as before.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Authentication endpoints must never be intercepted or retried by the 401
 * handler. A prefix rule rather than an enumeration: a 401 from ANY auth route
 * means the credentials themselves were rejected, so refreshing and replaying
 * is meaningless at best and, for refresh itself, recursive at worst. An
 * enumeration silently omitted `register` until a test caught it.
 */
const NON_RETRYABLE_PREFIX = 'api/auth/';

/**
 * Routes under `api/auth/` that are ordinary bearer-authorised READS rather
 * than credential exchanges, and so may be refreshed and replayed like any
 * other resource.
 *
 * The prefix rule above exists because a 401 from a credential route means the
 * credential itself was rejected -- refreshing and replaying is meaningless at
 * best and recursive at worst. `memberships` is not that: it is a plain list of
 * the caller's workspaces that happens to be mounted on the auth controller,
 * and a 401 from it means only that the access token aged out. Excluding it
 * would strand the workspace picker exactly when a user has left a tab open.
 *
 * Note the direction this enumeration fails in. The prefix rule's own comment
 * records that an earlier ENUMERATION OF CREDENTIAL ROUTES omitted `register`
 * -- an omission that made a credential route retryable. This list is the
 * inverse: it enumerates the SAFE routes, so forgetting to add one costs a
 * retry, not a security property.
 */
const RETRYABLE_AUTH_ROUTES = new Set(['api/auth/memberships']);

function isNonRetryable(endpoint: string): boolean {
  if (!endpoint.startsWith(NON_RETRYABLE_PREFIX)) return false;
  // Compare on the path only: a query string must not smuggle a credential
  // route past this check, and must not stop a safe one from matching.
  return !RETRYABLE_AUTH_ROUTES.has(endpoint.split('?')[0]);
}

async function request(
  endpoint: string,
  options: RequestInit = {},
  hasRetried = false,
): Promise<any> {
  const token = getAuthToken();
  const user = getActiveUser();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (user?.workspaceId) {
    headers['x-workspace-id'] = user.workspaceId;
  }

  const response = await fetch(`${API_URL}/${endpoint}`, {
    ...options,
    headers,
  });

  // A 401 means the access token expired. Refresh ONCE through the coordinated
  // single-flight path and replay the original request ONCE. `hasRetried`
  // guarantees termination: a second 401 falls through to the normal error path
  // instead of looping. Auth endpoints are excluded so a refresh can never
  // recursively trigger another refresh.
  if (response.status === 401 && !hasRetried && !isNonRetryable(endpoint)) {
    const refreshed = await sessionClient.refreshSession();
    if (refreshed) {
      return request(endpoint, options, true);
    }
    // Refresh failed: the session client has already cleared state and told the
    // other tabs. Surface the original 401 rather than inventing an error.
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.message || `Request failed: ${response.status}`,
      response.status,
    );
  }

  return response.json();
}

export const api = {
  // Auth
  /**
   * Two-step login, routed entirely through the first-party T7 session routes:
   * credentials and the pre-auth token go to same-origin handlers that talk to
   * the backend server-side, and the refresh token is captured into an httpOnly
   * cookie this code cannot read. Only the access token comes back, and it
   * stays in memory.
   *
   * T9 removed the temporary bridge that silently entered the first workspace.
   * This call now REPORTS what the account looks like and lets the caller act:
   * one workspace is entered automatically, several require a choice, none is
   * stated honestly. It no longer decides on the user's behalf.
   */
  login: async (
    email: string,
    passwordPlain: string,
  ): Promise<sessionClient.LoginOutcome> => {
    return sessionClient.beginLogin(email, passwordPlain);
  },

  register: async (data: {
    email: string;
    passwordPlain: string;
    firstName: string;
    lastName: string;
    workspaceName: string;
    subdomain: string;
  }) => {
    return request('api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getMe: async () => {
    return request('api/auth/me');
  },

  // Dashboard
  getDashboard: async () => {
    return request('dashboard');
  },

  // Contacts
  getContacts: async () => {
    return request('contacts');
  },

  searchContacts: async (query: string) => {
    return request(`contacts/search?q=${encodeURIComponent(query)}`);
  },

  createContact: async (data: any) => {
    return request('contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateContact: async (id: string, data: any) => {
    return request(`contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  getContact: async (id: string) => {
    return request(`contacts/${id}`);
  },

  // Pipelines & Stages
  getPipelines: async () => {
    return request('pipelines');
  },

  createPipeline: async (name: string) => {
    return request('pipelines', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  getPipeline: async (id: string) => {
    return request(`pipelines/${id}`);
  },

  // Opportunities
  getOpportunities: async () => {
    return request('opportunities');
  },

  createOpportunity: async (data: any) => {
    return request('opportunities', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  moveOpportunity: async (id: string, stageId: string) => {
    return request(`opportunities/${id}/move`, {
      method: 'PUT',
      body: JSON.stringify({ stageId }),
    });
  },

  // Agent
  getTools: async () => {
    return request('agent/tools');
  },

  executeTool: async (toolName: string, args: any) => {
    return request('agent/execute', {
      method: 'POST',
      body: JSON.stringify({ toolName, arguments: args }),
    });
  },

  // Marketing: Offers
  getOffers: async () => {
    return request('marketing/offers');
  },

  createOffer: async (data: any) => {
    return request('marketing/offers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateOffer: async (id: string, data: any) => {
    return request(`marketing/offers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  setOfferLifecycle: async (id: string, state: 'DRAFT' | 'ACTIVE' | 'RETIRED') => {
    return request(`marketing/offers/${id}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
  },

  // Marketing: Leads
  getLeads: async () => {
    return request('marketing/leads');
  },

  createLead: async (data: any) => {
    return request('marketing/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  convertLead: async (contactId: string, data: any, idempotencyKey: string) => {
    return request(`marketing/leads/${contactId}/convert`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  getClientDetail: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}`);
  },

  getMarketingBrief: async (briefId: string) => {
    return request(`dom26r/relationship-briefs/${briefId}?view=INTERNAL_HUMAN`);
  },

  // Marketing: Onboarding
  getOnboardingPlan: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/onboarding`);
  },

  updateChecklistItem: async (
    clientAccountId: string,
    itemId: string,
    data: {
      status?: string;
      evidence?: string;
      clientSubmission?: Record<string, unknown>;
      blockerReason?: string;
    },
  ) => {
    return request(
      `marketing/clients/${clientAccountId}/onboarding/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  },

  generateOnboardingPlan: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/onboarding/generate`, {
      method: 'POST',
    });
  },

  activateClient: async (
    clientAccountId: string,
    data: { override?: { reason: string } } = {},
  ) => {
    return request(`marketing/clients/${clientAccountId}/onboarding/activate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Marketing: Service Delivery
  getDeliverables: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/deliverables`);
  },

  updateDeliverable: async (
    clientAccountId: string,
    deliverableId: string,
    data: {
      status?: string;
      evidence?: string;
      blockerReason?: string;
      clientApprovedAt?: string;
    },
  ) => {
    return request(
      `marketing/clients/${clientAccountId}/deliverables/${deliverableId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  },

  createOutsideScopeDeliverable: async (
    clientAccountId: string,
    data: { name: string; description?: string; cadence: string; cadenceDetail?: string },
  ) => {
    return request(`marketing/clients/${clientAccountId}/deliverables`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Marketing: Dashboard
  getMarketingDashboard: async () => {
    return request('marketing/dashboard');
  },

  // Marketing: Client Health
  getClientHealth: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/health`);
  },

  recalculateClientHealth: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/health/recalculate`, {
      method: 'POST',
    });
  },

  overrideClientHealth: async (
    clientAccountId: string,
    data: { state: string; reason: string },
  ) => {
    return request(`marketing/clients/${clientAccountId}/health/override`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  clearClientHealthOverride: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/health/override`, {
      method: 'DELETE',
    });
  },

  // Marketing: Reporting
  getInternalReport: async () => {
    return request('marketing/reports/internal');
  },

  getClientReport: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/report`);
  },

  recordCommercialStateChange: async (
    clientAccountId: string,
    data: { field: 'CONTRACT' | 'PAYMENT'; newValue: string; amount?: number },
  ) => {
    return request(`marketing/clients/${clientAccountId}/commercial-state`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Marketing: Billing (Stripe Checkout)
  getBillingCheckout: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/billing/checkout`);
  },

  regenerateBillingCheckout: async (clientAccountId: string) => {
    return request(`marketing/clients/${clientAccountId}/billing/checkout/regenerate`, {
      method: 'POST',
    });
  },
};
