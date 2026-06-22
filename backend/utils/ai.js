// AI provider: Groq (free cloud) when GROQ_API_KEY env var is set, Ollama (local) otherwise.
// Set GROQ_API_KEY in Railway environment variables.

const GROQ_KEY     = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.1-8b-instant';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL  || 'tinyllama';

const useGroq = () => !!GROQ_KEY;

// ── Groq ────────────────────────────────────────────────────

async function callGroq(messages, { json = false } = {}) {
  const apiKey = GROQ_KEY;
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
    // Key is set — report as configured without making a test call (avoids latency + token waste)
    return { ok: true, provider: 'groq', model: GROQ_MODEL, running: true, modelReady: true };
  }

  // Ollama — check if running and model is present
  try {
    const res  = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, running: false, modelReady: false, provider: 'ollama', model: OLLAMA_MODEL };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const modelReady = models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]));
    return { ok: modelReady, running: true, modelReady, provider: 'ollama', model: OLLAMA_MODEL, models };
  } catch {
    return { ok: false, running: false, modelReady: false, provider: 'ollama', model: OLLAMA_MODEL };
  }
}

// legacy alias used by old code
export async function checkOllama() { return checkAI(); }
export const callClaude = callAI;
export const isAiConfigured = () => true;
