/**
 * Étape 6 : synchro quotidienne automatique. Module pur (horloge, stockage, Health Connect
 * et réseau injectés) : les décisions se testent avec jest, sans téléphone.
 *
 * Deux chemins mènent à la même synchro de 3 jours (`runSync`) :
 * - la tâche de fond (`runBackgroundTask`), réveillée par WorkManager toutes les quelques
 *   heures, qui n'envoie qu'une fois par jour ;
 * - le repli à l'ouverture de l'app (`shouldSyncOnOpen`), pour le cas où la tâche ne peut pas
 *   lire Health Connect (permission d'arrière-plan refusée ou indisponible) ou a été tuée par
 *   le système (Samsung).
 */
import { localDateOf, type LocalDate } from "./days";
import { EMPTY_SYNC_STATE, runSync, type BackgroundRun, type SyncDeps, type SyncState } from "./sync";

/**
 * Heure locale à partir de laquelle « hier » est considéré comme bien rempli dans Health
 * Connect : la montre synchronise avec Samsung Health, qui écrit ensuite dans Health Connect,
 * parfois avec du retard. Une synchro réussie avant cette heure est refaite après.
 */
export const DAILY_SYNC_HOUR = 5;

/**
 * Intervalle minimal entre deux réveils de la tâche (minutes). Android le traite comme un
 * minimum et décale selon la batterie : on se réveille souvent, mais on n'envoie qu'une fois
 * par jour (voir `needsDailySync`), ce qui laisse plusieurs chances chaque matin.
 */
export const BACKGROUND_INTERVAL_MINUTES = 180;

/** Après un échec, l'ouverture de l'app ne relance pas de synchro avant ce délai (minutes). */
export const OPEN_RETRY_MINUTES = 30;

/** État de la permission `READ_HEALTH_DATA_IN_BACKGROUND` pour Sillage. */
export type BackgroundAccess = "granted" | "denied" | "unknown";

/** Hier, en date locale du téléphone. */
export function yesterdayOf(now: Date): LocalDate {
  return localDateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

/**
 * Dernier passage à `DAILY_SYNC_HOUR` heure locale, construit avec les composants locaux
 * (jamais `- 24 h`) pour rester juste les jours de changement d'heure.
 */
export function dailyAnchor(now: Date): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAILY_SYNC_HOUR);
  if (now >= today) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, DAILY_SYNC_HOUR);
}

/**
 * Faut-il envoyer les derniers jours ? Oui, sauf si une synchro réussie (quel que soit son
 * type) a déjà couvert hier **et** a eu lieu après le dernier passage à 5 h.
 */
export function needsDailySync(state: SyncState, now: Date): boolean {
  const s = state.lastSuccess;
  if (!s || !s.to) return true;
  if (s.to < yesterdayOf(now)) return true;
  const at = new Date(s.at);
  if (Number.isNaN(at.getTime())) return true;
  return at < dailyAnchor(now);
}

/**
 * Repli à l'ouverture de l'app : synchroniser si hier n'a pas été envoyé, que la tâche de fond
 * soit bloquée ou simplement pas encore passée. Jamais sans URL ni token (ce serait un échec
 * assuré), et pas plus d'une tentative ratée toutes les `OPEN_RETRY_MINUTES`.
 */
export function shouldSyncOnOpen(state: SyncState, now: Date, configured: boolean): boolean {
  if (!configured) return false;
  if (!needsDailySync(state, now)) return false;
  const last = state.lastAttempt;
  if (last && !last.ok) {
    const at = new Date(last.at).getTime();
    if (!Number.isNaN(at) && now.getTime() - at < OPEN_RETRY_MINUTES * 60_000 && now.getTime() >= at) {
      return false;
    }
  }
  return true;
}

export interface AutoSyncInput {
  /** URL et token renseignés. */
  configured: boolean;
  taskRegistered: boolean;
  access: BackgroundAccess;
  /** Health Connect installé trop ancien pour la lecture en arrière-plan. */
  featureUnavailable: boolean;
  /** Batterie « Restreinte » pour Sillage : Android n'exécute pas les tâches de fond. */
  restricted: boolean;
}

export interface AutoSyncStatus {
  /** `background` : tout est en place ; `open` : repli à l'ouverture seulement ; `off` : rien ne partira. */
  mode: "background" | "open" | "off";
  title: string;
  detail: string;
}

/** Ce que l'écran affiche sur la synchro automatique, sans rien promettre de plus que la réalité. */
export function describeAutoSync(input: AutoSyncInput): AutoSyncStatus {
  if (!input.configured) {
    return {
      mode: "off",
      title: "Synchro automatique : en attente des réglages",
      detail: "Renseigne l'URL de l'API et le token : rien ne peut être envoyé sans eux.",
    };
  }
  const reasons: string[] = [];
  if (!input.taskRegistered) reasons.push("la tâche de fond n'a pas pu être enregistrée");
  if (input.restricted) reasons.push("la batterie de Sillage est « Restreinte »");
  if (input.featureUnavailable) {
    reasons.push("cette version de Health Connect ne permet pas la lecture en arrière-plan");
  } else if (input.access === "denied") {
    reasons.push("la lecture de Health Connect en arrière-plan n'est pas autorisée");
  } else if (input.access === "unknown") {
    reasons.push("l'autorisation de lecture en arrière-plan n'a pas pu être vérifiée");
  }
  if (reasons.length === 0) {
    return {
      mode: "background",
      title: "Synchro automatique : activée, en arrière-plan",
      detail: `Chaque jour après ${DAILY_SYNC_HOUR} h, sans ouvrir l'app (si Android laisse tourner la tâche).`,
    };
  }
  return {
    mode: "open",
    title: "Synchro automatique : à l'ouverture de l'app seulement",
    detail: `${capitalize(reasons.join(" ; "))}. Hier sera envoyé la prochaine fois que tu ouvres Sillage.`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface BackgroundDeps extends SyncDeps {
  /** Permission de lecture en arrière-plan ; une erreur est traitée comme `unknown`. */
  backgroundAccess(): Promise<BackgroundAccess>;
}

const NO_BACKGROUND_ACCESS =
  "La lecture de Health Connect en arrière-plan n'est pas autorisée pour Sillage : " +
  "la synchro se fera à la prochaine ouverture de l'app.";

/**
 * Corps de la tâche de fond. Ne lève jamais : tout échec (lecture, réseau, stockage) finit
 * dans le `BackgroundRun` renvoyé et mémorisé (et, pour une synchro tentée, dans le
 * `SyncRecord` de `runSync`, comme les autres synchros).
 */
export async function runBackgroundTask(deps: BackgroundDeps): Promise<BackgroundRun> {
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  let run: BackgroundRun;
  try {
    const state = await safeLoad(deps);
    if (!needsDailySync(state, now)) {
      run = {
        at: now.toISOString(),
        outcome: "skipped",
        message: `Rien à faire : journées jusqu'au ${state.lastSuccess?.to ?? "?"} déjà envoyées.`,
      };
    } else {
      let access: BackgroundAccess;
      try {
        access = await deps.backgroundAccess();
      } catch {
        access = "unknown";
      }
      // On tente même sans la permission : selon la version de Health Connect, la lecture
      // peut marcher, renvoyer vide (seules les données écrites par Sillage) ou lever.
      // runSync refuse d'envoyer une lecture vide, donc rien n'est jamais effacé.
      const record = await runSync("background", { ...deps, now: () => now });
      run = {
        at: now.toISOString(),
        outcome: record.ok ? "sent" : "failed",
        message:
          record.ok || access !== "denied" ? record.message : `${NO_BACKGROUND_ACCESS} (${record.message})`,
      };
    }
  } catch (e) {
    run = {
      at: now.toISOString(),
      outcome: "failed",
      message: `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    // Relire : runSync vient d'écrire la dernière tentative / réussite. Si la relecture
    // échoue, on n'écrit rien plutôt que d'écraser l'état par un état vide.
    const latest = await deps.loadState();
    await deps.saveState({ ...latest, lastBackground: run });
  } catch {
    // Mémorisation impossible (stockage verrouillé…) : le résultat reste renvoyé.
  }
  return run;
}

async function safeLoad(deps: Pick<SyncDeps, "loadState">): Promise<SyncState> {
  try {
    return await deps.loadState();
  } catch {
    return { ...EMPTY_SYNC_STATE };
  }
}
