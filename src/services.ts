import { PriceRepository, ProductRepository, DealRepository, FeedbackRepository } from "./repositories.ts";
import { evaluate, isPriceBug } from "./deal.ts";
import { analyzeDeal } from "./ai.ts";
import { notifyDeal } from "./telegram.ts";
import { saveClusterDeal } from "./clusterDb.ts";
import { classify, keywords } from "./category.ts";
import { popularity } from "./popularity.ts";
import { seasonInfo, type SeasonInfo } from "./season.ts";
import { log } from "./log.ts";
import { config } from "./config.ts";
import type { MarketRef, ScrapedProduct } from "./types.ts";

export interface ProcessContext {
  market?: MarketRef | null;
  season?: SeasonInfo;
}

/** Oferta gravada que pode disputar o orçamento de notificação do ciclo. */
export interface Candidate {
  dealId: number;
  productId: number;
  title: string;
  score: number;
  discountPct: number;
}

// Preço "de" sozinho é a régua mais fraca (inflado no BR, ainda mais em novembro).
function listPriceNotifiable(flags: string[]): boolean {
  if (!flags.includes("so-preco-de")) return true;
  if (config.listPriceNotify === "always") return true;
  if (config.listPriceNotify === "never") return false;
  return flags.includes("menor-entre-lojas");
}

export class DealService {
  private productRepo = new ProductRepository();
  private priceRepo = new PriceRepository();
  private dealRepo = new DealRepository();
  private feedbackRepo = new FeedbackRepository();

  /**
   * Predictive analysis: Calculates the price trend based on recent history.
   * Returns a trend score and direction.
   */
  calculateTrend(series: { price: number }[]) {
    if (series.length < 3) return { direction: "stable", strength: 0 };
    const prices = series.map((s) => s.price);
    const half = Math.floor(prices.length / 2);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const avg1 = mean(prices.slice(0, half));
    const avg2 = mean(prices.slice(half));
    const diffPct = ((avg2 - avg1) / avg1) * 100;
    if (diffPct < -2) return { direction: "falling", strength: Math.abs(diffPct) };
    if (diffPct > 2) return { direction: "rising", strength: diffPct };
    return { direction: "stable", strength: 0 };
  }

  /**
   * Fase 1 do ciclo: grava histórico, avalia e registra a oferta (sem notificar).
   * Retorna o candidato a notificação, que o pipeline ranqueia por score.
   */
  async evaluateAndStore(p: ScrapedProduct, ctx: ProcessContext = {}): Promise<{ dealId: number | null; candidate: Candidate | null }> {
    const season = ctx.season ?? seasonInfo();
    const category = classify(p.title);
    const productId = this.productRepo.upsert(p, category);

    // stats ANTES de inserir a leitura atual
    const stats = this.priceRepo.getStats(
      productId,
      season.active ? { preEventCutoff: season.baselineCutoff, preEventDays: config.season.baselineDays } : {},
    );
    this.priceRepo.insert(productId, p.price);

    const pop = popularity(p);
    const ev = evaluate(p.price, stats, p.title, category, p.listPrice, {
      popularity: pop,
      market: ctx.market,
      season: { active: season.active, label: season.label, strictListPrice: season.active },
    });
    if (!ev.isDeal) return { dealId: null, candidate: null };

    // Re-oferta só se o preço CAIU mais desde a última oferta (ou ela envelheceu).
    const last = this.dealRepo.lastForProduct(productId);
    if (last) {
      const dropped = p.price <= last.price * (1 - config.redealDropPct / 100);
      if (!dropped && last.ageDays < config.redealDays) {
        log.debug(`oferta repetida ignorada: ${p.source}:${p.externalId}`);
        return { dealId: null, candidate: null };
      }
      if (dropped) {
        const pct = ((last.price - p.price) / last.price) * 100;
        ev.flags = [...(ev.flags ?? []), "caiu-mais"];
        ev.reasons.push(`caiu-mais: -${pct.toFixed(1)}% vs oferta anterior (R$ ${last.price.toFixed(2)})`);
      }
    }

    const reasons = ev.reasons.join(" | ");
    const flags = (ev.flags ?? []).join(",");
    const dealId = this.dealRepo.insert({
      productId,
      price: ev.price,
      avg: ev.avg,
      discountPct: ev.discountPct,
      zscore: ev.zscore,
      score: ev.score,
      reasons,
      flags,
      aiComment: null,
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
      price: ev.price,
      avg: ev.avg,
      discountPct: ev.discountPct,
      zscore: ev.zscore,
      score: ev.score,
      reasons,
      aiComment: null,
    });

    const eligible =
      ev.score >= config.notifyScore &&
      listPriceNotifiable(ev.flags ?? []) &&
      !this.dealRepo.wasNotifiedRecently(productId, 12);
    return {
      dealId,
      candidate: eligible ? { dealId, productId, title: p.title, score: ev.score, discountPct: ev.discountPct } : null,
    };
  }

  /**
   * Fase 2: comenta via IA e envia ao Telegram. `attempted` = consumiu orçamento
   * (IA + envio), mesmo que o Telegram falhe — senão o teto fica inerte.
   */
  async notify(c: Candidate): Promise<{ notified: boolean; attempted: boolean }> {
    // checado aqui (e não na fase 1) porque envios anteriores deste ciclo contam
    if (this.dealRepo.wasSimilarProductNotifiedRecently(c.title, 24)) return { notified: false, attempted: false };
    const view = this.dealRepo.getById(c.dealId);
    if (!view) return { notified: false, attempted: false };

    const aiComment = await analyzeDeal(view.title, view.source, {
      isDeal: true,
      price: view.price,
      avg: view.avg_price,
      discountPct: view.discount_pct,
      zscore: 0,
      score: view.score,
      reasons: [],
      flags: view.flags ? view.flags.split(",") : [],
    });
    if (aiComment) {
      this.dealRepo.setAiComment(c.dealId, aiComment);
      view.ai_comment = aiComment;
    }
    const notified = await notifyDeal(view);
    if (notified) this.dealRepo.markNotified(c.dealId);
    return { notified, attempted: true };
  }

  /**
   * Caminho de 1 produto (compatível com a API antiga).
   * @param allowNotify quando false, a oferta é gravada mas não vai ao Telegram
   *   (nem gasta chamada de IA). Usado pelo teto de notificações por ciclo.
   */
  async processScrapedProduct(p: ScrapedProduct, allowNotify = true, ctx: ProcessContext = {}) {
    const { dealId, candidate } = await this.evaluateAndStore(p, ctx);
    if (!candidate || !allowNotify) return { dealId, notified: false, notifyAttempted: false };
    const r = await this.notify(candidate);
    return { dealId, notified: r.notified, notifyAttempted: r.attempted };
  }

  /** Registra voto (👍/👎) vindo do dashboard ou do Telegram. */
  registerVote(dealId: number, vote: 1 | -1) {
    const deal = this.dealRepo.getById(dealId);
    if (!deal) return false;
    this.feedbackRepo.insert(dealId, deal.category, keywords(deal.title).join(","), vote);
    return true;
  }

  private enrich(deals: ReturnType<DealRepository["getRecent"]>) {
    return deals.map((d) => {
      const series = this.priceRepo.getSeries(d.product_id, 24);
      return {
        ...d,
        // erro de preço só é crível contra histórico próprio, não contra preço "de"
        priceBug: isPriceBug(d.discount_pct) && !(d.flags ?? "").includes("so-preco-de"),
        flags: d.flags ? d.flags.split(",") : [],
        series: series.map((p) => p.price),
        seriesDates: series.map((p) => ({ price: p.price, date: p.captured_at })),
        trend: this.calculateTrend(series),
      };
    });
  }

  getDashboardDeals(limit = 50) {
    return this.enrich(this.dealRepo.getRecent(limit));
  }

  /** Ranking: melhores ofertas (1 por produto) das últimas N horas. */
  getTopDeals(hours = 24, limit = 20) {
    return this.enrich(this.dealRepo.getTop(hours, limit));
  }
}
