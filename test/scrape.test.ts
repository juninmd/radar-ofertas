import { afterEach, describe, expect, it } from "bun:test";
import { sanitize } from "../src/crawlers/index.ts";
import { crawlCasasBahia } from "../src/crawlers/extra.ts";
import { config } from "../src/config.ts";

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });

const vtex = (n: number, off = 0) =>
  Array.from({ length: n }, (_, i) => ({
    productId: String(off + i), productName: `Produto de teste ${off + i}`, link: `https://x.com.br/p${off + i}/p`,
    items: [{ images: [{ imageUrl: "https://i/x.jpg" }], sellers: [{ commertialOffer: { Price: 100, ListPrice: 150 } }] }],
  }));

describe("scrap", () => {
  it("limites default >= 5000", () => {
    expect(config.maxDealsApi).toBeGreaterThanOrEqual(5000);
    expect(config.queries.length).toBeGreaterThan(60);
    expect(config.sources.indexOf("aliexpress")).toBe(-1);
  });
  it("VTEX pagina até pagesPerQuery", async () => {
    let calls = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify(vtex(50, calls++ * 50)))) as any;
    const r = await crawlCasasBahia("tv", 500);
    expect(calls).toBe(config.pagesPerQuery);
    expect(r.length).toBe(50 * config.pagesPerQuery);
  });
  it("sanitize descarta lixo e 'de' absurdo", () => {
    const base = { source: "a", externalId: "1", url: "https://a.com.br/p", imageSource: "real" as const, query: "q" };
    const out = sanitize([
      { ...base, title: "Smart TV 55 polegadas", price: 100, listPrice: 9000 },
      { ...base, externalId: "2", title: "12345 678", price: 10 },
      { ...base, externalId: "3", title: "Geladeira Frost Free", price: -1 },
    ] as any);
    expect(out.length).toBe(1);
    expect(out[0].listPrice).toBeUndefined();
  });
});
