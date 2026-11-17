import { describe, expect, test } from "bun:test";
import { parseAmazonBestsellers } from "../src/crawlers/bestsellers.ts";

// Fixture no formato da grade "zg" de amazon.com.br/gp/bestsellers/* (sem rede).
const item = (o: { asin: string; rank: number; title: string; price?: string; rating?: string; reviews?: string }) => `
  <div id="gridItemRoot" class="a-column">
    <div class="zg-grid-general-faceout"><span class="zg-bdg-text">#${o.rank}</span>
    <div data-asin="${o.asin}" class="p13n-sc-uncoverable-faceout">
      <a href="/Produto/dp/${o.asin}/ref=zg_bs"><img alt="${o.title}" src="https://m.media-amazon.com/images/I/${o.asin}.jpg"/></a>
      <div class="_cDEzb_p13n-sc-css-line-clamp-3_g3dy1">${o.title}</div>
      ${o.rating ? `<i class="a-icon a-icon-star-small"><span class="a-icon-alt">${o.rating}</span></i>` : ""}
      ${o.reviews ? `<span class="a-size-small">${o.reviews}</span>` : ""}
      ${o.price ? `<span class="_cDEzb_p13n-sc-price_3mJ9Z">${o.price}</span>` : ""}
    </div></div>
  </div>`;

const html =
  `<html><body>` +
  item({ asin: "B0CHX1W1XY", rank: 1, title: "Echo Dot 5ª geração &amp; Alexa", price: "R$ 379,05", rating: "4,8 de 5 estrelas", reviews: "12.345" }) +
  item({ asin: "B09XYZ1234", rank: 2, title: "Fone Bluetooth JBL Tune 520BT", price: "R$ 1.299,90" }) +
  item({ asin: "B0SEMPRECO", rank: 3, title: "Produto indisponível sem preço" }) +
  item({ asin: "B0CHX1W1XY", rank: 4, title: "Echo Dot duplicado no carrossel", price: "R$ 379,05" }) +
  `</body></html>`;

describe("Amazon mais vendidos", () => {
  const r = parseAmazonBestsellers(html, "electronics");

  test("extrai ranking, preço, nota e link canônico", () => {
    expect(r[0]).toMatchObject({
      source: "amazon",
      externalId: "B0CHX1W1XY",
      title: "Echo Dot 5ª geração & Alexa",
      url: "https://www.amazon.com.br/dp/B0CHX1W1XY",
      price: 379.05,
      bestSellerRank: 1,
      query: "mais-vendidos:electronics",
      badges: ["mais-vendido"],
    });
    expect(r[0]?.rating).toBe(4.8);
    expect(r[0]?.reviews).toBe(12345);
    expect(r[1]).toMatchObject({ externalId: "B09XYZ1234", price: 1299.9, bestSellerRank: 2 });
  });

  test("ignora item sem preço e ASIN repetido", () => {
    expect(r.map((p) => p.externalId)).toEqual(["B0CHX1W1XY", "B09XYZ1234"]);
  });

  test("respeita o limite e tolera HTML sem grade", () => {
    expect(parseAmazonBestsellers(html, "electronics", 1)).toHaveLength(1);
    expect(parseAmazonBestsellers("<html>503 Service Unavailable</html>", "x")).toEqual([]);
  });
});
