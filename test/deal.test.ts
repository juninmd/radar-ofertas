import { expect, test, describe } from "bun:test";
import { evaluate } from "../src/deal.ts";
import type { PriceStats } from "../src/types.ts";

const stats = (avg: number, std: number, count = 10): PriceStats => ({
  avg,
  std,
  count,
  min: avg - std,
  max: avg + std,
});

describe("evaluate (detecção de oferta)", () => {
  test("histórico insuficiente não dispara", () => {
    const r = evaluate(50, stats(100, 10, 2), "Whey 900g", "suplementos");
    expect(r.isDeal).toBe(false);
    expect(r.reasons).toContain("historico-insuficiente");
  });

  test("preço acima da média nunca é oferta", () => {
    const r = evaluate(120, stats(100, 10), "Whey 900g", "suplementos");
    expect(r.isDeal).toBe(false);
    expect(r.score).toBe(0);
  });

  test("queda forte abaixo da média vira oferta", () => {
    const r = evaluate(70, stats(100, 10), "Whey 900g", "suplementos");
    expect(r.isDeal).toBe(true);
    expect(r.discountPct).toBeCloseTo(30, 0);
    expect(r.zscore).toBeLessThan(-1.2);
    expect(r.score).toBeGreaterThan(0);
  });

  test("desconto pequeno dentro do desvio não dispara", () => {
    // 100 média, std alto 30, preço 95 -> z=-0.16, desconto 5% < 12%
    const r = evaluate(95, stats(100, 30), "SSD 1TB", "armazenamento");
    expect(r.isDeal).toBe(false);
  });

  test("score satura em 1", () => {
    const r = evaluate(10, stats(100, 10), "Whey 900g", "suplementos");
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.score).toBeGreaterThan(0.9);
  });

  test("oferta real exige histórico: sem leituras suficientes não dispara", () => {
    // count=1: sem histórico e sem preço-de, não há baseline -> não é oferta.
    const r = evaluate(140, stats(140, 0, 1), "Monitor Gamer 144Hz", "perifericos");
    expect(r.isDeal).toBe(false);
    expect(r.reasons).toContain("historico-insuficiente");
  });

  test("dia-1 sem histórico: usa preço-de do site como baseline", () => {
    // count=1, mas o site anuncia preço-de 200 e atual 140 -> desconto 30% dispara.
    const r = evaluate(140, stats(0, 0, 1), "Monitor Gamer 144Hz", "perifericos", 200);
    expect(r.isDeal).toBe(true);
    expect(r.discountPct).toBeCloseTo(30, 0);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some((x) => x.startsWith("preco-de"))).toBe(true);
  });

  test("dia-1 com preço-de mas desconto pequeno não dispara", () => {
    const r = evaluate(190, stats(0, 0, 1), "Monitor Gamer 144Hz", "perifericos", 200);
    expect(r.isDeal).toBe(false);
  });

  test("histórico próprio tem precedência sobre preço-de", () => {
    // count>=3: ignora listPrice e avalia contra a média observada.
    const r = evaluate(70, stats(100, 10), "Whey 900g", "suplementos", 999);
    expect(r.isDeal).toBe(true);
    expect(r.avg).toBe(100);
  });

  test("menor preço dos últimos 30 dias dispara com desconto moderado (>= 8%)", () => {
    // média 100, std 30 (z = -0.33 não passaria de -1.2, disc = 10% < 12%), mas é o menor dos 30 dias (90 <= min30d)
    const st: PriceStats = { avg: 100, std: 30, count: 20, min: 90, max: 130, min30d: 90 };
    const r = evaluate(90, st, "Whey 900g", "suplementos");
    expect(r.isDeal).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("menor-preco-recente"))).toBe(true);
  });
});
