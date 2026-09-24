/**
 * Registre minimal des tâches planifiées (node-cron).
 * Les tâches ne tournent que si `ENABLE_JOBS=true` (voir server.ts).
 *
 * Les autres agents enregistrent leur tâche en bas de ce fichier, une ligne
 * chacun, dans la section « Enregistrements ».
 */
import cron, { type ScheduledTask } from "node-cron";

export type JobFn = () => unknown | Promise<unknown>;
export type JobOptions = { timezone?: string };
type Job = { name: string; cronExpr: string; fn: JobFn; options: JobOptions };

const registry = new Map<string, Job>();
const running = new Map<string, ScheduledTask>();

export function registerJob(name: string, cronExpr: string, fn: JobFn, options: JobOptions = {}): void {
  if (registry.has(name)) throw new Error(`tâche déjà enregistrée : ${name}`);
  if (!cron.validate(cronExpr)) throw new Error(`expression cron invalide pour ${name} : ${cronExpr}`);
  registry.set(name, { name, cronExpr, fn, options });
}

export function listJobs(): { name: string; cronExpr: string }[] {
  return [...registry.values()].map(({ name, cronExpr }) => ({ name, cronExpr }));
}

/** Exécute une tâche en capturant ses erreurs (une tâche qui plante ne tue pas le serveur). */
export async function runJob(name: string, log: (msg: string, err?: unknown) => void = console.error): Promise<boolean> {
  const job = registry.get(name);
  if (!job) throw new Error(`tâche inconnue : ${name}`);
  try {
    await job.fn();
    return true;
  } catch (err) {
    log(`tâche ${name} en échec`, err);
    return false;
  }
}

/** Démarre toutes les tâches si `enabled`. Retourne les noms démarrés. */
export function startJobs(enabled: boolean): string[] {
  if (!enabled) return [];
  for (const job of registry.values()) {
    if (running.has(job.name)) continue;
    const task = cron.schedule(job.cronExpr, () => runJob(job.name), {
      name: job.name,
      noOverlap: true,
      ...(job.options.timezone ? { timezone: job.options.timezone } : {}),
    });
    running.set(job.name, task);
  }
  return [...running.keys()];
}

export async function stopJobs(): Promise<void> {
  for (const task of running.values()) await task.destroy();
  running.clear();
}

/** Pour les tests. */
export function clearJobs(): void {
  registry.clear();
}

// --- Enregistrements (une ligne par agent) ----------------------------------
// ex. github-collector : registerJob("github-sync", "15 4 * * *", () => syncGithub(last7Days()));
registerJob("github-sync", "15 4 * * *", () => import("./collectors/github/sync").then((m) => m.runGithubSyncJob()), { timezone: "Europe/Paris" });
