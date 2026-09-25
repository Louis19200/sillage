/**
 * Registre minimal des tâches planifiées.
 *  - en local (serveur long) : node-cron, seulement si `ENABLE_JOBS=true` (voir server.ts) ;
 *  - en serverless (Vercel) : node-cron ne tourne pas, les Vercel Cron Jobs appellent
 *    `GET /cron/:name` (voir app.ts), qui exécute la tâche du même registre.
 * L'expression cron enregistrée ne sert qu'à node-cron ; sur Vercel, l'horaire est dans vercel.json.
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

export function hasJob(name: string): boolean {
  return registry.has(name);
}

export class UnknownJobError extends Error {
  constructor(readonly jobName: string) {
    super(`tâche inconnue : ${jobName}`);
    this.name = "UnknownJobError";
  }
}

/**
 * Exécute une tâche et renvoie sa valeur ; l'erreur de la tâche est propagée.
 * Utilisé par la route `GET /cron/:name` (Vercel Cron Jobs), qui la transforme en 500.
 */
export async function invokeJob(name: string): Promise<unknown> {
  const job = registry.get(name);
  if (!job) throw new UnknownJobError(name);
  return await job.fn();
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
registerJob("freeze-styles", "30 5 * * *", () => import("./artworks").then((m) => m.runFreezeStylesJob()), { timezone: "Europe/Paris" }); // moteur v2 ; Vercel : 30 3 * * * UTC
registerJob("check-freshness", "5 * * * *", () => import("./ops/freshness").then((m) => m.runFreshnessJob())); // Vercel : 1×/jour (vercel.json)
