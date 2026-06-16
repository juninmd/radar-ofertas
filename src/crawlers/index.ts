import { config } from "../config.ts";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { demoProducts } from "./demo.ts";
import { crawlAmazon, crawlMagalu, crawlMercadoLivre } from "./sites.ts";
import { crawlAmazonBrowser, crawlMercadoLivreBrowser } from "./browser.ts";

type Crawler = (q: string, max: number) => Promise<ScrapedProduct[]>;
const REAL: Record<string, Crawler> = {
  mercadolivre: crawlMercadoLivre,
  amazon: crawlAmazon,
  magalu: crawlMagalu,
};

// Fallback browsers for sites that block simple HTTP crawlers
const BROWSER_CRAWLERS: Record<string, Crawler> = {
  mercadolivre: crawlMercadoLivreBrowser,
  amazon: crawlAmazonBrowser,
};

// tick global crescente p/ o gerador demo simular variação de preço ao longo
// das execuções (persistido em arquivo simples).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const tickFile = `${dirname(config.dbPath)}/.tick`;
function nextTick(): number {
  let t = 0;
  try {
    if (existsSync(tickFile)) t = Number(readFileSync(tickFile, "utf8")) || 0;
  } catch {}
  t += 1;
  try {
    mkdirSync(dirname(tickFile), { recursive: true });
    writeFileSync(tickFile, String(t));
  } catch {}
  return t;
}

export async function crawlAll(): Promise<ScrapedProduct[]> {
  const tick = nextTick();
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

      // Browser crawling disabled for Alpine containers
      // (Playwright Chromium not compatible; use real crawlers or demo fallback)

      // Final fallback to demo if both HTTP and browser failed
      if (items.length === 0 && config.allowDemoFallback) {
        items = demoProducts(query, source, tick);
        log.info(`[demo] ${source}/${query} -> ${items.length} (site bloqueou/sem dados)`);
      } else if (items.length > 0 && !items[0].title.includes("Demo")) {
        log.info(`[real] ${source}/${query} -> ${items.length}`);
      }
      all.push(...items);
    }
  }
  log.info(`crawl total: ${all.length} produtos (tick ${tick})`);
  return all;
}
