import { expect, test, describe, beforeAll } from "bun:test";

// usa DB em memória isolado deste teste
process.env.DB_PATH = ":memory:";

let insertFeedback: typeof import("../src/db.ts").insertFeedback;
let affinity: typeof import("../src/recommend.ts").affinity;
let db: typeof import("../src/db.ts").db;

beforeAll(async () => {
  const dbMod = await import("../src/db.ts");
  insertFeedback = dbMod.insertFeedback;
  db = dbMod.db;
  ({ affinity } = await import("../src/recommend.ts"));
});

describe("recomendação por feedback", () => {
  test("curtir whey aumenta o multiplicador de futuras ofertas de whey", () => {
    db.run("DELETE FROM feedback;");
    const before = affinity("Whey Protein Isolado 900g", "suplementos").multiplier;
    insertFeedback(null, "suplementos", "whey,protein", 1);
    insertFeedback(null, "suplementos", "whey,protein", 1);
    insertFeedback(null, "suplementos", "whey", 1);
    const after = affinity("Whey Protein Concentrado 1kg", "suplementos").multiplier;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(1);
  });

  test("não curtir reduz o multiplicador da categoria", () => {
    insertFeedback(null, "celulares", "iphone", -1);
    insertFeedback(null, "celulares", "iphone", -1);
    insertFeedback(null, "celulares", "iphone", -1);
    const m = affinity("iPhone 13 128GB", "celulares").multiplier;
    expect(m).toBeLessThan(1);
  });

  test("categoria neutra fica ~1", () => {
    const m = affinity("Produto neutro xyz", "tv-audio").multiplier;
    expect(m).toBeGreaterThan(0.9);
    expect(m).toBeLessThan(1.1);
  });
});
