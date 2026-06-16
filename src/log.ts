import { config } from "./config.ts";

const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = levels[config.logLevel] ?? 20;

function emit(level: string, msg: string, extra?: unknown) {
  if ((levels[level] ?? 20) < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
