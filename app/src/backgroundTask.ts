/**
 * Câblage réel de la tâche de fond (expo-background-task, donc WorkManager sur Android).
 * La logique est dans background.ts (testée) ; ce fichier ne fait que brancher.
 *
 * Importé par index.ts AVANT registerRootComponent : quand Android réveille l'app sans
 * écran, TaskManager doit trouver la tâche définie dès le chargement du JavaScript.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { BACKGROUND_INTERVAL_MINUTES, runBackgroundTask } from "./background";
import { getBackgroundAccess } from "./healthConnect";
import { loadSyncState, realSyncDeps } from "./settings";

export const BACKGROUND_TASK = "sillage-daily-sync";

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const run = await runBackgroundTask({ ...realSyncDeps(), backgroundAccess: getBackgroundAccess });
    return run.outcome === "failed" ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // runBackgroundTask ne lève pas ; ceinture et bretelles, la tâche ne doit jamais planter.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export interface BackgroundTaskInfo {
  /** WorkManager disponible (toujours vrai sur Android, sauf erreur). */
  available: boolean;
  registered: boolean;
  error: string | null;
}

/** Enregistre la tâche si elle ne l'est pas encore (l'enregistrement survit aux redémarrages de l'app). */
export async function ensureBackgroundTaskRegistered(): Promise<BackgroundTaskInfo> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    const available = status === BackgroundTask.BackgroundTaskStatus.Available;
    if (!available) return { available, registered: false, error: null };
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, {
        minimumInterval: BACKGROUND_INTERVAL_MINUTES,
      });
    }
    return { available, registered: await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK), error: null };
  } catch (e) {
    return { available: false, registered: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lignes ajoutées au diagnostic. */
export async function backgroundTaskDiagnostic(): Promise<string[]> {
  const info = await ensureBackgroundTaskRegistered();
  const state = await loadSyncState();
  const lines = [
    `Tâche de fond : ${info.error ? `ERREUR ${info.error}` : info.registered ? `enregistrée (réveil toutes les ${BACKGROUND_INTERVAL_MINUTES / 60} h environ)` : info.available ? "non enregistrée" : "indisponible"}`,
  ];
  const b = state.lastBackground;
  lines.push(
    b ? `Dernier réveil de la tâche : ${b.at} (${b.outcome}) ${b.message}` : "Dernier réveil de la tâche : jamais"
  );
  return lines;
}
