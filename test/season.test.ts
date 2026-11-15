import { describe, expect, test } from "bun:test";
import { blackFridayDate, seasonInfo, seasonTuning } from "../src/season.ts";

describe("calendário Black Friday", () => {
  test("última sexta de novembro", () => {
    expect(blackFridayDate(2025).toISOString().slice(0, 10)).toBe("2025-11-28");
    expect(blackFridayDate(2026).toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(blackFridayDate(2027).toISOString().slice(0, 10)).toBe("2027-11-26");
  });

  test("fases: fora, Black November, semana da BF, Cyber Monday", () => {
    expect(seasonInfo(new Date("2026-10-20T12:00:00Z")).phase).toBe("none");
    expect(seasonInfo(new Date("2026-11-15T12:00:00Z")).phase).toBe("black-november");
    expect(seasonInfo(new Date("2026-11-27T12:00:00Z")).phase).toBe("black-friday");
    expect(seasonInfo(new Date("2026-11-30T12:00:00Z")).phase).toBe("cyber-monday");
    expect(seasonInfo(new Date("2026-12-05T12:00:00Z")).phase).toBe("none");
  });

  test("temporada acelera coleta e amplia teto de envios", () => {
    const off = seasonTuning(new Date("2026-10-01T12:00:00Z"));
    const peak = seasonTuning(new Date("2026-11-27T12:00:00Z"));
    expect(peak.crawlIntervalMin).toBeLessThan(off.crawlIntervalMin);
    expect(peak.maxNotificationsPerCycle).toBeGreaterThan(off.maxNotificationsPerCycle);
    expect(peak.extraQueries.length).toBeGreaterThan(0);
    expect(off.extraQueries).toHaveLength(0);
  });
});
