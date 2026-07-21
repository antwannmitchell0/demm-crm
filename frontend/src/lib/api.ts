const API_URL = 'http://localhost:3001/api';

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
    const res = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, passwordPlain }),
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
    return request('auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getMe: async () => {
    return request('auth/me');
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
};
