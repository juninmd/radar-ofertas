import { config } from "./config.ts";

// Calendário da Black Friday (BR): última sexta de novembro = 4ª sexta, pois
// novembro tem 30 dias. "Black November" = o mês inteiro até a Cyber Monday.
export type SeasonPhase = "none" | "black-november" | "black-friday" | "cyber-monday";

export interface SeasonInfo {
  phase: SeasonPhase;
  active: boolean;
  peak: boolean; // semana da BF ou Cyber Monday: ritmo máximo
  label: string;
  blackFriday: Date;
  baselineCutoff: Date; // preços antes disto = "preço normal"
  daysToBlackFriday: number;
}

const DAY = 86_400_000;

export function blackFridayDate(year: number): Date {
  const firstNov = new Date(Date.UTC(year, 10, 1));
  const toFriday = (5 - firstNov.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, 10, 1 + toFriday + 21));
}

export function seasonInfo(now = new Date()): SeasonInfo {
  const year = now.getUTCFullYear();
  const bf = blackFridayDate(year);
  const cutoffEnv = config.season.baselineCutoff ? new Date(config.season.baselineCutoff) : null;
  const baselineCutoff =
    cutoffEnv && !Number.isNaN(cutoffEnv.getTime()) ? cutoffEnv : new Date(Date.UTC(year, 10, 1));
  const start = new Date(Date.UTC(year, 10, 1));
  const peakStart = new Date(bf.getTime() - 3 * DAY); // terça da semana da BF
  const cyberMonday = new Date(bf.getTime() + 3 * DAY);
  const end = new Date(cyberMonday.getTime() + DAY); // fim da Cyber Monday

  const daysToBlackFriday = Math.ceil((bf.getTime() - now.getTime()) / DAY);
  const base = { blackFriday: bf, baselineCutoff, daysToBlackFriday };

  const mode = config.season.mode;
  if (mode === "off") return { ...base, phase: "none", active: false, peak: false, label: "" };
  if (mode === "force") return { ...base, phase: "black-friday", active: true, peak: true, label: "BLACK FRIDAY" };

  const t = now.getTime();
  if (t < start.getTime() || t >= end.getTime())
    return { ...base, phase: "none", active: false, peak: false, label: "" };
  if (t >= cyberMonday.getTime())
    return { ...base, phase: "cyber-monday", active: true, peak: true, label: "CYBER MONDAY" };
  if (t >= peakStart.getTime())
    return { ...base, phase: "black-friday", active: true, peak: true, label: "BLACK FRIDAY" };
  return { ...base, phase: "black-november", active: true, peak: false, label: "BLACK NOVEMBER" };
}

// Ajustes operacionais da temporada: ritmo de coleta, teto de envios e termos extras.
export function seasonTuning(now = new Date()) {
  const s = seasonInfo(now);
  if (!s.active) {
    return {
      season: s,
      crawlIntervalMin: config.crawlIntervalMin,
      maxNotificationsPerCycle: config.maxNotificationsPerCycle,
      extraQueries: [] as string[],
    };
  }
  const interval = s.peak ? config.season.peakCrawlIntervalMin : config.season.crawlIntervalMin;
  return {
    season: s,
    // nunca desacelera quem já roda mais rápido; 0 (desligado) continua desligado
    crawlIntervalMin: config.crawlIntervalMin > 0 ? Math.min(config.crawlIntervalMin, interval) : 0,
    maxNotificationsPerCycle: Math.max(config.maxNotificationsPerCycle, config.season.maxNotificationsPerCycle),
    extraQueries: config.season.queries,
  };
}
