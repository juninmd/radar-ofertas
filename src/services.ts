import { PriceRepository, ProductRepository, DealRepository, FeedbackRepository } from "./repositories.ts";
import { evaluate, isPriceBug } from "./deal.ts";
import { analyzeDeal } from "./ai.ts";
import { notifyDeal } from "./telegram.ts";
import { saveClusterDeal } from "./clusterDb.ts";
import { classify, keywords } from "./category.ts";
import { log } from "./log.ts";
import { config } from "./config.ts";

export class DealService {
  private productRepo = new ProductRepository();
  private priceRepo = new PriceRepository();
  private dealRepo = new DealRepository();
  private feedbackRepo = new FeedbackRepository();

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

  /**
   * @param allowNotify quando false, a oferta é gravada mas não vai ao Telegram
   *   (nem gasta chamada de IA). Usado pelo teto de notificações por ciclo.
   */
  async processScrapedProduct(p: any, allowNotify = true) {
    const category = classify(p.title);
    const productId = this.productRepo.upsert(p, category);
    this.priceRepo.insert(productId, p.price);

    const stats = this.priceRepo.getStats(productId);
    const evalResult = evaluate(p.price, stats, p.title, category, p.listPrice);

    if (!evalResult.isDeal) return { dealId: null, notified: false, notifyAttempted: false };
    if (this.dealRepo.hasDealForProduct(productId)) {
      log.debug(`oferta repetida ignorada: ${p.source}:${p.externalId}`);
      return { dealId: null, notified: false, notifyAttempted: false };
    }

    // Evita spam: não renotifica o mesmo produto em <12h.
    // Evita spam: nao renotifica o mesmo produto em <12h e nem similar recente em <24h.
    const isDuplicateRecent =
      this.dealRepo.wasNotifiedRecently(productId, 12) ||
      this.dealRepo.wasSimilarProductNotifiedRecently(p.title, 24);

    const shouldNotify =
      allowNotify &&
      evalResult.score >= config.notifyScore &&
      !isDuplicateRecent;
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

    // Persiste a oferta REAL no banco do cluster (best-effort).
    await saveClusterDeal({
      source: p.source,
      externalId: p.externalId,
      title: p.title,
      url: p.url,
      category,
      image: p.image ?? null,
      price: evalResult.price,
      avg: evalResult.avg,
      discountPct: evalResult.discountPct,
      zscore: evalResult.zscore,
      score: evalResult.score,
      reasons: evalResult.reasons.join(" | "),
      aiComment,
    });

    let notified = false;
    if (shouldNotify) {
      const view = this.dealRepo.getById(dealId);
      if (view) {
        notified = await notifyDeal(view);
        if (notified) this.dealRepo.markNotified(dealId);
      }
    }

    // notifyAttempted conta o consumo real de orçamento do ciclo (chamada de IA +
    // envio). Contar só sucesso deixaria o teto inerte quando o Telegram falha.
    return { dealId, notified, notifyAttempted: shouldNotify };
  }

  /** Registra voto (👍/👎) vindo do dashboard ou do Telegram. */
  registerVote(dealId: number, vote: 1 | -1) {
    const deal = this.dealRepo.getById(dealId);
    if (!deal) return false;
    this.feedbackRepo.insert(dealId, deal.category, keywords(deal.title).join(","), vote);
    return true;
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
