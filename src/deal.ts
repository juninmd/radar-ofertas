import { config } from "./config.ts";
import type { DealEval, PriceStats } from "./types.ts";
import { affinity } from "./recommend.ts";
import { utilityScore } from "./category.ts";

// Detecta bug de precificação: desconto absurdo frente à média histórica
// (ex.: PS5 anunciado por R$100). Sinaliza para tratamento visual distinto.
export function isPriceBug(discountPct: number): boolean {
  return discountPct >= config.priceBugDiscountPct;
}

// Avalia se o preço atual é uma oferta real frente ao histórico, e combina com
// a afinidade de recomendação para produzir um score 0..1.
export function evaluate(
  price: number,
  stats: PriceStats,
  title: string,
  category: string,
  listPrice?: number,
): DealEval {
  const reasons: string[] = [];

  // Oferta REAL = preço atual abaixo da média OBSERVADA no histórico.
  // O preço "de" (riscado) do site é ignorado quando há histórico próprio,
  // pois em BR ele é frequentemente inflado e produz desconto-fantasma.
  const avg = stats.avg;
  const discountPct = avg > 0 ? ((avg - price) / avg) * 100 : 0;
  const zscore = stats.std > 0 ? (price - stats.avg) / stats.std : 0;

  if (stats.count < config.minHistoryPoints || avg <= 0) {
    // Fallback dia-1: sem histórico próprio suficiente, usa o preço "de"
    // do site como baseline para que ofertas genuínas postem já na 1ª coleta.
    if (listPrice && listPrice > price) {
      return evaluateAgainstBaseline(price, listPrice, title, category);
    }
    return { isDeal: false, price, avg, discountPct, zscore, score: 0, reasons: ["historico-insuficiente"] };
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
  if (price >= avg) {
    return { isDeal: false, price, avg, discountPct, zscore, score: 0, reasons: ["acima-da-media"] };
  }

  // força do desconto normalizada 0..1 (satura em 40%)
  const discountStrength = Math.min(Math.max(discountPct, 0) / 40, 1);
  const aff = affinity(title, category);
  reasons.push(aff.detail);

  const util = utilityScore(title, category);
  reasons.push(util.reason);

  // score = força * afinidade * utilidade, saturado em 1
  const score = Math.min(discountStrength * aff.multiplier * util.score, 1);

  return { isDeal, price, avg, discountPct, zscore, score, reasons };
}

// Avalia oferta contra o preço "de" (riscado) do site quando ainda não há
// histórico próprio. Mantém o mesmo critério de desconto e scoring de evaluate().
function evaluateAgainstBaseline(
  price: number,
  listPrice: number,
  title: string,
  category: string,
): DealEval {
  const discountPct = ((listPrice - price) / listPrice) * 100;
  const base = { price, avg: listPrice, discountPct, zscore: 0 };

  if (discountPct < config.minDiscountPct) {
    return { ...base, isDeal: false, score: 0, reasons: ["preco-de: desconto insuficiente"] };
  }

  const reasons = [`preco-de: desconto=${discountPct.toFixed(1)}% (>=${config.minDiscountPct}%)`];
  const discountStrength = Math.min(Math.max(discountPct, 0) / 40, 1);
  const aff = affinity(title, category);
  reasons.push(aff.detail);

  const util = utilityScore(title, category);
  reasons.push(util.reason);

  const score = Math.min(discountStrength * aff.multiplier * util.score, 1);

  return { ...base, isDeal: true, score, reasons };
}
