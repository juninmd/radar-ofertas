FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
# Install system dependencies for Playwright
RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    libx11 \
    libxext \
    libxrender \
    libxrandr \
    libxinerama \
    libxi \
    libxcursor \
    libxdamage \
    libxfixes \
    libxtst \
    libxss

COPY package.json ./
RUN bun install --production

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
# Install runtime dependencies for Playwright
RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    libx11 \
    libxext \
    libxrender \
    libxrandr \
    libxinerama \
    libxi \
    libxcursor \
    libxdamage \
    libxfixes \
    libxtst \
    libxss \
    libgconf-2-4

ENV NODE_ENV=production \
    RUN_MODE=SERVER \
    PORT=3005 \
    DB_PATH=/data/radar.sqlite \
    PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY package.json tsconfig.json ./

RUN mkdir -p /data .cache && addgroup -S app && adduser -S app -G app && chown -R app:app /app /data .cache
USER app

# Pre-install chromium for Playwright
RUN bunx playwright install chromium || true

EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["bun", "run", "src/index.ts"]
