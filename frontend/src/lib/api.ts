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
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  workspaceId: string;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('demm_crm_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('demm_crm_token', token);
}

export function removeAuthToken() {
  localStorage.removeItem('demm_crm_token');
}

export function getActiveUser(): User | null {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('demm_crm_user');
  return user ? JSON.parse(user) : null;
}

export function setActiveUser(user: User) {
  localStorage.setItem('demm_crm_user', JSON.stringify(user));
}

export function removeActiveUser() {
  localStorage.removeItem('demm_crm_user');
}

async function request(endpoint: string, options: RequestInit = {}) {
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

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Request failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: async (email: string, passwordPlain: string) => {
    // Login is two steps: verify credentials (returns a short-lived
    // preAuthToken + the accessible workspace list, but no real access
    // token yet), then select a workspace (requires the preAuthToken,
    // returns the actual access/refresh tokens). This matches the backend
    // contract in auth.service.ts -- login() never issues a usable token
    // by itself.
    const loginRes = await request('api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, passwordPlain }),
    });

    if (!loginRes.workspaces || loginRes.workspaces.length === 0) {
      throw new Error('No accessible workspace for this account.');
    }
    // TODO: surface a workspace picker for multi-workspace accounts.
    // Defaulting to the first entry for now, matching the current
    // single-workspace-per-account signup flow (see register()).
    const workspaceId = loginRes.workspaces[0].workspaceId;

    const res = await request('api/auth/select-workspace', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginRes.preAuthToken}` },
      body: JSON.stringify({ workspaceId }),
    });
    setAuthToken(res.access_token);
    setActiveUser(res.user);
    return res;
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
};
