import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-redeal-")), "test.sqlite");
process.env.TELEGRAM_ENABLED = "false";
process.env.LITELLM_ENABLED = "false";
process.env.CLUSTER_DATABASE_URL = "";
process.env.SEASON_MODE = "off";

let service: any;
let repos: typeof import("../src/repositories.ts");

beforeAll(async () => {
  repos = await import("../src/repositories.ts");
  service = new (await import("../src/services.ts")).DealService();
});

const produto = (id: string, price: number) => ({
  source: "amazon", externalId: id, title: `Smart TV 55 Teste ${id}`,
  url: `https://www.amazon.com.br/dp/${id}`, price, listPrice: 4000, query: "smart tv",
});

describe("re-oferta e estatística", () => {
  test("preço que CAI MAIS gera nova oferta; igual não", async () => {
    const id = `RD${Date.now()}`;
    const a = await service.processScrapedProduct(produto(id, 2800), false);
    const same = await service.processScrapedProduct(produto(id, 2790), false);
    const lower = await service.processScrapedProduct(produto(id, 2500), false);
    expect(a.dealId).toBeNumber();
    expect(same.dealId).toBeNull();
    expect(lower.dealId).toBeNumber();
    const top = service.getTopDeals(24, 50).filter((d: any) => d.title.includes(id));
    expect(top).toHaveLength(1); // ranking mostra 1 por produto (a mais recente)
    expect(top[0].flags).toContain("caiu-mais");
  });

  test("stats robustas: mediana, janela e baseline pré-evento", () => {
    const pr = new repos.PriceRepository();
    const prod = new repos.ProductRepository();
    const pid = prod.upsert({ ...produto(`ST${Date.now()}`, 100), listPrice: undefined } as any, "tv-audio");
    const db = (pr as any).db;
    const ins = db.query("INSERT INTO price_history (product_id, price, captured_at) VALUES ($p, $v, $t)");
    for (const [v, t] of [[100, "2026-10-10 10:00:00"], [100, "2026-10-12 10:00:00"], [102, "2026-10-20 10:00:00"],
                           [140, "2026-11-05 10:00:00"], [140, "2026-11-08 10:00:00"], [1000, "2026-11-09 10:00:00"]] as const)
      ins.run({ $p: pid, $v: v, $t: t });
    const st = pr.getStats(pid, {
      days: 60, now: Date.parse("2026-11-10T00:00:00Z"),
      preEventCutoff: new Date("2026-11-01T00:00:00Z"), preEventDays: 60,
    });
    expect(st.count).toBe(6);
    expect(st.median).toBe(121); // pico de R$1000 não arrasta a referência
    expect(st.preEventMedian).toBe(100);
    expect(st.olderMedian).toBe(100);
    expect(st.spanHours).toBeGreaterThan(24 * 20);
  });
});

describe("preço 'de' sem confirmação de mercado", () => {
  test("grava a oferta mas não a candidata a notificação", async () => {
    const id = `LP${Date.now()}`;
    const solo = await service.evaluateAndStore(produto(id, 2000));
    expect(solo.dealId).toBeNumber();
    expect(solo.candidate).toBeNull();
    const id2 = `LP2${Date.now()}`;
    const confirmed = await service.evaluateAndStore(produto(id2, 2000), {
      market: { minOther: 2100, source: "magalu", stores: 2 },
    });
    expect(confirmed.candidate).not.toBeNull();
  });
});

// Reset SEASON_MODE after tests to prevent affecting other tests
test.afterAll(() => {
  process.env.SEASON_MODE = "auto";
});