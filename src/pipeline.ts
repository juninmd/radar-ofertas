import { config } from "./config.ts";
import { log } from "./log.ts";
import { classify, keywords } from "./category.ts";
import { crawlAll } from "./crawlers/index.ts";
import {
  dealById,
  insertDeal,
  insertPrice,
  priceStats,
  upsertProduct,
} from "./db.ts";
import { evaluate } from "./deal.ts";
import { analyzeDeal } from "./ai.ts";
import { notifyDeal } from "./telegram.ts";

export interface CycleResult {
  scraped: number;
  deals: number;
  notified: number;
}

// Executa um ciclo completo: coleta -> grava histórico -> avalia oferta ->
// IA -> Telegram. Idempotente em relação ao schema; cada execução adiciona um
// ponto na série temporal de cada produto.
export async function runCrawlCycle(): Promise<CycleResult> {
  const products = await crawlAll();
  let dealCount = 0;
  let notified = 0;

  for (const p of products) {
    const category = classify(p.title);
    const productId = upsertProduct(p, category);
    insertPrice(productId, p.price);

    const stats = priceStats(productId);
    const evalResult = evaluate(p.price, stats, p.title, category);
    if (!evalResult.isDeal) continue;

    const shouldNotify = evalResult.score >= config.notifyScore;
    let aiComment: string | null = null;
    if (shouldNotify) {
      aiComment = await analyzeDeal(p.title, p.source, evalResult);
    }

    const dealId = insertDeal({
      productId,
      price: evalResult.price,
      avg: evalResult.avg,
      discountPct: evalResult.discountPct,
      zscore: evalResult.zscore,
      score: evalResult.score,
      reasons: evalResult.reasons.join(" | "),
      aiComment,
      notified: false,
    });
    dealCount++;

    log.info(
      `OFERTA #${dealId} ${p.source} "${p.title}" R$${p.price.toFixed(2)} ` +
        `(-${evalResult.discountPct.toFixed(1)}%, score ${(evalResult.score * 100).toFixed(0)}) ` +
        `kw=[${keywords(p.title).join(",")}]`,
    );

    if (shouldNotify) {
      const view = dealById(dealId);
      if (view) {
        const ok = await notifyDeal(view);
        if (ok) notified++;
      }
    }
  }

  log.info(
    `ciclo: ${products.length} coletados, ${dealCount} ofertas, ${notified} notificadas`,
  );
  return { scraped: products.length, deals: dealCount, notified };
}
