import { feedbackByCategory, feedbackKeywords } from "./db.ts";
import { keywords } from "./category.ts";

// Converte feedback acumulado em multiplicador de afinidade.
// Ex.: curtiu várias promoções de whey -> categoria "suplementos" e keyword
// "whey" ganham boost -> próximas ofertas de whey pontuam mais alto -> +chance
// de notificar/postar. Não-curtir empurra para baixo.
//
// boost(x) = 1 + tanh(somaVotos / 3) * 0.6   ∈ [0.4, 1.6]
function boost(votes: number): number {
  return 1 + Math.tanh(votes / 3) * 0.6;
}

export interface Affinity {
  multiplier: number;
  detail: string;
}

export function affinity(title: string, category: string): Affinity {
  const cat = feedbackByCategory().find((f) => f.category === category);
  const catBoost = boost(cat?.score ?? 0);

  const kwMap = new Map(feedbackKeywords().map((k) => [k.keyword, k.score]));
  const kws = keywords(title);
  let kwVotes = 0;
  const hits: string[] = [];
  for (const kw of kws) {
    const v = kwMap.get(kw);
    if (v) {
      kwVotes += v;
      hits.push(`${kw}${v > 0 ? "+" : ""}${v}`);
    }
  }
  const kwBoost = boost(kwVotes);

  // combinação: categoria pesa menos que match exato de keyword
  const multiplier = catBoost * 0.4 + kwBoost * 0.6;
  const detail =
    `cat:${category}(${cat?.score ?? 0}) kw:[${hits.join(",") || "-"}]`;
  return { multiplier, detail };
}
