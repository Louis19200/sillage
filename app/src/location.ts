/**
 * Position quotidienne ARRONDIE, pour la météo du moteur v2. Module pur (stockage,
 * permission, capteur, réseau et horloge injectés) : testé avec jest, sans téléphone.
 *
 * Vie privée, dans cet ordre :
 * - toute position est arrondie à 2 décimales (~1 km) dès sa lecture, AVANT d'être stockée,
 *   envoyée ou comparée : aucune fonction de ce module ne garde une coordonnée brute ;
 * - une seule position par journée locale (la dernière relevée ce jour-là), jamais de trajet ;
 * - une position envoyée est effacée du téléphone ; désactiver l'option efface tout ;
 * - aucun message, état mémorisé ou ligne de diagnostic ne contient de coordonnée
 *   (seulement des dates) ; les messages d'erreur venus d'ailleurs passent par
 *   `scrubCoordinates` ; rien n'est loggué.
 */
import { ingestLocationDays, type FetchLike, type LocationIngestDay } from "./api";
import { localDateOf, type LocalDate } from "./days";

/** 2 décimales : ~1,1 km en latitude, assez pour la météo, trop peu pour une adresse. */
export const LOCATION_DECIMALS = 2;
/** Au plus 30 journées envoyées par synchro. */
export const MAX_LOCATION_DAYS = 30;
/** Journées gardées sur le téléphone en attendant l'envoi : 30 terminées + aujourd'hui. */
export const MAX_STORED_DAYS = MAX_LOCATION_DAYS + 1;

/** Position déjà arrondie (seule forme qui circule hors de `roundPosition`). */
export interface RoundedPosition {
  lat: number;
  lon: number;
}

export interface LocationDay extends RoundedPosition {
  date: LocalDate;
}

export interface LocationStore {
  /** Option « Envoyer ma position approximative » ; désactivée par défaut. */
  enabled: boolean;
  /** Positions pas encore envoyées, une par journée locale, triées par date. */
  pending: LocationDay[];
  /** Journée de la dernière position relevée (la date seulement). */
  lastCaptured: LocalDate | null;
  /** Dernière journée dont la position a été acceptée par l'API. */
  lastSent: LocalDate | null;
}

export const DEFAULT_LOCATION_STORE: LocationStore = {
  enabled: false,
  pending: [],
  lastCaptured: null,
  lastSent: null,
};

/** Arrondi à 2 décimales ; jamais de `-0`. */
export function roundCoordinate(v: number): number {
  const r = Math.round(v * 10 ** LOCATION_DECIMALS) / 10 ** LOCATION_DECIMALS;
  return r === 0 ? 0 : r;
}

/** Arrondit une position brute ; `null` si elle est inutilisable (NaN, hors bornes). */
export function roundPosition(latitude: number, longitude: number): RoundedPosition | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: roundCoordinate(latitude), lon: roundCoordinate(longitude) };
}

/**
 * Mémorise la position du jour local de `now` (remplace celle déjà relevée ce jour-là :
 * une seule position par journée). Sans effet si l'option est désactivée ou la position
 * inutilisable. Ne garde que les `MAX_STORED_DAYS` journées les plus récentes.
 */
export function recordPosition(
  store: LocationStore,
  coords: { latitude: number; longitude: number },
  now: Date
): LocationStore {
  if (!store.enabled) return store;
  const pos = roundPosition(coords.latitude, coords.longitude);
  if (!pos) return store;
  const date = localDateOf(now);
  const pending = store.pending.filter((d) => d.date !== date);
  pending.push({ date, ...pos });
  pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...store, pending: pending.slice(-MAX_STORED_DAYS), lastCaptured: date };
}

/** Une position a-t-elle déjà été relevée pour le jour local de `now` ? */
export function hasPositionFor(store: LocationStore, now: Date): boolean {
  const today = localDateOf(now);
  return store.pending.some((d) => d.date === today) || store.lastCaptured === today;
}

/**
 * Journées à envoyer : terminées (jamais aujourd'hui, comme days.ts, car la position du
 * jour peut encore changer), pas encore envoyées, les `MAX_LOCATION_DAYS` plus récentes,
 * dans l'ordre chronologique.
 */
export function selectDaysToSend(store: LocationStore, now: Date): LocationDay[] {
  const today = localDateOf(now);
  return store.pending
    .filter((d) => d.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-MAX_LOCATION_DAYS);
}

/** Après un envoi réussi : efface du téléphone les positions envoyées, ne garde que leur date. */
export function markSent(store: LocationStore, sent: readonly LocationDay[]): LocationStore {
  if (sent.length === 0) return store;
  const dates = new Set(sent.map((d) => d.date));
  const last = sent.reduce((m, d) => (d.date > m ? d.date : m), sent[0]!.date);
  return {
    ...store,
    pending: store.pending.filter((d) => !dates.has(d.date)),
    lastSent: store.lastSent && store.lastSent > last ? store.lastSent : last,
  };
}

/** Désactiver l'option : tout est effacé, positions en attente comprises. */
export function disabledStore(): LocationStore {
  return { ...DEFAULT_LOCATION_STORE, pending: [] };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Forme stockée, compacte (SecureStore déconseille plus de 2 Ko) :
 * `{ e: 0|1, p: [[date, lat, lon], …], c: date|null, s: date|null }`.
 */
export function serializeLocationStore(store: LocationStore): string {
  return JSON.stringify({
    e: store.enabled ? 1 : 0,
    // Ré-arrondi par précaution : même un appelant fautif ne peut rien écrire de plus précis.
    p: store.pending.slice(-MAX_STORED_DAYS).map((d) => [d.date, roundCoordinate(d.lat), roundCoordinate(d.lon)]),
    c: store.lastCaptured,
    s: store.lastSent,
  });
}

/** Relit l'état ; illisible ou absent → option désactivée, rien en attente. */
export function parseLocationStore(raw: string | null): LocationStore {
  if (!raw) return disabledStore();
  try {
    const v = JSON.parse(raw) as { e?: unknown; p?: unknown; c?: unknown; s?: unknown } | null;
    if (typeof v !== "object" || v === null) return disabledStore();
    const pending: LocationDay[] = [];
    if (Array.isArray(v.p)) {
      for (const item of v.p) {
        if (!Array.isArray(item) || item.length !== 3) continue;
        const [date, lat, lon] = item as unknown[];
        if (typeof date !== "string" || !DATE_RE.test(date)) continue;
        if (typeof lat !== "number" || typeof lon !== "number") continue;
        const pos = roundPosition(lat, lon);
        if (pos && !pending.some((d) => d.date === date)) pending.push({ date, ...pos });
      }
    }
    pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const date = (x: unknown): LocalDate | null => (typeof x === "string" && DATE_RE.test(x) ? x : null);
    return {
      enabled: v.e === 1,
      pending: pending.slice(-MAX_STORED_DAYS),
      lastCaptured: date(v.c),
      lastSent: date(v.s),
    };
  } catch {
    return disabledStore();
  }
}

/**
 * Masque tout nombre qui ressemble à une coordonnée précise (au moins 3 décimales) dans un
 * texte venu d'ailleurs (erreur du capteur, réponse de l'API) avant de l'afficher ou de le
 * mémoriser.
 */
export function scrubCoordinates(text: string): string {
  return text.replace(/-?\d+[.,]\d{3,}/g, "…");
}

/** `granted` : ACCESS_COARSE_LOCATION accordée. */
export type LocationPermission = "granted" | "denied" | "unknown";

/** `current` : demander une position (premier plan) ; `last-known` : dernière connue, sans allumer le GPS. */
export type PositionMode = "current" | "last-known";

export interface LocationDeps {
  loadStore(): Promise<LocationStore>;
  saveStore(store: LocationStore): Promise<void>;
  permission(): Promise<LocationPermission>;
  /** Position brute (arrondie aussitôt par ce module) ou `null` si aucune n'est disponible. */
  getPosition(mode: PositionMode): Promise<{ latitude: number; longitude: number } | null>;
}

export type CaptureOutcome = "captured" | "disabled" | "no-permission" | "no-position" | "skipped" | "error";

export interface CaptureResult {
  outcome: CaptureOutcome;
  /** Journée de la position relevée (jamais les coordonnées). */
  date: LocalDate | null;
  message: string;
  /** État après la capture (pour enchaîner sur l'envoi sans relire le stockage). */
  store: LocationStore | null;
}

/**
 * Relève la position du jour si l'option est activée et la permission accordée. Ne lève
 * jamais. `onlyIfMissing` : ne rien faire si le jour a déjà sa position (ouverture de l'app).
 */
export async function captureDailyPosition(
  deps: LocationDeps,
  mode: PositionMode,
  now: Date,
  opts: { onlyIfMissing?: boolean } = {}
): Promise<CaptureResult> {
  let store: LocationStore;
  try {
    store = await deps.loadStore();
  } catch {
    return { outcome: "error", date: null, message: "Réglage de position illisible sur ce téléphone.", store: null };
  }
  if (!store.enabled) return { outcome: "disabled", date: null, message: "Option désactivée.", store };
  if (opts.onlyIfMissing && hasPositionFor(store, now)) {
    return { outcome: "skipped", date: localDateOf(now), message: "Position du jour déjà relevée.", store };
  }
  let permission: LocationPermission;
  try {
    permission = await deps.permission();
  } catch {
    permission = "unknown";
  }
  if (permission !== "granted") {
    return {
      outcome: "no-permission",
      date: null,
      message:
        "Permission de localisation non accordée : réactive l'option dans les réglages de Sillage (ou désactive-la).",
      store,
    };
  }
  let raw: { latitude: number; longitude: number } | null;
  try {
    raw = await deps.getPosition(mode);
  } catch (e) {
    return {
      outcome: "error",
      date: null,
      message: `Position indisponible (${scrubCoordinates(e instanceof Error ? e.message : String(e)).slice(0, 120)}).`,
      store,
    };
  }
  const next = raw ? recordPosition(store, raw, now) : store;
  if (next === store) {
    return {
      outcome: "no-position",
      date: null,
      message:
        mode === "last-known"
          ? "Aucune position récente connue du téléphone (la tâche de fond n'allume pas le GPS)."
          : "Aucune position disponible (localisation du téléphone coupée ?).",
      store,
    };
  }
  try {
    await deps.saveStore(next);
  } catch {
    return { outcome: "error", date: null, message: "Position non mémorisée (stockage indisponible).", store };
  }
  return { outcome: "captured", date: next.lastCaptured, message: "Position du jour mémorisée (arrondie).", store: next };
}

/**
 * Résultat de l'étape « position » d'une synchro, mémorisé et affiché. Ne contient
 * JAMAIS de coordonnée : seulement des dates, un nombre de journées et un message.
 */
export interface LocationRun {
  /** Instant, ISO 8601 UTC (affichage seulement). */
  at: string;
  /**
   * `sent` : envoyée ; `disabled` : option désactivée ; `unavailable` : route pas encore
   * déployée (404), positions gardées ; `nothing` : aucune journée terminée à envoyer ;
   * `no-permission` ; `failed` : autre échec, positions gardées.
   */
  outcome: "sent" | "disabled" | "unavailable" | "nothing" | "no-permission" | "failed";
  from: LocalDate | null;
  to: LocalDate | null;
  days: number;
  message: string;
}

export interface LocationSyncDeps {
  location: LocationDeps;
  fetch: FetchLike;
  loadSettings(): Promise<{ apiUrl: string; token: string }>;
  timeoutMs?: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/**
 * Étape « position » d'une synchro, après la santé : relève la position du jour, puis
 * envoie les journées terminées pas encore envoyées (au plus 30), en un seul appel.
 * Ne lève jamais ; un 404 n'est pas une erreur (route pas encore déployée).
 */
export async function runLocationSync(deps: LocationSyncDeps, mode: PositionMode, now: Date): Promise<LocationRun> {
  const at = now.toISOString();
  const base = { at, from: null, to: null, days: 0 };
  const capture = await captureDailyPosition(deps.location, mode, now);
  if (capture.outcome === "disabled") {
    return { ...base, outcome: "disabled", message: "Position : option désactivée, rien n'est relevé ni envoyé." };
  }
  if (capture.outcome === "no-permission") {
    return { ...base, outcome: "no-permission", message: capture.message };
  }
  if (!capture.store) {
    return { ...base, outcome: "failed", message: capture.message };
  }
  const store = capture.store;
  const note = capture.outcome === "captured" ? "" : ` (${capture.message})`;

  const days = selectDaysToSend(store, now);
  if (days.length === 0) {
    return {
      ...base,
      outcome: "nothing",
      message: `Aucune journée terminée à envoyer${store.lastCaptured ? ` ; position du ${store.lastCaptured} mémorisée, envoyée une fois la journée finie` : ""}.${note}`,
    };
  }
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;
  const range = { from, to, days: days.length };

  let outcome;
  try {
    const settings = await deps.loadSettings();
    const body: LocationIngestDay[] = days.map((d) => ({ date: d.date, lat: d.lat, lon: d.lon }));
    outcome = await ingestLocationDays({
      baseUrl: settings.apiUrl,
      token: settings.token,
      days: body,
      fetch: deps.fetch,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
  } catch (e) {
    return { ...base, ...range, outcome: "failed", message: scrubCoordinates(`Envoi impossible : ${String(e)}`) };
  }

  if (outcome.ok) {
    try {
      await deps.location.saveStore(markSent(store, days));
    } catch {
      // Positions renvoyées la prochaine fois : l'API fait un upsert sur la date.
    }
    return {
      ...base,
      ...range,
      outcome: "sent",
      message: `${plural(days.length, "journée")} de position envoyée${days.length > 1 ? "s" : ""}.${note}`,
    };
  }
  if (outcome.status === 404) {
    return {
      ...base,
      ...range,
      outcome: "unavailable",
      message: `La route /ingest/location n'est pas encore déployée sur l'API (404) : ${plural(days.length, "position")} gardée${days.length > 1 ? "s" : ""} sur le téléphone, renvoyée${days.length > 1 ? "s" : ""} plus tard.`,
    };
  }
  return { ...base, ...range, outcome: "failed", message: scrubCoordinates(outcome.message) };
}

/** Ligne du panneau de synchro : « position : envoyée / désactivée / route pas encore disponible ». */
export function describeLocation(run: LocationRun | null, enabled: boolean): string {
  if (!enabled) return "Position : désactivée";
  if (!run) return "Position : activée, pas encore envoyée";
  switch (run.outcome) {
    case "sent":
      return `Position : envoyée (${run.from === run.to ? run.to : `du ${run.from} au ${run.to}`})`;
    case "disabled":
      // Option réactivée depuis la dernière synchro.
      return "Position : activée, envoyée à la prochaine synchro";
    case "unavailable":
      return "Position : route pas encore disponible sur l'API";
    case "nothing":
      return "Position : rien à envoyer pour l'instant";
    case "no-permission":
      return "Position : permission de localisation non accordée";
    case "failed":
      return "Position : échec de l'envoi";
  }
}

/** Lignes du diagnostic : permission et dates seulement, jamais de coordonnée. */
export function locationDiagnostic(input: {
  store: LocationStore;
  permission: LocationPermission;
  lastRun: LocationRun | null;
}): string[] {
  const { store, permission, lastRun } = input;
  const perm = permission === "granted" ? "accordée (approximative)" : permission === "denied" ? "non accordée" : "inconnue";
  return [
    `Position (météo) : ${store.enabled ? "activée" : "désactivée"} ; permission de localisation : ${perm}`,
    `Dernière position mémorisée : ${store.lastCaptured ?? "aucune"} ; en attente d'envoi : ${plural(store.pending.length, "journée")} ; dernière envoyée : ${store.lastSent ?? "aucune"}`,
    lastRun ? `Dernier envoi de position : ${lastRun.at} (${lastRun.outcome}) ${lastRun.message}` : "Dernier envoi de position : jamais",
  ];
}
