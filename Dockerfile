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

# Install system deps. Ollama used to be installed here and run alongside
# Node in this same container — moved to its own Railway service
# (ollama-service/) so a crash or memory spike in the LLM runtime can't take
# the whole container (and every in-flight HTTP request on it) down with it.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates zstd && \
    rm -rf /var/lib/apt/lists/*

# Install backend dependencies (production only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy built frontend into backend/public so Express can serve it
COPY --from=frontend-builder /build/frontend/dist ./public

# Create uploads directory and make start script executable
RUN mkdir -p /app/uploads && chmod +x /app/start.sh

# Expose port (Railway injects $PORT automatically)
EXPOSE 3001

ENV NODE_ENV=production

CMD ["/app/start.sh"]
