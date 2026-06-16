import { config } from "./config.ts";
import type { DealEval, PriceStats } from "./types.ts";
import { affinity } from "./recommend.ts";

// Avalia se o preço atual é uma oferta real frente ao histórico, e combina com
// a afinidade de recomendação para produzir um score 0..1.
export function evaluate(
  price: number,
  stats: PriceStats,
  title: string,
  category: string,
): DealEval {
  const reasons: string[] = [];
  const avg = stats.avg;
  const discountPct = avg > 0 ? ((avg - price) / avg) * 100 : 0;
  const zscore = stats.std > 0 ? (price - avg) / stats.std : 0;

  let isDeal = false;
  if (stats.count < config.minHistoryPoints) {
    // histórico insuficiente: não dispara, só acumula série temporal
    return { isDeal: false, price, avg, discountPct, zscore, score: 0, reasons: ["historico-insuficiente"] };
  }

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

  // score = força * afinidade, saturado em 1
  const score = Math.min(discountStrength * aff.multiplier, 1);

  return { isDeal, price, avg, discountPct, zscore, score, reasons };
}
