import { config } from "./config.ts";
import { log } from "./log.ts";
import { runCrawlCycle } from "./pipeline.ts";
import { startServer } from "./server.ts";

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

  const intervalMin = config.crawlIntervalMin;
  if (intervalMin > 0) {
    log.info(`ciclo contínuo agendado a cada ${intervalMin}min`);
    const tick = async () => {
      try {
        await runCrawlCycle();
      } catch (e) {
        log.error("ciclo falhou", (e as Error).message);
      }
    };
    void tick();
    setInterval(() => void tick(), intervalMin * 60_000);
  }
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
