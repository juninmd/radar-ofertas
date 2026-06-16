import { expect, test, describe } from "bun:test";
import { sparkline } from "../src/telegram.ts";

describe("sparkline", () => {
  test("série curta retorna vazio", () => {
    expect(sparkline([])).toBe("");
    expect(sparkline([10])).toBe("");
  });
  test("crescente vai do menor ao maior bloco", () => {
    const s = sparkline([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.length).toBe(8);
    expect(s[0]).toBe("▁");
    expect(s.at(-1)).toBe("█");
  });
  test("constante não quebra (range 0)", () => {
    const s = sparkline([5, 5, 5]);
    expect(s.length).toBe(3);
  });
});
