import type { MarketRef, ScrapedProduct } from "./types.ts";

// Comparação entre lojas no MESMO ciclo: "oferta" que outra loja vende mais
// barato não é oferta. Casamento por tokens do título incluindo números de
// modelo/capacidade ("980", "1tb", "55"), que é o que distingue produtos.
const STOP = new Set([
  "com", "para", "the", "and", "de", "da", "do", "em", "kit", "novo", "original", "oferta",
  "promocao", "envio", "imediato", "frete", "gratis", "preto", "branco", "cor", "unidade",
]);

export function productTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/(\d+)\s+(gb|tb|mb|w|hz|kg|g|ml|l|pol)\b/g, "$1$2") // "1 tb" -> "1tb"
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  // números precisam bater: "ssd 1tb" ≠ "ssd 2tb"
  const numsA = [...a].filter((t) => /\d/.test(t));
  const numsB = new Set([...b].filter((t) => /\d/.test(t)));
  if (numsA.length && numsB.size && !numsA.some((n) => numsB.has(n))) return 0;
  // títulos de loja variam muito de tamanho: coeficiente de sobreposição,
  // exigindo um mínimo absoluto de termos em comum
  if (inter < 3) return 0;
  return inter / Math.min(a.size, b.size);
}

const MATCH = 0.75;

export function buildMarket(products: ScrapedProduct[]): (p: ScrapedProduct) => MarketRef | null {
  const toks = products.map((p) => productTokens(p.title));
  const cache = new Map<ScrapedProduct, MarketRef | null>();
  return (p) => {
    if (cache.has(p)) return cache.get(p)!;
    const mine = productTokens(p.title);
    let minOther = Infinity;
    let source = "";
    const stores = new Set([p.source]);
    for (let i = 0; i < products.length; i++) {
      const o = products[i];
      if (o.source === p.source) continue;
      // faixa de preço plausível p/ o mesmo item (evita casar acessório com produto)
      if (o.price < p.price * 0.5 || o.price > p.price * 2) continue;
      if (similarity(mine, toks[i]) < MATCH) continue;
      stores.add(o.source);
      if (o.price < minOther) {
        minOther = o.price;
        source = o.source;
      }
    }
    const ref = Number.isFinite(minOther) ? { minOther, source, stores: stores.size } : null;
    cache.set(p, ref);
    return ref;
  };
}
