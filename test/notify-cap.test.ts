import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-cap-")), "test.sqlite");
process.env.TELEGRAM_ENABLED = "false";
process.env.LITELLM_ENABLED = "false";
process.env.CLUSTER_DATABASE_URL = "";

let service: any;

beforeAll(async () => {
  const mod = await import("../src/services.ts");
  service = new mod.DealService();
});

describe("teto de notificações", () => {
  const novoProduto = (id: string) => ({
    source: "magalu",
    externalId: id,
    title: `Produto de Teste ${id}`,
    url: `https://www.magazineluiza.com.br/p/${id}/`,
    price: 100,
    listPrice: 200, // 50% de desconto anunciado => vira oferta no 1o ciclo
    query: "teste",
    imageSource: "real" as const,
  });

  test("allowNotify=false grava a oferta mas não notifica", async () => {
    const r = await service.processScrapedProduct(novoProduto(`cap-${Date.now()}`), false);
    expect(r.dealId).toBeNumber(); // oferta registrada (histórico preservado)
    expect(r.notified).toBe(false); // sem Telegram, sem chamada de IA
  });

  test("allowNotify=true mantém o caminho normal de notificação", async () => {
    const r = await service.processScrapedProduct(novoProduto(`ok-${Date.now()}`), true);
    expect(r.dealId).toBeNumber();
  });
});
