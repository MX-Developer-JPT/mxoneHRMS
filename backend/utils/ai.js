// Local AI via Ollama — no API keys, completely free
// Install: https://ollama.com  then run: ollama pull llama3.2

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const modelReady = models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]));
    return { running: true, models, modelReady, model: OLLAMA_MODEL };
  } catch {
    return { running: false, models: [], modelReady: false };
  }
}

export async function callAI(prompt, { system = '', json = false } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return callAIMessages(messages, { json });
}

export async function callAIMessages(messages, { json = false } = {}) {
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
      signal: AbortSignal.timeout(120000), // 2-min timeout for slower hardware
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('AI response timed out. The model may be loading — try again in a moment.');
    throw new Error(`Cannot reach Ollama at ${OLLAMA_URL}. Is it running? Run: ollama serve`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 404) throw new Error(`Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`);
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = (data.message?.content ?? '').trim();

  if (json) {
    // Try to extract JSON even if model adds extra text
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    // Find first { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    try { return JSON.parse(match ? match[0] : cleaned); }
    catch { return null; }
  }
  return text;
}

// Keep backward-compat alias
export const callClaude = callAI;
export const isAiConfigured = () => true; // always "configured" — just needs Ollama running
