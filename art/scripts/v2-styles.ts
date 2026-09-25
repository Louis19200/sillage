/**
 * Moteur v2 : liste le style de chaque jour et les fréquences, sur les fixtures (défaut) ou
 * sur un export JSON de `GET /range` (`pnpm --filter @sillage/art v2:styles -- chemin.json`).
 */
import { readFileSync } from "node:fs";
import rawDays from "@sillage/shared/fixtures/days.json";
import { computeChain, STYLE_NAMES, STYLES, type SelectionDay } from "@sillage/shared";

const file = process.argv[2];
const parsed: unknown = file ? JSON.parse(readFileSync(file, "utf8")) : rawDays;
const days = (Array.isArray(parsed) ? parsed : (parsed as { days: unknown[] }).days) as SelectionDay[];
const to = days.map((d) => d.date).sort().at(-1)!;
const { entries } = computeChain({ days, to });
const counts = new Map(STYLES.map((s) => [s, 0]));
for (const e of entries) counts.set(e.style, counts.get(e.style)! + 1);
const byMonth = new Map<string, string[]>();
for (const e of entries) {
  const k = e.date.slice(0, 7);
  byMonth.set(k, [...(byMonth.get(k) ?? []), `${e.date.slice(8)} ${e.style}`]);
}
for (const [m, list] of byMonth) console.log(`${m}\n  ${list.join("  ")}`);
console.log(`\n${entries.length} jours :`);
for (const s of STYLES) console.log(`  ${STYLE_NAMES[s].padEnd(14)} ${String(counts.get(s)).padStart(5)}  ${((100 * counts.get(s)!) / entries.length).toFixed(1)} %`);
