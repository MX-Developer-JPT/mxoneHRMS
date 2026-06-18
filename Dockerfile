# ── Stage 1: Build React frontend ──────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend
COPY maxvolt-hr/package*.json ./
RUN npm ci --legacy-peer-deps

COPY maxvolt-hr/ ./
RUN npm run build
# Output: /build/frontend/dist


# ── Stage 2: Production server ──────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install backend dependencies (production only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy built frontend into backend/public so Express can serve it
COPY --from=frontend-builder /build/frontend/dist ./public

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Railway injects $PORT automatically)
EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "server.js"]
