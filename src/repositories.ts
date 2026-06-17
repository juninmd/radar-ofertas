import { Database } from "bun:sqlite";
import { config } from "./config.ts";
import type { PriceStats, ProductRow, ScrapedProduct, PricePoint } from "./types.ts";

/**
 * Repository Pattern for Database Access
 * Centralizes all raw SQL logic and provides a clean API for the Services.
 */

export class BaseRepository {
  protected db: Database;
  
  constructor() {
    this.db = new Database(config.dbPath, { create: true });
    this.init();
  }

  private init() {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }
}

export class ProductRepository extends BaseRepository {
  upsert(p: ScrapedProduct, category: string): number {
    const hasImageSource = this.db.query("PRAGMA table_info(products);").all().some((c: any) => c.name === 'image_source');
    
    const sql = hasImageSource
      ? `INSERT INTO products (source, external_id, title, url, category, image, image_source, query, first_seen, last_seen)
         VALUES ($source, $external_id, $title, $url, $category, $image, $image_source, $query, datetime('now'), datetime('now'))
         ON CONFLICT(source, external_id) DO UPDATE SET
           title=$title, url=$url, image=$image, image_source=$image_source, query=$query, last_seen=datetime('now')
         RETURNING id`
      : `INSERT INTO products (source, external_id, title, url, category, image, query, first_seen, last_seen)
         VALUES ($source, $external_id, $title, $url, $category, $image, $query, datetime('now'), datetime('now'))
         ON CONFLICT(source, external_id) DO UPDATE SET
           title=$title, url=$url, image=$image, query=$query, last_seen=datetime('now')
         RETURNING id`;

    const params: any = {
      $source: p.source,
      $external_id: p.externalId,
      $title: p.title,
      $url: p.url,
      $category: category,
      $image: p.image ?? null,
      $query: p.query,
    };
    if (hasImageSource) params.$image_source = p.imageSource ?? 'unknown';

    const row = this.db.query(sql).get(params) as { id: number };
    return row.id;
  }

  getById(id: number): ProductRow | null {
    return (this.db.query("SELECT * FROM products WHERE id = $id").get({ $id: id }) ?? null) as ProductRow | null;
  }
}

export class PriceRepository extends BaseRepository {
  insert(productId: number, price: number) {
    this.db.query("INSERT INTO price_history (product_id, price) VALUES ($pid, $price)").run({ $pid: productId, $price: price });
  }

  getStats(productId: number): PriceStats {
    const r = this.db.query(`SELECT COUNT(*) c, AVG(price) avg, MIN(price) min, MAX(price) max FROM price_history WHERE product_id = $pid`).get({ $pid: productId }) as any;
    const rows = this.db.query("SELECT price FROM price_history WHERE product_id = $pid").all({ $pid: productId }) as { price: number }[];
    const avg = r.avg ?? 0;
    const variance = rows.length > 1 ? rows.reduce((s, x) => s + (x.price - avg) ** 2, 0) / (rows.length - 1) : 0;
    return { count: r.c, avg, std: Math.sqrt(variance), min: r.min ?? 0, max: r.max ?? 0 };
  }

  getSeries(productId: number, limit = 20): PricePoint[] {
    return (this.db.query("SELECT price, captured_at FROM price_history WHERE product_id = $pid ORDER BY captured_at DESC, id DESC LIMIT $lim").all({ $pid: productId, $lim: limit }) as any[]).map(r => ({
      price: r.price,
      captured_at: r.captured_at
    })).reverse();
  }
}

export class DealRepository extends BaseRepository {
  insert(d: any): number {
    return (this.db.query(`
      INSERT INTO deals (product_id, price, avg_price, discount_pct, zscore, score, reasons, ai_comment, notified)
      VALUES ($pid, $price, $avg, $disc, $z, $score, $reasons, $ai, $notified)
      RETURNING id
    `).get({
      $pid: d.productId, $price: d.price, $avg: d.avg, $disc: d.discountPct,
      $z: d.zscore, $score: d.score, $reasons: d.reasons, $ai: d.aiComment,
      $notified: d.notified ? 1 : 0,
    }) as { id: number }).id;
  }

  getRecent(limit = 50): any[] {
    // Logic for join and select
    const hasImageSource = this.db.query("PRAGMA table_info(products);").all().some((c: any) => c.name === 'image_source');
    const select = hasImageSource 
      ? `d.id, d.product_id, p.title, p.url, p.source, p.category, p.image, p.image_source,
         d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.ai_comment, d.created_at,
         (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
         (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
         (SELECT COUNT(*) FROM price_history WHERE product_id = p.id) points`
      : `d.id, d.product_id, p.title, p.url, p.source, p.category, p.image, 'unknown' as image_source,
         d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.ai_comment, d.created_at,
         (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
         (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
         (SELECT COUNT(*) FROM price_history WHERE product_id = p.id) points`;
    
    return this.db.query(`SELECT ${select} FROM deals d JOIN products p ON p.id = d.product_id ORDER BY d.created_at DESC, d.id DESC LIMIT $lim`).all({ $lim: limit });
  }

  getById(id: number): any {
    const hasImageSource = this.db.query("PRAGMA table_info(products);").all().some((c: any) => c.name === 'image_source');
    const select = hasImageSource 
      ? `d.id, d.product_id, p.title, p.url, p.source, p.category, p.image, p.image_source,
         d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.ai_comment, d.created_at,
         (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
         (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
         (SELECT COUNT(*) FROM price_history WHERE product_id = p.id) points`
      : `d.id, d.product_id, p.title, p.url, p.source, p.category, p.image, 'unknown' as image_source,
         d.price, d.avg_price, d.discount_pct, d.score, d.reasons, d.ai_comment, d.created_at,
         (SELECT MIN(price) FROM price_history WHERE product_id = p.id) min_price,
         (SELECT MAX(price) FROM price_history WHERE product_id = p.id) max_price,
         (SELECT COUNT(*) FROM price_history WHERE product_id = p.id) points`;
    
    return this.db.query(`SELECT ${select} FROM deals d JOIN products p ON p.id = d.product_id WHERE d.id = $id`).get({ $id: id });
  }
}
