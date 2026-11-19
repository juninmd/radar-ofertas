// /api/top keys vary by (hours, limit) and entries were only dropped when read
// again, so a client sweeping query params could grow the map without bound.
export const CACHE_MAX_ENTRIES = 500;

export class CacheService {
  private cache = new Map<string, { data: any; expires: number }>();

  set(key: string, data: any, ttlMs: number) {
    this.cache.delete(key); // re-insert so Map order reflects recency of write
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.makeRoom();
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
  }

  private makeRoom() {
    const now = Date.now();
    for (const [k, v] of this.cache) if (now > v.expires) this.cache.delete(k);
    while (this.cache.size >= CACHE_MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.data as T;
  }

  invalidate(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      keys: this.cache.size,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }
}

export const globalCache = new CacheService();
