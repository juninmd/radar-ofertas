import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-ofertas-")), "queries.sqlite");
process.env.TELEGRAM_ENABLED = "false";
process.env.LITELLM_ENABLED = "false";
process.env.CLUSTER_DATABASE_URL = "";

const { addSearchQuery, removeSearchQuery, getSearchQueries, MAX_QUERY_LENGTH } = await import("../src/db.ts");

describe("termos de busca", () => {
  test("remover um termo inexistente devolve false (o servidor responde 404)", () => {
    expect(removeSearchQuery("termo que nunca existiu")).toBe(false);
  });

  test("adicionar e remover um termo existente devolve true", () => {
    expect(addSearchQuery("  cadeira gamer  ")).toBe(true);
    expect(getSearchQueries()).toContain("cadeira gamer");
    expect(removeSearchQuery("cadeira gamer")).toBe(true);
    expect(getSearchQueries()).not.toContain("cadeira gamer");
  });

  test("duplicado e termo grande demais são rejeitados", () => {
    expect(addSearchQuery("monitor 4k")).toBe(true);
    expect(addSearchQuery("monitor 4k")).toBe(false);
    expect(addSearchQuery("x".repeat(MAX_QUERY_LENGTH + 1))).toBe(false);
    expect(addSearchQuery("x".repeat(MAX_QUERY_LENGTH))).toBe(true);
  });
});
