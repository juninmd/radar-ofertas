import { config } from "./config.ts";
import { log } from "./log.ts";
import { runCrawlCycle } from "./pipeline.ts";
import { startServer } from "./server.ts";
import { seasonTuning } from "./season.ts";

async function main() {
  log.info(
    `radar-ofertas iniciando | modo=${config.runMode} fontes=[${config.sources.join(",")}] ` +
      `queries=${config.queries.length} telegram=${config.telegram.enabled} litellm=${config.litellm.enabled}`,
  );

  if (config.runMode === "CRAWL") {
    const r = await runCrawlCycle();
    log.info(`CRAWL concluído: ${JSON.stringify(r)}`);
    const { closeBrowser } = await import("./crawlers/browser.ts");
    await closeBrowser();
    process.exit(0);
  }

  // SERVER: sobe a API/dashboard e agenda ciclos internos (opcional)
  startServer();

  // Agenda dinâmica: o intervalo é recalculado a cada ciclo, então a coleta
  // acelera sozinha ao entrar na Black November / semana da Black Friday.
  if (config.crawlIntervalMin > 0) {
    const tick = async () => {
      try {
        await runCrawlCycle();
      } catch (e) {
        log.error("ciclo falhou", (e as Error).message);
      }
      const { crawlIntervalMin, season } = seasonTuning();
      log.info(`próximo ciclo em ${crawlIntervalMin}min${season.active ? ` (${season.label})` : ""}`);
      setTimeout(() => void tick(), crawlIntervalMin * 60_000);
    };
    void tick();
  }
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
