import { describe, expect, test } from "bun:test";
import { CACHE_MAX_ENTRIES, CacheService } from "../src/cache.ts";

describe("CacheService bounds", () => {
  test("never holds more than CACHE_MAX_ENTRIES keys", () => {
    const c = new CacheService();
    for (let i = 0; i < CACHE_MAX_ENTRIES + 50; i++) c.set(`k${i}`, i, 60_000);
    expect(c.getStats().keys).toBe(CACHE_MAX_ENTRIES);
    expect(c.get("k0")).toBeNull(); // oldest evicted
    expect(c.get<number>(`k${CACHE_MAX_ENTRIES + 49}`)).toBe(CACHE_MAX_ENTRIES + 49);
  });

  test("expired entries never read again are purged before live ones are evicted", () => {
    const c = new CacheService();
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) c.set(`stale${i}`, i, -1);
    c.set("live", 1, 60_000);
    expect(c.getStats().keys).toBe(1);
    expect(c.get<number>("live")).toBe(1);
  });
});
