FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
# Install system dependencies for Playwright and Chromium
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
    libgconf-2-4 \
    chromium

COPY package.json ./
RUN bun install --production

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
# Install runtime dependencies including system Chromium
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
    libgconf-2-4 \
    chromium

ENV NODE_ENV=production \
    RUN_MODE=SERVER \
    PORT=3005 \
    DB_PATH=/data/radar.sqlite
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY package.json tsconfig.json ./

RUN mkdir -p /data && addgroup -S app && adduser -S app -G app && chown -R app:app /app /data
USER app

EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["bun", "run", "src/index.ts"]
