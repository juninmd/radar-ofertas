import { log } from "./log.ts";
import { crawlAll } from "./crawlers/index.ts";
import { DealService } from "./services.ts";

export interface CycleResult {
  scraped: number;
  deals: number;
  notified: number;
}

const dealService = new DealService();

export async function runCrawlCycle(): Promise<CycleResult> {
  const products = await crawlAll();
  let dealCount = 0;
  let notified = 0;

  for (const p of products) {
    const { dealId, notified: didNotify } = await dealService.processScrapedProduct(p);
    if (dealId) dealCount++;
    if (didNotify) notified++;
  }

  log.info(
    `ciclo: ${products.length} coletados, ${dealCount} ofertas, ${notified} notificadas`,
  );
  return { scraped: products.length, deals: dealCount, notified };
}
