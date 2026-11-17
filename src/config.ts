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
  // Resolvido a cada leitura: cada teste escolhe seu DB_PATH em runtime e não
  // pode herdar o valor de outro arquivo de teste (importado antes).
  get dbPath() {
    return env("DB_PATH", "./data/radar.sqlite");
  },
  logLevel: env("LOG_LEVEL", "info"),

  // termos pesquisados nos e-commerces
  queries: env(
    "CRAWL_QUERIES",
    "whey protein,creatina,smart tv 4k,geladeira frost free,lavadora de roupas,ps5 console,jogos ps5,nintendo switch,tenis corrida,camisa polo,air fryer,parafusadeira,ssd nvme,monitor gamer,aspirador robo",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxPerQuery: num("MAX_PER_QUERY", 8),
  // teto por chamada de crawler: fonte lenta/travada (browser pendurado) não
  // pode segurar o ciclo inteiro e estourar o deadline do CronJob.
  crawlTimeoutMs: num("CRAWL_TIMEOUT_MS", 40000),
  sources: env("CRAWL_SOURCES", "mercadolivre,amazon,magalu,zoom,buscape,casasbahia,extra,pontofrio,kabum,aliexpress,shopee")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // fontes coletadas em paralelo (hosts distintos). O throttle por host continua
  // dentro de cada fonte; isto só evita esperar 9 fontes em fila.
  crawlConcurrency: num("CRAWL_CONCURRENCY", 4),

  // ciclo contínuo: coleta a cada N minutos (default 1h)
  crawlIntervalMin: num("CRAWL_INTERVAL_MIN", 60),

  // detecção de oferta
  minHistoryPoints: num("MIN_HISTORY_POINTS", 3),
  priceHistoryDays: num("PRICE_HISTORY_DAYS", 60), // janela móvel (dias) para cálculo de média e estatísticas
  zThreshold: num("Z_THRESHOLD", 1.2), // preço < média - z*desvio
  minDiscountPct: num("MIN_DISCOUNT_PCT", 12), // ou desconto >= % sobre a média
  notifyScore: num("NOTIFY_SCORE", 0.5), // score combinado mínimo p/ notificar
  skipAiPass: bool("AI_SKIP_PASS", true), // veredito PASSE da IA não vira alerta no Telegram
  // Teto de notificações por ciclo. Com muitas fontes, o 1o ciclo de um produto
  // novo dispara pelo preço "de" e um lote grande viraria dezenas de mensagens —
  // além de estourar o deadline do CronJob (1 chamada de IA por oferta postada).
  maxNotificationsPerCycle: num("MAX_NOTIFICATIONS_PER_CYCLE", 10),

  // "Oferta real" exige histórico de verdade: N leituras não bastam se todas
  // forem da mesma hora. Antes disso, só o preço "de" (com régua mais dura).
  minHistoryHours: num("MIN_HISTORY_HOURS", 24),
  // Preço "de" é frequentemente inflado no BR: sem histórico próprio, exige
  // desconto maior e pesa menos no score.
  listPriceMinDiscountPct: num("LISTPRICE_MIN_DISCOUNT_PCT", 20),
  listPriceTrust: num("LISTPRICE_TRUST", 0.75),
  // Notificar oferta medida SÓ contra o preço "de"? market = só se nenhuma
  // outra loja vender mais barato (confirmação de mercado) | always | never.
  // Fica no dashboard de qualquer forma; com 24h de histórico vira oferta real.
  listPriceNotify: env("LISTPRICE_NOTIFY", "market").toLowerCase(),
  // Re-oferta do mesmo produto: só se cair mais X% vs a última oferta, ou se a
  // última tiver mais de N dias (antes era bloqueio eterno).
  redealDropPct: num("REDEAL_DROP_PCT", 5),
  redealDays: num("REDEAL_DAYS", 7),
  // Outra loja vendendo o mesmo item mais barato (>X%) = não é oferta.
  marketTolerancePct: num("MARKET_TOLERANCE_PCT", 3),
  // Popularidade: pouco avaliado pontua menos; mais vendido pontua mais.
  popularityWeight: num("POPULARITY_WEIGHT", 1),
  // Listas "mais vendidos" (1 GET cada, independem de CRAWL_QUERIES).
  bestsellerSources: env("BESTSELLER_SOURCES", "mercadolivre,amazon")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Intervalo mínimo entre mensagens (limite do Telegram ~20 msg/min por grupo).
  telegramMinIntervalMs: num("TELEGRAM_MIN_INTERVAL_MS", 3200),

  // ── Sazonalidade (Black Friday) ──
  season: {
    mode: env("SEASON_MODE", "auto").toLowerCase(), // auto | off | force
    // Baseline "pré-evento": preços até esta data (default 1/nov do ano) contam
    // como preço normal. Pega a maquiagem "metade do dobro".
    baselineCutoff: env("BF_BASELINE_CUTOFF"),
    baselineDays: num("BF_BASELINE_DAYS", 60),
    crawlIntervalMin: num("BF_CRAWL_INTERVAL_MIN", 30), // Black November
    peakCrawlIntervalMin: num("BF_PEAK_CRAWL_INTERVAL_MIN", 15), // semana da BF / Cyber Monday
    maxNotificationsPerCycle: num("BF_MAX_NOTIFICATIONS_PER_CYCLE", 20),
    queries: env(
      "BF_QUERIES",
      "iphone,smartphone samsung galaxy,smart tv 55,notebook,air fryer,fone bluetooth,smartwatch,geladeira,ps5,aspirador robo,kindle,echo dot",
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // bug de precificação: desconto absurdo (ex: PS5 por R$100) = erro de preço
  priceBugDiscountPct: num("PRICE_BUG_DISCOUNT_PCT", 70),

  telegram: {
    enabled: bool("TELEGRAM_ENABLED", true),
    botToken: env("TELEGRAM_BOT_TOKEN"),
    chatId: env("TELEGRAM_CHAT_ID"),
    // Long-polling dos botões 👍/👎. Desligado por padrão: este bot é
    // compartilhado com n8n, e dois getUpdates simultâneos = HTTP 409.
    pollCallbacks: bool("TELEGRAM_POLL_CALLBACKS", false),
  },

  // Banco do cluster (Postgres) onde as ofertas REAIS são persistidas.
  // Vazio => persistência no cluster desligada (só SQLite local).
  cluster: {
    url: env("CLUSTER_DATABASE_URL"),
  },

  litellm: {
    enabled: bool("LITELLM_ENABLED", true),
    base: env("LITELLM_API_BASE", "http://litellm.ai.svc.cluster.local:4000/v1"),
    apiKey: env("LITELLM_API_KEY"),
    model: env("LITELLM_MODEL", "cloud/auto"),
    timeoutMs: num("LITELLM_TIMEOUT_MS", 45000),
  },
} as const;

export type Source = string;
