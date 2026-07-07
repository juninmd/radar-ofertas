import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "radar-ofertas-")), "test.sqlite");
process.env.TELEGRAM_ENABLED = "false";
process.env.LITELLM_ENABLED = "false";
process.env.CLUSTER_DATABASE_URL = "";

let service: any;

beforeAll(async () => {
  const mod = await import("../src/services.ts");
  service = new mod.DealService();
});

describe("DealService", () => {
  test("não cria ofertas repetidas para o mesmo produto", async () => {
    const externalId = `B0TEST${Date.now()}`;
    const title = `SSD NVMe 1TB Teste ${externalId}`;
    const product = {
      source: "amazon",
      externalId,
      title,
      url: `https://www.amazon.com.br/dp/${externalId}`,
      price: 299,
      listPrice: 499,
      query: "ssd nvme",
      imageSource: "real" as const,
    };

    const first = await service.processScrapedProduct(product);
    const second = await service.processScrapedProduct(product);

    expect(first.dealId).toBeNumber();
    expect(second.dealId).toBeNull();
    const matchingDeals = service.getDashboardDeals(50).filter((d: any) => d.title === title);
    expect(matchingDeals).toHaveLength(1);
  });
});
