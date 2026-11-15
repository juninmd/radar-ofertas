export interface ScrapedProduct {
  source: string; // mercadolivre | amazon | magalu
  externalId: string; // id estável dentro da fonte
  title: string;
  url: string;
  price: number; // BRL
  listPrice?: number; // preço "de" (riscado) anunciado pelo site, referência p/ desconto
  image?: string;
  query: string; // termo de busca que originou
  imageSource?: "real" | "demo"; // indicates image reality
  // ── sinais de popularidade (todos opcionais; ausência = neutro) ──
  rating?: number; // nota média 0..5
  reviews?: number; // nº de avaliações
  soldCount?: number; // vendidos (ML "+1000 vendidos", Amazon "mil+ compras no mês")
  bestSellerRank?: number; // posição em lista "mais vendidos" (1 = topo)
  badges?: string[]; // ex.: "mais-vendido", "oferta-do-dia"
}

export interface ProductRow {
  id: number;
  source: string;
  external_id: string;
  title: string;
  url: string;
  category: string;
  image: string | null;
  image_source: string;
  query: string;
  first_seen: string;
  last_seen: string;
}

export interface PriceStats {
  count: number;
  avg: number;
  std: number;
  min: number;
  max: number;
  min30d?: number;
  // ── baseline robusto (opcionais p/ compatibilidade) ──
  median?: number; // mediana da janela: imune a picos isolados
  olderMedian?: number; // mediana das leituras com >14 dias (antes de uma possível "maquiagem")
  spanHours?: number; // horas entre a 1ª e a última leitura
  preEventMedian?: number; // mediana antes do evento sazonal (ex.: preço de outubro na Black Friday)
  preEventCount?: number;
}

export interface MarketRef {
  minOther: number; // menor preço do MESMO produto em outra loja neste ciclo
  source: string; // loja do menor preço
  stores: number; // nº de lojas que vendem o produto
}

export interface EvalContext {
  popularity?: { multiplier: number; reason: string; isBestSeller: boolean };
  market?: MarketRef | null;
  season?: { active: boolean; label: string; strictListPrice: boolean };
}

export interface DealEval {
  isDeal: boolean;
  price: number;
  avg: number;
  discountPct: number; // (avg - price) / avg * 100
  zscore: number; // (price - avg) / std (negativo = barato)
  score: number; // 0..1 combinado com recomendação
  reasons: string[];
  flags?: string[]; // marcadores curtos p/ UI/Telegram (menor-preco-historico, mais-vendido, ...)
}
