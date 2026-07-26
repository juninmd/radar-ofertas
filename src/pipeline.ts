import { log } from "./log.ts";
import { config } from "./config.ts";
import { crawlAll } from "./crawlers/index.ts";
import { DealService } from "./services.ts";

export interface CycleResult {
  scraped: number;
  deals: number;
  notified: number;
}

const dealService = new DealService();

// Desconto anunciado (preço "de"), usado só para ordenar quem disputa o teto de
// notificações — produto sem preço "de" fica por último, mas ainda é processado.
function advertisedDiscount(p: { price: number; listPrice?: number }): number {
  if (!p.listPrice || p.listPrice <= p.price) return 0;
  return (p.listPrice - p.price) / p.listPrice;
}

export async function runCrawlCycle(): Promise<CycleResult> {
  const products = await crawlAll();
  let dealCount = 0;
  let notified = 0;

  // Maior desconto anunciado primeiro: com teto por ciclo, o orçamento de
  // notificação vai para as ofertas mais promissoras, não para as primeiras.
  const ordered = [...products].sort((a, b) => advertisedDiscount(b) - advertisedDiscount(a));

  let attempts = 0;
  for (const p of ordered) {
    try {
      const allowNotify = attempts < config.maxNotificationsPerCycle;
      const { dealId, notified: didNotify, notifyAttempted } =
        await dealService.processScrapedProduct(p, allowNotify);
      if (dealId) dealCount++;
      if (notifyAttempted) attempts++;
      if (didNotify) notified++;
    } catch (e) {
      // Falha de um produto (rede/IA/Telegram) não pode abortar o lote inteiro,
      // senão as demais promoções nunca chegam ao Telegram.
      log.error(`produto falhou (${p.source}:${p.externalId ?? "?"})`, (e as Error).message);
    }
  }

  log.info(
    `ciclo: ${products.length} coletados, ${dealCount} ofertas, ${notified} notificadas` +
      (attempts >= config.maxNotificationsPerCycle
        ? ` (teto de ${config.maxNotificationsPerCycle} envios/ciclo atingido)`
        : ""),
  );
  return { scraped: products.length, deals: dealCount, notified };
}
