#!/bin/sh
set -e

# Ensure uploads directory exists
mkdir -p /app/uploads

# Ollama now runs as its own Railway service (see ollama-service/) reached
# via the OLLAMA_URL env var — it no longer starts in this container, so a
# crash or memory spike in it can't take this API server down too.

# ── Hand off to Node.js ───────────────────────────────────────────
echo "[start] Starting Node.js server..."
exec node server.js
