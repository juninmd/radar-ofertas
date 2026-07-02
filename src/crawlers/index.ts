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

// Coleta 100% real: HTTP -> fallback browser. Sem dados mock.
export async function crawlAll(): Promise<ScrapedProduct[]> {
  const all: ScrapedProduct[] = [];
  for (const source of config.sources) {
    const real = REAL[source];
    if (!real) {
      log.warn(`fonte desconhecida: ${source}`);
      continue;
    }
    const queries = getSearchQueries();
    for (const query of queries) {
      let items: ScrapedProduct[] = [];
      try {
        items = await withTimeout(
          real(query, config.maxPerQuery),
          config.crawlTimeoutMs,
          `${source}/${query}`,
        );
      } catch (e) {
        log.warn(`crawl ${source}/${query} falhou`, (e as Error).message);
      }

      // Fallback to browser crawling if HTTP crawl returned nothing
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
      all.push(...items);

      // Throttling defensivo para evitar blocks por "Too Many Requests" (HTTP 429) e Akamai
      await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000));
    }
  }
  log.info(`crawl total: ${all.length} produtos`);
  return all;
}
