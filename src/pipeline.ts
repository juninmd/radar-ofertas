import { log } from "./log.ts";
import { crawlAll } from "./crawlers/index.ts";
import { DealService, type Candidate } from "./services.ts";
import { buildMarket } from "./market.ts";
import { seasonTuning } from "./season.ts";
import type { ScrapedProduct } from "./types.ts";

export interface CycleResult {
  scraped: number;
  deals: number;
  notified: number;
  attempted?: number; // envios tentados (limitados pelo teto do ciclo)
  season?: string;
}

const dealService = new DealService();
let running: Promise<CycleResult> | null = null;

export function isCycleRunning(): boolean {
  return running !== null;
}

// Um ciclo por vez: na Black Friday o intervalo cai para 15min e um ciclo
// lento + POST /api/crawl não podem rodar em paralelo (dobrava envios e carga).
// `crawl` é injetável para testar o ciclo inteiro sem rede.
export type Crawl = (extraQueries: string[]) => Promise<ScrapedProduct[]>;

export function runCrawlCycle(crawl: Crawl = crawlAll): Promise<CycleResult> {
  if (running) {
    log.warn("ciclo já em andamento; reaproveitando o atual");
    return running;
  }
  running = cycle(crawl).finally(() => {
    running = null;
  });
  return running;
}

async function cycle(crawl: Crawl): Promise<CycleResult> {
  const tuning = seasonTuning();
  const { season } = tuning;
  if (season.active) log.info(`🖤 temporada ${season.label} (BF em ${season.daysToBlackFriday}d)`);

  const products = await crawl(tuning.extraQueries);
  const marketFor = buildMarket(products);

  // Fase 1: grava histórico e avalia TUDO antes de decidir o que notificar.
  const candidates: Candidate[] = [];
  let dealCount = 0;
  for (const p of products) {
    try {
      const { dealId, candidate } = await dealService.evaluateAndStore(p, { market: marketFor(p), season });
      if (dealId) dealCount++;
      if (candidate) candidates.push(candidate);
    } catch (e) {
      // Falha de um produto (rede/IA/Telegram) não pode abortar o lote inteiro.
      log.error(`produto falhou (${p.source}:${p.externalId ?? "?"})`, (e as Error).message);
    }
  }

  // Fase 2: o orçamento de mensagens vai para as MELHORES ofertas do ciclo
  // (score = desconto real × popularidade × afinidade), não para as primeiras.
  candidates.sort((a, b) => b.score - a.score || b.discountPct - a.discountPct);
  const cap = tuning.maxNotificationsPerCycle;
  let attempts = 0;
  let notified = 0;
  for (const c of candidates) {
    if (attempts >= cap) break;
    try {
      const r = await dealService.notify(c);
      if (r.attempted) attempts++;
      if (r.notified) notified++;
    } catch (e) {
      log.error(`notificação falhou (deal ${c.dealId})`, (e as Error).message);
    }
  }

  log.info(
    `ciclo: ${products.length} coletados, ${dealCount} ofertas, ${candidates.length} candidatas, ${notified} notificadas` +
      (candidates.length > cap ? ` (teto de ${cap} envios/ciclo)` : ""),
  );
  return { scraped: products.length, deals: dealCount, notified, attempted: attempts, season: season.active ? season.label : undefined };
}
