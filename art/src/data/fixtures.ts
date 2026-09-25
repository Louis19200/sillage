import { DailyMetrics } from "@sillage/shared";
import rawDays from "@sillage/shared/fixtures/days.json";
import type { DataSource } from "./source";

/** Source locale : les 120 journées factices de `packages/shared/fixtures/days.json`. */
export function createFixturesSource(raw: unknown = rawDays): DataSource {
  const days = DailyMetrics.array()
    .parse(raw)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = new Map(days.map((d) => [d.date, d]));
  return {
    kind: "fixtures",
    getDay: async (date) => byDate.get(date) ?? null,
    getRange: async (from, to) => days.filter((d) => d.date >= from && d.date <= to),
    defaultDate: async () => days.at(-1)?.date ?? "2026-09-23",
    firstDate: async () => days[0]?.date ?? null,
  };
}
