import type { Database } from "bun:sqlite";

// Schema SQLite compartilhado. Toda conexão que consulta as tabelas precisa
// chamar ensureSchema() antes: não dá para depender do import de `db.ts` ter
// rodado antes, porque a ordem de avaliação dos módulos muda entre versões do
// Bun e entre execuções isoladas (ex.: `bun test` de um único arquivo).
export function ensureSchema(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'geral',
  image       TEXT,
  image_source TEXT DEFAULT 'unknown',
  query       TEXT NOT NULL DEFAULT '',
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       REAL NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_product_captured ON price_history(product_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS deals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price        REAL NOT NULL,
  avg_price    REAL NOT NULL,
  discount_pct REAL NOT NULL,
  zscore       REAL NOT NULL,
  score        REAL NOT NULL,
  reasons      TEXT NOT NULL DEFAULT '',
  ai_comment   TEXT,
  notified     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_created ON deals(created_at);

-- feedback do usuário (curtir/não curtir) p/ algoritmo de recomendação
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  category   TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '',
  vote       INTEGER NOT NULL, -- +1 curtir, -1 não curtir
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_cat ON feedback(category);
`);

  // Migrações aditivas (bancos antigos): coluna nova só entra se faltar.
  addColumns(db, "products", {
    image_source: "TEXT DEFAULT 'unknown'",
    rating: "REAL",
    reviews: "INTEGER",
    sold_count: "INTEGER",
    best_seller_rank: "INTEGER",
    badges: "TEXT NOT NULL DEFAULT ''",
  });
  addColumns(db, "deals", { flags: "TEXT NOT NULL DEFAULT ''" });
  db.exec("CREATE INDEX IF NOT EXISTS idx_deals_product ON deals(product_id, created_at DESC);");
}

function addColumns(db: Database, table: string, cols: Record<string, string>): void {
  const have = new Set((db.query(`PRAGMA table_info(${table});`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, def] of Object.entries(cols)) {
    if (have.has(name)) continue;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`);
    } catch (e) {
      console.log(`[DB] migração ${table}.${name} falhou:`, (e as Error).message);
    }
  }
}

// SELECT único da visão de oferta (dashboard, Telegram, API).
export const DEAL_SELECT = `SELECT d.id, d.product_id, p.external_id, p.title, p.url, p.source, p.category, p.image, p.image_source,
  d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.flags, d.ai_comment, d.created_at,
  p.rating, p.reviews, p.sold_count, p.best_seller_rank, p.badges,
  (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
  (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
  (SELECT COUNT(*) FROM price_history WHERE product_id = p.id) points
FROM deals d JOIN products p ON p.id = d.product_id`;
