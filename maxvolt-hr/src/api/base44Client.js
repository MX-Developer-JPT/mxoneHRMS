// Drop-in shim replacing @base44/sdk — calls the self-hosted Express backend

const TOKEN_KEY = 'base44_access_token';
const API_BASE  = '/api';

const getToken  = () => localStorage.getItem(TOKEN_KEY);
const setToken  = (t) => { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); };

// Phone cameras routinely produce 5-10MB photos — uploading those raw over a
// spotty factory-floor wifi or mobile data connection is the single biggest
// reason uploads feel "stuck" or fail outright, since payload size directly
// drives upload time on a slow link. Resizes to a sane max dimension and
// re-encodes as JPEG client-side before the file ever leaves the device,
// typically cutting a multi-MB camera photo down to a few hundred KB with no
// visible quality loss for a profile photo or a scanned document. Skipped
// entirely (falls back to the original file untouched) for non-images, GIFs
// (re-encoding would destroy animation), files already small enough that
// compressing isn't worth the CPU cost, or any failure along the way —
// never let a compression hiccup block the upload itself.
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_COMPRESS_QUALITY = 0.82;
const SKIP_COMPRESSION_UNDER_BYTES = 400 * 1024;

async function compressImageIfNeeded(file) {
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= SKIP_COMPRESSION_UNDER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', IMAGE_COMPRESS_QUALITY));
    if (!blob || blob.size >= file.size) return file; // compression didn't actually help — use the original
    const newName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

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

  // ResetPassword.jsx calls this with { resetToken, newPassword } (the URL's
  // ?token= query param, read as "resetToken" locally) — but the backend
  // route reads req.body.token, not req.body.resetToken. Sending the raw
  // object straight through silently dropped the token every time, so
  // POST /auth/reset-password always failed with "Token ... required"
  // regardless of how valid the link was. Normalize the key names here so
  // either naming works.
  resetPassword: ({ resetToken, token, newPassword, new_password } = {}) =>
    apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: token || resetToken, newPassword: newPassword || new_password }),
    }),

  verifyOtp: (data) =>
    apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify(data) }),

  resendOtp: (data) =>
    apiFetch('/auth/resend-otp', { method: 'POST', body: JSON.stringify(data) }),

  // Self-service password change from App Settings — two paths:
  // (1) current_password + new_password (changePassword), or
  // (2) requestPasswordChangeOtp() then verifyPasswordChangeOtp() for
  //     someone who doesn't remember their current password.
  changePassword: ({ current_password, new_password }) =>
    apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),

  requestPasswordChangeOtp: () =>
    apiFetch('/auth/request-password-change-otp', { method: 'POST' }),

  verifyPasswordChangeOtp: ({ otp_code, new_password }) =>
    apiFetch('/auth/verify-password-change-otp', { method: 'POST', body: JSON.stringify({ otp_code, new_password }) }),

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
// Special case: User is stored in the users table, not entities — route to getAllUsers
const userClient = {
  list: async () => {
    const r = await functions.invoke('getAllUsers', {});
    return r.data?.users || [];
  },
  filter: async (query = {}) => {
    const r = await functions.invoke('getAllUsers', {});
    const users = r.data?.users || [];
    if (!Object.keys(query).length) return users;
    return users.filter(u => Object.entries(query).every(([k, v]) => u[k] === v));
  },
  get: async (id) => {
    const r = await functions.invoke('getAllUsers', {});
    return (r.data?.users || []).find(u => u.id === id) || null;
  },
};

const entities = new Proxy({}, {
  get(_target, type) {
    if (String(type) === 'User') return userClient;
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
      const uploadFile = await compressImageIfNeeded(file);
      const fd = new FormData();
      fd.append('file', uploadFile);

      const attempt = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // generous — mobile uploads can be slow, not stalled
        try {
          const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
            signal: controller.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Upload failed (${res.status})`);
          }
          return res.json(); // { file_url, filename, size }
        } finally {
          clearTimeout(timeoutId);
        }
      };

      try {
        return await attempt();
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Upload timed out — check your connection and try again.');
        // One retry — covers the single most common failure mode on
        // employee mobile networks (a transient drop mid-upload), instead
        // of surfacing "upload failed" for a blip that a plain reattempt
        // would have sailed through.
        try { return await attempt(); }
        catch (e2) {
          if (e2.name === 'AbortError') throw new Error('Upload timed out — check your connection and try again.');
          throw e2;
        }
      }
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
