#!/bin/sh
set -e

# ── Ensure data directory exists ─────────────────────────────────
mkdir -p /app/data /app/uploads

# ── Restore DB from Cloudinary backup if local file is missing ───
# This runs BEFORE Node imports db.js so the file is ready at startup.
if [ -n "$CLOUDINARY_URL" ] || [ -n "$CLOUDINARY_CLOUD_NAME" ]; then
  echo "[start] Checking for DB backup in Cloudinary..."
  node /app/restore-db.js || echo "[start] Restore script exited non-zero — continuing"
else
  echo "[start] CLOUDINARY_URL not set — skipping DB restore (set it to enable automatic backup)"
fi

# ── Start Ollama in background if installed ───────────────────────
if command -v ollama > /dev/null 2>&1; then
  echo "[start] Starting Ollama server..."
  ollama serve > /tmp/ollama.log 2>&1 &
  echo "[start] Ollama started (PID $!)"
else
  echo "[start] Ollama not found — AI will use Groq if configured"
fi

# ── Hand off to Node.js ───────────────────────────────────────────
echo "[start] Starting Node.js server..."
exec node server.js
