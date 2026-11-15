import { config } from "./config.ts";

// Popularidade = prova social. Promoção boa de verdade costuma ser de produto
// que muita gente compra e avalia bem; item sem avaliação, com nota baixa ou
// de vendedor obscuro é onde mora o "desconto" enganoso.
export interface PopularityInput {
  rating?: number | null;
  reviews?: number | null;
  soldCount?: number | null;
  bestSellerRank?: number | null;
  badges?: string[] | null;
}

export interface Popularity {
  multiplier: number; // ~0.7..1.35; 1 = neutro (sem dados)
  reason: string;
  isBestSeller: boolean;
}

export function popularity(p: PopularityInput): Popularity {
  const parts: string[] = [];
  let m = 1;
  const isBestSeller =
    (p.bestSellerRank != null && p.bestSellerRank > 0) || !!p.badges?.includes("mais-vendido");

  if (isBestSeller) {
    // top 3 vale mais que o 30º da lista
    const rank = p.bestSellerRank ?? 10;
    m *= rank <= 3 ? 1.25 : rank <= 10 ? 1.18 : 1.1;
    parts.push(p.bestSellerRank ? `mais-vendido#${p.bestSellerRank}` : "mais-vendido");
  }

  const volume = Math.max(p.reviews ?? 0, p.soldCount ?? 0);
  if (volume > 0) {
    // log: 10 avaliações ≈ neutro, 1k ≈ +12%, 10k+ ≈ +18%
    m *= 1 + Math.max(-0.15, Math.min(0.18, (Math.log10(volume) - 1.5) * 0.06));
    parts.push(`volume=${volume}`);
  }

  if (p.rating != null && p.rating > 0) {
    if (p.rating < 3.8) m *= 0.75;
    else if (p.rating >= 4.6) m *= 1.06;
    parts.push(`nota=${p.rating.toFixed(1)}`);
  }

  // peso configurável: 0 desliga, 1 = padrão
  const w = Math.max(0, config.popularityWeight);
  const multiplier = 1 + (Math.min(1.35, Math.max(0.6, m)) - 1) * w;
  return { multiplier, reason: parts.length ? `pop:[${parts.join(",")}]` : "pop:sem-dados", isBestSeller };
}

// "+10mil vendidos", "mil+ compras no mês passado", "5 mil", "1.234" -> número
export function parseCount(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/\s+/g, " ");
  const m = s.match(/(\d+(?:[.,]\d+)*)\s*(mil|k|mi)?/);
  if (!m) {
    return /\bmil\b/.test(s) ? 1000 : undefined; // "mil+ compras"
  }
  const mult = m[2] === "mi" ? 1_000_000 : m[2] === "mil" || m[2] === "k" ? 1000 : 1;
  // "1.234" (milhar) vs "1,5 mil" (decimal)
  const n = mult > 1 ? Number(m[1].replace(",", ".")) : Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * mult) : undefined;
}

// "4,7 de 5 estrelas" | "4.7" -> 4.7
export function parseRating(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d)[.,](\d)/) ?? raw.match(/^\s*(\d)\s*$/);
  if (!m) return undefined;
  const n = Number(m[2] != null ? `${m[1]}.${m[2]}` : m[1]);
  return n > 0 && n <= 5 ? n : undefined;
}
