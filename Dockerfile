# Jarvis Telegram Service - Production Dockerfile
#
# Build:
#   docker build -t jarvis .
#
# Run:
#   docker run -d --name jarvis \
#     -v $(pwd)/data:/app/data \
#     -v $(pwd)/logs:/app/logs \
#     --env-file .env \
#     jarvis

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, sqlite-vec)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim AS production

WORKDIR /app

# Install runtime dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy drizzle migrations
COPY --from=builder /app/src/db/migrations ./dist/db/migrations

# Create directories for data and logs
RUN mkdir -p data logs data/media/photos data/media/documents data/media/voice data/media/video data/media/audio

# Set environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('fs').existsSync('/app/data/jarvis.db') || process.exit(1)"

# Run as non-root user for security
RUN groupadd -r jarvis && useradd -r -g jarvis jarvis
RUN chown -R jarvis:jarvis /app
USER jarvis

# Start the application
CMD ["node", "dist/index.js"]
