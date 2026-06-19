#!/bin/sh
set -e

# Start Ollama in background if installed
if command -v ollama > /dev/null 2>&1; then
  echo "[start] Starting Ollama server..."
  ollama serve > /tmp/ollama.log 2>&1 &
  echo "[start] Ollama started (PID $!)"
else
  echo "[start] Ollama not found — AI will use Groq if configured"
fi

# Hand off to Node.js (exec replaces shell process so signals work)
echo "[start] Starting Node.js server..."
exec node server.js
