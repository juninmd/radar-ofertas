import { config } from "../config.ts";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { crawlMagalu, crawlMercadoLivre, crawlAmazon } from "./sites.ts";
import { crawlMercadoLivreBrowser, crawlAmazonBrowser } from "./browser.ts";

type Crawler = (q: string, max: number) => Promise<ScrapedProduct[]>;

const REAL: Record<string, Crawler> = {
  magalu: crawlMagalu,
  mercadolivre: crawlMercadoLivre,
  amazon: crawlAmazon,
};

const BROWSER_CRAWLERS: Record<string, Crawler> = {
  mercadolivre: crawlMercadoLivreBrowser,
  amazon: crawlAmazonBrowser,
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
    for (const query of config.queries) {
      let items: ScrapedProduct[] = [];
      try {
        items = await real(query, config.maxPerQuery);
      } catch (e) {
        log.warn(`crawl ${source}/${query} falhou`, (e as Error).message);
      }

      // Fallback to browser crawling if HTTP crawl returned nothing
      if (items.length === 0 && BROWSER_CRAWLERS[source]) {
        try {
          log.debug(`browser fallback ${source}/${query}...`);
          items = await BROWSER_CRAWLERS[source](query, config.maxPerQuery);
        } catch (e) {
          log.warn(`browser crawl ${source}/${query} falhou`, (e as Error).message);
        }
      }

      if (items.length > 0) log.info(`[real] ${source}/${query} -> ${items.length}`);
      else log.warn(`[real] ${source}/${query} -> 0 (site bloqueou/sem dados)`);
      all.push(...items);
    }
  }
  log.info(`crawl total: ${all.length} produtos`);
  return all;
}
