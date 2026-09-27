import { classify, keywords, utilityScore, titleSignature } from "../src/category.ts";

describe("classify", () => {
  test("identifica suplementos", () => {
    expect(classify("Whey Protein Concentrado 900g")).toBe("suplementos");
    expect(classify("Creatina Monohidratada 300g")).toBe("suplementos");
  });
  test("identifica eletrodomesticos e tvs", () => {
    expect(classify("Geladeira Frost Free Brastemp 375L")).toBe("eletrodomesticos");
    expect(classify("Lavadora de Roupas Electrolux 11kg")).toBe("eletrodomesticos");
    expect(classify("Smart TV 55 Polegadas 4K UHD Samsung")).toBe("tv-audio");
  });
  test("identifica roupas e jogos", () => {
    expect(classify("Tenis Nike Air Max Masculino")).toBe("roupas");
    expect(classify("Camisa Polo Dry Fit")).toBe("roupas");
    expect(classify("Console PlayStation 5 Edicao Digital")).toBe("jogos");
    expect(classify("Jogo Nintendo Switch Mario Kart 8")).toBe("jogos");
  });
  test("identifica armazenamento", () => {
    expect(classify("SSD 1TB NVMe M.2 Kingston")).toBe("armazenamento");
  });
  test("identifica eletroportateis e ferramentas", () => {
    expect(classify("Fritadeira Sem Oleo Air Fryer Mondial 4L")).toBe("eletroportateis");
    expect(classify("Parafusadeira e Furadeira de Impacto Bosch 12V")).toBe("ferramentas");
    expect(classify("Aspirador Robo WAP Robot W300")).toBe("eletroportateis");
  });
  test("fallback geral", () => {
    expect(classify("Produto qualquer aleatório")).toBe("geral");
  });
});

describe("keywords", () => {
  test("remove stopwords/acentos e limita", () => {
    const kw = keywords("Whey Protein Concentrado 900g Growth de Baunilha");
    expect(kw).toContain("whey");
    expect(kw).toContain("protein");
    expect(kw).not.toContain("de");
    expect(kw.length).toBeLessThanOrEqual(6);
  });
});

describe("utilityScore", () => {
  test("penaliza acessorios futeis e capinhas", () => {
    const res = utilityScore("Capa Case Silicone para iPhone 13", "celulares");
    expect(res.score).toBeLessThan(1);
    expect(res.reason).toContain("baixa-utilidade");
  });

  test("bonifica produtos uteis e categorias de alta utilidade", () => {
    const res = utilityScore("Fritadeira Eletrica Air Fryer 4L", "eletroportateis");
    expect(res.score).toBeGreaterThan(1);
    expect(res.reason).toContain("alta-utilidade");
  });
});

describe("titleSignature", () => {
  test("gera assinatura normalizada de palavras unicas", () => {
    const sig1 = titleSignature("Fritadeira Air Fryer Mondial 4L Inox");
    const sig2 = titleSignature("Air Fryer Fritadeira Mondial Inox");
    expect(sig1).toBe(sig2);
  });
});


