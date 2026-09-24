// Génère fixtures/days.json : 120 jours factices mais réalistes, déterministes,
// avec des trous (null) et de vrais zéros, pour développer art/ sans backend.
// Usage : node scripts/gen-fixtures.mjs
import { writeFileSync } from "node:fs";

let s = 20260924;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const at = (date, minutes) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return `${iso(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00+02:00`;
};

const days = [];
const end = new Date("2026-09-23T00:00:00Z");
for (let i = 119; i >= 0; i--) {
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() - i);
  const date = iso(d);
  const weekend = [0, 6].includes(d.getUTCDay());
  const r = rand();

  let steps = Math.round(4000 + rand() * 9000 + (weekend ? 3000 : 0));
  if (r < 0.06) steps = null; // montre oubliée
  else if (r < 0.08) steps = 0; // vraie journée au lit

  let sleep_minutes = Math.round(330 + rand() * 180);
  let sleep_start = null;
  let sleep_end = null;
  if (rand() < 0.07) sleep_minutes = null;
  else {
    const wake = 6 * 60 + 30 + Math.round(rand() * 150) + (weekend ? 60 : 0);
    sleep_end = at(date, wake);
    sleep_start = at(date, wake - sleep_minutes);
  }

  let commits = weekend ? Math.round(rand() * 3) : Math.round(rand() * 14);
  if (rand() < 0.15) commits = 0;

  days.push({ date, steps, sleep_minutes, sleep_start, sleep_end, commits, updated_at: "2026-09-24T06:00:00+02:00" });
}
writeFileSync(new URL("../fixtures/days.json", import.meta.url), JSON.stringify(days, null, 2) + "\n");
console.log(`${days.length} jours écrits`);
