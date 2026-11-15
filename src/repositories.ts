import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import { DEAL_SELECT, ensureSchema } from "./schema.ts";
import type { PriceStats, ProductRow, ScrapedProduct } from "./types.ts";
import type { DealView, PricePoint } from "./db.ts";

/**
 * Repository Pattern for Database Access
 * Centralizes all raw SQL logic and provides a clean API for the Services.
 */

// Uma conexão por arquivo (antes: uma por repositório). Chave = caminho, pois
// cada arquivo de teste escolhe seu DB_PATH em runtime.
const connections = new Map<string, Database>();
function connect(path: string): Database {
  let db = connections.get(path);
  if (!db) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA foreign_keys = ON;");
    ensureSchema(db);
    connections.set(path, db);
  }
  return db;
}

export class BaseRepository {
  protected db: Database;
  constructor() {
    this.db = connect(config.dbPath);
  }
}

const sqliteDate = (s: string) => new Date(`${s.replace(" ", "T")}Z`).getTime();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class ProductRepository extends BaseRepository {
  upsert(p: ScrapedProduct, category: string): number {
    // Sinais de popularidade ausentes nesta coleta não apagam os já conhecidos.
    const row = this.db
      .query(
        `INSERT INTO products (source, external_id, title, url, category, image, image_source, query,
                               rating, reviews, sold_count, best_seller_rank, badges, first_seen, last_seen)
         VALUES ($source, $external_id, $title, $url, $category, $image, $image_source, $query,
                 $rating, $reviews, $sold, $rank, $badges, datetime('now'), datetime('now'))
         ON CONFLICT(source, external_id) DO UPDATE SET
           title=$title, url=$url, image=COALESCE($image, image), image_source=$image_source, query=$query,
           rating=COALESCE($rating, rating), reviews=COALESCE($reviews, reviews),
           sold_count=COALESCE($sold, sold_count), best_seller_rank=COALESCE($rank, best_seller_rank),
           badges=CASE WHEN $badges <> '' THEN $badges ELSE badges END,
           last_seen=datetime('now')
         RETURNING id`,
      )
      .get({
        $source: p.source,
        $external_id: p.externalId,
        $title: p.title,
        $url: p.url,
        $category: category,
        $image: p.image ?? null,
        $image_source: p.imageSource ?? "unknown",
        $query: p.query,
        $rating: p.rating ?? null,
        $reviews: p.reviews ?? null,
        $sold: p.soldCount ?? null,
        $rank: p.bestSellerRank ?? null,
        $badges: (p.badges ?? []).join(","),
      }) as { id: number };
    return row.id;
  }

  getById(id: number): ProductRow | null {
    return (this.db.query("SELECT * FROM products WHERE id = $id").get({ $id: id }) ?? null) as ProductRow | null;
  }
}

export interface StatsOptions {
  days?: number; // janela móvel
  preEventCutoff?: Date; // baseline sazonal: leituras ANTES desta data
  preEventDays?: number;
  now?: number;
}

export class PriceRepository extends BaseRepository {
  insert(productId: number, price: number) {
    this.db.query("INSERT INTO price_history (product_id, price) VALUES ($pid, $price)").run({ $pid: productId, $price: price });
  }

  /**
   * Estatística do histórico. Chame ANTES de inserir a leitura atual: o preço
   * em avaliação não pode puxar a própria média (diluía o desconto real).
   */
  getStats(productId: number, opts: StatsOptions = {}): PriceStats {
    const days = opts.days ?? config.priceHistoryDays;
    const now = opts.now ?? Date.now();
    const all = this.db
      .query("SELECT price, captured_at FROM price_history WHERE product_id = $pid ORDER BY captured_at, id")
      .all({ $pid: productId }) as PricePoint[];
    const points = all.map((r) => ({ price: r.price, t: sqliteDate(r.captured_at) }));

    let win = points.filter((p) => p.t >= now - days * 86_400_000);
    // janela recente curta demais: usa o histórico total
    if (win.length < config.minHistoryPoints) win = points;
    if (win.length === 0) return { count: 0, avg: 0, std: 0, min: 0, max: 0 };

    const prices = win.map((p) => p.price);
    const avg = prices.reduce((s, x) => s + x, 0) / prices.length;
    const variance = prices.length > 1 ? prices.reduce((s, x) => s + (x - avg) ** 2, 0) / (prices.length - 1) : 0;
    const min = Math.min(...prices);

    const older = win.filter((p) => p.t < now - 14 * 86_400_000).map((p) => p.price);
    const stats: PriceStats = {
      count: prices.length,
      avg,
      std: Math.sqrt(variance),
      min: Math.min(...points.map((p) => p.price)), // menor de todos os tempos
      max: Math.max(...prices),
      min30d: min,
      median: median(prices),
      olderMedian: older.length >= config.minHistoryPoints ? median(older) : undefined,
      spanHours: (win[win.length - 1].t - win[0].t) / 3_600_000,
    };

    if (opts.preEventCutoff) {
      const end = opts.preEventCutoff.getTime();
      const start = end - (opts.preEventDays ?? 60) * 86_400_000;
      const pre = points.filter((p) => p.t < end && p.t >= start).map((p) => p.price);
      if (pre.length) {
        stats.preEventMedian = median(pre);
        stats.preEventCount = pre.length;
      }
    }
    return stats;
  }

  getSeries(productId: number, limit = 20): PricePoint[] {
    return (
      this.db
        .query("SELECT price, captured_at FROM price_history WHERE product_id = $pid ORDER BY captured_at DESC, id DESC LIMIT $lim")
        .all({ $pid: productId, $lim: limit }) as PricePoint[]
    ).reverse();
  }
}

export interface DealInsert {
  productId: number;
  price: number;
  avg: number;
  discountPct: number;
  zscore: number;
  score: number;
  reasons: string;
  flags?: string;
  aiComment: string | null;
  notified: boolean;
}

export class DealRepository extends BaseRepository {
  insert(d: DealInsert): number {
    return (
      this.db
        .query(
          `INSERT INTO deals (product_id, price, avg_price, discount_pct, zscore, score, reasons, flags, ai_comment, notified)
           VALUES ($pid, $price, $avg, $disc, $z, $score, $reasons, $flags, $ai, $notified)
           RETURNING id`,
        )
        .get({
          $pid: d.productId,
          $price: d.price,
          $avg: d.avg,
          $disc: d.discountPct,
          $z: d.zscore,
          $score: d.score,
          $reasons: d.reasons,
          $flags: d.flags ?? "",
          $ai: d.aiComment,
          $notified: d.notified ? 1 : 0,
        }) as { id: number }
    ).id;
  }

  getRecent(limit = 50): DealView[] {
    return this.db.query(`${DEAL_SELECT} ORDER BY d.created_at DESC, d.id DESC LIMIT $lim`).all({ $lim: limit }) as DealView[];
  }

  /** Melhores ofertas das últimas N horas (uma por produto), por score. */
  getTop(hours: number, limit = 20): DealView[] {
    return this.db
      .query(
        `${DEAL_SELECT}
         WHERE d.created_at >= datetime('now', $delta)
           AND d.id = (SELECT MAX(id) FROM deals WHERE product_id = d.product_id)
         ORDER BY d.score DESC, d.discount_pct DESC LIMIT $lim`,
      )
      .all({ $delta: `-${hours} hours`, $lim: limit }) as DealView[];
  }

  getById(id: number): DealView | null {
    return (this.db.query(`${DEAL_SELECT} WHERE d.id = $id`).get({ $id: id }) ?? null) as DealView | null;
  }

  setAiComment(id: number, comment: string) {
    this.db.query("UPDATE deals SET ai_comment = $c WHERE id = $id").run({ $id: id, $c: comment });
  }

  markNotified(id: number) {
    this.db.query("UPDATE deals SET notified = 1 WHERE id = $id").run({ $id: id });
  }

  /** True se já houve deal notificado p/ este produto nas últimas N horas. */
  wasNotifiedRecently(productId: number, hours: number): boolean {
    const r = this.db
      .query(
        `SELECT COUNT(*) c FROM deals
         WHERE product_id = $pid AND notified = 1
           AND created_at >= datetime('now', $delta)`,
      )
      .get({ $pid: productId, $delta: `-${hours} hours` }) as { c: number };
    return r.c > 0;
  }

  /**
   * True se produto com título similar já foi notificado recentemente (evita spam de múltiplos marketplaces).
   */
  wasSimilarProductNotifiedRecently(title: string, hours = 24): boolean {
    const rows = this.db
      .query(
        `SELECT p.title FROM deals d
         JOIN products p ON p.id = d.product_id
         WHERE d.notified = 1
           AND d.created_at >= datetime('now', $delta)`,
      )
      .all({ $delta: `-${hours} hours` }) as { title: string }[];

    if (rows.length === 0) return false;

    const normalize = (str: string) =>
      str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);

    const targetTokens = new Set(normalize(title));
    if (targetTokens.size === 0) return false;

    for (const r of rows) {
      const tokens = normalize(r.title);
      if (tokens.length === 0) continue;
      const common = tokens.filter((t) => targetTokens.has(t)).length;
      const similarity = common / Math.max(targetTokens.size, tokens.length);
      if (similarity >= 0.6 || (common >= 4 && targetTokens.size >= 4)) return true;
    }
    return false;
  }

  /** Última oferta registrada do produto (p/ decidir re-oferta quando o preço cai mais). */
  lastForProduct(productId: number): { price: number; ageDays: number } | null {
    const r = this.db
      .query(
        `SELECT price, (julianday('now') - julianday(created_at)) age FROM deals
         WHERE product_id = $pid ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get({ $pid: productId }) as { price: number; age: number } | null;
    return r ? { price: r.price, ageDays: r.age } : null;
  }

  hasDealForProduct(productId: number): boolean {
    return this.lastForProduct(productId) !== null;
  }
}

export class FeedbackRepository extends BaseRepository {
  insert(dealId: number | null, category: string, keywords: string, vote: 1 | -1) {
    this.db
      .query("INSERT INTO feedback (deal_id, category, keywords, vote) VALUES ($did, $cat, $kw, $vote)")
      .run({ $did: dealId, $cat: category, $kw: keywords, $vote: vote });
  }
}
