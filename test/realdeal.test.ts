import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/deal.ts";
import { popularity, parseCount, parseRating } from "../src/popularity.ts";
import { buildMarket } from "../src/market.ts";
import { parseMlBestsellers, parseAriaMoney } from "../src/crawlers/bestsellers.ts";
import type { PriceStats, ScrapedProduct } from "../src/types.ts";

const base: PriceStats = { count: 30, avg: 100, std: 5, min: 95, max: 110, median: 100, spanHours: 24 * 20 };
const season = { active: true, label: "BLACK FRIDAY", strictListPrice: true };

describe("oferta de verdade", () => {
  test("metade do dobro: subiu antes de baixar não vira oferta", () => {
    // ficou meses a R$100, subiu p/ R$140 nas últimas semanas, 'baixou' p/ R$99
    const st = { ...base, avg: 125, median: 140, olderMedian: 100 };
    const r = evaluate(99, st, "Air Fryer 4L", "eletroportateis");
    expect(r.flags).toContain("preco-maquiado");
    expect(r.avg).toBe(100);
    expect(r.isDeal).toBe(false);
  });

  test("Black Friday mede contra o preço pré-evento", () => {
    const st = { ...base, median: 120, preEventMedian: 100, preEventCount: 10 };
    const r = evaluate(95, st, "Air Fryer 4L", "eletroportateis", undefined, { season });
    expect(r.avg).toBe(100);
    expect(r.flags).toContain("preco-inflado-pre-evento");
    expect(r.isDeal).toBe(false); // 5% vs preço de outubro não é Black Friday de verdade
  });

  test("outra loja mais barata derruba a oferta", () => {
    const r = evaluate(70, base, "SSD 1TB", "armazenamento", undefined, {
      market: { minOther: 60, source: "kabum", stores: 2 },
    });
    expect(r.isDeal).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("mais-barato-em:kabum"))).toBe(true);
  });

  test("menor preço entre lojas e histórico ganha bônus", () => {
    const plain = evaluate(80, base, "SSD 1TB", "armazenamento");
    const best = evaluate(80, base, "SSD 1TB", "armazenamento", undefined, {
      market: { minOther: 85, source: "kabum", stores: 3 },
    });
    expect(best.flags).toContain("menor-entre-lojas");
    expect(best.flags).toContain("menor-preco-historico");
    expect(best.score).toBeGreaterThanOrEqual(plain.score);
  });

  test("histórico de poucas horas não conta como histórico", () => {
    const r = evaluate(70, { ...base, spanHours: 2 }, "SSD 1TB", "armazenamento");
    expect(r.reasons).toContain("historico-insuficiente");
  });

  test("preço 'de' na Black Friday exige desconto maior", () => {
    const empty: PriceStats = { count: 0, avg: 0, std: 0, min: 0, max: 0 };
    expect(evaluate(78, empty, "Fone Bluetooth", "tv-audio", 100).isDeal).toBe(true); // 22% fora da temporada
    expect(evaluate(78, empty, "Fone Bluetooth", "tv-audio", 100, { season }).isDeal).toBe(false);
  });

  test("mais vendido pontua mais que produto sem prova social", () => {
    const anon = evaluate(80, base, "Cafeteira", "eletroportateis", undefined, { popularity: popularity({}) });
    const hit = evaluate(80, base, "Cafeteira", "eletroportateis", undefined, {
      popularity: popularity({ bestSellerRank: 1, reviews: 12000, rating: 4.8 }),
    });
    expect(hit.score).toBeGreaterThan(anon.score);
    expect(hit.flags).toContain("mais-vendido");
  });
});

describe("popularidade", () => {
  test("sem dados é neutro; nota baixa penaliza", () => {
    expect(popularity({}).multiplier).toBe(1);
    expect(popularity({ rating: 3.2, reviews: 40 }).multiplier).toBeLessThan(1);
  });
  test("parse de contagens e notas", () => {
    expect(parseCount("+10mil vendidos")).toBe(10000);
    expect(parseCount("mil+ compras no mês passado")).toBe(1000);
    expect(parseCount("1.234")).toBe(1234);
    expect(parseCount("2,5 mil")).toBe(2500);
    expect(parseRating("4,7 de 5 estrelas")).toBe(4.7);
  });
});

describe("mercado (mesmo produto entre lojas)", () => {
  const p = (source: string, title: string, price: number): ScrapedProduct => ({
    source, externalId: `${source}-${price}`, title, url: "https://x", price, query: "q",
  });
  test("casa o mesmo modelo e ignora capacidade diferente", () => {
    const items = [
      p("amazon", "SSD Kingston NV2 1TB M.2 NVMe", 400),
      p("kabum", "SSD 1TB Kingston NV2, M.2 2280 PCIe NVMe", 380),
      p("magalu", "SSD Kingston NV2 2TB M.2 NVMe", 390),
    ];
    const ref = buildMarket(items)(items[0]!);
    expect(ref?.source).toBe("kabum");
    expect(ref?.minOther).toBe(380);
  });
});

describe("ML mais vendidos", () => {
  const card = (title: string, id: string, cur: string, prev?: string) => `
    <div class="andes-card poly-card poly-card--grid-card"><img src="https://http2.mlstatic.com/${id}.webp"/>
    <span>MAIS VENDIDO</span><h3><a href="https://www.mercadolivre.com.br/x/p/${id}#polycard=1&amp;wid=MLB9" class="poly-component__title">${title}</a></h3>
    ${prev ? `<s class="andes-money-amount andes-money-amount--previous" role="img" aria-label="${prev}">` : ""}
    <div class="poly-price__current"><span class="andes-money-amount" aria-label="${cur}"></span></div></div>`;
  const html =
    `<h2 class="sbc-products-carousel__title">Mais vendidos em Games</h2>` +
    card("Console PlayStation 5 Slim", "MLB111", "3.499 reais com 90 centavos", "Antes: 4.299 reais") +
    card("Controle DualSense", "MLB222", "379 reais");

  test("extrai ranking, preços e categoria", () => {
    const r = parseMlBestsellers(html);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      externalId: "MLB111", price: 3499.9, listPrice: 4299, bestSellerRank: 1,
      query: "mais-vendidos:Games", url: "https://www.mercadolivre.com.br/x/p/MLB111",
    });
    expect(r[1]?.bestSellerRank).toBe(2);
    expect(r[1]?.listPrice).toBeUndefined();
  });
  test("aria-label monetário", () => {
    expect(parseAriaMoney("417 reais com 57 centavos")).toBe(417.57);
    expect(parseAriaMoney("Antes: 1.299 reais")).toBe(1299);
  });
});
