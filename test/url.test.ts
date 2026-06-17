import { expect, test, describe } from "bun:test";
import { cleanMlUrl } from "../src/crawlers/base.ts";

describe("cleanMlUrl", () => {
  const fb = "https://lista.mercadolivre.com.br/echo";

  test("reconstrói permalink a partir de tracker patrocinado (item_id)", () => {
    const tracker =
      "https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=ABC%2B" +
      "&pdp_filters=item_id%3AMLB4280836579#polycard_client=search-desktop&wid=MLB4280836579";
    expect(cleanMlUrl(tracker, fb)).toBe("https://produto.mercadolivre.com.br/MLB-4280836579");
  });

  test("reconstrói via wid quando não há item_id", () => {
    const tracker = "https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=X&wid=MLB6002678062&sid=search";
    expect(cleanMlUrl(tracker, fb)).toBe("https://produto.mercadolivre.com.br/MLB-6002678062");
  });

  test("mantém permalink direto removendo tracking", () => {
    const direct = "https://www.mercadolivre.com.br/echo-dot-5/p/MLB18927400?searchVariation=1&position=2";
    expect(cleanMlUrl(direct, fb)).toBe("https://www.mercadolivre.com.br/echo-dot-5/p/MLB18927400");
  });

  test("usa fallback quando href ausente", () => {
    expect(cleanMlUrl(undefined, fb)).toBe(fb);
  });
});
