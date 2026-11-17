import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ScrapedProduct } from "../src/types.ts";

// Ensaio do modo Black Friday: ciclo completo (coleta → avaliação → teto de
// envios) com SEASON_MODE=force, sem rede, sem Telegram e sem IA.
process.env.DB_PATH ??= join(mkdtempSync(join(tmpdir(), "radar-bf-")), "test.sqlite");
process.env.TELEGRAM_ENABLED = "false";
process.env.LITELLM_ENABLED = "false";
process.env.CLUSTER_DATABASE_URL = "";

let config: any;
let pipeline: typeof import("../src/pipeline.ts");
let seasonTuning: typeof import("../src/season.ts").seasonTuning;
let buildCaption: typeof import("../src/telegram.ts").buildCaption;
const saved: Record<string, unknown> = {};

beforeAll(async () => {
  ({ config } = await import("../src/config.ts"));
  // config é lido uma vez por processo; o bun test compartilha o processo entre
  // arquivos, então o modo é ajustado em runtime e restaurado no fim.
  saved.mode = config.season.mode;
  saved.cap = config.season.maxNotificationsPerCycle;
  saved.baseCap = config.maxNotificationsPerCycle;
  saved.queries = config.season.queries;
  saved.listPriceNotify = config.listPriceNotify;
  config.season.mode = "force";
  config.season.maxNotificationsPerCycle = 3;
  config.maxNotificationsPerCycle = 2; // teto efetivo = max(normal, BF) = 3
  config.season.queries = ["black friday notebook", "black friday tv"];
  pipeline = await import("../src/pipeline.ts");
  ({ seasonTuning } = await import("../src/season.ts"));
  ({ buildCaption } = await import("../src/telegram.ts"));
});

afterAll(() => {
  config.season.mode = saved.mode;
  config.season.maxNotificationsPerCycle = saved.cap;
  config.maxNotificationsPerCycle = saved.baseCap;
  config.season.queries = saved.queries;
  config.listPriceNotify = saved.listPriceNotify;
});

const run = `bf-${Date.now()}`;
// Produtos distintos (sem casar no mercado) com preço "de" 60% acima: no
// 1º ciclo viram oferta pela régua de temporada (≥30% de desconto).
function lote(n: number): ScrapedProduct[] {
  const marcas = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  return Array.from({ length: n }, (_, i) => ({
    source: "magalu",
    externalId: `${run}-${i}`,
    title: `${marcas[i % marcas.length]} Liquidificador Modelo ${run}-${i}`,
    url: `https://www.magazineluiza.com.br/p/${run}-${i}/`,
    price: 100 + i,
    listPrice: 250 + i,
    query: "teste",
    imageSource: "real" as const,
  }));
}

describe("modo Black Friday forçado", () => {
  test("temporada ativa em pico, com teto e termos extras", () => {
    const t = seasonTuning(new Date("2026-03-10T12:00:00Z"));
    expect(t.season).toMatchObject({ active: true, peak: true, label: "BLACK FRIDAY" });
    expect(t.maxNotificationsPerCycle).toBe(3);
    expect(t.extraQueries).toEqual(["black friday notebook", "black friday tv"]);
    expect(t.crawlIntervalMin).toBeLessThanOrEqual(config.season.peakCrawlIntervalMin || Infinity);
  });

  test("ciclo repassa BF_QUERIES ao crawler e marca a temporada", async () => {
    let recebido: string[] = [];
    const r = await pipeline.runCrawlCycle(async (q) => {
      recebido = q;
      return [];
    });
    expect(recebido).toEqual(["black friday notebook", "black friday tv"]);
    expect(r).toEqual({ scraped: 0, deals: 0, notified: 0, attempted: 0, season: "BLACK FRIDAY" });
  });

  test("ciclo grava todas as ofertas e respeita o teto de envios", async () => {
    config.listPriceNotify = "always"; // 1º ciclo: preço "de" já é candidato
    try {
      const r = await pipeline.runCrawlCycle(async () => lote(8));
      expect(r.scraped).toBe(8);
      expect(r.deals).toBe(8);
      expect(r.attempted).toBe(3); // 8 candidatas, teto BF de 3 envios
      expect(r.notified).toBe(0); // Telegram desligado: nenhuma mensagem sai
    } finally {
      config.listPriceNotify = saved.listPriceNotify;
    }
  });

  test("produto que quebra não derruba o lote", async () => {
    const ruim = { ...lote(1)[0], externalId: `${run}-ruim`, price: Number.NaN } as ScrapedProduct;
    const bom = { ...lote(1)[0], externalId: `${run}-bom`, title: `Kilo Batedeira ${run}` };
    const r = await pipeline.runCrawlCycle(async () => [ruim, bom]);
    expect(r.scraped).toBe(2);
    expect(r.deals).toBe(1); // o produto válido segue sendo avaliado
    expect(r.season).toBe("BLACK FRIDAY");
  });

  test("ciclos não se sobrepõem: 2ª chamada reaproveita a 1ª", async () => {
    let chamadas = 0;
    let solta!: () => void;
    const crawl = () => {
      chamadas++;
      return new Promise<ScrapedProduct[]>((res) => (solta = () => res([])));
    };
    const a = pipeline.runCrawlCycle(crawl);
    expect(pipeline.isCycleRunning()).toBe(true); // POST /api/crawl responde 409 aqui
    const b = pipeline.runCrawlCycle(crawl);
    expect(b).toBe(a);
    solta();
    await a;
    expect(chamadas).toBe(1);
    expect(pipeline.isCycleRunning()).toBe(false);
  });

  test("legenda do Telegram leva o selo 🖤 da temporada", () => {
    const caption = buildCaption({
      id: 1, product_id: -1, source: "magalu", category: "eletrodomesticos",
      title: "Liquidificador Teste", url: "https://x", image: null,
      price: 100, avg_price: 200, min_price: 90, max_price: 250, points: 5, discount_pct: 50, score: 0.8,
      flags: "", ai_comment: null, created_at: new Date().toISOString(),
    } as any);
    expect(caption).toContain("🖤 <b>BLACK FRIDAY</b>");
    expect(caption).toContain("-50%");
  });
});
