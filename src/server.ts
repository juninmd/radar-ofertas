import { config } from "./config.ts";
import { log } from "./log.ts";
import { runCrawlCycle } from "./pipeline.ts";
import { pollCallbacks } from "./telegram.ts";
import { DealService } from "./services.ts";
import { globalCache } from "./cache.ts";
import { getSearchQueries, addSearchQuery, removeSearchQuery } from "./db.ts";

const dealService = new DealService();

// Simple in-memory rate limiter
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 100; // requests
const RATE_LIMIT_WINDOW = 60000; // 1 minute

const json = (data: unknown, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders 
    },
  });

const DASHBOARD = Bun.file(new URL("../public/index.html", import.meta.url));

export function startServer() {
  const server = Bun.serve({
    port: config.port,
    idleTimeout: 60,
    async fetch(req) {
      const start = performance.now();
      const url = new URL(req.url);
      const { pathname } = url;
      const ip = req.headers.get("x-forwarded-for") || server.requestIP(req)?.address || "unknown";

      // Rate Limiting Logic
      const now = Date.now();
      let rl = rateLimits.get(ip);
      if (!rl || now > rl.resetTime) {
        rl = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
      }
      rl.count++;
      rateLimits.set(ip, rl);
      if (rateLimits.size > 1000) {
        for (const [k, v] of rateLimits) if (now > v.resetTime) rateLimits.delete(k);
      }

      if (rl.count > RATE_LIMIT_MAX) {
        log.warn(`Rate limit exceeded for IP: ${ip}`);
        return json({ error: "Too Many Requests" }, 429);
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }
        });
      }

      let response: Response;

      try {
        if (pathname === "/health") {
          response = json({ ok: true, ts: Date.now() });
        }
        else if (pathname === "/api/system/metrics") {
          const mem = process.memoryUsage();
          response = json({
            uptime: process.uptime(),
            memory: {
              rss: Math.round(mem.rss / 1024 / 1024) + "MB",
              heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
              heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
            },
            cache: globalCache.getStats()
          });
        }
        else if (pathname === "/" || pathname === "/index.html") {
          response = new Response(DASHBOARD, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        else if (pathname === "/api/deals" && req.method === "GET") {
          const raw = Number(url.searchParams.get("limit") ?? 50);
          const limit = Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 50, 1), 200);
          const cacheKey = `deals_${limit}`;
          
          let deals = globalCache.get<any[]>(cacheKey);
          if (!deals) {
            deals = dealService.getDashboardDeals(limit);
            globalCache.set(cacheKey, deals, 15000); // Cache for 15 seconds
          }
          
          response = json(deals);
        }
        else if (pathname === "/api/feedback" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { dealId?: number; vote?: number } | null;
          const dealId = Number(body?.dealId);
          const vote = body?.vote === 1 ? 1 : body?.vote === -1 ? -1 : null;
          if (!Number.isFinite(dealId) || vote === null) {
            response = json({ error: "dealId e vote (1|-1) obrigatórios" }, 400);
          } else {
            const ok = dealService.registerVote(dealId, vote);
            response = json({ ok }, ok ? 200 : 404);
          }
        }
        else if (pathname === "/api/crawl" && req.method === "POST") {
          const result = await runCrawlCycle();
          globalCache.clear();
          response = json(result);
        }
        else if (pathname === "/api/queries" && req.method === "GET") {
          response = json(getSearchQueries());
        }
        else if (pathname === "/api/queries" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { query?: string } | null;
          const q = body?.query?.trim();
          if (!q) {
            response = json({ error: "O campo query é obrigatório" }, 400);
          } else {
            const added = addSearchQuery(q);
            response = json({ ok: added }, added ? 201 : 400);
          }
        }
        else if (pathname === "/api/queries" && req.method === "DELETE") {
          const body = (await req.json().catch(() => null)) as { query?: string } | null;
          const q = body?.query?.trim();
          if (!q) {
            response = json({ error: "O campo query é obrigatório" }, 400);
          } else {
            const removed = removeSearchQuery(q);
            response = json({ ok: removed }, removed ? 200 : 404);
          }
        }
        else {
          response = new Response("not found", { status: 404 });
        }
      } catch (err) {
        log.error(`API Error on ${pathname}:`, err);
        response = json({ error: "Internal Server Error" }, 500);
      }

      const duration = (performance.now() - start).toFixed(2);
      log.info(`HTTP ${req.method} ${pathname} - ${response.status} [${duration}ms] - IP: ${ip}`);
      
      return response;
    },
  });

  log.info(`🚀 Radar de Ofertas PRO Server via Bun em http://localhost:${server.port}`);

  // Long-polling dos botões 👍/👎 do Telegram -> feedback de recomendação.
  // Opt-in: evita conflito 409 com outros consumidores getUpdates (ex.: n8n).
  if (config.telegram.enabled && config.telegram.botToken && config.telegram.pollCallbacks) {
    const offsetRef = { offset: 0 };
    const poll = () =>
      pollCallbacks((dealId, vote) => dealService.registerVote(dealId, vote), offsetRef).catch(
        (e) => log.debug("pollCallbacks erro", (e as Error).message),
      );
    setInterval(() => void poll(), 5000);
    log.info("Telegram callback poller ativo (5s)");
  }

  return server;
}
