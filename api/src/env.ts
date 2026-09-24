/**
 * Lecture et validation des variables d'environnement.
 * Aucun secret n'a de valeur par défaut : s'il manque, le démarrage échoue.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const DatabaseEnv = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL est obligatoire" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL doit commencer par postgres:// ou postgresql://"),
});

export const Env = DatabaseEnv.extend({
  INGEST_TOKEN: z
    .string({ required_error: "INGEST_TOKEN est obligatoire (openssl rand -hex 32)" })
    .min(32, "INGEST_TOKEN doit faire au moins 32 caractères (openssl rand -hex 32)"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ENABLE_JOBS: booleanFlag,
  /**
   * Les routes de lecture exigent-elles le token ? Par défaut : oui en
   * production (données personnelles), non en local. Voir docs/API.md.
   */
  PROTECT_READS: booleanFlag,
  NODE_ENV: z.string().optional(),
});
export type Env = {
  DATABASE_URL: string;
  INGEST_TOKEN: string;
  PORT: number;
  ENABLE_JOBS: boolean;
  PROTECT_READS: boolean;
};

export class EnvError extends Error {
  constructor(issues: z.ZodIssue[]) {
    super(
      "Configuration invalide :\n" +
        issues.map((i) => `  - ${i.path.join(".") || "(env)"} : ${i.message}`).join("\n"),
    );
    this.name = "EnvError";
  }
}

/** Charge `api/.env` puis `.env` à la racine s'ils existent (sans écraser l'environnement). */
export function loadDotenvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(here, "../.env"), resolve(here, "../../.env")]) {
    if (existsSync(p)) process.loadEnvFile(p);
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) throw new EnvError(parsed.error.issues);
  const e = parsed.data;
  return {
    DATABASE_URL: e.DATABASE_URL,
    INGEST_TOKEN: e.INGEST_TOKEN,
    PORT: e.PORT,
    ENABLE_JOBS: e.ENABLE_JOBS,
    PROTECT_READS:
      source.PROTECT_READS === undefined || source.PROTECT_READS === ""
        ? e.NODE_ENV === "production"
        : e.PROTECT_READS,
  };
}

/** Pour les scripts qui n'ont besoin que de la base (migrations, collecteurs). */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const parsed = DatabaseEnv.safeParse(source);
  if (!parsed.success) throw new EnvError(parsed.error.issues);
  return parsed.data.DATABASE_URL;
}
