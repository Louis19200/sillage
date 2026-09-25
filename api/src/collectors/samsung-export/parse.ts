/**
 * Lecture de l'export « Télécharger mes données personnelles » de Samsung Health.
 *
 * Fonctions pures (aucun accès disque ni réseau) : elles prennent le texte des CSV
 * et renvoient des `HealthDay` prêts pour `POST /ingest/health`.
 *
 * Format Samsung : ligne 1 = identifiant technique du fichier, ligne 2 = noms de
 * colonnes, puis une ligne par enregistrement (avec une virgule finale en trop).
 *
 * Règles (les mêmes que l'app Android, voir app/src/days.ts) :
 * - Pas : `pedometer_day_summary` contient une ligne par appareil et par jour, plus
 *   une ligne « tous appareils » fusionnée par Samsung (celle qui a `source_info`).
 *   On prend celle-ci ; à défaut, la plus grande valeur du jour. `day_time` porte
 *   déjà la date locale (minuit, sans décalage) : on ne la recalcule pas.
 * - Sommeil : `sleep_combined`, horaires en UTC + `time_offset` (« UTC+0200 »).
 *   Une nuit compte pour le jour **local** du réveil. `sleep_minutes` = somme des
 *   `sleep_duration` des sessions qui se terminent ce jour-là (une session qui en
 *   chevauche une autre n'est comptée qu'une fois : on garde la plus longue) ;
 *   `sleep_start` / `sleep_end` = ceux de la plus longue, avec le décalage local.
 * - Une donnée absente reste absente (champ omis) : jamais 0 par défaut.
 */
import type { HealthDay } from "@sillage/shared";

export type CsvRow = Record<string, string>;

/** Découpe une ligne CSV (guillemets doublés gérés). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Lit un CSV Samsung : saute la ligne technique, utilise la 2e comme en-tête. */
export function parseSamsungCsv(text: string): CsvRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[1]!);
  return lines.slice(2).map((line) => {
    const cells = splitCsvLine(line);
    const row: CsvRow = {};
    header.forEach((name, i) => {
      if (name) row[name] = cells[i] ?? "";
    });
    return row;
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pas par date locale. */
export function stepsByDate(rows: readonly CsvRow[]): Map<string, number> {
  const perDay = new Map<string, { merged: number | null; max: number }>();
  for (const r of rows) {
    const date = (r.day_time ?? "").slice(0, 10);
    const count = Number(r.step_count);
    if (!ISO_DATE.test(date) || !Number.isFinite(count) || count < 0 || r.step_count === "") continue;
    const entry = perDay.get(date) ?? { merged: null, max: 0 };
    entry.max = Math.max(entry.max, count);
    if (r.source_info) entry.merged = Math.max(entry.merged ?? 0, count);
    perDay.set(date, entry);
  }
  const out = new Map<string, number>();
  for (const [date, e] of perDay) out.set(date, Math.round(e.merged ?? e.max));
  return out;
}

/** « UTC+0200 » → minutes (+120). `null` si illisible. */
export function parseOffset(raw: string): number | null {
  const m = /^UTC([+-])(\d{2}):?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/** « 2023-04-09 21:20:00.000 » (UTC) → millisecondes. */
function parseUtc(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant UTC + décalage → « 2023-04-09T23:20:00+02:00 » (heure locale de l'époque). */
export function toLocalIso(utcMs: number, offsetMin: number): string {
  const d = new Date(utcMs + offsetMin * 60_000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

interface Session {
  start: number;
  end: number;
  offset: number;
  minutes: number;
}

export interface SleepDay {
  sleep_minutes: number;
  sleep_start: string;
  sleep_end: string;
}

/** Sommeil par date locale du réveil. */
export function sleepByDate(rows: readonly CsvRow[]): Map<string, SleepDay> {
  const byDate = new Map<string, Session[]>();
  for (const r of rows) {
    const start = parseUtc(r.start_time ?? "");
    const end = parseUtc(r.end_time ?? "");
    const offset = parseOffset(r.time_offset ?? "");
    // Lignes corrompues (ex. datées de 1970) ou incohérentes : ignorées.
    if (start === null || end === null || offset === null) continue;
    if (start < Date.UTC(2000, 0, 1) || end <= start || end - start > 24 * 3_600_000) continue;
    const span = Math.round((end - start) / 60_000);
    const declared = Number(r.sleep_duration);
    const minutes = Number.isFinite(declared) && declared > 0 && declared <= span ? Math.round(declared) : span;
    const date = toLocalIso(end, offset).slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push({ start, end, offset, minutes });
    byDate.set(date, list);
  }

  const out = new Map<string, SleepDay>();
  for (const [date, sessions] of byDate) {
    // Chevauchement : une seule des deux sessions compte (la plus longue).
    const kept: Session[] = [];
    for (const s of [...sessions].sort((a, b) => b.minutes - a.minutes)) {
      if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
    }
    const longest = kept[0]!;
    out.set(date, {
      sleep_minutes: kept.reduce((sum, s) => sum + s.minutes, 0),
      sleep_start: toLocalIso(longest.start, longest.offset),
      sleep_end: toLocalIso(longest.end, longest.offset),
    });
  }
  return out;
}

/**
 * Fusionne pas et sommeil en journées, triées, en excluant `today` et au-delà
 * (journée incomplète). Seules les valeurs présentes sont incluses.
 */
export function buildHealthDays(
  steps: ReadonlyMap<string, number>,
  sleep: ReadonlyMap<string, SleepDay>,
  today: string,
): HealthDay[] {
  const dates = [...new Set([...steps.keys(), ...sleep.keys()])].filter((d) => d < today).sort();
  return dates.map((date) => {
    const day: HealthDay = { date };
    const s = steps.get(date);
    if (s !== undefined) day.steps = s;
    const n = sleep.get(date);
    if (n) Object.assign(day, n);
    return day;
  });
}
