export class CacheService {
  private cache = new Map<string, { data: any; expires: number }>();

  set(key: string, data: any, ttlMs: number) {
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
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
