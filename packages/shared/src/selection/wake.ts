/**
 * Minute locale du réveil (0–1439) lue dans `sleep_end`.
 *  - « 2026-07-14T07:57:00+02:00 » (décalage explicite) : l'heure écrite, 07:57 → 477 ;
 *  - « 2026-07-14T05:57:00.000Z » (UTC, tel que le renvoie l'API) : convertie dans
 *    `WAKE_TIME_ZONE` (Europe/Paris), 05:57Z en été → 07:57 → 477.
 * Les deux formes d'un même instant donnent donc la même minute, côté API comme côté navigateur.
 */
import { WAKE_TIME_ZONE } from "./constants";

const OFFSET_CLOCK = /T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/;
const UTC_STAMP = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/i;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

export function wakeMinute(sleepEnd: string | null | undefined, timeZone: string = WAKE_TIME_ZONE): number | null {
  if (!sleepEnd) return null;
  const m = OFFSET_CLOCK.exec(sleepEnd);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (UTC_STAMP.test(sleepEnd)) {
    const t = Date.parse(sleepEnd);
    if (Number.isNaN(t)) return null;
    let h = 0;
    let min = 0;
    for (const p of formatter(timeZone).formatToParts(new Date(t))) {
      if (p.type === "hour") h = Number(p.value) % 24;
      if (p.type === "minute") min = Number(p.value);
    }
    return h * 60 + min;
  }
  return null;
}

/** 477 → « 07:57 ». */
export function formatClock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
