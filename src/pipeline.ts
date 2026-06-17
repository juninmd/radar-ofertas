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
    try {
      const { dealId, notified: didNotify } = await dealService.processScrapedProduct(p);
      if (dealId) dealCount++;
      if (didNotify) notified++;
    } catch (e) {
      // Falha de um produto (rede/IA/Telegram) não pode abortar o lote inteiro,
      // senão as demais promoções nunca chegam ao Telegram.
      log.error(`produto falhou (${p.source}:${p.externalId ?? "?"})`, (e as Error).message);
    }
  }

  log.info(
    `ciclo: ${products.length} coletados, ${dealCount} ofertas, ${notified} notificadas`,
  );
  return { scraped: products.length, deals: dealCount, notified };
}
