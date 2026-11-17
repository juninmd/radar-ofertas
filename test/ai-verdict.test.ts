import { afterAll, beforeEach, describe, expect, test } from "bun:test";

process.env.LITELLM_API_KEY = "k";
process.env.LITELLM_ENABLED = "true";
const { analyzeDeal, clearAnalysisCache, verdictOf } = await import("../src/ai.ts");
const { config } = await import("../src/config.ts");

const realFetch = globalThis.fetch;
let calls: Record<string, unknown>[] = [];
beforeEach(() => {
  // Outros arquivos de teste desligam a IA no mesmo processo.
  process.env.LITELLM_ENABLED = "true";
  Object.assign(config.litellm as { enabled: boolean; apiKey: string }, { enabled: true, apiKey: "k" });
  calls = [];
  clearAnalysisCache();
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: "PASSE: desconto fraco" } }] }));
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  process.env.LITELLM_ENABLED = "false";
  Object.assign(config.litellm as { enabled: boolean }, { enabled: false });
});

const deal = { isDeal: true, price: 99, avg: 110, discountPct: 10, zscore: 0, score: 0.6, reasons: [] };

describe("verdictOf", () => {
  test("lê o veredito do início, com ou sem acento e emoji", () => {
    expect(verdictOf("COMPRA JÁ! menor preço")).toBe("COMPRA JÁ");
    expect(verdictOf("🔥 compra ja, vale")).toBe("COMPRA JÁ");
    expect(verdictOf("PASSE — supérfluo")).toBe("PASSE");
    expect(verdictOf("MEDIANO: ok")).toBe("MEDIANO");
    expect(verdictOf("talvez")).toBeNull();
    expect(verdictOf(null)).toBeNull();
  });
});

describe("analyzeDeal", () => {
  test("mesmo produto no mesmo preço usa o cache e não chama a IA de novo", async () => {
    expect(await analyzeDeal("Fone X", "amazon", deal)).toBe("PASSE: desconto fraco");
    expect(await analyzeDeal("Fone X", "amazon", deal)).toBe("PASSE: desconto fraco");
    expect(calls).toHaveLength(1);
    await analyzeDeal("Fone X", "amazon", { ...deal, price: 89 });
    expect(calls).toHaveLength(2);
  });

  test("teto de saída cabe o raciocínio dos modelos do cloud/auto", async () => {
    await analyzeDeal("Fone Y", "amazon", deal);
    expect(calls[0]?.max_tokens).toBe(600);
    expect(calls[0]?.reasoning_effort).toBe("low");
  });
});
