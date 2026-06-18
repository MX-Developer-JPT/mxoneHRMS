import { Router } from 'express';
import { callAI, callAIMessages, checkOllama } from '../utils/ai.js';

const router = Router();

// GET /api/ai/status — check if Ollama is running and model is available
router.get('/status', async (_req, res) => {
  const status = await checkOllama();
  res.json(status);
});

// POST /api/ai/llm — used by base44.integrations.Core.InvokeLLM shim
router.post('/llm', async (req, res) => {
  const { prompt, system } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const content = await callAI(prompt, { system });
    res.json({ content });
  } catch (err) {
    console.error('[ai/llm]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
