import { useEffect, useState } from 'react';
import { Bot, AlertTriangle, X, Zap } from 'lucide-react';

export default function AiStatusBanner() {
  const [status, setStatus]       = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ok: false, running: false, provider: 'ollama' }));
  }, []);

  // Don't show until checked, or if dismissed, or if AI is fully working
  if (!status || dismissed || status.ok) return null;

  const isGroq        = status.provider === 'groq';
  const ollamaDown    = !status.running;
  const modelMissing  = status.running && !status.modelReady;

  // If Groq is configured but reported not-ok, show a different message
  if (isGroq) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl shadow-lg border bg-amber-50 border-amber-200 p-4">
        <div className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-gray-800 mb-1">Groq API key issue</p>
            <p className="text-gray-600 text-xs">
              {status.error || 'Check your Groq API key in Admin Panel → AI Settings.'}
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Ollama cases
  return (
    <div className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl shadow-lg border p-4 ${ollamaDown ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${ollamaDown ? 'text-orange-500' : 'text-yellow-500'}`}>
          {ollamaDown ? <AlertTriangle className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </div>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-gray-800 mb-1">
            {ollamaDown ? 'AI warming up…' : 'AI model downloading…'}
          </p>
          {ollamaDown && (
            <p className="text-gray-600 text-xs">
              Ollama is starting — this takes a few minutes on the first deploy.
              Or add a free <strong>Groq API key</strong> in <a href="/AdminPanel" className="underline">Admin Panel → AI Settings</a> for instant AI.
            </p>
          )}
          {modelMissing && (
            <p className="text-gray-600 text-xs">
              Downloading <code className="bg-yellow-100 px-1 rounded font-mono">{status.model}</code> in background — usually takes 5–10 min on first run.
            </p>
          )}
        </div>
        <button onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
