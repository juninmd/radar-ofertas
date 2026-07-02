import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import * as cheerio from "cheerio";
import { log } from "../log.ts";
import type { ScrapedProduct } from "../types.ts";
import { cleanMlUrl, decodeEntities, parseBrl } from "./base.ts";
import { findProducts } from "./sites.ts";

puppeteerExtra.use(StealthPlugin() as any);

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCKED_RESOURCE_TYPES = new Set<string>(['image', 'stylesheet', 'font', 'media']);

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (!browserInstance) {
    try {
      const isHeadless = process.env.HEADLESS !== "false";
      const launchOptions: any = {
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
      };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      browserInstance = (await puppeteerExtra.launch(launchOptions)) as any;
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

      // preço "de" (riscado): andes-money-amount--previous
      const prevWhole = $(el).find(".andes-money-amount--previous .andes-money-amount__fraction").first().text().trim();
      const prevCents = $(el).find(".andes-money-amount--previous .andes-money-amount__cents").first().text().trim();

      const image = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src");

      if (title && whole) {
        const cleanWhole = whole.replace(/[^\d]/g, "");
        const cleanCents = cents.replace(/[^\d]/g, "");
        const priceRaw = cleanCents ? `${cleanWhole},${cleanCents}` : `${cleanWhole}`;
        const price = parseBrl(priceRaw);

        let listPrice: number | undefined;
        if (prevWhole) {
          const lp = parseBrl(prevCents ? `${prevWhole.replace(/[^\d]/g, "")},${prevCents.replace(/[^\d]/g, "")}` : prevWhole.replace(/[^\d]/g, ""));
          if (Number.isFinite(lp) && lp > price) listPrice = lp;
        }

        if (Number.isFinite(price) && price > 0) {
          const cleanUrl = cleanMlUrl(productUrl ?? undefined, url);
          const idm = cleanUrl.match(/MLB-?(\d+)/);
          out.push({
            source: "mercadolivre",
            externalId: idm ? `MLB${idm[1]}` : `ml-${query}-${i}`,
            title: decodeEntities(title),
            url: cleanUrl,
            image,
            price,
            listPrice,
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

      // preço "de" (riscado): a-price.a-text-price > .a-offscreen
      const prevRaw = $(el).find(".a-price.a-text-price .a-offscreen").first().text().trim();

      const img = $(el).find("img.s-image").attr("src");

      // URL canônica e limpa pelo ASIN (evita querystring de tracking gigante)
      const productUrl = `https://www.amazon.com.br/dp/${asin}`;

      if (title && whole) {
        const cleanWhole = whole.replace(/[^\d]/g, "");
        const cleanFraction = fraction.replace(/[^\d]/g, "");
        const priceRaw = cleanFraction ? `${cleanWhole},${cleanFraction}` : `${cleanWhole}`;
        const price = parseBrl(priceRaw);

        let listPrice: number | undefined;
        if (prevRaw) {
          const lp = parseBrl(prevRaw);
          if (Number.isFinite(lp) && lp > price) listPrice = lp;
        }

        if (Number.isFinite(price) && price > 0) {
          out.push({
            source: "amazon",
            externalId: asin,
            title: decodeEntities(title),
            url: productUrl ?? `https://www.amazon.com.br/dp/${asin}`,
            image: img,
            price,
            listPrice,
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

// ── Shopee ──────────────────────────────────────────────────────────────────
// SPA sem HTML útil: consultamos a API v4 de dentro da página (cookies de
// sessão SPC_* já presentes após visitar a home). Preço vem em micro-unidades.
export async function crawlShopeeBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.goto("https://shopee.com.br/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2500));

    const apiUrl =
      `https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(query)}` +
      `&limit=${max}&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;

    const json = (await page.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, {
          headers: { "x-api-source": "pc", "x-shopee-language": "pt-BR", "af-ac-enc-dat": "" },
          credentials: "include",
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }, apiUrl)) as any;

    const items: any[] = json?.items ?? [];
    const out: ScrapedProduct[] = [];
    for (const it of items) {
      if (out.length >= max) break;
      const b = it?.item_basic ?? it;
      if (!b?.name || b.itemid == null || b.shopid == null) continue;
      const price = typeof b.price === "number" ? b.price / 100000 : NaN;
      if (!Number.isFinite(price) || price <= 0) continue;
      const before = typeof b.price_before_discount === "number" ? b.price_before_discount / 100000 : 0;
      const listPrice = before > price ? before : undefined;
      const image = b.image ? `https://cf.shopee.com.br/file/${b.image}` : undefined;
      out.push({
        source: "shopee",
        externalId: `${b.shopid}.${b.itemid}`,
        title: decodeEntities(String(b.name)),
        url: `https://shopee.com.br/product/${b.shopid}/${b.itemid}`,
        image,
        price,
        listPrice,
        query,
        imageSource: "real",
      });
    }
    log.debug(`Shopee "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`Shopee "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}

// ── Kabum ───────────────────────────────────────────────────────────────────
// Next.js: produtos no __NEXT_DATA__ (a API REST é protegida por Akamai).
export async function crawlKabumBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.goto(`https://www.kabum.com.br/busca/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));

    const raw = (await page.evaluate((lim: number) => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el || !el.textContent) return [];
      let nd: any;
      try { nd = JSON.parse(el.textContent); } catch { return []; }
      const out: any[] = [];
      const seen = new Set<any>();
      const walk = (n: any) => {
        if (out.length >= 60 || !n || typeof n !== "object" || seen.has(n)) return;
        seen.add(n);
        if (Array.isArray(n)) { for (const x of n) walk(x); return; }
        const name = n.name ?? n.title;
        const disc = typeof n.priceWithDiscount === "number" && n.priceWithDiscount > 0 ? n.priceWithDiscount : null;
        const price = disc ?? n.price;
        if (name && n.code != null && typeof price === "number" && price > 0) {
          let image: string | null = null;
          const ph = Array.isArray(n.photos) ? n.photos[0] : null;
          if (typeof ph === "string") image = ph;
          else if (ph && typeof ph === "object") image = ph.gg ?? ph.g ?? ph.m ?? ph.p ?? null;
          else if (typeof n.thumbnail === "string") image = n.thumbnail;
          out.push({
            code: n.code,
            name,
            price,
            oldPrice: typeof n.price === "number" && n.price > price ? n.price : null,
            image,
            slug: n.friendlyName ?? n.url ?? "",
          });
        }
        for (const k of Object.keys(n)) walk(n[k]);
      };
      walk(nd);
      return out.slice(0, lim);
    }, max)) as any[];

    const out: ScrapedProduct[] = [];
    for (const r of raw) {
      const slug = String(r.slug || "").replace(/^\//, "");
      out.push({
        source: "kabum",
        externalId: String(r.code),
        title: decodeEntities(String(r.name)),
        url: slug ? `https://www.kabum.com.br/produto/${r.code}/${slug}` : `https://www.kabum.com.br/produto/${r.code}`,
        image: r.image ?? undefined,
        price: r.price,
        listPrice: r.oldPrice ?? undefined,
        query,
        imageSource: "real",
      });
    }
    log.debug(`Kabum browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`Kabum browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}

// ── AliExpress ──────────────────────────────────────────────────────────────
// Resultados embutidos em window._dida_config_._init_data_ (runParams).
export async function crawlAliExpressBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    const url = `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(query)}.html?currency=BRL&shipCountry=BR`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 3000));

    const items = (await page.evaluate(() => {
      const w = window as any;
      const data = w?._dida_config_?._init_data_?.data ?? w?.runParams?.data ?? null;
      if (!data) return null;
      // procura recursivamente uma lista de itens com title/price
      const found: any[] = [];
      const seen = new Set<any>();
      const walk = (n: any, depth: number) => {
        if (!n || typeof n !== "object" || depth > 8 || seen.has(n)) return;
        seen.add(n);
        if (Array.isArray(n)) {
          for (const x of n) {
            if (x && (x.productId || x.product_id) && (x.title?.displayTitle || x.title || x.subject)) found.push(x);
            else walk(x, depth + 1);
          }
        } else {
          for (const k of Object.keys(n)) walk(n[k], depth + 1);
        }
      };
      walk(data, 0);
      return found.slice(0, 40).map((p) => ({
        id: p.productId ?? p.product_id,
        title: p.title?.displayTitle ?? p.title ?? p.subject,
        price: p.prices?.salePrice?.minPrice ?? p.price?.value ?? p.salePrice ?? null,
        original: p.prices?.originalPrice?.minPrice ?? null,
        image: p.image?.imgUrl ?? p.imageUrl ?? p.image ?? null,
      }));
    })) as any[] | null;

    if (!items) {
      log.debug(`AliExpress "${query}" -> sem runParams`);
      return [];
    }
    const out: ScrapedProduct[] = [];
    for (const p of items) {
      if (out.length >= max) break;
      const price = typeof p.price === "number" ? p.price : parseBrl(String(p.price ?? ""));
      if (!p.id || !p.title || !Number.isFinite(price) || price <= 0) continue;
      const listPrice = typeof p.original === "number" && p.original > price ? p.original : undefined;
      let image: string | undefined = p.image ?? undefined;
      if (image && image.startsWith("//")) image = "https:" + image;
      out.push({
        source: "aliexpress",
        externalId: String(p.id),
        title: decodeEntities(String(p.title)),
        url: `https://www.aliexpress.com/item/${p.id}.html`,
        image,
        price,
        listPrice,
        query,
        imageSource: "real",
      });
    }
    log.debug(`AliExpress "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`AliExpress "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}

// ── Magazine Luiza ──────────────────────────────────────────────────────────
// Next.js: produtos no __NEXT_DATA__. Se a rota direta de busca for bloqueada,
// tentamos o fluxo interativo pela home (digitar e buscar) para herdar cookies.
export async function crawlMagaluBrowser(query: string, max: number): Promise<ScrapedProduct[]> {
  const browser = await getBrowser();
  if (!browser) return [];

  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query)}/`;
  let page: Page | null = null;

  try {
    page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (!req.method().includes("GET") || BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    try {
      await page.waitForSelector("#__NEXT_DATA__", { timeout: 8000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    let html = await page.content();
    
    // Se bloqueado, executa o fallback de interação real pela homepage
    if (!html || html.includes("Não é possível acessar a página") || !html.includes("__NEXT_DATA__")) {
      log.debug(`Magalu browser "/busca" bloqueado. Tentando fluxo interativo pela home para "${query}"...`);
      await page.goto("https://www.magazineluiza.com.br/", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector("#header-search-input", { timeout: 10000 });
      await page.click("#header-search-input");
      await page.type("#header-search-input", query, { delay: 100 });
      await page.waitForSelector('[data-testid="input-icon-end"]', { timeout: 5000 });
      await page.click('[data-testid="input-icon-end"]');
      await new Promise((resolve) => setTimeout(resolve, 6000));
      html = await page.content();
    }

    if (!html || html.length < 5000) return [];

    const nextM = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextM) {
      log.debug(`Magalu browser "${query}" -> sem __NEXT_DATA__`);
      return [];
    }

    const data = JSON.parse(nextM[1]);
    const list = findProducts(data);
    const out: ScrapedProduct[] = [];
    for (const p of list) {
      if (out.length >= max) break;
      out.push({ ...p, query });
    }

    log.debug(`Magalu browser "${query}" -> ${out.length} itens`);
    return out;
  } catch (e) {
    log.warn(`Magalu browser "${query}" failed: ${(e as Error).message}`);
    return [];
  } finally {
    if (page) await page.close();
  }
}
