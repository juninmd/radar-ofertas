import { SQL } from "bun";
import { config } from "./config.ts";
import { log } from "./log.ts";

// Persistência das ofertas REAIS no banco do cluster (Postgres).
// Best-effort: se indisponível, loga e segue (não derruba o ciclo).

export function clusterEnabled(): boolean {
  if (process.env.CLUSTER_DATABASE_URL === "") return false;
  return !!config.cluster.url;
}

let sql: SQL | null = null;
let schemaReady: Promise<void> | null = null;

function getSql(): SQL {
  if (!sql) sql = new SQL(config.cluster.url);
  return sql;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const s = getSql();
      await s`
        CREATE TABLE IF NOT EXISTS deals (
          id           BIGSERIAL PRIMARY KEY,
          source       TEXT        NOT NULL,
          external_id  TEXT        NOT NULL,
          title        TEXT        NOT NULL,
          url          TEXT        NOT NULL,
          category     TEXT        NOT NULL DEFAULT 'geral',
          image        TEXT,
          price        DOUBLE PRECISION NOT NULL,
          avg_price    DOUBLE PRECISION NOT NULL,
          discount_pct DOUBLE PRECISION NOT NULL,
          zscore       DOUBLE PRECISION NOT NULL,
          score        DOUBLE PRECISION NOT NULL,
          reasons      TEXT        NOT NULL DEFAULT '',
          ai_comment   TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (source, external_id)
        )`;
      await s`CREATE INDEX IF NOT EXISTS idx_deals_created ON deals (created_at DESC)`;
    })().catch((e) => {
      schemaReady = null; // permite nova tentativa no próximo deal
      throw e;
    });
  }
  return schemaReady;
}

export interface ClusterDeal {
  source: string;
  externalId: string;
  title: string;
  url: string;
  category: string;
  image: string | null;
  price: number;
  avg: number;
  discountPct: number;
  zscore: number;
  score: number;
  reasons: string;
  aiComment: string | null;
}

// Upsert por (source, external_id): mantém uma linha por produto com a
// oferta real mais recente. Idempotente entre ciclos.
export async function saveClusterDeal(d: ClusterDeal): Promise<boolean> {
  if (!clusterEnabled()) return false;
  try {
    await ensureSchema();
    const s = getSql();
    await s`
      INSERT INTO deals (source, external_id, title, url, category, image,
        price, avg_price, discount_pct, zscore, score, reasons, ai_comment)
      VALUES (${d.source}, ${d.externalId}, ${d.title}, ${d.url}, ${d.category}, ${d.image},
        ${d.price}, ${d.avg}, ${d.discountPct}, ${d.zscore}, ${d.score}, ${d.reasons}, ${d.aiComment})
      ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title, url = EXCLUDED.url, category = EXCLUDED.category,
        image = EXCLUDED.image, price = EXCLUDED.price, avg_price = EXCLUDED.avg_price,
        discount_pct = EXCLUDED.discount_pct, zscore = EXCLUDED.zscore, score = EXCLUDED.score,
        reasons = EXCLUDED.reasons, ai_comment = EXCLUDED.ai_comment, updated_at = now()`;
    return true;
  } catch (e) {
    log.warn("cluster Postgres indisponível; oferta não persistida", (e as Error).message);
    return false;
  }
}
