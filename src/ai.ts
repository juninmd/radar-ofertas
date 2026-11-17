import { config } from "./config.ts";
import { log } from "./log.ts";
import type { DealEval } from "./types.ts";

export type Verdict = "COMPRA JÁ" | "VALE A PENA" | "MEDIANO" | "PASSE";

/** Veredito em caixa alta no início do comentário, ou null se a IA não seguiu o formato. */
export function verdictOf(comment: string | null | undefined): Verdict | null {
  const head = (comment ?? "")
    .trim()
    .replace(/^[^\p{L}]+/u, "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (head.startsWith("COMPRA JA")) return "COMPRA JÁ";
  if (head.startsWith("VALE A PENA")) return "VALE A PENA";
  if (head.startsWith("MEDIANO")) return "MEDIANO";
  if (head.startsWith("PASSE")) return "PASSE";
  return null;
}

const CACHE_TTL_MS = 24 * 3_600_000;
const cache = new Map<string, { comment: string; expires: number }>();

/** Mesmo produto no mesmo preço tem o mesmo veredito: não paga outra chamada. */
const cacheKey = (title: string, source: string, deal: DealEval) =>
  `${source}|${title}|${deal.price.toFixed(2)}|${deal.avg.toFixed(2)}`;

export function clearAnalysisCache() {
  cache.clear();
}

// Análise opcional via LiteLLM (OpenAI-compatível). Falha graciosamente:
// se indisponível, retorna null e o pipeline segue sem comentário de IA.
export async function analyzeDeal(
  title: string,
  source: string,
  deal: DealEval,
): Promise<string | null> {
  if (!config.litellm.enabled || process.env.LITELLM_ENABLED === "false" || !config.litellm.apiKey) return null;

  const key = cacheKey(title, source, deal);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.comment;

  const prompt =
    `Você é o "Faro de Ofertas", um caçador de promoções brasileiro afiado e bem-humorado. ` +
    `Em UMA frase curta (max 180 caracteres), pt-BR, comece com um veredito em CAIXA ALTA ` +
    `(COMPRA JÁ / VALE A PENA / MEDIANO / PASSE) seguido de um motivo direto. ` +
    `Produto: "${title}" (${source}). Preço atual R$${deal.price.toFixed(2)}, ` +
    `média histórica R$${deal.avg.toFixed(2)}, desconto ${deal.discountPct.toFixed(1)}%. ` +
    (deal.flags?.length ? `Sinais: ${deal.flags.join(", ")}. ` : "") +
    `Avalie o preco e a utilidade pratica no dia a dia: se o item for superfluo, inutil ou com desconto fraco, de veredito PASSE ou MEDIANO.`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), config.litellm.timeoutMs);
  try {
    const res = await fetch(`${config.litellm.base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.litellm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.litellm.model,
        temperature: 0.4,
        // 120 sobrava só para modelos sem raciocínio: os de raciocínio do pool
        // cloud/auto gastavam tudo antes da resposta e o comentário vinha vazio.
        // A frase continua curta (cortada em 240 caracteres abaixo).
        max_tokens: 600,
        reasoning_effort: "low",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      log.warn(`LiteLLM HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const txt = json.choices?.[0]?.message?.content?.trim();
    if (!txt) return null;
    const comment = txt.slice(0, 240);
    cache.set(key, { comment, expires: Date.now() + CACHE_TTL_MS });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return comment;
  } catch (e) {
    log.warn("LiteLLM indisponível", (e as Error).message);
    return null;
  } finally {
    clearTimeout(to);
  }
}
