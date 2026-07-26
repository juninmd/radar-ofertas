import { expect, test, describe } from "bun:test";
import { crawlZoom, crawlBuscape } from "../src/crawlers/mosaico.ts";
import { sanitize } from "../src/crawlers/index.ts";

// Rede real: comparadores respondem em ~1 GET. Se a fonte cair, o teste tolera
// zero resultados (mesma política de browser.test.ts) mas nunca dado inválido.
describe("comparadores Mosaico (rede real)", () => {
  for (const [name, crawl] of [
    ["zoom", crawlZoom],
    ["buscape", crawlBuscape],
  ] as const) {
    test(`${name} devolve produtos com preço em reais`, async () => {
      const items = await crawl("monitor gamer", 5);
      if (items.length === 0) {
        console.warn(`${name} devolveu 0 itens - fonte indisponível`);
        return;
      }
      expect(items.length).toBeLessThanOrEqual(5);
      expect(sanitize(items)).toHaveLength(items.length);
      for (const p of items) {
        expect(p.source).toBe(name);
        expect(p.price).toBeGreaterThan(10); // reais, não centavos
        expect(p.price).toBeLessThan(100_000);
        expect(p.url).toStartWith(`https://www.${name === "zoom" ? "zoom" : "buscape"}.com.br/`);
        expect(p.externalId).toBeTruthy();
        expect(p.title.length).toBeGreaterThan(5);
      }
    }, 30_000);
  }

  test("query bloqueada pelo WAF ('echo dot') é recuperada via retry", async () => {
    const items = await crawlZoom("echo dot", 3);
    if (items.length === 0) {
      console.warn("zoom devolveu 0 itens - fonte indisponível");
      return;
    }
    expect(items.some((p) => /echo/i.test(p.title))).toBe(true);
  }, 30_000);
});
