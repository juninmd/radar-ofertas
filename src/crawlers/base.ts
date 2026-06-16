import { log } from "../log.ts";

const UAS = [
  // Desktop Chrome
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  // Mobile Chrome (often less blocked)
  "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  // iPad
  "Mozilla/5.0 (iPad; CPU OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
  // Firefox
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  // Safari
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15",
];

function getUA(): string {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

export async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300)); // modest throttle
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
