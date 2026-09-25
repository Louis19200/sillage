import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { setDb, type Db } from "../db";
import { createTestDb, resetTestDb, TEST_TOKEN } from "../../test/helpers";
import { checkFreshness, formatAge, type FreshnessReport } from "./freshness";
import { formatEvent, sanitize, type LogFields, type LogLevel } from "./log";
import { hasNotifierConfig, LogNotifier, notifierFromEnv, NtfyNotifier, type Alert, type Notifier } from "./notifier";
import { healthStatus } from "./index";

const HOUR = 3_600_000;
const T0 = new Date("2026-09-20T07:05:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

class FakeNotifier implements Notifier {
  readonly name = "fake";
  sent: Alert[] = [];
  fail = false;
  async send(alert: Alert) {
    if (this.fail) throw new Error("canal en panne");
    this.sent.push(alert);
  }
}

type Logged = { level: LogLevel; event: string; fields: LogFields };
const quietLog = () => {};

let db: Db;

beforeAll(async () => {
  ({ db } = await createTestDb());
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetTestDb(db);
  await db.executor.exec("TRUNCATE alert_state");
});

async function ingestAt(source: string, when: Date, ok = true) {
  await db.executor.query(
    "INSERT INTO ingest_log (source, received_at, days_count, first_date, last_date, ok, error) VALUES ($1, $2::timestamptz, 1, NULL, NULL, $3, $4)",
    [source, when.toISOString(), ok, ok ? null : "échec de test"],
  );
}

async function run(notifier: Notifier, now: Date): Promise<FreshnessReport> {
  return checkFreshness({ db, notifier, now, log: quietLog });
}

const actionOf = (r: FreshnessReport, source: string) => r.checks.find((c) => c.source === source)?.action;

describe("checkFreshness : santé (seuil 48 h)", () => {
  it("pas d'alerte avant 48 h, une seule après, puis un message de rétablissement", async () => {
    const n = new FakeNotifier();
    await ingestAt("health", T0);
    await ingestAt("github", T0);

    // 47 h sans données : rien.
    let r = await run(n, at(47));
    expect(n.sent).toHaveLength(0);
    expect(actionOf(r, "health")).toBe("initialized");
    expect(r.checks.find((c) => c.source === "health")).toMatchObject({ status: "ok", age_hours: 47, threshold_hours: 48 });

    // Juste 48 h : toujours rien (strictement plus de 48 h).
    await run(n, at(48));
    expect(n.sent).toHaveLength(0);

    // 49 h : une alerte.
    r = await run(n, at(49));
    expect(actionOf(r, "health")).toBe("alerted");
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]).toMatchObject({ title: "Sillage : plus de données santé", priority: "high" });
    expect(n.sent[0]?.message).toMatch(/depuis 2 j 1 h/);

    // Contrôles suivants, situation inchangée : plus rien.
    await run(n, at(50));
    await run(n, at(73));
    r = await run(n, at(24 * 7));
    expect(actionOf(r, "health")).toBe("unchanged");
    expect(n.sent.filter((a) => a.title.includes("santé"))).toHaveLength(1);

    // Une ingestion en échec ne compte pas.
    await ingestAt("health", at(24 * 7 + 1), false);
    await run(n, at(24 * 7 + 2));
    expect(n.sent.filter((a) => a.title.includes("santé"))).toHaveLength(1);

    // Les données reviennent : un message « rétabli », une seule fois.
    await ingestAt("health", at(24 * 7 + 3));
    r = await run(n, at(24 * 7 + 4));
    expect(actionOf(r, "health")).toBe("recovered");
    const santé = n.sent.filter((a) => a.title.includes("santé"));
    expect(santé).toHaveLength(2);
    expect(santé[1]).toMatchObject({ title: "Sillage : données santé rétablies", priority: "default" });
    await run(n, at(24 * 7 + 5));
    expect(n.sent.filter((a) => a.title.includes("santé"))).toHaveLength(2);

    // L'état est en base (survit à un redémarrage : checkFreshness n'a aucune mémoire).
    const rows = await db.executor.query<{ check_name: string; status: string }>("SELECT check_name, status FROM alert_state ORDER BY check_name");
    expect(rows).toEqual([
      { check_name: "freshness:github", status: "stale" },
      { check_name: "freshness:health", status: "ok" },
    ]);
  });

  it("alerte une fois si aucune ingestion n'a jamais réussi", async () => {
    const n = new FakeNotifier();
    await ingestAt("github", T0);
    await run(n, T0);
    await run(n, at(24));
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]?.message).toMatch(/jamais été enregistrée/);
  });

  it("si l'envoi échoue, l'état ne change pas et le contrôle suivant réessaie", async () => {
    const n = new FakeNotifier();
    await ingestAt("health", T0);
    await ingestAt("github", at(40));
    await run(n, at(1));

    n.fail = true;
    await expect(run(n, at(50))).rejects.toThrow(/alerte non envoyée \(fake\) pour health : canal en panne/);
    const [row] = await db.executor.query<{ status: string }>("SELECT status FROM alert_state WHERE check_name = 'freshness:health'");
    expect(row?.status).toBe("ok");

    n.fail = false;
    const r = await run(n, at(51));
    expect(actionOf(r, "health")).toBe("alerted");
    await run(n, at(52));
    expect(n.sent).toHaveLength(1);
  });

  it("deux contrôles simultanés (double livraison du cron) n'envoient qu'une alerte", async () => {
    const n = new FakeNotifier();
    await ingestAt("health", T0);
    await ingestAt("github", at(40));
    await run(n, at(1));
    await Promise.all([run(n, at(50)), run(n, at(50))]);
    expect(n.sent).toHaveLength(1);
  });
});

describe("checkFreshness : GitHub (seuil 72 h)", () => {
  it("rien à 71 h, une alerte à 73 h", async () => {
    const n = new FakeNotifier();
    await ingestAt("github", T0);
    await ingestAt("health", at(70));
    await run(n, at(71));
    expect(n.sent).toHaveLength(0);
    const r = await run(n, at(73));
    expect(actionOf(r, "github")).toBe("alerted");
    expect(n.sent.map((a) => a.title)).toEqual(["Sillage : plus de données GitHub"]);
  });
});

describe("GET /health", () => {
  const READ = "r".repeat(40);
  const app = () => createApp({ db, ingestToken: TEST_TOKEN, protectReads: true, readToken: READ, cronSecret: "c".repeat(32), logError: quietLog });

  it("200 sans token même avec PROTECT_READS=true, format de docs/API.md", async () => {
    await ingestAt("health", new Date("2026-09-24T06:40:00Z"));
    await ingestAt("health", new Date("2026-09-24T07:00:00Z"), false);
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      db: "ok",
      last_ingest: { health: "2026-09-24T06:40:00.000Z", github: null },
    });
    // La protection de lecture reste en place sur /range.
    expect((await app().request("/range?from=2026-09-01&to=2026-09-02")).status).toBe(401);
  });

  it("répond aussi à HEAD (moniteurs externes)", async () => {
    const res = await app().request("/health", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("503 quand la base tombe", async () => {
    const { db: dead, pg } = await createTestDb();
    await pg.close();
    const res = await createApp({ db: dead, ingestToken: TEST_TOKEN, protectReads: true, logError: quietLog }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", db: "error", last_ingest: { health: null, github: null } });
  });

  it("503 quand la base ne répond pas à temps", async () => {
    const hung = { executor: { query: () => new Promise(() => {}) } } as unknown as Db;
    const r = await healthStatus(hung, 20);
    expect(r.code).toBe(503);
    expect(r.error).toMatch(/20 ms/);
  });
});

describe("GET /cron/check-freshness", () => {
  const CRON = "c".repeat(32);

  it("avec un faux Notifier injecté dans le registre", async () => {
    const n = new FakeNotifier();
    await ingestAt("github", new Date());
    const app = createApp({
      db,
      ingestToken: TEST_TOKEN,
      cronSecret: CRON,
      logError: quietLog,
      jobs: { has: (name) => name === "check-freshness", invoke: () => checkFreshness({ db, notifier: n, log: quietLog }) },
    });
    expect((await app.request("/cron/check-freshness")).status).toBe(401);

    const res = await app.request("/cron/check-freshness", { headers: { authorization: `Bearer ${CRON}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: FreshnessReport };
    expect(body.ok).toBe(true);
    expect(body.result.notifier).toBe("fake");
    expect(body.result.checks.map((c) => [c.source, c.action])).toEqual([
      ["health", "alerted"],
      ["github", "initialized"],
    ]);
    expect(n.sent).toHaveLength(1);

    await app.request("/cron/check-freshness", { headers: { authorization: `Bearer ${CRON}` } });
    expect(n.sent).toHaveLength(1);
  });

  describe("tâche réelle du registre (jobs.ts) et ntfy simulé", () => {
    const calls: { url: string; init: RequestInit }[] = [];
    beforeEach(() => {
      calls.length = 0;
      setDb(db);
      vi.stubEnv("NTFY_TOPIC", "sillage-test-topic");
      vi.stubEnv("NTFY_TOKEN", "tk_secret_ntfy");
      vi.stubEnv("ALERT_EMAIL", "");
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{"id":"x"}', { status: 200 });
      });
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      setDb(undefined);
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("publie une alerte ntfy, puis plus rien", async () => {
      await ingestAt("github", new Date());
      const app = createApp({ db, ingestToken: TEST_TOKEN, cronSecret: CRON, logError: quietLog });
      const res = await app.request("/cron/check-freshness", { headers: { authorization: `Bearer ${CRON}` } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { result: FreshnessReport }).result.notifier).toBe("ntfy");

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://ntfy.sh");
      expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tk_secret_ntfy");
      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
        topic: "sillage-test-topic",
        title: "Sillage : plus de données santé",
        priority: 4,
        tags: ["warning"],
      });

      await app.request("/cron/check-freshness", { headers: { authorization: `Bearer ${CRON}` } });
      expect(calls).toHaveLength(1);
    });

    it("un refus de ntfy donne une tâche en échec (500) et l'état reste inchangé", async () => {
      vi.stubGlobal("fetch", async () => new Response('{"error":"limit reached"}', { status: 429 }));
      await ingestAt("github", new Date());
      const app = createApp({ db, ingestToken: TEST_TOKEN, cronSecret: CRON, logError: quietLog });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await app.request("/cron/check-freshness", { headers: { authorization: `Bearer ${CRON}` } });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toMatch(/HTTP 429/);
      expect(await db.executor.query("SELECT 1 FROM alert_state WHERE check_name = 'freshness:health'")).toEqual([]);
    });
  });
});

describe("journaux structurés", () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(String(args[0])));
  });
  afterEach(() => vi.restoreAllMocks());

  const events = () => lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);

  it("une ligne JSON par ingestion : source, jours, durée, succès ou erreur, sans token ni corps", async () => {
    const app = createApp({ db, ingestToken: TEST_TOKEN, logError: quietLog });
    const post = (body: unknown, token = TEST_TOKEN) =>
      app.request("/ingest/health", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await post({ days: [{ date: "2026-09-22", steps: 8421 }, { date: "2026-09-23", steps: 0 }] })).status).toBe(200);
    expect((await post({ days: [{ date: "23/09/2026", steps: 1 }] })).status).toBe(400);
    expect((await post({ days: [] }, "x".repeat(32))).status).toBe(401);

    const ingests = events().filter((e) => e.event === "ingest");
    expect(ingests).toHaveLength(2);
    expect(ingests[0]).toMatchObject({ level: "info", source: "health", days: 2, ok: true, http_status: 200 });
    expect(typeof ingests[0]?.duration_ms).toBe("number");
    expect(ingests[1]).toMatchObject({ level: "error", source: "health", days: null, ok: false, http_status: 400, error: "corps invalide" });

    const all = lines.join("\n");
    expect(all).not.toContain(TEST_TOKEN);
    expect(all).not.toContain("8421");
    expect(all).not.toContain("23/09/2026");
  });

  it("journalise la tâche github-sync comme une ingestion", async () => {
    const CRON = "c".repeat(32);
    const app = createApp({
      db,
      ingestToken: TEST_TOKEN,
      cronSecret: CRON,
      logError: quietLog,
      jobs: {
        has: () => true,
        invoke: async (name) => {
          if (name === "github-sync") return { source: "github", from: "x", to: "y", days_written: 9, first_date: null, last_date: null };
          throw new Error("GraphQL : Bearer ghp_abcdefghijklmnop refusé");
        },
      },
    });
    await app.request("/cron/github-sync", { headers: { authorization: `Bearer ${CRON}` } });
    await app.request("/cron/autre", { headers: { authorization: `Bearer ${CRON}` } });

    const ev = events();
    expect(ev.find((e) => e.event === "ingest")).toMatchObject({ source: "github", days: 9, ok: true, job: "github-sync" });
    expect(ev.filter((e) => e.event === "job").map((e) => [e.job, e.ok])).toEqual([
      ["github-sync", true],
      ["autre", false],
    ]);
    expect(lines.join("\n")).not.toContain("ghp_abcdefghijklmnop");
    expect(lines.join("\n")).not.toContain(CRON);
  });

  it("masque les secrets et tronque", () => {
    expect(sanitize("Bearer abc.def refusé")).toBe("Bearer [masqué] refusé");
    expect(sanitize(`token ${"a1".repeat(32)}`)).toBe("token [masqué]");
    expect(sanitize("x".repeat(1000))).toHaveLength(300);
    expect(JSON.parse(formatEvent("info", "e", { a: 1, b: undefined, c: "Bearer z" }, T0))).toEqual({
      ts: T0.toISOString(),
      level: "info",
      event: "e",
      a: 1,
      c: "Bearer [masqué]",
    });
  });
});

describe("Notifier", () => {
  it("ntfy : sans NTFY_TOPIC, repli sur les journaux", async () => {
    expect(hasNotifierConfig({})).toBe(false);
    const logged: Logged[] = [];
    const n = notifierFromEnv({ NTFY_TOPIC: "  " }, (level, event, fields = {}) => logged.push({ level, event, fields }));
    expect(n).toBeInstanceOf(LogNotifier);
    await n.send({ title: "t", message: "m", priority: "high", tags: [] });
    expect(logged).toEqual([{ level: "error", event: "alert", fields: { title: "t", message: "m", channel: "log" } }]);
  });

  it("ntfy : serveur, token et e-mail optionnels", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const n = new NtfyNotifier({
      topic: "abc",
      server: "https://ntfy.example.org/",
      email: "moi@example.org",
      fetch: async (url, init) => {
        seen.push({ url, init });
        return new Response("", { status: 200 });
      },
    });
    await n.send({ title: "Données rétablies", message: "é", priority: "default", tags: ["white_check_mark"] });
    expect(seen[0]?.url).toBe("https://ntfy.example.org");
    expect((seen[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      topic: "abc",
      title: "Données rétablies",
      message: "é",
      priority: 3,
      tags: ["white_check_mark"],
      email: "moi@example.org",
    });
  });

  it("ntfy injoignable : erreur explicite", async () => {
    const n = new NtfyNotifier({ topic: "abc", fetch: async () => Promise.reject(new Error("ECONNREFUSED")) });
    await expect(n.send({ title: "t", message: "m", priority: "high", tags: [] })).rejects.toThrow(/ntfy injoignable : ECONNREFUSED/);
  });

  it("formatAge", () => {
    expect(formatAge(7.9)).toBe("7 h");
    expect(formatAge(49)).toBe("2 j 1 h");
    expect(formatAge(72)).toBe("3 j");
  });
});
