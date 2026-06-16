import { expect, test, describe } from "bun:test";
import { classify, keywords } from "../src/category.ts";

describe("classify", () => {
  test("identifica suplementos", () => {
    expect(classify("Whey Protein Concentrado 900g")).toBe("suplementos");
    expect(classify("Creatina Monohidratada 300g")).toBe("suplementos");
  });
  test("identifica armazenamento", () => {
    expect(classify("SSD 1TB NVMe M.2 Kingston")).toBe("armazenamento");
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
