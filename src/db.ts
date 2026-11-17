import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import { ensureSchema } from "./schema.ts";

if (config.dbPath !== ":memory:") {
  const dir = dirname(config.dbPath);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
}

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

ensureSchema(db);

// Leituras/escritas do pipeline ficam em repositories.ts; aqui só o que é
// compartilhado por telegram/recomendação/servidor.

const seriesStmt = db.query(
  "SELECT price FROM price_history WHERE product_id = $pid ORDER BY captured_at DESC, id DESC LIMIT $lim",
);
export function priceSeries(productId: number, limit = 20): number[] {
  const rows = seriesStmt.all({ $pid: productId, $lim: limit }) as { price: number }[];
  return rows.map((r) => r.price).reverse(); // cronológico
}

export interface PricePoint {
  price: number;
  captured_at: string;
}

export interface DealView {
  id: number;
  product_id: number;
  external_id: string;
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
  flags: string;
  ai_comment: string | null;
  created_at: string;
  rating: number | null;
  reviews: number | null;
  sold_count: number | null;
  best_seller_rank: number | null;
  badges: string;
  min_price: number;
  max_price: number;
  points: number;
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

// ── Gerenciamento de Consultas de Busca (Queries) ──
db.exec(`
CREATE TABLE IF NOT EXISTS search_queries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  query       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Popula com as consultas padrão do config se a tabela estiver vazia
try {
  const countRow = db.query("SELECT COUNT(*) c FROM search_queries").get() as { c: number };
  if (countRow && countRow.c === 0) {
    const insertQ = db.query("INSERT INTO search_queries (query) VALUES ($query)");
    for (const q of config.queries) {
      try {
        insertQ.run({ $query: q });
      } catch {
        // ignora duplicados
      }
    }
  }
} catch (e) {
  console.log("[DB] Erro ao inicializar search_queries:", (e as Error).message);
}

export function getSearchQueries(): string[] {
  try {
    const rows = db.query("SELECT query FROM search_queries ORDER BY id ASC").all() as { query: string }[];
    return rows.map(r => r.query);
  } catch {
    return config.queries; // fallback se falhar
  }
}

export function addSearchQuery(query: string): boolean {
  if (!query || !query.trim()) return false;
  try {
    db.query("INSERT INTO search_queries (query) VALUES ($query)").run({ $query: query.trim() });
    return true;
  } catch {
    return false;
  }
}

export function removeSearchQuery(query: string): boolean {
  if (!query || !query.trim()) return false;
  try {
    db.query("DELETE FROM search_queries WHERE query = $query").run({ $query: query.trim() });
    return true;
  } catch {
    return false;
  }
}
