FROM oven/bun:1.3-debian AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --production

FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# Install Playwright system dependencies for Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libgconf-2-4 \
    libgbm1 \
    libxss1 \
    libappindicator1 \
    libindicator7 \
    libappindicator3-1 \
    libxkbcommon0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libdbus-1-3 \
    fontconfig \
    fonts-dejavu \
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
    useradd -m -u 1000 app && \
    chown -R app:app /app /data

USER app

# Pre-download Playwright browsers
RUN bunx playwright install chromium

EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["bun", "run", "src/index.ts"]
