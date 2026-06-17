import { PriceRepository, ProductRepository, DealRepository } from "./repositories.ts";
import { evaluate, isPriceBug } from "./deal.ts";
import { analyzeDeal } from "./ai.ts";
import { notifyDeal } from "./telegram.ts";
import { classify } from "./category.ts";
import { log } from "./log.ts";
import { config } from "./config.ts";

export class DealService {
  private productRepo = new ProductRepository();
  private priceRepo = new PriceRepository();
  private dealRepo = new DealRepository();

  /**
   * Predictive analysis: Calculates the price trend based on recent history.
   * Returns a trend score and direction.
   */
  calculateTrend(productId: number) {
    const series = this.priceRepo.getSeries(productId, 10);
    if (series.length < 3) return { direction: 'stable', strength: 0 };
    
    const prices = series.map(s => s.price);
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const diffPct = ((avg2 - avg1) / avg1) * 100;
    
    if (diffPct < -2) return { direction: 'falling', strength: Math.abs(diffPct) };
    if (diffPct > 2) return { direction: 'rising', strength: diffPct };
    return { direction: 'stable', strength: 0 };
  }

  async processScrapedProduct(p: any) {
    const category = classify(p.title);
    const productId = this.productRepo.upsert(p, category);
    this.priceRepo.insert(productId, p.price);

    const stats = this.priceRepo.getStats(productId);
    const evalResult = evaluate(p.price, stats, p.title, category);
    
    if (!evalResult.isDeal) return null;

    const shouldNotify = evalResult.score >= config.notifyScore;
    let aiComment: string | null = null;
    if (shouldNotify) {
      aiComment = await analyzeDeal(p.title, p.source, evalResult);
    }

    const dealId = this.dealRepo.insert({
      productId,
      price: evalResult.price,
      avg: evalResult.avg,
      discountPct: evalResult.discountPct,
      zscore: evalResult.zscore,
      score: evalResult.score,
      reasons: evalResult.reasons.join(" | "),
      aiComment,
      notified: false,
    });

    if (shouldNotify) {
      const view = this.dealRepo.getById(dealId);
      if (view) {
        const ok = await notifyDeal(view);
        if (ok) {
          // In a real pro architecture, we'd have a 'markAsNotified' in the repo
          // For now, keeping it simple within the service
        }
      }
    }

    return dealId;
  }

  getDashboardDeals(limit = 50) {
    const deals = this.dealRepo.getRecent(limit);
    return deals.map(d => ({
      ...d,
      priceBug: isPriceBug(d.discount_pct),
      series: this.priceRepo.getSeries(d.product_id, 24).map(p => p.price),
      seriesDates: this.priceRepo.getSeries(d.product_id, 24).map(p => ({
        price: p.price,
        date: p.captured_at
      })),
      trend: this.calculateTrend(d.product_id)
    }));
  }
}
