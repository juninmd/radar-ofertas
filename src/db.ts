import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import type { PriceStats, ProductRow, ScrapedProduct } from "./types.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

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

// Schema migration: add image_source column to existing products tables
try {
  db.exec(`ALTER TABLE products ADD COLUMN image_source TEXT DEFAULT 'unknown';`);
} catch {
  // Column already exists, silently ignore
}

// ── Produtos & histórico ────────────────────────────────────────────────────
const upsertProductStmt = db.query(`
INSERT INTO products (source, external_id, title, url, category, image, image_source, query, first_seen, last_seen)
VALUES ($source, $external_id, $title, $url, $category, $image, $image_source, $query, datetime('now'), datetime('now'))
ON CONFLICT(source, external_id) DO UPDATE SET
  title=$title, url=$url, image=$image, image_source=$image_source, query=$query, last_seen=datetime('now')
RETURNING id
`);

export function upsertProduct(p: ScrapedProduct, category: string): number {
  const row = upsertProductStmt.get({
    $source: p.source,
    $external_id: p.externalId,
    $title: p.title,
    $url: p.url,
    $category: category,
    $image: p.image ?? null,
    $image_source: p.imageSource ?? 'unknown',
    $query: p.query,
  }) as { id: number };
  return row.id;
}

const insertPriceStmt = db.query(
  "INSERT INTO price_history (product_id, price) VALUES ($pid, $price)",
);
export function insertPrice(productId: number, price: number) {
  insertPriceStmt.run({ $pid: productId, $price: price });
}

const statsStmt = db.query(`
SELECT COUNT(*) c, AVG(price) avg, MIN(price) min, MAX(price) max
FROM price_history WHERE product_id = $pid
`);
const pricesStmt = db.query(
  "SELECT price FROM price_history WHERE product_id = $pid",
);

export function priceStats(productId: number): PriceStats {
  const r = statsStmt.get({ $pid: productId }) as {
    c: number;
    avg: number | null;
    min: number | null;
    max: number | null;
  };
  const rows = pricesStmt.all({ $pid: productId }) as { price: number }[];
  const avg = r.avg ?? 0;
  const variance =
    rows.length > 1
      ? rows.reduce((s, x) => s + (x.price - avg) ** 2, 0) / (rows.length - 1)
      : 0;
  return {
    count: r.c,
    avg,
    std: Math.sqrt(variance),
    min: r.min ?? 0,
    max: r.max ?? 0,
  };
}

const seriesStmt = db.query(
  "SELECT price FROM price_history WHERE product_id = $pid ORDER BY captured_at DESC, id DESC LIMIT $lim",
);
export function priceSeries(productId: number, limit = 20): number[] {
  const rows = seriesStmt.all({ $pid: productId, $lim: limit }) as { price: number }[];
  return rows.map((r) => r.price).reverse(); // cronológico
}

export function getProduct(id: number): ProductRow | null {
  return (db.query("SELECT * FROM products WHERE id = $id").get({ $id: id }) ??
    null) as ProductRow | null;
}

// ── Deals ───────────────────────────────────────────────────────────────────
const insertDealStmt = db.query(`
INSERT INTO deals (product_id, price, avg_price, discount_pct, zscore, score, reasons, ai_comment, notified)
VALUES ($pid, $price, $avg, $disc, $z, $score, $reasons, $ai, $notified)
RETURNING id
`);
export function insertDeal(d: {
  productId: number;
  price: number;
  avg: number;
  discountPct: number;
  zscore: number;
  score: number;
  reasons: string;
  aiComment: string | null;
  notified: boolean;
}): number {
  const r = insertDealStmt.get({
    $pid: d.productId,
    $price: d.price,
    $avg: d.avg,
    $disc: d.discountPct,
    $z: d.zscore,
    $score: d.score,
    $reasons: d.reasons,
    $ai: d.aiComment,
    $notified: d.notified ? 1 : 0,
  }) as { id: number };
  return r.id;
}

export interface DealView {
  id: number;
  product_id: number;
  title: string;
  url: string;
  source: string;
  category: string;
  image: string | null;
  image_source: string;
  price: number;
  avg_price: number;
  discount_pct: number;
  score: number;
  reasons: string;
  ai_comment: string | null;
  created_at: string;
  min_price: number;
  max_price: number;
  points: number;
}

const DEAL_SELECT = `
  SELECT d.id, d.product_id, p.title, p.url, p.source, p.category, p.image, p.image_source,
         d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.ai_comment, d.created_at,
         (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
         (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
         (SELECT COUNT(*)   FROM price_history WHERE product_id = p.id) points
  FROM deals d JOIN products p ON p.id = d.product_id`;

export function recentDeals(limit = 50): DealView[] {
  return db
    .query(`${DEAL_SELECT} ORDER BY d.created_at DESC, d.id DESC LIMIT $lim`)
    .all({ $lim: limit }) as DealView[];
}

export function dealById(id: number): DealView | null {
  return (db.query(`${DEAL_SELECT} WHERE d.id = $id`).get({ $id: id }) ??
    null) as DealView | null;
}

// ── Feedback ────────────────────────────────────────────────────────────────
const insertFeedbackStmt = db.query(`
INSERT INTO feedback (deal_id, category, keywords, vote) VALUES ($did, $cat, $kw, $vote)
`);
export function insertFeedback(
  dealId: number | null,
  category: string,
  keywords: string,
  vote: 1 | -1,
) {
  insertFeedbackStmt.run({
    $did: dealId,
    $cat: category,
    $kw: keywords,
    $vote: vote,
  });
}

export interface FeedbackAgg {
  category: string;
  score: number;
  votes: number;
}
export function feedbackByCategory(): FeedbackAgg[] {
  return db
    .query(
      "SELECT category, SUM(vote) score, COUNT(*) votes FROM feedback GROUP BY category",
    )
    .all() as FeedbackAgg[];
}

export function feedbackKeywords(): { keyword: string; score: number }[] {
  // expande linhas keywords (csv) em pares keyword->voto agregado
  const rows = db
    .query("SELECT keywords, vote FROM feedback WHERE keywords <> ''")
    .all() as { keywords: string; vote: number }[];
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const kw of r.keywords.split(",").map((s) => s.trim()).filter(Boolean)) {
      map.set(kw, (map.get(kw) ?? 0) + r.vote);
    }
  }
  return [...map.entries()].map(([keyword, score]) => ({ keyword, score }));
}

// ── Image Reality Diagnostic ────────────────────────────────────────────────
export interface ImageStats {
  total: number;
  real: number;
  demo: number;
  unknown: number;
  bySource: Record<string, { total: number; real: number; demo: number }>;
}

export function imageStats(): ImageStats {
  const rows = db
    .query(`SELECT source, image_source, COUNT(*) cnt FROM products GROUP BY source, image_source`)
    .all() as { source: string; image_source: string; cnt: number }[];

  const bySource: Record<string, { total: number; real: number; demo: number }> = {};
  let total = 0, real = 0, demo = 0, unknown = 0;

  for (const r of rows) {
    if (!bySource[r.source]) bySource[r.source] = { total: 0, real: 0, demo: 0 };
    bySource[r.source].total += r.cnt;
    total += r.cnt;

    if (r.image_source === 'real') {
      real += r.cnt;
      bySource[r.source].real += r.cnt;
    } else if (r.image_source === 'demo') {
      demo += r.cnt;
      bySource[r.source].demo += r.cnt;
    } else {
      unknown += r.cnt;
    }
  }

  return { total, real, demo, unknown, bySource };
}
