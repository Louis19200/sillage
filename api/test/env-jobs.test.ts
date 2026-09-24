import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/env";
import { clearJobs, listJobs, registerJob, runJob, startJobs, stopJobs } from "../src/jobs";
import { bearerAuth, extractBearer, tokenMatches } from "../src/auth";

const base = {
  DATABASE_URL: "postgres://sillage:sillage@localhost:5432/sillage",
  INGEST_TOKEN: "a".repeat(32),
};

describe("env", () => {
  it("accepte une configuration valide avec les valeurs par défaut", () => {
    expect(loadEnv(base)).toEqual({ ...base, PORT: 8787, ENABLE_JOBS: false, PROTECT_READS: false, CORS_ORIGINS: [], DATABASE_SERVERLESS: false });
  });

  it("refuse un INGEST_TOKEN de moins de 32 caractères", () => {
    expect(() => loadEnv({ ...base, INGEST_TOKEN: "a".repeat(31) })).toThrow(EnvError);
    expect(() => loadEnv({ ...base, INGEST_TOKEN: "change-me-long-random-string" })).toThrow(/32 caractères/);
  });

  it("refuse l'absence de DATABASE_URL ou d'INGEST_TOKEN", () => {
    expect(() => loadEnv({ INGEST_TOKEN: base.INGEST_TOKEN })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/INGEST_TOKEN/);
  });

  it("lit PORT, ENABLE_JOBS et PROTECT_READS", () => {
    const env = loadEnv({ ...base, PORT: "3000", ENABLE_JOBS: "true", PROTECT_READS: "true" });
    expect(env).toMatchObject({ PORT: 3000, ENABLE_JOBS: true, PROTECT_READS: true });
    expect(() => loadEnv({ ...base, ENABLE_JOBS: "oui" })).toThrow(EnvError);
  });

  it("protège la lecture par défaut en production", () => {
    expect(loadEnv({ ...base, NODE_ENV: "production" }).PROTECT_READS).toBe(true);
    expect(loadEnv({ ...base, NODE_ENV: "production", PROTECT_READS: "false" }).PROTECT_READS).toBe(false);
  });
});

describe("auth", () => {
  it("extrait le token Bearer", () => {
    expect(extractBearer("Bearer abc")).toBe("abc");
    expect(extractBearer("bearer   abc ")).toBe("abc");
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });

  it("compare les tokens", () => {
    expect(tokenMatches("x".repeat(40), "x".repeat(40))).toBe(true);
    expect(tokenMatches("x".repeat(39), "x".repeat(40))).toBe(false);
  });

  it("refuse un token attendu trop court", () => {
    expect(() => bearerAuth("court")).toThrow(/32/);
  });
});

describe("jobs", () => {
  // Le registre contient déjà les tâches enregistrées au chargement de jobs.ts (ex. github-sync).
  beforeEach(() => clearJobs());
  afterEach(async () => {
    await stopJobs();
    clearJobs();
  });

  it("enregistre et valide les tâches", () => {
    registerJob("a", "15 4 * * *", () => {});
    expect(listJobs()).toEqual([{ name: "a", cronExpr: "15 4 * * *" }]);
    expect(() => registerJob("a", "0 * * * *", () => {})).toThrow(/déjà/);
    expect(() => registerJob("b", "pas du cron", () => {})).toThrow(/invalide/);
  });

  it("ne démarre rien si ENABLE_JOBS est faux", () => {
    registerJob("a", "15 4 * * *", () => {});
    expect(startJobs(false)).toEqual([]);
    expect(startJobs(true)).toEqual(["a"]);
  });

  it("une tâche en échec ne propage pas l'erreur", async () => {
    const logs: string[] = [];
    registerJob("boom", "0 * * * *", () => {
      throw new Error("x");
    });
    expect(await runJob("boom", (m) => logs.push(m))).toBe(false);
    expect(logs).toEqual(["tâche boom en échec"]);
  });
});
