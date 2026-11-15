import type { ScrapedProduct } from "../types.ts";
import { cleanMlUrl, decodeEntities, fetchHtml, parseBrl } from "./base.ts";
import { parseCount, parseRating } from "../popularity.ts";
import { log } from "../log.ts";

// Listas "mais vendidos": o que o Brasil está comprando AGORA. Um GET devolve
// centenas de produtos já ranqueados — é a base de "promoção boa de verdade"
// (produto desejado + preço abaixo do histórico).

// "417 reais com 57 centavos" | "Antes: 499 reais" -> número
export function parseAriaMoney(label: string | undefined): number {
  if (!label) return NaN;
  const m = label.match(/([\d.]+)\s*reais?(?:\s*com\s*(\d{1,2})\s*centavos?)?/i);
  if (!m) return NaN;
  return Number(m[1].replace(/\./g, "")) + (m[2] ? Number(m[2]) / 100 : 0);
}

const ML_BESTSELLERS = "https://www.mercadolivre.com.br/mais-vendidos";

/**
 * Página /mais-vendidos do ML: carrosséis "Mais vendidos em <categoria>" com
 * cards poly-card. A posição no carrossel é o ranking (1 = mais vendido).
 * (A busca lista.mercadolivre.com.br costuma cair no "suspicious-traffic";
 * esta página não.)
 */
export function parseMlBestsellers(html: string, max = 200): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  const sections = html.split(/sbc-products-carousel__title[^>]*>/).slice(1);
  for (const sec of sections) {
    const section = decodeEntities(sec.slice(0, sec.indexOf("<")).trim()).replace(/^Mais vendidos em\s*/i, "");
    const cards = sec.split(/class="[^"]*\bpoly-card\b/).slice(1);
    let rank = 0;
    for (const c of cards) {
      if (out.length >= max) return out;
      rank++;
      const a = c.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*poly-component__title[^"]*"[^>]*>([^<]{4,})<\/a>/)
        ?? c.match(/class="[^"]*poly-component__title[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]{4,})<\/a>/);
      if (!a) continue;
      const url = cleanMlUrl(decodeEntities(a[1]), "");
      const id = url.match(/MLB-?(\d+)/);
      if (!url || !id) continue;

      const cur = c.match(/poly-price__current[\s\S]*?aria-label="([^"]+)"/);
      const price = parseAriaMoney(cur?.[1]);
      if (!Number.isFinite(price) || price <= 0) continue;
      const prev = c.match(/andes-money-amount--previous[^>]*aria-label="([^"]+)"/);
      const listPrice = parseAriaMoney(prev?.[1]);

      const img = c.match(/<img[^>]+src="(https:\/\/[^"]*mlstatic[^"]+)"/);
      const rating = parseRating(c.match(/poly-reviews__rating[^>]*>([\d.,]+)</)?.[1]);
      const reviews = parseCount(c.match(/poly-reviews__total[^>]*>\(?([\d.,]+\s*(?:mil)?)\)?</)?.[1]);
      const badges = /MAIS VENDIDO/i.test(c) ? ["mais-vendido"] : [];

      out.push({
        source: "mercadolivre",
        externalId: `MLB${id[1]}`,
        title: decodeEntities(a[2].trim()),
        url,
        image: img?.[1],
        price,
        listPrice: Number.isFinite(listPrice) && listPrice > price ? listPrice : undefined,
        query: `mais-vendidos:${section || "geral"}`,
        imageSource: "real",
        bestSellerRank: rank,
        rating,
        reviews,
        badges,
      });
    }
  }
  return out;
}

export async function crawlMercadoLivreBestsellers(max = 200): Promise<ScrapedProduct[]> {
  const html = await fetchHtml(ML_BESTSELLERS, 20000);
  if (!html || html.length < 5000) return [];
  const out = parseMlBestsellers(html, max);
  log.debug(`ML mais-vendidos -> ${out.length} itens`);
  return out;
}

// Amazon /gp/bestsellers/<categoria>: grade "zg" com ranking #N. Best-effort:
// a Amazon alterna 503 sob carga; sem resposta, segue o ciclo.
export const AMAZON_BESTSELLER_CATEGORIES = [
  "electronics",
  "computers",
  "videogames",
  "kitchen",
  "home",
  "hpc",
  "sports",
  "tools",
  "beauty",
];

export function parseAmazonBestsellers(html: string, category: string, max = 50): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  const blocks = html.split(/id="gridItemRoot"|class="[^"]*zg-grid-general-faceout/).slice(1);
  for (const b of blocks) {
    if (out.length >= max) break;
    const asin = b.match(/data-asin="([A-Z0-9]{10})"/)?.[1] ?? b.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    if (!asin || out.some((p) => p.externalId === asin)) continue;
    const rank = Number(b.match(/zg-bdg-text[^>]*>#(\d+)/)?.[1]) || out.length + 1;
    const title =
      b.match(/p13n-sc-(?:css-)?line-clamp[^"]*"[^>]*>([^<]{6,})</)?.[1] ??
      b.match(/<img[^>]+alt="([^"]{6,})"/)?.[1];
    const priceRaw = b.match(/p13n-sc-price[^"]*"[^>]*>([^<]+)</)?.[1] ?? b.match(/a-offscreen[^>]*>(R\$[^<]+)</)?.[1];
    if (!title || !priceRaw) continue;
    const price = parseBrl(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;
    const rating = parseRating(b.match(/a-icon-alt[^>]*>([^<]+)</)?.[1]);
    const reviews = parseCount(b.match(/a-size-small[^>]*>([\d.]+)<\/span>/)?.[1]);
    const img = b.match(/<img[^>]+src="(https:\/\/[^"]+)"/)?.[1];
    out.push({
      source: "amazon",
      externalId: asin,
      title: decodeEntities(title.trim()),
      url: `https://www.amazon.com.br/dp/${asin}`,
      image: img,
      price,
      query: `mais-vendidos:${category}`,
      imageSource: "real",
      bestSellerRank: rank,
      rating,
      reviews,
      badges: ["mais-vendido"],
    });
  }
  return out;
}

export async function crawlAmazonBestsellers(maxPerCategory = 30): Promise<ScrapedProduct[]> {
  const out: ScrapedProduct[] = [];
  for (const cat of AMAZON_BESTSELLER_CATEGORIES) {
    const html = await fetchHtml(`https://www.amazon.com.br/gp/bestsellers/${cat}`, 15000);
    if (!html || html.length < 5000) {
      log.debug(`Amazon mais-vendidos/${cat} indisponível`);
      continue;
    }
    out.push(...parseAmazonBestsellers(html, cat, maxPerCategory));
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }
  return out;
}
