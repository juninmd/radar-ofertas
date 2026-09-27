import type { ScrapedProduct } from "../types.ts";
import {
  cleanMlUrl,
  decodeEntities,
  extractNextData,
  fetchHtml,
  magaluSlug,
  parseBrl,
  parseMoney,
} from "./base.ts";
import { log } from "../log.ts";

// Crawlers best-effort por HTML público de busca. Sites de e-commerce têm
// anti-bot agressivo; quando bloqueado retorna []. Parsing tolerante a
// mudanças de markup.

// Garante URL absoluta (Magalu costuma devolver path relativo "/p/...").
function absoluteUrl(raw: unknown, origin: string): string {
  if (typeof raw !== "string" || !raw) return origin;
  if (/^https?:\/\//.test(raw)) return raw;
  return origin + (raw.startsWith("/") ? raw : `/${raw}`);
}

export async function crawlMercadoLivre(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html || html.length < 5000) {
    log.debug(`ML "${query}" bloqueado ou sem dados (${html?.length || 0} bytes)`);
    return [];
  }
  const out: ScrapedProduct[] = [];

  // Try multiple regex patterns to be resilient to markup changes
  const titleRes = [
    /poly-component__title[^>]*>\s*(?:<a[^>]*>)?([^<]{6,})/g,
    /data-component-type="s-search-result"[^>]*>[\s\S]*?<h2[^>]*>([^<]{6,})<\/h2/g,
    /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{6,})</g,
  ];

  const priceRes = [
    /andes-money-amount__fraction[^>]*>([\d.]+)</g,
    /price-tag[^>]*>(R\$\s*[\d.,]+)/g,
    /data-price="([\d.]+)"/g,
  ];

  const linkRe = /href="(https:\/\/[^"]*?(?:MLB-?\d+|\/p\/MLB\d+)[^"]*)"/g;
  const imgRe = /<img[^>]+(?:data-src|src)="(https:\/\/[^"]*mlstatic[^"]+)"/g;

  let titles: string[] = [];
  for (const re of titleRes) {
    titles = [...html.matchAll(re)].map((m) => decodeEntities(m[1].trim())).filter(Boolean);
    if (titles.length > 0) break;
  }

  let prices: number[] = [];
  for (const re of priceRes) {
    const matches = [...html.matchAll(re)];
    if (matches.length > 0) {
      prices = matches.map((m) => parseBrl(m[1])).filter(Number.isFinite);
      if (prices.length > 0) break;
    }
  }

  const links = [...html.matchAll(linkRe)].map((m) => m[1]);
  const images = [...html.matchAll(imgRe)].map((m) => m[1]);

  const n = Math.min(titles.length, prices.length, max);
  for (let i = 0; i < n; i++) {
    const title = titles[i];
    const price = prices[i];
    if (!title || !Number.isFinite(price) || price <= 0) continue;
    const fallbackUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
    const productUrl = cleanMlUrl(links[i], fallbackUrl);
    const idm = productUrl.match(/MLB-?(\d+)/);
    out.push({
      source: "mercadolivre",
      externalId: idm ? `MLB${idm[1]}` : `ml-${query}-${i}`,
      title,
      url: productUrl,
      image: images[i],
      price,
      query,
      imageSource: "real",
    });
  }
  log.debug(`ML "${query}" -> ${out.length} itens (${html.length} bytes, titles=${titles.length}, prices=${prices.length})`);
  return out;
}

export function parseAmazonProducts(html: string, query: string, max: number): ScrapedProduct[] {
  if (!html || html.length < 50) return [];
  const out: ScrapedProduct[] = [];

  // Try multiple block delimiters for robustness
  let blocks = html.split('data-asin="').slice(1);
  if (blocks.length === 0) blocks = html.split('data-component-type="s-search-result"').slice(1);

  for (const b of blocks) {
    if (out.length >= max) break;
    let asin = b.slice(0, b.indexOf('"'));
    if (!asin || asin.length < 5) {
      // Fallback: try to find ASIN in data attributes
      const asinMatch = b.match(/asin["\s]*:?\s*["\']([A-Z0-9]{10})["\']?/i);
      asin = asinMatch?.[1] || "";
    }
    if (!asin || asin.length < 5) continue;

    // Try multiple title patterns
    let titleM = b.match(/<span class="a-size-(?:medium|base-plus)[^"]*"[^>]*>([^<]{6,})</);
    if (!titleM) titleM = b.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(?:<span[^>]*>)?([^<]{6,})(?:<\/span>)?/);
    if (!titleM) titleM = b.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{6,})</);

    // Try multiple price patterns
    let priceM = b.match(/a-price-whole">([\d.]+)<\/span><span class="a-price-fraction">(\d{2})/);
    let priceRaw = "";
    if (priceM) {
      priceRaw = `${priceM[1]},${priceM[2]}`;
    } else {
      const dataPriceM = b.match(/data-a-price="([\d.]+)"/);
      if (dataPriceM) {
        priceRaw = dataPriceM[1].includes(",") ? dataPriceM[1] : `${dataPriceM[1]},00`;
      } else {
        const genericPriceM = b.match(/price["\s]*:?\s*["\']?([\d.,]+)["\']?/i);
        if (genericPriceM) {
          priceRaw = genericPriceM[1].includes(",") ? genericPriceM[1] : `${genericPriceM[1]},00`;
        }
      }
    }

    if (!titleM || !priceRaw) continue;
    const price = parseBrl(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;

    // preço "de" (riscado) na Amazon: <span class="a-price a-text-price"...><span class="a-offscreen">R$ X</span>
    let listPrice: number | undefined;
    const prevM = b.match(/a-text-price[^>]*>[\s\S]{0,40}?a-offscreen[^>]*>([^<]+)</);
    if (prevM) {
      const lp = parseBrl(prevM[1]);
      if (Number.isFinite(lp) && lp > price) listPrice = lp;
    }

    // Try multiple image patterns
    const imgM = b.match(/<img[^>]+class="s-image"[^>]+src="(https:\/\/[^"]+)"/) ||
                 b.match(/<img[^>]+src="(https:\/\/m\.media-amazon\.com[^"]+)"/);

    out.push({
      source: "amazon",
      externalId: asin,
      title: decodeEntities(titleM[1].trim()),
      url: `https://www.amazon.com.br/dp/${asin}`,
      image: imgM?.[1],
      price,
      listPrice,
      query,
      imageSource: "real",
    });
  }
  return out;
}

export async function crawlAmazon(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html || html.length < 5000) {
    log.debug(`Amazon "${query}" bloqueado ou sem dados (${html?.length || 0} bytes)`);
    return [];
  }
  const out = parseAmazonProducts(html, query, max);
  log.debug(`Amazon "${query}" -> ${out.length} itens (${html.length} bytes)`);
  return out;
}

// A busca de www.magazineluiza.com.br é barrada pelo Akamai (403 em HTTP e em
// browser headless; o header akamai-grn denuncia o edge). Duas vitrines servem o
// MESMO catálogo e os MESMOS preços pelo mesmo __NEXT_DATA__, sem Akamai —
// preços conferidos produto a produto entre elas. Links são reescritos para o
// domínio canônico.
const MAGALU_ORIGIN = "https://www.magazineluiza.com.br";

interface MagaluEndpoint {
  nome: string;
  url: (query: string) => string;
}

// Ordem de preferência: clube roda em nginx puro (sem Akamai) e é mais estável
// no volume por busca; magazinevoce fica como redundância.
export const MAGALU_ENDPOINTS: MagaluEndpoint[] = [
  {
    nome: "clube",
    url: (q) => `https://clube.magazineluiza.com.br/clubedosmagalus/busca/${magaluSlug(q)}/`,
  },
  {
    nome: "magazinevoce",
    url: (q) => `https://www.magazinevoce.com.br/magazinevoce/busca/${magaluSlug(q)}/`,
  },
];

export async function crawlMagalu(query: string, max: number): Promise<ScrapedProduct[]> {
  for (const endpoint of MAGALU_ENDPOINTS) {
    const html = await fetchHtml(endpoint.url(query));
    const data = html ? extractNextData(html) : null;
    const out = data
      ? findProducts(data)
          .slice(0, max)
          .map((p) => ({ ...p, query }))
      : [];
    if (out.length > 0) {
      log.debug(`Magalu[${endpoint.nome}] "${query}" -> ${out.length} itens`);
      return out;
    }
    log.debug(`Magalu[${endpoint.nome}] "${query}" -> 0, tentando próxima vitrine`);
  }
  return [];
}

// Formato de preço do Magalu: strings em REAIS ("1289.00"), onde
// bestPrice = preço à vista/Pix, fullPrice = preço normal e price = preço "de".
interface MagaluPrice {
  price?: unknown;
  fullPrice?: unknown;
  bestPrice?: unknown;
  listPrice?: unknown;
}

function toProduct(o: Record<string, unknown>): Omit<ScrapedProduct, "query"> | null {
  const priceObj = o.price as MagaluPrice | undefined;
  if (!priceObj || typeof priceObj !== "object") return null;
  const title = o.title ?? o.name;
  const id = o.id ?? o.productId ?? o.variationId ?? o.sku;
  if (typeof title !== "string" || !title.trim() || id == null) return null;
  if (o.available === false) return null;

  const price = parseMoney(priceObj.bestPrice ?? priceObj.fullPrice ?? priceObj.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  // Preço "de" = maior entre os preços de referência, se acima do praticado.
  const refs = [priceObj.price, priceObj.fullPrice, priceObj.listPrice]
    .map(parseMoney)
    .filter((n) => Number.isFinite(n) && n > price);
  const listPrice = refs.length > 0 ? Math.max(...refs) : undefined;

  // Imagem vem com placeholder de dimensão ("{w}x{h}") no path do CDN.
  let image = typeof o.image === "string" ? o.image : undefined;
  if (image) {
    image = image.replace("{w}x{h}", "800x560");
    if (image.startsWith("//")) image = `https:${image}`;
    else if (image.startsWith("/")) image = MAGALU_ORIGIN + image;
  }

  // "/magazinevoce/<slug>/p/<id>/..." -> canônico no domínio do Magalu.
  const rawPath = typeof o.url === "string" ? o.url : typeof o.path === "string" ? o.path : `/p/${id}/`;
  const canonical = rawPath.replace(/^\/magazinevoce(?=\/)/, "");

  return {
    source: "magalu",
    externalId: String(id),
    title: decodeEntities(title.trim()),
    url: absoluteUrl(canonical, MAGALU_ORIGIN),
    image,
    price,
    listPrice,
    imageSource: "real",
  };
}

// Onde cada vitrine guarda a lista de produtos no __NEXT_DATA__.
const MAGALU_PRODUCT_PATHS = [
  (d: any) => d?.props?.pageProps?.dataResponse?.searchProducts?.data?.products, // clube
  (d: any) => d?.props?.pageProps?.data?.search?.products, // magazinevoce
];

// Percorre o __NEXT_DATA__ atrás da lista de produtos. Caminhos conhecidos
// primeiro; varredura recursiva só como rede de segurança, e restrita a nós com
// o objeto `price` do Magalu — assim banners/carrosséis com números soltos não
// entram mais como "produto" com preço inventado.
export function findProducts(node: unknown, acc: Omit<ScrapedProduct, "query">[] = []): Omit<ScrapedProduct, "query">[] {
  if (acc.length === 0) {
    for (const pick of MAGALU_PRODUCT_PATHS) {
      const known = pick(node);
      if (!Array.isArray(known)) continue;
      for (const raw of known) {
        if (acc.length >= 60) break;
        const p = raw && typeof raw === "object" ? toProduct(raw as Record<string, unknown>) : null;
        if (p) acc.push(p);
      }
      if (acc.length > 0) return acc;
    }
  }
  if (acc.length >= 60 || node == null || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const v of node) findProducts(v, acc);
    return acc;
  }
  const o = node as Record<string, unknown>;
  const p = toProduct(o);
  if (p) acc.push(p);
  for (const v of Object.values(o)) {
    if (v !== null && typeof v === "object") findProducts(v, acc);
  }
  return acc;
}
