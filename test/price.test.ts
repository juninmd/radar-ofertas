import { expect, test, describe } from "bun:test";
import { parseMoney, magaluSlug } from "../src/crawlers/base.ts";
import { findProducts, parseAmazonProducts } from "../src/crawlers/sites.ts";
import { sanitize } from "../src/crawlers/index.ts";

describe("parseMoney", () => {
  test("string US do Magalu vale reais, não centavos", () => {
    expect(parseMoney("1289.00")).toBe(1289);
    expect(parseMoney("1055.55")).toBe(1055.55);
  });

  test("formato BR com milhar e vírgula", () => {
    expect(parseMoney("1.289,00")).toBe(1289);
    expect(parseMoney("R$ 1.055,55")).toBe(1055.55);
  });

  test("number já em reais é preservado", () => {
    expect(parseMoney(1019)).toBe(1019);
    expect(parseMoney(680.18)).toBe(680.18);
  });

  test("inteiro e milhar sem decimais", () => {
    expect(parseMoney("1289")).toBe(1289);
    expect(parseMoney("1.289")).toBe(1289);
  });

  test("valor não monetário vira NaN", () => {
    expect(parseMoney("abc")).toBeNaN();
    expect(parseMoney(null)).toBeNaN();
    expect(parseMoney(undefined)).toBeNaN();
  });
});

test("magaluSlug usa + literal (não %2B) para espaços", () => {
  expect(magaluSlug("ssd nvme")).toBe("ssd+nvme");
});

describe("findProducts (Magalu)", () => {
  const payload = {
    props: {
      pageProps: {
        data: {
          search: {
            products: [
              {
                id: "ddkg17c11f",
                title: "SSD Kingston NV3 1TB M.2 NVMe",
                available: true,
                url: "/magazinevoce/ssd-kingston-nv3-1tb/p/ddkg17c11f/in/ssdi/",
                image: "https://a-static.mlcdn.com.br/{w}x{h}/ssd/foo.jpeg",
                price: { price: "1289.00", fullPrice: "1135.00", bestPrice: "1055.55" },
              },
              {
                id: "sem-desconto",
                title: "Alexa Echo Dot 5 Geração",
                url: "/magazinevoce/echo-dot-5/p/sem-desconto/in/eltr/",
                price: { price: "550.10", fullPrice: "550.10", bestPrice: "550.10" },
              },
              {
                id: "indisponivel",
                title: "Produto Fora de Estoque",
                available: false,
                url: "/magazinevoce/x/p/indisponivel/",
                price: { bestPrice: "10.00" },
              },
            ],
          },
        },
      },
    },
  };

  test("preço em reais e preço-de a partir do maior valor de referência", () => {
    const [p] = findProducts(payload);
    expect(p.price).toBe(1055.55);
    expect(p.listPrice).toBe(1289);
    expect(p.source).toBe("magalu");
    expect(p.externalId).toBe("ddkg17c11f");
  });

  test("URL canônica no domínio do Magalu e imagem com dimensão resolvida", () => {
    const [p] = findProducts(payload);
    expect(p.url).toBe("https://www.magazineluiza.com.br/ssd-kingston-nv3-1tb/p/ddkg17c11f/in/ssdi/");
    expect(p.image).toBe("https://a-static.mlcdn.com.br/800x560/ssd/foo.jpeg");
  });

  test("sem desconto não inventa preço-de; indisponível é descartado", () => {
    const list = findProducts(payload);
    expect(list).toHaveLength(2);
    expect(list[1].price).toBe(550.1);
    expect(list[1].listPrice).toBeUndefined();
  });

  test("nó sem objeto de preço do Magalu não vira produto", () => {
    expect(findProducts({ banner: { id: 1, title: "Frete grátis acima de 99", price: 99 } })).toHaveLength(0);
  });

  // Vitrine clube: mesmo formato de produto, outro caminho no payload, e `url`
  // sem barra inicial e sem o prefixo de vitrine.
  test("payload do clube é lido no caminho dele", () => {
    const clube = {
      props: {
        pageProps: {
          dataResponse: {
            searchProducts: {
              data: {
                products: [
                  {
                    id: "ddkg17c11f",
                    title: "SSD Kingston NV3 1TB M.2 NVMe",
                    available: true,
                    channel: "magaluempresas.com.br",
                    url: "ssd-kingston-nv3-1tb/p/ddkg17c11f/in/ssdi/",
                    price: { price: "1289.00", fullPrice: "1135.00", bestPrice: "1055.55" },
                  },
                ],
              },
            },
          },
        },
      },
    };
    const [p] = findProducts(clube);
    expect(p.price).toBe(1055.55);
    expect(p.listPrice).toBe(1289);
    expect(p.url).toBe("https://www.magazineluiza.com.br/ssd-kingston-nv3-1tb/p/ddkg17c11f/in/ssdi/");
  });
});

describe("sanitize", () => {
  const base = {
    source: "zoom",
    externalId: "1",
    title: "Monitor Gamer 27",
    url: "https://www.zoom.com.br/monitor/x",
    price: 100,
    query: "monitor",
  };

  test("remove duplicados por (source, externalId)", () => {
    expect(sanitize([base, { ...base, price: 90 }])).toHaveLength(1);
  });

  test("descarta preço inválido, absurdo, título curto e URL relativa", () => {
    expect(
      sanitize([
        { ...base, externalId: "a", price: 0 },
        { ...base, externalId: "b", price: Number.NaN },
        { ...base, externalId: "c", price: 5_000_000 },
        { ...base, externalId: "d", title: "SSD" },
        { ...base, externalId: "e", url: "/relativo" },
      ]),
    ).toHaveLength(0);
  });

  test("zera preço-de incoerente e mantém o coerente", () => {
    const [a, b] = sanitize([
      { ...base, externalId: "a", listPrice: 80 },
      { ...base, externalId: "b", listPrice: 150 },
    ]);
    expect(a.listPrice).toBeUndefined();
    expect(b.listPrice).toBe(150);
  });

  test("preço muito baixo (bug de precificação) é preservado", () => {
    expect(sanitize([{ ...base, price: 1.99 }])).toHaveLength(1);
  });
});

describe("parseAmazonProducts", () => {
  test("extrai valor com centavos exatos e preço-de riscado", () => {
    const html = `
      <div data-asin="B07NGL3FDY">
        <h2><a href="/dp/B07NGL3FDY"><span>Whey Protein Concentrado Dux 900g Cookies</span></a></h2>
        <span class="a-price-whole">192</span><span class="a-price-fraction">68</span>
        <span class="a-price a-text-price"><span class="a-offscreen">R$ 229,90</span></span>
        <img class="s-image" src="https://m.media-amazon.com/images/I/whey.jpg" />
      </div>
    `;
    const res = parseAmazonProducts(html, "whey protein", 5);
    expect(res).toHaveLength(1);
    expect(res[0].externalId).toBe("B07NGL3FDY");
    expect(res[0].price).toBe(192.68);
    expect(res[0].listPrice).toBe(229.9);
    expect(res[0].title).toBe("Whey Protein Concentrado Dux 900g Cookies");
    expect(res[0].url).toBe("https://www.amazon.com.br/dp/B07NGL3FDY");
  });
});
