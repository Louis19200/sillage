/**
 * Synchro de bout en bout sans téléphone : faux Health Connect, faux fetch, faux stockage.
 * Tourne en Europe/Paris (voir jest.tz-check.js).
 */
import { HealthIngestBody } from "@sillage/shared";

import type { FetchLike } from "../api";
import { localDateOf, type HealthReader } from "../days";
import { BACKFILL_DAYS, SYNC_DAYS, parseSyncState, runSync, toIngestDays, type SyncState } from "../sync";

const TOKEN = "0123456789abcdef0123456789abcdef-secret";
// 24 septembre 2026, 07:10 à Paris : « aujourd'hui » = 24, hier = 23.
const NOW = new Date("2026-09-24T05:10:00Z");

/** Pas seulement le 23 ; les autres jours n'ont aucune source (→ null). Une nuit du 22 au 23. */
const reader: HealthReader = {
  async aggregateSteps(start) {
    return localDateOf(start) === "2026-09-23"
      ? { total: 8421, dataOrigins: ["com.google.android.apps.fitness"] }
      : { total: 0, dataOrigins: [] };
  },
  async readSleepSessions() {
    return [{ startTime: "2026-09-22T21:48:00Z", endTime: "2026-09-23T04:40:00Z" }];
  },
};

/** Des pas et une nuit tous les jours. */
const everyDayReader: HealthReader = {
  async aggregateSteps(start) {
    return { total: 5000 + start.getDate(), dataOrigins: ["com.sec.android.app.shealth"] };
  },
  async readSleepSessions(start, end) {
    const out = [];
    for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const wake = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0);
      const bed = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 30);
      out.push({ startTime: bed.toISOString(), endTime: wake.toISOString() });
    }
    return out;
  },
};

/** Health Connect qui ne renvoie rien (aucune appli source, par exemple). */
const emptyReader: HealthReader = {
  async aggregateSteps() {
    return { total: 0, dataOrigins: [] };
  },
  async readSleepSessions() {
    return [];
  },
};

function harness(response: { status: number; body: unknown }, initial?: SyncState, r: HealthReader = reader) {
  const bodies: unknown[] = [];
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    headers.push(init.headers);
    return {
      ok: response.status < 300,
      status: response.status,
      text: async () => JSON.stringify(response.body),
    };
  };
  let saved: SyncState = initial ?? { lastAttempt: null, lastSuccess: null };
  return {
    bodies,
    headers,
    get saved() {
      return saved;
    },
    deps: {
      reader: r,
      fetch,
      now: () => NOW,
      loadSettings: async () => ({ apiUrl: "http://localhost:8787", token: TOKEN }),
      loadState: async () => saved,
      saveState: async (s: SyncState) => {
        saved = s;
      },
    },
  };
}

function datesOf(body: unknown): string[] {
  return (body as { days: { date: string }[] }).days.map((d) => d.date);
}

describe("toIngestDays", () => {
  const empty = { steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null };
  it("garde 0 (vraie valeur), omet null (absence), retire les journées vides", () => {
    expect(
      toIngestDays([
        { date: "2026-09-20", ...empty },
        { date: "2026-09-21", ...empty, steps: 0 },
        {
          date: "2026-09-22",
          steps: null,
          sleep_minutes: 400,
          sleep_start: "2026-09-21T23:00:00+02:00",
          sleep_end: "2026-09-22T05:40:00+02:00",
        },
      ]),
    ).toEqual([
      { date: "2026-09-21", steps: 0 },
      {
        date: "2026-09-22",
        sleep_minutes: 400,
        sleep_start: "2026-09-21T23:00:00+02:00",
        sleep_end: "2026-09-22T05:40:00+02:00",
      },
    ]);
  });
});

describe("runSync", () => {
  it("Synchroniser : un appel, les 7 derniers jours complets, aujourd'hui exclu", async () => {
    const h = harness({ status: 200, body: { upserted: SYNC_DAYS } }, undefined, everyDayReader);
    const record = await runSync("sync", h.deps);

    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0];
    expect(HealthIngestBody.safeParse(body).success).toBe(true);
    expect(datesOf(body)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
    expect(h.headers[0]?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(record).toMatchObject({
      kind: "sync",
      ok: true,
      from: "2026-09-17",
      to: "2026-09-23",
      days: 7,
      upserted: 7,
      at: NOW.toISOString(),
    });
    expect(h.saved.lastAttempt).toEqual(record);
    expect(h.saved.lastSuccess).toEqual(record);
  });

  it("jours sans données : non envoyés, jamais de null qui effacerait une valeur en base", async () => {
    const h = harness({ status: 200, body: { upserted: 1 } });
    const record = await runSync("sync", h.deps);

    expect(h.bodies).toHaveLength(1);
    expect((h.bodies[0] as { days: unknown[] }).days).toEqual([
      {
        date: "2026-09-23",
        steps: 8421,
        sleep_minutes: 412,
        sleep_start: "2026-09-22T23:48:00+02:00",
        sleep_end: "2026-09-23T06:40:00+02:00",
      },
    ]);
    expect(record).toMatchObject({ ok: true, from: "2026-09-17", to: "2026-09-23", days: 1, upserted: 1 });
    expect(record.message).toContain("6 journées sans données, non envoyées");
  });

  it("Health Connect ne renvoie rien : aucun appel à l'API, échec explicite", async () => {
    const h = harness({ status: 200, body: { upserted: 30 } }, undefined, emptyReader);
    const record = await runSync("backfill", h.deps);

    expect(h.bodies).toHaveLength(0);
    expect(record).toMatchObject({ ok: false, errorKind: "read", days: 0, upserted: null });
    expect(record.message).toContain("aucune donnée");
    expect(h.saved.lastSuccess).toBeNull();
  });

  it("Backfill : un seul appel avec 30 journées consécutives jusqu'à hier", async () => {
    const h = harness({ status: 200, body: { upserted: BACKFILL_DAYS } }, undefined, everyDayReader);
    const record = await runSync("backfill", h.deps);

    expect(BACKFILL_DAYS).toBe(30);
    expect(h.bodies).toHaveLength(1);
    const dates = datesOf(h.bodies[0]);
    expect(dates).toHaveLength(30);
    expect(new Set(dates).size).toBe(30);
    expect(dates[0]).toBe("2026-08-25");
    expect(dates[29]).toBe("2026-09-23");
    expect(dates).not.toContain("2026-09-24");
    expect(HealthIngestBody.safeParse(h.bodies[0]).success).toBe(true);
    expect(record).toMatchObject({ kind: "backfill", ok: true, days: 30, upserted: 30 });
  });

  it("échec : mémorisé comme dernière tentative, la dernière réussite est conservée", async () => {
    const ok = harness({ status: 200, body: { upserted: 7 } });
    const first = await runSync("sync", ok.deps);

    const h = harness({ status: 401, body: { error: "unauthorized" } }, ok.saved);
    const record = await runSync("sync", h.deps);
    expect(record).toMatchObject({ ok: false, errorKind: "unauthorized", upserted: null });
    expect(h.saved.lastAttempt).toEqual(record);
    expect(h.saved.lastSuccess).toEqual(first);
    expect(JSON.stringify(h.saved)).not.toContain(TOKEN);
  });

  it("lecture Health Connect impossible : rien n'est envoyé, l'erreur est mémorisée", async () => {
    const h = harness({ status: 200, body: { upserted: 7 } });
    const record = await runSync("sync", {
      ...h.deps,
      reader: {
        ...reader,
        async readSleepSessions() {
          throw new Error("SecurityException: permission retirée");
        },
      },
    });
    expect(h.bodies).toHaveLength(0);
    expect(record).toMatchObject({ ok: false, errorKind: "read" });
    expect(record.message).toContain("permission retirée");
    expect(h.saved.lastAttempt).toEqual(record);
  });

  it("un stockage en panne ne masque pas le résultat", async () => {
    const h = harness({ status: 200, body: { upserted: 7 } });
    const record = await runSync("sync", {
      ...h.deps,
      saveState: async () => {
        throw new Error("Keystore indisponible");
      },
    });
    expect(record.ok).toBe(true);
  });
});

describe("parseSyncState", () => {
  it("valeur absente ou illisible : état vide", () => {
    const empty = { lastAttempt: null, lastSuccess: null };
    expect(parseSyncState(null)).toEqual(empty);
    expect(parseSyncState("pas du json")).toEqual(empty);
    expect(parseSyncState('{"lastAttempt":{"at":1}}')).toEqual(empty);
  });
});
