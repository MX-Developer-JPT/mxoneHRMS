// Drop-in shim replacing @base44/sdk — calls the self-hosted Express backend

const TOKEN_KEY = 'base44_access_token';
const API_BASE  = '/api';

const getToken  = () => localStorage.getItem(TOKEN_KEY);
const setToken  = (t) => { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); };

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || err.message || res.statusText);
    e.status = res.status;
    e.data   = err;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

// ── Auth ────────────────────────────────────────────────────────────────────

const auth = {
  me: () => apiFetch('/auth/me'),

  loginViaEmailPassword: async (emailOrObj, passwordArg) => {
    // Accept either (email, password) positional args or a single { email, password } object
    const email    = typeof emailOrObj === 'object' ? emailOrObj.email    : emailOrObj;
    const password = typeof emailOrObj === 'object' ? emailOrObj.password : passwordArg;
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    return res.user;
  },

  loginWithProvider: async (provider) => {
    // OAuth not supported in self-hosted mode
    throw new Error(`Social login (${provider}) is not available in standalone mode.`);
  },

  register: async (data) => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Token is NOT set here — user must verify OTP first (verifyOtp returns access_token)
    return res;
  },

  logout: (_redirectUrl) => {
    setToken(null);
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  },

  redirectToLogin: (_redirectUrl) => {
    window.location.href = '/login';
  },

  resetPasswordRequest: (email) =>
    apiFetch('/auth/reset-password-request', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (data) =>
    apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),

  verifyOtp: (data) =>
    apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify(data) }),

  resendOtp: (data) =>
    apiFetch('/auth/resend-otp', { method: 'POST', body: JSON.stringify(data) }),

  setToken,

  updateMe: (data) =>
    apiFetch('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── Entities ────────────────────────────────────────────────────────────────

function makeEntityClient(type) {
  return {
    list: (sort, limit) => {
      const params = new URLSearchParams();
      if (sort)  params.set('sort', sort);
      if (limit) params.set('limit', limit);
      return apiFetch(`/entities/${type}?${params}`);
    },

    filter: (query = {}, sort, limit) =>
      apiFetch(`/entities/${type}/filter`, {
        method: 'POST',
        body: JSON.stringify({ query, sort, limit }),
      }),

    get: (id) => apiFetch(`/entities/${type}/${id}`),

    create: (data) =>
      apiFetch(`/entities/${type}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id, data) =>
      apiFetch(`/entities/${type}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id) =>
      apiFetch(`/entities/${type}/${id}`, { method: 'DELETE' }),
  };
}

// Proxy: base44.entities.AnyEntityName returns an entity client automatically
const entities = new Proxy({}, {
  get(_target, type) {
    return makeEntityClient(String(type));
  },
});

// ── Custom Functions ────────────────────────────────────────────────────────
// base44 SDK wraps function results in { data: ... } — replicate that behaviour

const functions = {
  invoke: async (name, params = {}) => {
    const result = await apiFetch(`/functions/${name}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { data: result };
  },
};

// ── File Upload & LLM ───────────────────────────────────────────────────────

const integrations = {
  Core: {
    // Used by JobRequisitions.jsx to generate JD via AI
    InvokeLLM: async ({ prompt, system }) => {
      const result = await apiFetch('/ai/llm', {
        method: 'POST',
        body: JSON.stringify({ prompt, system }),
      });
      return result; // { content: '...' }  — caller does result?.content
    },

    UploadFile: async ({ file }) => {
      const token = getToken();
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });

      if (!res.ok) throw new Error('File upload failed');
      return res.json(); // { file_url, filename, size }
    },

    SendEmail: async ({ to, subject, body, html }) => {
      return apiFetch('/functions/sendCustomEmail', {
        method: 'POST',
        body: JSON.stringify({ to, subject, body, html }),
      });
    },

    ExtractDataFromUploadedFile: async ({ file_url, json_schema }) => {
      // Parse CSV file and map columns to the schema's output item properties
      const res = await apiFetch(`/functions/extractFileData`, {
        method: 'POST',
        body: JSON.stringify({ file_url, json_schema }),
      });
      return res; // { output: [...] }
    },
  },
};

export const base44 = { auth, entities, functions, integrations };
export default base44;
