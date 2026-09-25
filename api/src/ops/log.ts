/**
 * Journaux structurés : une ligne JSON par événement, lisible dans les Logs Vercel.
 * Ne jamais y mettre de token, de corps de requête complet ni de donnée santé.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type EventLogger = (level: LogLevel, event: string, fields?: LogFields) => void;

const MAX_TEXT = 300;

/** Retire ce qui ressemble à un secret (en-tête Bearer, tokens GitHub, longues chaînes hexadécimales) et tronque. */
export function sanitize(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [masqué]")
    .replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[token masqué]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[masqué]")
    .slice(0, MAX_TEXT);
}

/** Ligne JSON d'un événement (exportée pour les tests). */
export function formatEvent(level: LogLevel, event: string, fields: LogFields = {}, now: Date = new Date()): string {
  const clean: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    clean[k] = typeof v === "string" ? sanitize(v) : v;
  }
  return JSON.stringify({ ts: now.toISOString(), level, event, ...clean });
}

/** Logger par défaut : console.log / console.warn / console.error selon le niveau. */
export const logEvent: EventLogger = (level, event, fields) => {
  const line = formatEvent(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};
