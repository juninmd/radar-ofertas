import { chromium } from "playwright";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { decodeEntities, parseBrl } from "./base.ts";

// Browser-based crawling for sites that block simple HTTP crawlers.
// Uses headless Chromium for JavaScript rendering.

let browserInstance: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function getBrowser() {
  if (!browserInstance) {
    try {
      // Try system chromium first, fallback to bundled if not available
      browserInstance = await chromium.launch({
        headless: true,
        executablePath: "/usr/bin/chromium-browser", // Alpine Linux system chromium
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage", // Avoid memory issues in container
          "--no-sandbox", // Required for running in container
          "--disable-gpu",
        ],
      });
    } catch (e) {
      log.warn(`Browser launch failed (system chromium): ${(e as Error).message}`);
      try {
        // Fallback: try bundled chromium
        browserInstance = await chromium.launch({
          headless: true,
          args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-gpu",
          ],
        });
      } catch (e2) {
        log.warn(`Browser launch failed (bundled): ${(e2 as Error).message}`);
        return null;
      }
    }
  }
  return browserInstance;
}

export async function crawlMercadoLivreBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];

  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  let context = null;
  let page = null;

  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 12000 });

    const html = await page.content();
    if (!html || html.length < 5000) return [];

    const out: ScrapedProduct[] = [];
    const titleRe = /poly-component__title[^>]*>\s*(?:<a[^>]*>)?([^<]{6,})/g;
    const priceRe = /andes-money-amount__fraction[^>]*>([\d.]+)</g;
    const linkRe = /href="(https:\/\/[^"]*?(?:MLB-?\d+|\/p\/MLB\d+)[^"]*)"/g;
    const imgRe = /<img[^>]+(?:data-src|src)="(https:\/\/[^"]*mlstatic[^"]+)"/g;

    const titles = [...html.matchAll(titleRe)].map((m) => decodeEntities(m[1].trim()));
    const prices = [...html.matchAll(priceRe)].map((m) => parseBrl(m[1]));
    const links = [...html.matchAll(linkRe)].map((m) => m[1]);
    const images = [...html.matchAll(imgRe)].map((m) => m[1]);

    const n = Math.min(titles.length, prices.length, max);
    for (let i = 0; i < n; i++) {
      const title = titles[i];
      const price = prices[i];
      if (!title || !Number.isFinite(price) || price <= 0) continue;
      const productUrl = links[i] ?? `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
      const idm = productUrl.match(/MLB-?(\d+)/);
      out.push({
        source: "mercadolivre",
        externalId: idm ? `MLB${idm[1]}` : `ml-${query}-${i}`,
        title,
        url: productUrl,
        image: images[i],
        price,
        query,
      });
    }
    log.debug(`ML browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`ML browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
    if (context) await context.close();
  }
}

export async function crawlAmazonBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];

  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  let context = null;
  let page = null;

  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 12000 });

    const html = await page.content();
    if (!html || html.length < 5000) return [];

    const out: ScrapedProduct[] = [];
    const blocks = html.split('data-asin="').slice(1);

    for (const b of blocks) {
      if (out.length >= max) break;
      const asin = b.slice(0, b.indexOf('"'));
      if (!asin || asin.length < 5) continue;

      const titleM = b.match(/<span class="a-size-(?:medium|base-plus)[^"]*"[^>]*>([^<]{6,})/);
      const priceM = b.match(/a-price-whole">([\d.]+)<\/span><span class="a-price-fraction">(\d{2})/);
      if (!titleM || !priceM) continue;

      const price = parseBrl(`${priceM[1]},${priceM[2]}`);
      if (!Number.isFinite(price) || price <= 0) continue;

      const imgM = b.match(/<img[^>]+class="s-image"[^>]+src="(https:\/\/[^"]+)"/);
      out.push({
        source: "amazon",
        externalId: asin,
        title: decodeEntities(titleM[1].trim()),
        url: `https://www.amazon.com.br/dp/${asin}`,
        image: imgM?.[1],
        price,
        query,
      });
    }
    log.debug(`Amazon browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`Amazon browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
    if (context) await context.close();
  }
}
