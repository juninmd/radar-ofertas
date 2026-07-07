import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-ofertas-telegram-")), "test.sqlite");
process.env.TELEGRAM_ENABLED = "false";

let sparkline: any;

beforeAll(async () => {
  ({ sparkline } = await import("../src/telegram.ts"));
});

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
