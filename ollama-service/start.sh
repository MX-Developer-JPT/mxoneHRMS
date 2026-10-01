#!/bin/sh
set -e

# Start Ollama's server in the background, then pull the configured model
# (persisted on the attached volume at /root/.ollama so this only costs
# bandwidth once, not on every restart) before handing off.
ollama serve &
SERVE_PID=$!

MODEL="${OLLAMA_MODEL:-tinyllama}"
echo "[ollama-service] Waiting for Ollama to accept connections…"
for i in $(seq 1 30); do
  if ollama list > /dev/null 2>&1; then break; fi
  sleep 1
done

if ! ollama list 2>/dev/null | grep -q "^${MODEL%%:*}"; then
  echo "[ollama-service] Pulling model ${MODEL}…"
  ollama pull "${MODEL}" || echo "[ollama-service] Pull failed — will retry on next request/restart"
else
  echo "[ollama-service] Model ${MODEL} already present"
fi

# PID 1 waits on the actual server process so a server crash is reflected
# as a real container exit (and restarted by Railway), instead of this
# wrapper script staying "up" with a dead server underneath it.
wait $SERVE_PID
