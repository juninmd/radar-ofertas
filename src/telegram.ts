import { config } from "./config.ts";
import { log } from "./log.ts";
import { priceSeries } from "./db.ts";
import type { DealView } from "./db.ts";
import { isPriceBug } from "./deal.ts";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SOURCE_LABEL: Record<string, string> = {
  mercadolivre: "Mercado Livre",
  amazon: "Amazon",
  magalu: "Magazine Luiza",
  kabum: "KaBuM!",
  aliexpress: "AliExpress",
  shopee: "Shopee",
  casasbahia: "Casas Bahia",
  pontofrio: "Ponto",
  extra: "Extra",
};

const BARS = "▁▂▃▄▅▆▇█";
export function sparkline(series: number[]): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map((v) => BARS[Math.min(BARS.length - 1, Math.floor(((v - min) / range) * (BARS.length - 1)))])
    .join("");
}

function heat(score: number): string {
  if (score >= 0.8) return "🔥🔥🔥 IMPERDÍVEL";
  if (score >= 0.6) return "🔥🔥 ÓTIMA";
  if (score >= 0.45) return "🔥 BOA";
  return "✨ razoável";
}

export function buildCaption(d: DealView): string {
  const label = SOURCE_LABEL[d.source] ?? d.source;
  const series = priceSeries(d.product_id, 24);
  const spark = sparkline(series);
  const isLowest = d.min_price > 0 && d.price <= d.min_price + 0.001;
  const economia = d.avg_price - d.price;
  const priceBug = isPriceBug(d.discount_pct);

  const lines = priceBug
    ? [
        `⚠️🐞 <b>POSSÍVEL ERRO DE PREÇO</b> 🐞⚠️`,
        `<i>Preço muito abaixo do histórico — pode ser bug de precificação. Confira antes de comprar.</i>`,
        `🏬 ${label} · 🏷️ ${d.category}`,
        ``,
      ]
    : [
    `🔥 <b>OFERTA ${heat(d.score)}</b>`,
    `🏬 ${label} · 🏷️ ${d.category}`,
    ``,
    `<b>${escapeHtml(d.title)}</b>`,
    ``,
    `💰 <b>${fmt(d.price)}</b>  <s>${fmt(d.avg_price)}</s>`,
    `📉 <b>-${d.discount_pct.toFixed(0)}%</b> · economia de ${fmt(economia)} vs média`,
  ];
  if (isLowest) lines.push(`🏆 <b>MENOR PREÇO HISTÓRICO!</b>`);
  lines.push(
    `📊 mín ${fmt(d.min_price)} · máx ${fmt(d.max_price)} · ${d.points} leituras`,
  );
  if (spark) lines.push(`📈 histórico: <code>${spark}</code>`);
  lines.push(`🎯 score ${(d.score * 100).toFixed(0)}/100`);
  if (d.ai_comment) lines.push(``, `🤖 <i>${escapeHtml(d.ai_comment)}</i>`);
  lines.push(``, `🔗 ${d.url}`);
  return lines.join("\n");
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// botões inline 👍/👎 -> callback tratado pelo webhook/poller (ou via dashboard)
function keyboard(dealId: number) {
  return {
    inline_keyboard: [
      [
        { text: "👍 Curtir", callback_data: `like:${dealId}` },
        { text: "👎 Não curtir", callback_data: `dislike:${dealId}` },
      ],
    ],
  };
}

export async function notifyDeal(d: DealView): Promise<boolean> {
  const caption = buildCaption(d);
  if (!config.telegram.enabled) {
    log.info(`[telegram dry-run] ${d.title} ${fmt(d.price)}`);
    return false;
  }
  if (!config.telegram.botToken || !config.telegram.chatId) {
    log.warn("Telegram sem credenciais; pulando envio");
    return false;
  }
  const base = `https://api.telegram.org/bot${config.telegram.botToken}`;
  // com imagem: sendPhoto (caption tem limite de 1024 chars); sem: sendMessage
  const hasImg = !!d.image && /^https?:\/\//.test(d.image);
  const endpoint = hasImg ? "sendPhoto" : "sendMessage";
  const payload: Record<string, unknown> = hasImg
    ? { chat_id: config.telegram.chatId, photo: d.image, caption: caption.slice(0, 1024), parse_mode: "HTML" }
    : { chat_id: config.telegram.chatId, text: caption, parse_mode: "HTML", disable_web_page_preview: false };
  payload.reply_markup = keyboard(d.id);

  try {
    let res = await fetch(`${base}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // se o sendPhoto falhar (imagem inacessível), faz fallback p/ texto
    if (!res.ok && hasImg) {
      log.warn(`sendPhoto falhou (${res.status}); fallback texto`);
      res = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: caption,
          parse_mode: "HTML",
          reply_markup: keyboard(d.id),
        }),
      });
    }
    if (!res.ok) {
      log.warn(`Telegram HTTP ${res.status}`, await res.text());
      return false;
    }
    log.info(`Telegram enviado${hasImg ? " 🖼️" : ""}: ${d.title}`);
    return true;
  } catch (e) {
    log.warn("Falha Telegram", (e as Error).message);
    return false;
  }
}

// Processa callbacks de botões (long-polling) p/ registrar feedback.
export async function pollCallbacks(
  onVote: (dealId: number, vote: 1 | -1) => void,
  offsetRef: { offset: number },
): Promise<void> {
  if (!config.telegram.enabled || !config.telegram.botToken) return;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/getUpdates?timeout=0&offset=${offsetRef.offset}&allowed_updates=["callback_query"]`,
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      result?: {
        update_id: number;
        callback_query?: { id: string; data?: string };
      }[];
    };
    for (const u of json.result ?? []) {
      offsetRef.offset = u.update_id + 1;
      const data = u.callback_query?.data;
      if (!data) continue;
      const [action, idStr] = data.split(":");
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      if (action === "like") onVote(id, 1);
      else if (action === "dislike") onVote(id, -1);
      // ack
      await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            callback_query_id: u.callback_query!.id,
            text: action === "like" ? "👍 Registrado!" : "👎 Anotado!",
          }),
        },
      );
    }
  } catch {
    /* silencioso: poller é best-effort */
  }
}
