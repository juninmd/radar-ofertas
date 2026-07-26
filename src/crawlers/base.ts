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

// fetch JSON best-effort (APIs públicas de e-commerce). Headers de browser p/
// reduzir bloqueio. Retorna null em qualquer falha.
export async function fetchJson<T = any>(url: string, timeoutMs = 12000, extraHeaders: Record<string, string> = {}): Promise<T | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        ...extraHeaders,
      },
      redirect: "follow",
    });
    if (!res.ok) {
      log.debug(`fetchJson ${res.status} ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    log.debug(`fetchJson erro ${url}: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(to);
  }
}

// Extrai e parseia o payload __NEXT_DATA__ de páginas Next.js (Magalu, Zoom,
// Buscapé, Kabum). Retorna null se ausente ou inválido.
export function extractNextData(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Converte valor monetário para reais SEM adivinhar escala. Aceita number já em
// reais, string US ("1289.00") e string BR ("1.289,00"). Retorna NaN se não for
// um valor monetário reconhecível — nunca divide por 100 no escuro (era a causa
// de preços do Magalu virarem centavos).
export function parseMoney(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== "string") return NaN;
  const s = raw.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return NaN;
  // BR: separador decimal vírgula ("1.289,00" | "1289,00")
  if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  // US: ponto decimal ("1289.00") ou inteiro ("1289")
  if (/^\d+(\.\d{1,2})?$/.test(s)) return Number(s);
  // milhar com ponto sem decimais ("1.289")
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return NaN;
}

// Query no formato de path do Magalu: espaços viram "+" literal (não %2B).
export function magaluSlug(query: string): string {
  return encodeURIComponent(query.trim()).replace(/%20/g, "+");
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

// Normaliza link de produto do Mercado Livre.
// - href direto de produto: remove query/fragment de tracking, mantém o permalink.
// - href de anúncio patrocinado (click1.mercadolivre.com.br/mclics/...): extrai o
//   item_id MLB e reconstrói o permalink canônico, pois o tracker não abre o produto.
export function cleanMlUrl(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const isTracker = /click\d*\.mercadolivre|\/mclics\/|\/clicks\//.test(raw);
  if (!isTracker && /^https?:\/\/[^/]*mercadolivre\.com\.br\//.test(raw)) {
    // permalink direto: corta tudo a partir de ? ou #
    return raw.split(/[?#]/)[0];
  }
  // patrocinado/tracker: pega o item_id (item_id:MLBxxxx, wid=MLBxxxx ou /MLB-xxxx)
  const m =
    raw.match(/item_id(?:%3A|:)MLB-?(\d+)/i) ||
    raw.match(/[?&]wid=MLB-?(\d+)/i) ||
    raw.match(/MLB-?(\d{6,})/);
  if (m) return `https://produto.mercadolivre.com.br/MLB-${m[1]}`;
  return fallback;
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
