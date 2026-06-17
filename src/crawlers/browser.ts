import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import * as cheerio from "cheerio";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { decodeEntities, parseBrl } from "./base.ts";

puppeteerExtra.use(StealthPlugin() as any);

const BLOCKED_RESOURCE_TYPES = new Set<string>(['image', 'stylesheet', 'font', 'media']);

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (!browserInstance) {
    try {
      const isHeadless = process.env.HEADLESS !== "false";
      browserInstance = (await puppeteerExtra.launch({
        headless: isHeadless,
        defaultViewport: {
          width: 1200,
          height: 800,
        },
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      })) as any;
      log.info("Browser (Puppeteer Stealth) launched successfully");
    } catch (e) {
      log.warn(`Browser launch failed: ${(e as Error).message}`);
      return null;
    }
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function crawlMercadoLivreBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];

  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  let page: Page | null = null;

  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (!req.method().includes("GET") || BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    try {
      await page.waitForSelector(".poly-card", { timeout: 8000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const html = await page.content();
    if (!html || html.length < 5000) return [];

    const $ = cheerio.load(html);
    const out: ScrapedProduct[] = [];
    
    $(".poly-card").each((i, el) => {
      if (out.length >= max) return;
      
      const titleEl = $(el).find("a.poly-component__title").first();
      const title = titleEl.text().trim();
      const productUrl = titleEl.attr("href");
      
      const whole = $(el).find(".poly-price__current .andes-money-amount__fraction").first().text().trim();
      const cents = $(el).find(".poly-price__current .andes-money-amount__cents").first().text().trim();
      
      const image = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src");
      
      if (title && whole) {
        const cleanWhole = whole.replace(/[^\d]/g, "");
        const cleanCents = cents.replace(/[^\d]/g, "");
        const priceRaw = cleanCents ? `${cleanWhole},${cleanCents}` : `${cleanWhole}`;
        const price = parseBrl(priceRaw);
        
        if (Number.isFinite(price) && price > 0) {
          const idm = productUrl?.match(/MLB-?(\d+)/);
          out.push({
            source: "mercadolivre",
            externalId: idm ? `MLB${idm[1]}` : `ml-${query}-${i}`,
            title: decodeEntities(title),
            url: productUrl ?? url,
            image,
            price,
            query,
            imageSource: "real",
          });
        }
      }
    });
    
    log.debug(`ML browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`ML browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}

export async function crawlAmazonBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];

  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  let page: Page | null = null;

  try {
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (!req.method().includes("GET") || BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    try {
      await page.waitForSelector("[data-asin]", { timeout: 8000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const html = await page.content();
    if (!html || html.length < 5000) return [];

    const $ = cheerio.load(html);
    const out: ScrapedProduct[] = [];
    
    $("[data-asin]").each((i, el) => {
      if (out.length >= max) return;
      
      const asin = $(el).attr("data-asin");
      if (!asin || asin.length < 5) return;
      
      let title = $(el).find("h2 a span").first().text().trim();
      if (!title) title = $(el).find("a.a-link-normal.a-text-normal").first().text().trim();
      if (!title) title = $(el).find(".a-size-base-plus").first().text().trim();
      if (!title) title = $(el).find(".a-size-medium").first().text().trim();
      
      const whole = $(el).find(".a-price-whole").first().text().trim();
      const fraction = $(el).find(".a-price-fraction").first().text().trim();
      
      const img = $(el).find("img.s-image").attr("src");
      
      let productUrl = $(el).find("h2 a").attr("href") || $(el).find("a.a-link-normal.a-text-normal").attr("href");
      if (productUrl && !productUrl.startsWith("http")) {
        productUrl = "https://www.amazon.com.br" + productUrl;
      }
      
      if (title && whole) {
        const cleanWhole = whole.replace(/[^\d]/g, "");
        const cleanFraction = fraction.replace(/[^\d]/g, "");
        const priceRaw = cleanFraction ? `${cleanWhole},${cleanFraction}` : `${cleanWhole}`;
        const price = parseBrl(priceRaw);
        
        if (Number.isFinite(price) && price > 0) {
          out.push({
            source: "amazon",
            externalId: asin,
            title: decodeEntities(title),
            url: productUrl ?? `https://www.amazon.com.br/dp/${asin}`,
            image: img,
            price,
            query,
            imageSource: "real",
          });
        }
      }
    });
    
    log.debug(`Amazon browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`Amazon browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}
