import { config } from "./config.ts";
import { log } from "./log.ts";
import type { DealView } from "./db.ts";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SOURCE_LABEL: Record<string, string> = {
  mercadolivre: "Mercado Livre",
  amazon: "Amazon",
  magalu: "Magazine Luiza",
};

export function buildMessage(d: DealView): string {
  const label = SOURCE_LABEL[d.source] ?? d.source;
  const lines = [
    `🔥 <b>OFERTA</b> — ${label}`,
    `<b>${escapeHtml(d.title)}</b>`,
    ``,
    `💰 <b>${fmt(d.price)}</b>  <s>${fmt(d.avg_price)}</s>  (-${d.discount_pct.toFixed(0)}%)`,
    `📊 score ${(d.score * 100).toFixed(0)}/100 · ${d.category}`,
  ];
  if (d.ai_comment) lines.push(`🤖 ${escapeHtml(d.ai_comment)}`);
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
  if (!config.telegram.enabled) {
    log.info(`[telegram dry-run] ${d.title} ${fmt(d.price)}`);
    return false;
  }
  if (!config.telegram.botToken || !config.telegram.chatId) {
    log.warn("Telegram sem credenciais; pulando envio");
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: buildMessage(d),
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: keyboard(d.id),
        }),
      },
    );
    if (!res.ok) {
      log.warn(`Telegram HTTP ${res.status}`, await res.text());
      return false;
    }
    log.info(`Telegram enviado: ${d.title}`);
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
