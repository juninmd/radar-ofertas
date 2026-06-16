import type { ScrapedProduct } from "../types.ts";
import { decodeEntities, fetchHtml, parseBrl } from "./base.ts";
import { log } from "../log.ts";

// Crawlers best-effort por HTML público de busca. Sites de e-commerce têm
// anti-bot agressivo; quando bloqueado retorna [] e o orquestrador usa o
// fallback demo. Parsing tolerante a mudanças de markup.

export async function crawlMercadoLivre(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  const out: ScrapedProduct[] = [];
  // cada card: link do produto + título + fração de preço
  const cardRe =
    /<a[^>]+href="(https:\/\/(?:produto|www)\.mercad(?:olivre|olibre)\.com\.br\/[^"]+|https:\/\/[^"]*\/MLB-?\d+[^"]*)"[^>]*>[\s\S]*?<\/a>/g;
  // estratégia simples: título via poly-component__title, preço via fraction
  const titleRe = /poly-component__title[^>]*>\s*(?:<a[^>]*>)?([^<]{6,})/g;
  const priceRe = /andes-money-amount__fraction[^>]*>([\d.]+)</g;
  const linkRe = /href="(https:\/\/[^"]*?(?:MLB-?\d+|\/p\/MLB\d+)[^"]*)"/g;

  const titles = [...html.matchAll(titleRe)].map((m) => decodeEntities(m[1].trim()));
  const prices = [...html.matchAll(priceRe)].map((m) => parseBrl(m[1]));
  const links = [...html.matchAll(linkRe)].map((m) => m[1]);
  void cardRe;

  const n = Math.min(titles.length, prices.length, max);
  for (let i = 0; i < n; i++) {
    const title = titles[i];
    const price = prices[i];
    if (!title || !Number.isFinite(price) || price <= 0) continue;
    const url = links[i] ?? `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
    const idm = url.match(/MLB-?(\d+)/);
    out.push({
      source: "mercadolivre",
      externalId: idm ? `MLB${idm[1]}` : `ml-${query}-${i}`,
      title,
      url,
      price,
      query,
    });
  }
  log.debug(`ML "${query}" -> ${out.length} itens`);
  return out;
}

export async function crawlAmazon(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  const out: ScrapedProduct[] = [];
  const blocks = html.split('data-asin="').slice(1);
  for (const b of blocks) {
    if (out.length >= max) break;
    const asin = b.slice(0, b.indexOf('"'));
    if (!asin || asin.length < 5) continue;
    const titleM = b.match(/<span class="a-size-(?:medium|base-plus)[^"]*"[^>]*>([^<]{6,})</);
    const priceM = b.match(/a-price-whole">([\d.]+)<\/span><span class="a-price-fraction">(\d{2})/);
    if (!titleM || !priceM) continue;
    const price = parseBrl(`${priceM[1]},${priceM[2]}`);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      source: "amazon",
      externalId: asin,
      title: decodeEntities(titleM[1].trim()),
      url: `https://www.amazon.com.br/dp/${asin}`,
      price,
      query,
    });
  }
  log.debug(`Amazon "${query}" -> ${out.length} itens`);
  return out;
}

export async function crawlMagalu(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query)}/`;
  const html = await fetchHtml(url);
  if (!html) return [];
  const out: ScrapedProduct[] = [];
  // Magalu usa Next.js __NEXT_DATA__ com produtos em JSON
  const nextM = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextM) {
    try {
      const data = JSON.parse(nextM[1]);
      const list = findProducts(data);
      for (const p of list) {
        if (out.length >= max) break;
        out.push({ ...p, query });
      }
    } catch {
      /* fallthrough */
    }
  }
  log.debug(`Magalu "${query}" -> ${out.length} itens`);
  return out;
}

// busca recursiva por nós que parecem produto no JSON do Next
function findProducts(node: unknown, acc: Omit<ScrapedProduct, "query">[] = []): Omit<ScrapedProduct, "query">[] {
  if (acc.length >= 30 || node == null || typeof node !== "object") return acc;
  const o = node as Record<string, unknown>;
  const title = o.title ?? o.name;
  const price = (o.price as Record<string, unknown>)?.bestPrice ?? o.bestPrice ?? o.price;
  const id = o.id ?? o.productId ?? o.sku;
  if (typeof title === "string" && (typeof price === "number" || typeof price === "string") && id != null) {
    const n = typeof price === "number" ? price : parseBrl(String(price));
    if (Number.isFinite(n) && n > 0) {
      acc.push({
        source: "magalu",
        externalId: String(id),
        title: decodeEntities(title),
        url: typeof o.url === "string" ? o.url : `https://www.magazineluiza.com.br/`,
        price: n,
      });
    }
  }
  for (const v of Object.values(o)) {
    if (typeof v === "object") findProducts(v, acc);
  }
  return acc;
}
