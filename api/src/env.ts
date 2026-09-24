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

/** Variable facultative : absente ou vide = non définie. */
const optionalSecret = (name: string, min: number, hint: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v))
    .refine((v) => v === undefined || v.length >= min, `${name} doit faire au moins ${min} caractères (${hint})`);

/** Une origine CORS : `https://hote[:port]`, sans chemin ni barre finale. */
const ORIGIN_RE = /^https?:\/\/[^/\s*,]+$/;

/** `CORS_ORIGINS` : liste séparée par des virgules ; vide = CORS désactivé. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter((o) => o !== ""))];
}

const corsOrigins = z
  .string()
  .optional()
  .transform(parseCorsOrigins)
  .refine((list) => list.every((o) => ORIGIN_RE.test(o)), {
    message: "CORS_ORIGINS : origines complètes attendues, séparées par des virgules (ex. https://sillage-art.vercel.app,http://localhost:5173), sans joker",
  });

export const DatabaseEnv = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL est obligatoire" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL doit commencer par postgres:// ou postgresql://"),
  /** `true` = client adapté aux fonctions serverless (pooler Neon / pgbouncer). */
  DATABASE_SERVERLESS: booleanFlag,
});
export type DatabaseConfig = { url: string; serverless: boolean };

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
  /** Token de lecture seule (page d'art) : accepté sur /day et /range, jamais en écriture. */
  READ_TOKEN: optionalSecret("READ_TOKEN", 32, "openssl rand -hex 32"),
  /** Secret des routes /cron/:name (Vercel l'envoie en `Authorization: Bearer`). */
  CRON_SECRET: optionalSecret("CRON_SECRET", 16, "openssl rand -hex 32"),
  CORS_ORIGINS: corsOrigins,
  NODE_ENV: z.string().optional(),
}).refine((e) => e.READ_TOKEN === undefined || e.READ_TOKEN !== e.INGEST_TOKEN, {
  path: ["READ_TOKEN"],
  message: "READ_TOKEN doit être différent d'INGEST_TOKEN",
});
export type Env = {
  DATABASE_URL: string;
  INGEST_TOKEN: string;
  PORT: number;
  ENABLE_JOBS: boolean;
  PROTECT_READS: boolean;
  /** Absent si la variable est vide ou non définie. */
  READ_TOKEN?: string;
  /** Absent si la variable est vide ou non définie : les routes /cron répondent alors 503. */
  CRON_SECRET?: string;
  /** Vide = aucun en-tête CORS. */
  CORS_ORIGINS: string[];
  DATABASE_SERVERLESS: boolean;
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
    ...(e.READ_TOKEN !== undefined ? { READ_TOKEN: e.READ_TOKEN } : {}),
    ...(e.CRON_SECRET !== undefined ? { CRON_SECRET: e.CRON_SECRET } : {}),
    CORS_ORIGINS: e.CORS_ORIGINS,
    DATABASE_SERVERLESS: e.DATABASE_SERVERLESS,
  };
}

/** Pour les scripts qui n'ont besoin que de la base (migrations, collecteurs). */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const parsed = DatabaseEnv.safeParse(source);
  if (!parsed.success) throw new EnvError(parsed.error.issues);
  return parsed.data.DATABASE_URL;
}

/** URL et mode du client (`DATABASE_SERVERLESS`). */
export function loadDatabaseConfig(source: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = DatabaseEnv.safeParse(source);
  if (!parsed.success) throw new EnvError(parsed.error.issues);
  return { url: parsed.data.DATABASE_URL, serverless: parsed.data.DATABASE_SERVERLESS };
}
