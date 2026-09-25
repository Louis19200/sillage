// Génère fixtures/context.json : le contexte (météo, Kp) de chaque journée de
// fixtures/days.json, même ordre, déterministe, avec des trous (null) et de vrais
// zéros (0 mm de pluie, Kp 0). Forme : `DayContext` (src/context.ts) + `date`.
// Usage : node scripts/gen-context-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";

let s = 20260925;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (min) => {
  const m = Math.round(min);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
const r1 = (x) => Math.round(x * 10) / 10;

const WEATHER_KEYS = ["temp_min", "temp_max", "precip_mm", "wind_max_kmh", "wind_dir_deg", "cloud_mean", "sunshine_min", "sunrise", "sunset", "weather_code"];

const days = JSON.parse(readFileSync(new URL("../fixtures/days.json", import.meta.url), "utf8"));
const out = days.map(({ date }, i) => {
  const doy = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 86400000;
  const season = Math.cos(((doy - 172) / 365) * 2 * Math.PI); // 1 au solstice d'été
  const cloud = Math.round(Math.min(100, Math.max(0, 55 - season * 20 + (rand() - 0.5) * 90)));
  const tmax = r1(17 + season * 9 + (rand() - 0.5) * 6 - cloud / 25);
  const tmin = r1(tmax - 5 - rand() * 6);
  const rainy = rand() < 0.35 + cloud / 300;
  const precip = rainy ? r1(0.2 + rand() ** 2 * 18) : 0;
  const daylight = 12 * 60 + season * 4 * 60;
  const sunrise = 13 * 60 + 50 - daylight / 2; // midi solaire ~13:50 à Paris l'été
  const code = precip > 8 ? 63 : precip > 0 ? (rand() < 0.5 ? 61 : 51) : cloud > 85 ? 3 : cloud > 50 ? 2 : cloud > 20 ? 1 : 0;
  const kpThirds = Math.min(27, Math.floor(-Math.log(1 - rand() * 0.999) * 5));
  const ctx = {
    date,
    location_source: i % 17 === 5 ? "phone" : "home",
    temp_min: tmin,
    temp_max: tmax,
    precip_mm: precip,
    wind_max_kmh: r1(8 + rand() * 30),
    wind_dir_deg: Math.round(rand() * 360),
    cloud_mean: cloud,
    sunshine_min: Math.round(Math.max(0, daylight * (1 - cloud / 100) * (0.6 + rand() * 0.3))),
    sunrise: hhmm(sunrise),
    sunset: hhmm(sunrise + daylight),
    weather_code: code,
    kp_max: Math.round((kpThirds / 3) * 1000) / 1000,
    updated_at: `${date}T02:45:00.000Z`,
  };
  // Trous : quelques journées sans météo (API indisponible), sans Kp, sans position connue.
  if (rand() < 0.06) for (const k of WEATHER_KEYS) ctx[k] = null;
  if (rand() < 0.05) ctx.kp_max = null;
  if (i === 7) ctx.location_source = null;
  return ctx;
});

writeFileSync(new URL("../fixtures/context.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`fixtures/context.json : ${out.length} journées`);
