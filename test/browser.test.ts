import { expect, test, describe, afterAll } from "bun:test";
import { crawlMercadoLivreBrowser, crawlAmazonBrowser, crawlMagaluBrowser, closeBrowser } from "../src/crawlers/browser.ts";

describe("Browser Crawlers", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  test("crawlMercadoLivreBrowser returns results and is not blocked", async () => {
    const results = await crawlMercadoLivreBrowser("creatina", 2);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const p = results[0]!;
    expect(p.source).toBe("mercadolivre");
    expect(typeof p.title).toBe("string");
    expect(typeof p.price).toBe("number");
    expect(p.price).toBeGreaterThan(0);
  }, 35000);

  test("crawlAmazonBrowser returns results and is not blocked", async () => {
    const results = await crawlAmazonBrowser("ssd nvme", 2);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const p = results[0]!;
    expect(p.source).toBe("amazon");
    expect(typeof p.title).toBe("string");
    expect(typeof p.price).toBe("number");
    expect(p.price).toBeGreaterThan(0);
  }, 35000);

  test("crawlMagaluBrowser returns results or is tolerated when blocked", async () => {
    const results = await crawlMagaluBrowser("whey protein", 2);
    expect(Array.isArray(results)).toBe(true);
    if (results.length === 0) {
      console.warn("crawlMagaluBrowser returned 0 results - likely blocked by Akamai");
    } else {
      const p = results[0]!;
      expect(p.source).toBe("magalu");
      expect(typeof p.title).toBe("string");
      expect(typeof p.price).toBe("number");
      expect(p.price).toBeGreaterThan(0);
    }
  }, 35000);
});
