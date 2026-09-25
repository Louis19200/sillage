/**
 * Palettes v2 : une famille par saison (durée du jour à Paris), une humeur par le sommeil,
 * une nuance par la température quand elle existe. Indépendant de la technique : toutes les
 * techniques (sauf Marée, qui garde la palette de la v1) peignent avec la palette du jour.
 *
 * Tout se règle ici : `SEASONS` (couleurs), `MOODS` (seuils de sommeil), `TEMPERATURE`.
 */
import { createRng } from "../engine/random";
import { desaturate, fmt, mixHex } from "./helpers";
import type { ExplainLine, PaletteV2 } from "./types";

type Season = PaletteV2["season"];
type Mood = PaletteV2["mood"];

interface SeasonColors {
  label: string;
  paper: string;
  ink: string;
  night: string;
  colors: PaletteV2["colors"];
}

/** Couleurs de base de chaque saison. L'été est la palette des esquisses validées. */
export const SEASONS: Record<Season, SeasonColors> = {
  hiver: { label: "Hiver", paper: "#eef0f2", ink: "#1b2230", night: "#0f1a2b", colors: ["#2f4f7f", "#b86b77", "#d9c38f", "#8aa6b8", "#6b2f4f"] },
  printemps: { label: "Printemps", paper: "#f3f0e6", ink: "#22302a", night: "#1b2a2f", colors: ["#3f7f8c", "#e58f8a", "#f1d27a", "#9cc58e", "#c4577a"] },
  ete: { label: "Été", paper: "#f2ece1", ink: "#1d1f2b", night: "#14213d", colors: ["#1f5f6b", "#e07a4f", "#f2b84b", "#8fb39a", "#b8413c"] },
  automne: { label: "Automne", paper: "#efe6d8", ink: "#2a1f1a", night: "#231a24", colors: ["#3d5a6c", "#c8662f", "#e0a73c", "#7d8c5a", "#8e2f2b"] },
};

/** Saison par la durée du jour : < 10 h hiver, ≥ 14 h 30 été, entre les deux printemps ou automne. */
export const DAY_LENGTH = { winterBelow: 10, summerFrom: 14.5, latitude: 48.85 } as const;

/** Humeur par le centile de sommeil : nuit courte → nocturne, longue nuit → lumineux ; absent → brume. */
export const MOODS = { nocturneBelow: 0.33, lumineuxFrom: 0.67 } as const;

/** Nuance de température (°C, max du jour) : seulement si la donnée existe. */
export const TEMPERATURE = { hotFrom: 25, coldBelow: 5, amount: 0.14, hot: "#e0703a", cold: "#5f86b8" } as const;

const MOOD_LABEL: Record<Mood, string> = { nocturne: "nocturne", doux: "doux", lumineux: "lumineux", brume: "brume" };

/** Durée du jour (heures) à la latitude donnée, formule astronomique simple (à ±10 min). */
export function dayLengthHours(date: string, latitude: number = DAY_LENGTH.latitude): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  const decl = (23.44 * Math.PI) / 180 * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const x = -Math.tan((latitude * Math.PI) / 180) * Math.tan(decl);
  const h = Math.acos(Math.max(-1, Math.min(1, x)));
  return (2 * h * 180) / Math.PI / 15;
}

/** Phase de lune 0–1 (0 = nouvelle, 0,5 = pleine), depuis la nouvelle lune de référence du 6 janvier 2000. */
export function moonPhase(date: string): number {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const t = (Date.parse(`${date}T12:00:00Z`) - ref) / 86_400_000;
  return (((t / 29.530588853) % 1) + 1) % 1;
}

export function seasonOf(date: string): Season {
  const len = dayLengthHours(date);
  if (len < DAY_LENGTH.winterBelow) return "hiver";
  if (len >= DAY_LENGTH.summerFrom) return "ete";
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  // Jours qui rallongent (avant le 21 juin) : printemps ; qui raccourcissent : automne.
  return m < 6 || (m === 6 && d < 21) ? "printemps" : "automne";
}

export function moodOf(sleep: number | null): Mood {
  if (sleep === null) return "brume";
  if (sleep < MOODS.nocturneBelow) return "nocturne";
  if (sleep >= MOODS.lumineuxFrom) return "lumineux";
  return "doux";
}

export interface PaletteData {
  date: string;
  seed: number;
  sleep: number | null;
  tempMax: number | null;
}

export function paletteFor({ date, seed, sleep, tempMax }: PaletteData): PaletteV2 {
  const season = seasonOf(date);
  const mood = moodOf(sleep);
  const base = SEASONS[season];
  let paper = base.paper;
  let ink = base.ink;
  let night = base.night;
  let colors = [...base.colors] as PaletteV2["colors"];

  if (mood === "nocturne") {
    paper = mixHex(base.night, "#000000", 0.15);
    ink = base.paper;
    night = mixHex(base.night, "#000000", 0.3);
  } else if (mood === "lumineux") {
    paper = mixHex(base.paper, "#ffffff", 0.4);
    colors = colors.map((c) => mixHex(c, "#ffffff", 0.08)) as PaletteV2["colors"];
  } else if (mood === "brume") {
    paper = desaturate(base.paper, 0.6);
    night = desaturate(base.night, 0.5);
    colors = colors.map((c) => desaturate(c, 0.55)) as PaletteV2["colors"];
  }
  if (tempMax !== null && (tempMax >= TEMPERATURE.hotFrom || tempMax < TEMPERATURE.coldBelow)) {
    const tint = tempMax >= TEMPERATURE.hotFrom ? TEMPERATURE.hot : TEMPERATURE.cold;
    colors = colors.map((c) => mixHex(c, tint, TEMPERATURE.amount)) as PaletteV2["colors"];
  }
  // Petite variation seedée : l'ordre des accents tourne (même famille de couleurs, autre équilibre).
  const shift = createRng(seed).fork("palette").int(0, 4);
  colors = [...colors.slice(shift), ...colors.slice(0, shift)] as PaletteV2["colors"];

  return { id: `${season}-${mood}`, name: `${base.label} · ${MOOD_LABEL[mood]}`, season, mood, paper, ink, night, colors };
}

export function explainPalette(p: PaletteV2, data: { date: string; sleep: number | null; tempMax: number | null }): ExplainLine[] {
  const len = dayLengthHours(data.date);
  const h = Math.floor(len);
  const min = Math.round((len - h) * 60);
  return [
    { param: "Famille de palette", source: `Durée du jour à Paris (${h} h ${String(min).padStart(2, "0")})`, value: SEASONS[p.season].label },
    {
      param: "Humeur de la palette",
      source: data.sleep === null ? "Sommeil non mesuré" : `Sommeil (${Math.round(data.sleep * 100)}ᵉ centile)`,
      value: `${MOOD_LABEL[p.mood]}${p.mood === "brume" ? " (couleurs désaturées : sommeil inconnu)" : ""}`,
    },
    {
      param: "Nuance de température",
      source: data.tempMax === null ? "Température non disponible" : `Température max (${fmt(data.tempMax, 1)} °C)`,
      value:
        data.tempMax === null ? "aucune"
        : data.tempMax >= TEMPERATURE.hotFrom ? "réchauffée"
        : data.tempMax < TEMPERATURE.coldBelow ? "refroidie"
        : "aucune",
    },
  ];
}
