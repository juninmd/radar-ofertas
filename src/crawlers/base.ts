import { log } from "../log.ts";

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

function getUA(): string {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

export async function fetchHtml(url: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1500)); // throttle
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": getUA(),
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "accept-encoding": "gzip, deflate",
        "cache-control": "max-age=0",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      log.debug(`fetch ${res.status} ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    log.debug(`fetch erro ${url}: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(to);
  }
}

export function parseBrl(raw: string): number {
  // "R$ 1.234,56" -> 1234.56
  const m = raw.replace(/\s/g, "").match(/([\d.]+,\d{2})/);
  if (!m) {
    const intMatch = raw.replace(/[^\d]/g, "");
    return intMatch ? Number(intMatch) : NaN;
  }
  return Number(m[1].replace(/\./g, "").replace(",", "."));
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
