import { config } from "./config.ts";
import { log } from "./log.ts";
import type { DealEval } from "./types.ts";

// Análise opcional via LiteLLM (OpenAI-compatível). Falha graciosamente:
// se indisponível, retorna null e o pipeline segue sem comentário de IA.
export async function analyzeDeal(
  title: string,
  source: string,
  deal: DealEval,
): Promise<string | null> {
  if (!config.litellm.enabled || process.env.LITELLM_ENABLED === "false" || !config.litellm.apiKey) return null;

  const prompt =
    `Você é o "Faro de Ofertas", um caçador de promoções brasileiro afiado e bem-humorado. ` +
    `Em UMA frase curta (max 180 caracteres), pt-BR, comece com um veredito em CAIXA ALTA ` +
    `(COMPRA JÁ / VALE A PENA / MEDIANO / PASSE) seguido de um motivo direto. ` +
    `Produto: "${title}" (${source}). Preço atual R$${deal.price.toFixed(2)}, ` +
    `média histórica R$${deal.avg.toFixed(2)}, desconto ${deal.discountPct.toFixed(1)}%. ` +
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
        max_tokens: 120,
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
    return txt && txt.length > 0 ? txt.slice(0, 240) : null;
  } catch (e) {
    log.warn("LiteLLM indisponível", (e as Error).message);
    return null;
  } finally {
    clearTimeout(to);
  }
}
