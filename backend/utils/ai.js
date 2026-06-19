// AI provider: Groq (free cloud) when GROQ_API_KEY is set, Ollama (local) otherwise.
// Get a free Groq key at https://console.groq.com — no credit card needed.
// Admin can also set GROQ_API_KEY via Admin Panel → AI Settings (stored in DB).

import db from '../db.js';

const GROQ_MODEL   = process.env.GROQ_MODEL  || 'llama3-8b-8192';
const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';

// Read key at request time so DB-saved key is picked up without restart
function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='GROQ_API_KEY'").get();
    return row?.value || '';
  } catch { return ''; }
}

const useGroq = () => !!getGroqKey();

// ── Groq ────────────────────────────────────────────────────

async function callGroq(messages, { json = false } = {}) {
  const apiKey = getGroqKey();
  const body = {
    model: GROQ_MODEL,
    messages,
    temperature: json ? 0.1 : 0.7,
    max_tokens: 2048,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('Groq request timed out.');
    throw new Error(`Cannot reach Groq API: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401) throw new Error('Invalid GROQ_API_KEY. Check your key at console.groq.com.');
    if (res.status === 429) throw new Error('Groq rate limit reached. Try again in a moment.');
    throw new Error(`Groq error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim();

  if (json) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    try { return JSON.parse(match ? match[0] : cleaned); } catch { return null; }
  }
  return text;
}

// ── Ollama ──────────────────────────────────────────────────

async function callOllama(messages, { json = false } = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: { temperature: json ? 0.1 : 0.7, num_predict: 2048 },
        ...(json ? { format: 'json' } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('AI response timed out. The model may be loading — try again.');
    throw new Error(`Cannot reach Ollama at ${OLLAMA_URL}. Run: ollama serve`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 404) throw new Error(`Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`);
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = (data.message?.content ?? '').trim();

  if (json) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    try { return JSON.parse(match ? match[0] : cleaned); } catch { return null; }
  }
  return text;
}

// ── Public API ──────────────────────────────────────────────

export async function callAIMessages(messages, opts = {}) {
  return useGroq() ? callGroq(messages, opts) : callOllama(messages, opts);
}

export async function callAI(prompt, { system = '', json = false } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return callAIMessages(messages, { json });
}

export async function checkAI() {
  if (useGroq()) {
    // Quick test call to verify the key is valid
    try {
      await callGroq([{ role: 'user', content: 'Reply with exactly: ok' }]);
      return { ok: true, provider: 'groq', model: GROQ_MODEL };
    } catch (e) {
      return { ok: false, provider: 'groq', model: GROQ_MODEL, error: e.message };
    }
  }

  // Ollama
  try {
    const res  = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, provider: 'ollama', model: OLLAMA_MODEL, error: 'Ollama not running' };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const modelReady = models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]));
    if (!modelReady) return { ok: false, provider: 'ollama', model: OLLAMA_MODEL, error: `Model "${OLLAMA_MODEL}" not yet downloaded`, models };
    return { ok: true, provider: 'ollama', model: OLLAMA_MODEL, models };
  } catch (e) {
    return { ok: false, provider: 'ollama', model: OLLAMA_MODEL, error: e.message };
  }
}

// legacy alias used by old code
export async function checkOllama() { return checkAI(); }
export const callClaude = callAI;
export const isAiConfigured = () => true;
