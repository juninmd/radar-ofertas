// Configuração central. Tudo via env (12-factor). Sem segredos hardcoded.

const env = (k: string, d = "") => process.env[k] ?? d;
const num = (k: string, d: number) => {
  const v = process.env[k];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const bool = (k: string, d = false) => {
  const v = process.env[k];
  return v == null ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const config = {
  runMode: env("RUN_MODE", "SERVER").toUpperCase(), // SERVER | CRAWL
  port: num("PORT", 3005),
  dbPath: env("DB_PATH", "./data/radar.sqlite"),
  logLevel: env("LOG_LEVEL", "info"),

  // termos pesquisados nos e-commerces
  queries: env(
    "CRAWL_QUERIES",
    "whey protein,ssd nvme,monitor gamer,cadeira gamer,echo dot,creatina",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxPerQuery: num("MAX_PER_QUERY", 8),
  // NOTE: ML e Amazon têm anti-bot agressivo. Browser automation é instável em containers.
  // Usando apenas Magalu que tem API pública confiável com imagens reais.
  sources: env("CRAWL_SOURCES", "mercadolivre,amazon,magalu")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // detecção de oferta
  minHistoryPoints: num("MIN_HISTORY_POINTS", 3),
  zThreshold: num("Z_THRESHOLD", 1.2), // preço < média - z*desvio
  minDiscountPct: num("MIN_DISCOUNT_PCT", 12), // ou desconto >= % sobre a média
  notifyScore: num("NOTIFY_SCORE", 0.5), // score combinado mínimo p/ notificar

  // demo fallback DISABLED for user requirement: 100% real images
  // If Magalu returns no products, it's a real issue (rate limit, network, etc)
  allowDemoFallback: bool("ALLOW_DEMO_FALLBACK", false),

  telegram: {
    enabled: bool("TELEGRAM_ENABLED", true),
    botToken: env("TELEGRAM_BOT_TOKEN"),
    chatId: env("TELEGRAM_CHAT_ID"),
  },

  litellm: {
    enabled: bool("LITELLM_ENABLED", true),
    base: env("LITELLM_API_BASE", "http://litellm.ai.svc.cluster.local:4000/v1"),
    apiKey: env("LITELLM_API_KEY"),
    model: env("LITELLM_MODEL", "cloud/llama-8b"),
    timeoutMs: num("LITELLM_TIMEOUT_MS", 45000),
  },
} as const;

export type Source = string;
