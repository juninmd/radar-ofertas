import { config } from "./config.ts";
import { log } from "./log.ts";
import { keywords } from "./category.ts";
import {
  dealById,
  feedbackByCategory,
  imageStats,
  insertFeedback,
  priceSeries,
  priceSeriesWithDates,
  recentDeals,
} from "./db.ts";
import { runCrawlCycle } from "./pipeline.ts";
import { pollCallbacks } from "./telegram.ts";
import { isPriceBug } from "./deal.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// registra voto a partir de um deal (deriva categoria + keywords do produto)
export function registerVote(dealId: number, vote: 1 | -1): boolean {
  const d = dealById(dealId);
  if (!d) return false;
  insertFeedback(dealId, d.category, keywords(d.title).join(","), vote);
  log.info(`feedback deal#${dealId} ${vote > 0 ? "👍" : "👎"} (${d.category})`);
  return true;
}

const DASHBOARD = Bun.file(new URL("../public/index.html", import.meta.url));

export function startServer() {
  const server = Bun.serve({
    port: config.port,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/health") return json({ ok: true, ts: Date.now() });

      if (pathname === "/" || pathname === "/index.html") {
        return new Response(DASHBOARD, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (pathname === "/api/deals" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const deals = recentDeals(Math.min(Math.max(limit, 1), 200)).map((d) => ({
          ...d,
          priceBug: isPriceBug(d.discount_pct),
          series: priceSeries(d.product_id, 24),
          seriesDates: priceSeriesWithDates(d.product_id, 24).map(p => ({
            price: p.price,
            date: p.captured_at
          })),
        }));
        return json(deals);
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        return json({ feedback: feedbackByCategory() });
      }

      if (pathname === "/api/feedback" && req.method === "POST") {
        try {
          const body = (await req.json()) as { dealId?: number; vote?: number };
          const vote = body.vote === -1 ? -1 : body.vote === 1 ? 1 : null;
          if (!body.dealId || vote === null)
            return json({ error: "dealId e vote (1|-1) obrigatórios" }, 400);
          const ok = registerVote(body.dealId, vote);
          return ok ? json({ ok: true }) : json({ error: "deal não encontrado" }, 404);
        } catch {
          return json({ error: "json inválido" }, 400);
        }
      }

      if (pathname === "/api/crawl" && req.method === "POST") {
        const result = await runCrawlCycle();
        return json(result);
      }

      if (pathname === "/api/image-stats" && req.method === "GET") {
        return json(imageStats());
      }

      return new Response("not found", { status: 404 });
    },
  });

  log.info(`radar-ofertas server em http://localhost:${server.port}`);

  // long-poll de callbacks do Telegram (botões 👍/👎)
  const offsetRef = { offset: 0 };
  if (config.telegram.enabled && config.telegram.botToken) {
    setInterval(() => {
      void pollCallbacks((id, vote) => registerVote(id, vote), offsetRef);
    }, 4000);
  }

  return server;
}
