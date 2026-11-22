# AGENTS.md

Radar de Ofertas: e-commerce crawler (Mercado Livre, Amazon, Magazine Luiza) that keeps price history, detects real discounts against the historical average, notifies on Telegram and learns from user feedback. Optional AI analysis through LiteLLM.

## Stack

- Bun 1.3, TypeScript, `bun:sqlite`, `Bun.serve`, `Bun.SQL` (Postgres), `bun test`
- Dependencies: cheerio (parsing), puppeteer (anti-bot browser fallback)
- Docker: `oven/bun:1.3-debian`, exposes port 3005 (`Dockerfile`)

## Commands

```bash
bun install
bun run dev        # watch mode, runs src/index.ts
bun run start      # run once as a server
bun run crawl      # RUN_MODE=CRAWL: crawl cycle only
bun test           # all tests in test/
```

## Structure

- `src/index.ts` - entry point; `RUN_MODE` picks server or crawl
- `src/server.ts` - `Bun.serve` HTTP API (admin routes use `adminAuth.ts`)
- `src/pipeline.ts`, `src/deal.ts`, `src/market.ts`, `src/season.ts` - crawl cycle and deal detection
- `src/crawlers/` - one module per source (7 files)
- `src/db.ts`, `src/clusterDb.ts`, `src/repositories.ts`, `src/schema.ts` - SQLite and Postgres access
- `src/ai.ts` - LiteLLM verdicts; `src/telegram.ts` - notifications and callbacks; `src/recommend.ts` - feedback-based ranking
- `src/config.ts` - all runtime settings, read from env vars
- `test/` - Bun test suites, one per feature; `bunfig.toml` - test config

## Conventions

- Tests use `bun test`. Keep new behavior covered in `test/`.
- Most settings are read in `src/config.ts`, but `adminAuth.ts`, `ai.ts`, `clusterDb.ts` and `server.ts` also read `process.env`. Check both places before adding a setting.
- Crawlers are one module per source; a new source is a new file in `src/crawlers/`.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.

## Gotchas

- Env vars (names only, see `.env.example`): `RUN_MODE`, `PORT`, `DB_PATH`, `LOG_LEVEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LITELLM_API_KEY`, `ADMIN_TOKEN`, `CLUSTER_DATABASE_URL`, plus crawl and notification tuning. Never commit values; `.env*` is ignored except `.env.example`.
- Telegram sends are throttled by `TELEGRAM_MIN_INTERVAL_MS`; keep that limit when changing notification flow.
- `data/`, `*.sqlite` and `*.log` are local state and ignored by git.
- CI: `validate.yml`, `security.yml`, `sast.yml` and `docker.yml` call reusable workflows from `juninmd/base-actions`. Docker builds on push to `main`.
