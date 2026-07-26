import { config } from "../config.ts";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { getSearchQueries } from "../db.ts";
import { crawlMagalu, crawlMercadoLivre, crawlAmazon } from "./sites.ts";
import {
  crawlMercadoLivreBrowser,
  crawlAmazonBrowser,
  crawlShopeeBrowser,
  crawlAliExpressBrowser,
  crawlKabumBrowser,
  crawlMagaluBrowser,
} from "./browser.ts";
import { crawlCasasBahia, crawlPontofrio, crawlExtra } from "./extra.ts";
import { crawlZoom, crawlBuscape } from "./mosaico.ts";

type Crawler = (q: string, max: number) => Promise<ScrapedProduct[]>;

// Aborta uma chamada de crawler que passe do teto. O browser pendurado por trás
// pode até vazar, mas o ciclo segue e notifica as ofertas já coletadas.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

const REAL: Record<string, Crawler> = {
  magalu: crawlMagalu,
  mercadolivre: crawlMercadoLivre,
  amazon: crawlAmazon,
  casasbahia: crawlCasasBahia,
  pontofrio: crawlPontofrio,
  extra: crawlExtra,
  zoom: crawlZoom,
  buscape: crawlBuscape,
  // browser-only: a entrada "primária" já é o crawler de browser
  kabum: crawlKabumBrowser,
  shopee: crawlShopeeBrowser,
  aliexpress: crawlAliExpressBrowser,
};

const BROWSER_CRAWLERS: Record<string, Crawler> = {
  mercadolivre: crawlMercadoLivreBrowser,
  amazon: crawlAmazonBrowser,
  magalu: crawlMagaluBrowser,
};

// Descarta o que não é produto utilizável antes de virar histórico de preço:
// preço inválido/absurdo, título degenerado, URL quebrada e "preço de" incoerente.
// Não filtra por preço baixo: bug de precificação é um alvo do projeto.
const MAX_PLAUSIBLE_PRICE = 1_000_000;

export function sanitize(items: ScrapedProduct[]): ScrapedProduct[] {
  const seen = new Set<string>();
  const out: ScrapedProduct[] = [];
  for (const p of items) {
    if (!p?.source || !p.externalId || !p.title || !p.url) continue;
    if (p.title.trim().length < 6) continue;
    if (!/^https?:\/\//.test(p.url)) continue;
    if (!Number.isFinite(p.price) || p.price <= 0 || p.price > MAX_PLAUSIBLE_PRICE) continue;
    const key = `${p.source}:${p.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const listPrice =
      Number.isFinite(p.listPrice as number) && (p.listPrice as number) > p.price
        ? p.listPrice
        : undefined;
    out.push({ ...p, title: p.title.trim(), listPrice });
  }
  return out;
}

// Coleta de uma fonte: consultas em série (throttle por host), HTTP -> browser.
async function crawlSource(source: string, queries: string[]): Promise<ScrapedProduct[]> {
  const real = REAL[source];
  if (!real) {
    log.warn(`fonte desconhecida: ${source}`);
    return [];
  }
  const collected: ScrapedProduct[] = [];
  for (const query of queries) {
    let items: ScrapedProduct[] = [];
    try {
      items = await withTimeout(real(query, config.maxPerQuery), config.crawlTimeoutMs, `${source}/${query}`);
    } catch (e) {
      log.warn(`crawl ${source}/${query} falhou`, (e as Error).message);
    }

    if (items.length === 0 && BROWSER_CRAWLERS[source]) {
      try {
        log.debug(`browser fallback ${source}/${query}...`);
        items = await withTimeout(
          BROWSER_CRAWLERS[source](query, config.maxPerQuery),
          config.crawlTimeoutMs,
          `${source}/${query} (browser)`,
        );
      } catch (e) {
        log.warn(`browser crawl ${source}/${query} falhou`, (e as Error).message);
      }
    }

    if (items.length > 0) log.info(`[real] ${source}/${query} -> ${items.length}`);
    else log.warn(`[real] ${source}/${query} -> 0 (site bloqueou/sem dados)`);
    collected.push(...items);

    // Throttling defensivo por host para evitar HTTP 429 / Akamai.
    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000));
  }
  return collected;
}

// Executa tarefas com teto de concorrência (fontes distintas = hosts distintos,
// o throttle que importa é o de dentro de cada fonte).
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

// Coleta 100% real: fontes em paralelo, consultas em série dentro da fonte.
export async function crawlAll(): Promise<ScrapedProduct[]> {
  const queries = getSearchQueries();
  const started = Date.now();

  const perSource = await withConcurrency(
    config.sources.map((source) => async () => {
      try {
        return await crawlSource(source, queries);
      } catch (e) {
        log.warn(`fonte ${source} abortada`, (e as Error).message);
        return [] as ScrapedProduct[];
      }
    }),
    config.crawlConcurrency,
  );

  const raw = perSource.flat();
  const all = sanitize(raw);
  const dropped = raw.length - all.length;
  log.info(
    `crawl total: ${all.length} produtos válidos` +
      (dropped > 0 ? ` (${dropped} descartados)` : "") +
      ` em ${Math.round((Date.now() - started) / 1000)}s`,
  );
  return all;
}
