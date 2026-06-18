import { useEffect, useState } from 'react';
import { Bot, AlertTriangle, CheckCircle, X } from 'lucide-react';

export default function AiStatusBanner() {
  const [status, setStatus]   = useState(null); // null = checking
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ running: false }));
  }, []);

  if (!status || dismissed) return null;
  if (status.running && status.modelReady) return null; // all good, no banner needed

  const isNotRunning = !status.running;
  const modelMissing = status.running && !status.modelReady;
  const model = status.model || 'llama3.2';

  return (
    <div className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl shadow-lg border p-4 ${isNotRunning ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${isNotRunning ? 'text-orange-500' : 'text-yellow-500'}`}>
          {isNotRunning ? <AlertTriangle className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </div>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-gray-800 mb-1">
            {isNotRunning ? 'AI features offline' : 'AI model not downloaded'}
          </p>
          {isNotRunning && (
            <p className="text-gray-600 text-xs">
              Ollama is not running. Start it by opening the Ollama app or running{' '}
              <code className="bg-orange-100 px-1 rounded font-mono">ollama serve</code> in a terminal.
            </p>
          )}
          {modelMissing && (
            <p className="text-gray-600 text-xs">
              Run this command once in your terminal:{' '}
              <code className="bg-yellow-100 px-1.5 py-0.5 rounded font-mono text-xs">ollama pull {model}</code>
            </p>
          )}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 text-xs underline mt-1 inline-block"
          >
            Download Ollama (free) →
          </a>
        </div>
        <button onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
