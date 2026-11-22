import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DB_PATH ??= join(mkdtempSync(join(tmpdir(), "radar-caption-")), "test.sqlite");
const { buildCaption } = await import("../src/telegram.ts");

describe("buildCaption", () => {
  test("link com & vai escapado para o parse_mode HTML do Telegram", () => {
    const caption = buildCaption({
      id: 1, product_id: -1, source: "magalu", category: "tv",
      title: "TV Teste", url: "https://www.magazineluiza.com.br/p/123/?a=1&utm_source=x", image: null,
      price: 100, avg_price: 200, min_price: 90, max_price: 250, points: 5, discount_pct: 50, score: 0.8,
      flags: "", ai_comment: null, created_at: new Date().toISOString(),
    } as any);
    expect(caption).toContain("🔗 https://www.magazineluiza.com.br/p/123/?a=1&amp;utm_source=x");
    expect(caption).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
});
