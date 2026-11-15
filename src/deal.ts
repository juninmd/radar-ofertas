import { config } from "./config.ts";
import type { DealEval, EvalContext, PriceStats } from "./types.ts";
import { affinity } from "./recommend.ts";
import { utilityScore } from "./category.ts";

// Detecta bug de precificação: desconto absurdo frente à média histórica
// (ex.: PS5 anunciado por R$100). Sinaliza para tratamento visual distinto.
export function isPriceBug(discountPct: number): boolean {
  return discountPct >= config.priceBugDiscountPct;
}

const NEUTRAL_POP = { multiplier: 1, reason: "pop:sem-dados", isBestSeller: false };

// força do desconto normalizada 0..1 (satura em 40%)
const strength = (discountPct: number) => Math.min(Math.max(discountPct, 0) / 40, 1);

// Outra loja vende o mesmo item mais barato => não é promoção de verdade.
function beatenByMarket(price: number, ctx?: EvalContext): string | null {
  const m = ctx?.market;
  if (!m || m.minOther <= 0) return null;
  return price > m.minOther * (1 + config.marketTolerancePct / 100)
    ? `mais-barato-em:${m.source} (R$ ${m.minOther.toFixed(2)})`
    : null;
}

/**
 * Avalia se o preço atual é uma oferta REAL e produz um score 0..1.
 *
 * Régua (do mais ao menos confiável):
 *  1. histórico próprio — mediana da janela (imune a picos), trocada pela
 *     mediana antiga se o preço SUBIU antes de "baixar" (metade do dobro), e
 *     na Black Friday pela mediana pré-evento (preço de outubro);
 *  2. preço de mercado — outra loja mais barata derruba a oferta;
 *  3. preço "de" do site — só sem histórico, com desconto mínimo maior e peso menor.
 *
 * `stats` deve EXCLUIR a leitura atual (senão ela puxa a própria média).
 */
export function evaluate(
  price: number,
  stats: PriceStats,
  title: string,
  category: string,
  listPrice?: number,
  ctx?: EvalContext,
): DealEval {
  const reasons: string[] = [];
  const flags: string[] = [];
  const pop = ctx?.popularity ?? NEUTRAL_POP;
  if (pop.isBestSeller) flags.push("mais-vendido");

  const historyOk =
    stats.count >= config.minHistoryPoints &&
    stats.avg > 0 &&
    (stats.spanHours == null || stats.spanHours >= config.minHistoryHours);

  if (!historyOk) {
    // Fallback dia-1: sem histórico próprio suficiente, usa o preço "de"
    // do site como baseline para que ofertas genuínas postem já na 1ª coleta.
    if (listPrice && listPrice > price) {
      return evaluateAgainstBaseline(price, listPrice, title, category, ctx, flags);
    }
    const discountPct = stats.avg > 0 ? ((stats.avg - price) / stats.avg) * 100 : 0;
    return { isDeal: false, price, avg: stats.avg, discountPct, zscore: 0, score: 0, reasons: ["historico-insuficiente"], flags };
  }

  // ── baseline robusto ──
  let baseline = stats.median ?? stats.avg;
  if (stats.olderMedian && stats.olderMedian < baseline * 0.97) {
    reasons.push(`subiu-antes-de-baixar: ref R$ ${stats.olderMedian.toFixed(2)} (era ${baseline.toFixed(2)})`);
    flags.push("preco-maquiado");
    baseline = stats.olderMedian;
  }
  if (
    ctx?.season?.active &&
    stats.preEventMedian &&
    (stats.preEventCount ?? 0) >= config.minHistoryPoints &&
    stats.preEventMedian < baseline
  ) {
    reasons.push(`ref-pre-evento: R$ ${stats.preEventMedian.toFixed(2)}`);
    flags.push("preco-inflado-pre-evento");
    baseline = stats.preEventMedian;
  }

  const avg = baseline;
  const discountPct = avg > 0 ? ((avg - price) / avg) * 100 : 0;
  // z contra a MESMA referência do desconto (senão a média inflada fabrica z)
  const zscore = stats.std > 0 ? (price - avg) / stats.std : 0;

  if (price >= avg) {
    return { isDeal: false, price, avg, discountPct, zscore, score: 0, reasons: [...reasons, "acima-da-media"], flags };
  }

  let isDeal = false;
  if (zscore <= -config.zThreshold) {
    isDeal = true;
    reasons.push(`z=${zscore.toFixed(2)} (<=-${config.zThreshold})`);
  }
  if (discountPct >= config.minDiscountPct) {
    isDeal = true;
    reasons.push(`desconto=${discountPct.toFixed(1)}% (>=${config.minDiscountPct}%)`);
  }
  // Menor preço recente (30-60 dias) com desconto mínimo razoável (>= 8%)
  if (stats.min30d && stats.min30d > 0 && price <= stats.min30d + 0.01 && discountPct >= 8) {
    isDeal = true;
    reasons.push(`menor-preco-recente: R$ ${price.toFixed(2)} (desconto=${discountPct.toFixed(1)}%)`);
  }

  let bonus = 1;
  if (stats.min > 0 && price < stats.min - 0.01) {
    flags.push("menor-preco-historico");
    bonus *= 1.1;
  }

  const beaten = beatenByMarket(price, ctx);
  if (beaten) {
    isDeal = false;
    reasons.push(beaten);
  } else if (ctx?.market) {
    flags.push("menor-entre-lojas");
    reasons.push(`menor-entre-${ctx.market.stores}-lojas`);
    bonus *= 1.08;
  }

  const aff = affinity(title, category);
  const util = utilityScore(title, category);
  reasons.push(aff.detail, util.reason, pop.reason);

  // score = força * afinidade * utilidade * popularidade * bônus, saturado em 1
  const score = isDeal ? Math.min(strength(discountPct) * aff.multiplier * util.score * pop.multiplier * bonus, 1) : 0;

  return { isDeal, price, avg, discountPct, zscore, score, reasons, flags };
}

// Avalia oferta contra o preço "de" (riscado) do site quando ainda não há
// histórico próprio. Preço "de" é muito inflado no BR (e mais ainda em
// novembro), então a régua é mais dura e o score pesa menos — salvo quando o
// mercado confirma que é o menor preço entre lojas.
function evaluateAgainstBaseline(
  price: number,
  listPrice: number,
  title: string,
  category: string,
  ctx: EvalContext | undefined,
  flags: string[],
): DealEval {
  const discountPct = ((listPrice - price) / listPrice) * 100;
  const base = { price, avg: listPrice, discountPct, zscore: 0 };
  const strict = !!ctx?.season?.strictListPrice;
  const minPct = Math.max(config.minDiscountPct, config.listPriceMinDiscountPct) + (strict ? 10 : 0);
  flags.push("so-preco-de");

  if (discountPct < minPct) {
    return { ...base, isDeal: false, score: 0, reasons: [`preco-de: desconto insuficiente (<${minPct}%)`], flags };
  }
  const beaten = beatenByMarket(price, ctx);
  if (beaten) {
    return { ...base, isDeal: false, score: 0, reasons: [`preco-de: desconto=${discountPct.toFixed(1)}%`, beaten], flags };
  }

  const reasons = [`preco-de: desconto=${discountPct.toFixed(1)}% (>=${minPct}%)`];
  let trust = config.listPriceTrust * (strict ? 0.85 : 1);
  if (ctx?.market) {
    trust = 1; // confirmado: nenhuma outra loja vende mais barato
    flags.push("menor-entre-lojas");
    reasons.push(`menor-entre-${ctx.market.stores}-lojas`);
  }
  const pop = ctx?.popularity ?? NEUTRAL_POP;
  const aff = affinity(title, category);
  const util = utilityScore(title, category);
  reasons.push(aff.detail, util.reason, pop.reason);

  const score = Math.min(strength(discountPct) * trust * aff.multiplier * util.score * pop.multiplier, 1);
  return { ...base, isDeal: true, score, reasons, flags };
}
