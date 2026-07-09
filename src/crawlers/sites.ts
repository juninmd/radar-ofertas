import type { ScrapedProduct } from "../types.ts";
import { cleanMlUrl, decodeEntities, fetchHtml, parseBrl } from "./base.ts";
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

export async function crawlAmazon(query: string, max: number): Promise<ScrapedProduct[]> {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html || html.length < 5000) {
    log.debug(`Amazon "${query}" bloqueado ou sem dados (${html?.length || 0} bytes)`);
    return [];
  }
  const out: ScrapedProduct[] = [];

  // Try multiple block delimiters for robustness
  let blocks = html.split('data-asin="').slice(1);
  if (blocks.length < 2) blocks = html.split('data-component-type="s-search-result"').slice(1);

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
    if (!titleM) titleM = b.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]{6,})</);
    if (!titleM) titleM = b.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{6,})</);

    // Try multiple price patterns
    let priceM = b.match(/a-price-whole">([\d.]+)<\/span><span class="a-price-fraction">(\d{2})/);
    if (!priceM) priceM = b.match(/data-a-price="([\d.]+)"/);
    if (!priceM) priceM = b.match(/price["\s]*:?\s*["\']?([\d.,]+)["\']?/i);

    if (!titleM) continue;
    const price = priceM
      ? parseBrl(typeof priceM[1] === "string" && priceM[1].includes(",") ? priceM[1] : `${priceM[1]},00`)
      : NaN;
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
  log.debug(`Amazon "${query}" -> ${out.length} itens (${html.length} bytes)`);
  return out;
}

export async function crawlMagalu(query: string, max: number): Promise<ScrapedProduct[]> {
  // Substitui espaços por + para evitar redirecionamento (que aciona bloqueio do Akamai)
  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query.replace(/\s+/g, "+"))}/`;
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
export function findProducts(node: unknown, acc: Omit<ScrapedProduct, "query">[] = []): Omit<ScrapedProduct, "query">[] {
  if (acc.length >= 40 || node == null || typeof node !== "object") return acc;
  const o = node as Record<string, unknown>;
  const title = o.title ?? o.name;
  const priceObj = o.price as Record<string, unknown> | undefined;
  const price = priceObj?.bestPrice ?? o.bestPrice ?? o.price;
  const listRaw = priceObj?.listPrice ?? priceObj?.fullPrice ?? o.listPrice;
  const id = o.id ?? o.productId ?? o.sku;
  
  if (typeof title === "string" && (typeof price === "number" || typeof price === "string") && id != null) {
    const n = typeof price === "number" ? price / 100 : Number(String(price).replace(/[^\d]/g, "")) / 100;
    if (Number.isFinite(n) && n > 0) {
      // Extrai imagem de forma robusta suportando strings, arrays e objetos aninhados
      const img = (o.image ?? o.images ?? (o.media as Record<string, unknown>)?.path ?? o.imageUrl) as unknown;
      let imageUrl: string | undefined;
      if (typeof img === "string") {
        imageUrl = img;
      } else if (Array.isArray(img) && img.length > 0) {
        const first = img[0];
        if (typeof first === "string") {
          imageUrl = first;
        } else if (first && typeof first === "object") {
          imageUrl = (first.path ?? first.url ?? first.imageUrl) as string | undefined;
        }
      } else if (img && typeof img === "object") {
        imageUrl = ((img as any).path ?? (img as any).url ?? (img as any).imageUrl) as string | undefined;
      }

      // Garante imagem absoluta caso seja protocol-relative ou relativa
      if (imageUrl && imageUrl.startsWith("//")) {
        imageUrl = "https:" + imageUrl;
      } else if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = "https://www.magazineluiza.com.br" + imageUrl;
      }

      // Constrói URL do produto canônica robustamente caso a original seja nula ou incompleta
      let rawUrl = o.url ?? o.path ?? o.slug ?? o.canonical;
      if (typeof rawUrl !== "string") {
        rawUrl = `/p/${id}/`;
      }

      const lp = typeof listRaw === "number" ? listRaw / 100 : typeof listRaw === "string" ? Number(listRaw.replace(/[^\d]/g, "")) / 100 : NaN;
      acc.push({
        source: "magalu",
        externalId: String(id),
        title: decodeEntities(title),
        url: absoluteUrl(rawUrl, "https://www.magazineluiza.com.br"),
        image: imageUrl,
        price: n,
        listPrice: Number.isFinite(lp) && lp > n ? lp : undefined,
        imageSource: "real",
      });
    }
  }
  for (const v of Object.values(o)) {
    if (typeof v === "object") findProducts(v, acc);
  }
  return acc;
}
