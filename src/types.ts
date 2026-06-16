export interface ScrapedProduct {
  source: string; // mercadolivre | amazon | magalu
  externalId: string; // id estável dentro da fonte
  title: string;
  url: string;
  price: number; // BRL
  image?: string;
  query: string; // termo de busca que originou
}

export interface ProductRow {
  id: number;
  source: string;
  external_id: string;
  title: string;
  url: string;
  category: string;
  image: string | null;
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
}

export interface DealEval {
  isDeal: boolean;
  price: number;
  avg: number;
  discountPct: number; // (avg - price) / avg * 100
  zscore: number; // (price - avg) / std (negativo = barato)
  score: number; // 0..1 combinado com recomendação
  reasons: string[];
}
