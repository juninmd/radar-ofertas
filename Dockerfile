FROM oven/bun:1.3-debian AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --production

FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# Minimal system dependencies (no Playwright needed - using Magalu JSON API only)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    RUN_MODE=SERVER \
    PORT=3005 \
    DB_PATH=/data/radar.sqlite

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY package.json tsconfig.json ./

RUN mkdir -p /data && \
    id app >/dev/null 2>&1 || useradd -m -u 1000 app || useradd -m app && \
    chown -R app:app /app /data 2>/dev/null || true

USER app

EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["bun", "run", "src/index.ts"]
