import type { ScrapedProduct } from "../types.ts";
import { decodeEntities, fetchJson } from "./base.ts";
import { log } from "../log.ts";

// ── VTEX genérico ───────────────────────────────────────────────────────────
// Lojas VTEX expõem a API pública de catálogo. Um único parser cobre todas;
// basta variar host + source. Retorna preço atual + preço "de" (ListPrice) já
// estruturados — alimenta o detector de oferta no 1º ciclo.
interface VtexProduct {
  productId?: string;
  productName?: string;
  linkText?: string;
  link?: string;
  items?: {
    images?: { imageUrl?: string }[];
    sellers?: { commertialOffer?: { Price?: number; ListPrice?: number; IsAvailable?: boolean } }[];
  }[];
}

async function crawlVtex(host: string, source: string, query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://${host}/api/catalog_system/pub/products/search/${encodeURIComponent(query)}?map=ft&_from=0&_to=${Math.max(0, max - 1)}`;
  const data = await fetchJson<VtexProduct[]>(url, 12000, { referer: `https://${host}/` });
  if (!Array.isArray(data) || data.length === 0) {
    log.debug(`VTEX ${source} "${query}" -> sem dados`);
    return [];
  }
  const out: ScrapedProduct[] = [];
  for (const p of data) {
    if (out.length >= max) break;
    const item = p.items?.[0];
    const offer = item?.sellers?.[0]?.commertialOffer;
    const price = offer?.Price;
    if (!p.productName || !p.productId || typeof price !== "number" || price <= 0) continue;
    const listPrice = typeof offer?.ListPrice === "number" && offer.ListPrice > price ? offer.ListPrice : undefined;
    const image = item?.images?.[0]?.imageUrl;
    const productUrl = p.link ?? (p.linkText ? `https://${host}/${p.linkText}/p` : `https://${host}/`);
    out.push({
      source,
      externalId: String(p.productId),
      title: decodeEntities(p.productName),
      url: productUrl,
      image,
      price,
      listPrice,
      query,
      imageSource: "real",
    });
  }
  log.debug(`VTEX ${source} "${query}" -> ${out.length} itens`);
  return out;
}

export const crawlCasasBahia = (q: string, max: number) => crawlVtex("www.casasbahia.com.br", "casasbahia", q, max);
export const crawlPontofrio = (q: string, max: number) => crawlVtex("www.pontofrio.com.br", "pontofrio", q, max);
export const crawlExtra = (q: string, max: number) => crawlVtex("www.extra.com.br", "extra", q, max);
