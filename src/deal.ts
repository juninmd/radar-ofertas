import { config } from "./config.ts";
import type { DealEval, PriceStats } from "./types.ts";
import { affinity } from "./recommend.ts";

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

  // Referência de desconto: o maior entre média histórica e o preço "de" (riscado)
  // anunciado pelo site. O listPrice permite detectar oferta real no 1º ciclo,
  // sem esperar acumular histórico (causa raiz de "nenhuma oferta chega").
  const hasList = typeof listPrice === "number" && listPrice > price;
  const avg = Math.max(stats.avg, hasList ? listPrice! : 0);
  const discountPct = avg > 0 ? ((avg - price) / avg) * 100 : 0;
  const zscore = stats.std > 0 ? (price - stats.avg) / stats.std : 0;

  // Só exige histórico quando NÃO há preço "de" anunciado.
  if (!hasList && stats.count < config.minHistoryPoints) {
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
  if (hasList) reasons.push(`preço-de=${listPrice!.toFixed(2)}`);
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
