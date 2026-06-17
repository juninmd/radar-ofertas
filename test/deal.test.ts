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
    // count=1: mesmo que o site anuncie desconto, sem histórico real não é oferta.
    const r = evaluate(140, stats(140, 0, 1), "Monitor Gamer 144Hz", "perifericos");
    expect(r.isDeal).toBe(false);
    expect(r.reasons).toContain("historico-insuficiente");
  });
});
