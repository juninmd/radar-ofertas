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

  // Schema migration: ensure image_source column exists
  const info = db.query("PRAGMA table_info(products);").all() as any[];
  const hasImageSource = info.some((col: any) => col.name === "image_source");
  if (!hasImageSource) {
    try {
      db.exec(`ALTER TABLE products ADD COLUMN image_source TEXT DEFAULT 'unknown';`);
      console.log("[DB] Added image_source column to products table");
    } catch (e) {
      console.log(
        "[DB] Note: image_source column migration failed, will work without it:",
        (e as Error).message,
      );
    }
  }
}
