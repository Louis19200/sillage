/**
 * Affichage des journées dans le tableau. « — » signifie `null` (pas de donnée),
 * ce qui se distingue toujours d'un vrai 0.
 */
export const MISSING = "—";

/** 8421 → « 8 421 » (séparateur fixe, sans dépendre d'Intl). */
export function formatSteps(steps: number | null): string {
  if (steps === null) return MISSING;
  return String(steps).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 412 → « 6 h 52 », 45 → « 0 h 45 ». */
export function formatSleepMinutes(minutes: number | null): string {
  if (minutes === null) return MISSING;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Heure locale d'un horodatage déjà exprimé avec le décalage local
 * (`2026-09-22T23:48:00+02:00` → « 23:48 »). On lit l'heure telle qu'écrite,
 * sans reconversion : c'est exactement ce qui sera envoyé à l'API.
 */
export function formatClock(iso: string | null): string {
  if (iso === null) return MISSING;
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[1]}:${match[2]}` : MISSING;
}

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Instant (ISO 8601) affiché en heure locale du téléphone : « 24/09 à 07:12 ». */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MISSING;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `2026-09-23` → « mer. 23/09 ». Calculé depuis les composants, sans fuseau. */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  // Midi local : aucun changement d'heure ne fait basculer le jour de la semaine.
  const weekday = WEEKDAYS[new Date(y, m - 1, d, 12).getDay()];
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
