# ── Stage 1: Build React frontend ──────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend
COPY maxvolt-hr/package*.json ./
RUN npm ci --legacy-peer-deps

COPY maxvolt-hr/ ./
RUN npm run build
# Output: /build/frontend/dist


# ── Stage 2: Production server ──────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# Install system deps + Ollama
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://ollama.ai/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

# Install backend dependencies (production only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy built frontend into backend/public so Express can serve it
COPY --from=frontend-builder /build/frontend/dist ./public

# Create persistent data directories (Railway volumes mount here)
RUN mkdir -p /app/data uploads

# Expose port (Railway injects $PORT automatically)
EXPOSE 3001

ENV NODE_ENV=production

# Start Ollama in background then start the app
CMD ["/bin/sh", "-c", "ollama serve &>/dev/null & node server.js"]
