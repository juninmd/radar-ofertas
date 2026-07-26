import type { ScrapedProduct } from "../types.ts";
import { decodeEntities, extractNextData, fetchHtml, parseMoney } from "./base.ts";
import { log } from "../log.ts";

// ── Comparadores Mosaico (Zoom / Buscapé) ───────────────────────────────────
// Ambos rodam a mesma plataforma: a busca é Next.js e traz os resultados já
// resolvidos em __NEXT_DATA__ (props.initialReduxState.hits.hits), com o MENOR
// preço de mercado entre as lojas parceiras. São fontes de agregação: um único
// GET devolve ~30 produtos com preço válido, sem anti-bot e sem browser.

interface MosaicoHit {
  sourceId?: string | number;
  objectID?: string;
  objectId?: string;
  name?: string;
  shortName?: string;
  price?: unknown;
  image?: string;
  url?: string;
  storeCount?: number;
  bestOffer?: { merchantName?: string };
}

function hits(data: unknown): MosaicoHit[] {
  const list = (data as any)?.props?.initialReduxState?.hits?.hits;
  return Array.isArray(list) ? list : [];
}

// O WAF da plataforma devolve 403 para termos que casam com padrão de injeção de
// shell — "echo dot" cai na regra do comando `echo `. A regra é case-sensitive,
// então a mesma busca em Title Case passa e devolve os mesmos resultados.
function titleCase(query: string): string {
  return query.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

async function search(host: string, query: string): Promise<MosaicoHit[]> {
  const html = await fetchHtml(`https://${host}/search?q=${encodeURIComponent(query)}`);
  return html ? hits(extractNextData(html)) : [];
}

async function crawlMosaico(host: string, source: string, query: string, max: number): Promise<ScrapedProduct[]> {
  let list = await search(host, query);
  if (list.length === 0) {
    const alt = titleCase(query);
    if (alt !== query) {
      log.debug(`${source} "${query}" bloqueado/vazio; tentando "${alt}"`);
      list = await search(host, alt);
    }
  }
  if (list.length === 0) {
    log.debug(`${source} "${query}" -> sem hits`);
    return [];
  }

  const out: ScrapedProduct[] = [];
  for (const h of list) {
    if (out.length >= max) break;
    const title = h.name ?? h.shortName;
    const id = h.sourceId ?? h.objectID ?? h.objectId;
    const price = parseMoney(h.price);
    if (typeof title !== "string" || !title.trim() || id == null) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    if (typeof h.url !== "string" || !h.url) continue;

    out.push({
      source,
      externalId: String(id),
      title: decodeEntities(title.trim()),
      url: h.url.startsWith("http") ? h.url : `https://${host}${h.url}`,
      image: h.image,
      price,
      query,
      imageSource: "real",
    });
  }
  log.debug(`${source} "${query}" -> ${out.length} itens`);
  return out;
}

export const crawlZoom = (q: string, max: number) => crawlMosaico("www.zoom.com.br", "zoom", q, max);
export const crawlBuscape = (q: string, max: number) => crawlMosaico("www.buscape.com.br", "buscape", q, max);
