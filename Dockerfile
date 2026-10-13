# Character Studio job worker, for Railway. One small Node process: it
# submits and polls generation jobs, downloads results, strips audio, and runs
# QA, seam joins and imported-sheet checks. It sleeps when nothing is queued
# and the API wakes it over HTTP (POST /wake), so it costs little when idle.

# Build: bundle the worker and fetch the face models.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY server ./server
COPY scripts ./scripts
RUN npm run build:worker && STUDIO_MODELS_DIR=/app/models node scripts/fetch-models.mjs

# Run: production dependencies, ffmpeg, the bundle, config and migrations.
FROM node:22-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    STUDIO_WORKER_IDLE=wake \
    STUDIO_MODELS_DIR=/app/models
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=build /app/models ./models
COPY config ./config
COPY server/db/migrations ./server/db/migrations
USER node
CMD ["node", "--enable-source-maps", "--max-old-space-size=384", "dist-worker/worker.mjs"]
