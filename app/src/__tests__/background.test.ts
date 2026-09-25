/**
 * Étape 6 : décisions de la synchro automatique et corps de la tâche de fond, sans téléphone.
 * Tourne en Europe/Paris (voir jest.tz-check.js).
 */
import { HealthIngestBody } from "@sillage/shared";

import type { FetchLike } from "../api";
import {
  DAILY_SYNC_HOUR,
  OPEN_RETRY_MINUTES,
  dailyAnchor,
  describeAutoSync,
  needsDailySync,
  runBackgroundTask,
  shouldSyncOnOpen,
  yesterdayOf,
  type BackgroundAccess,
  type BackgroundDeps,
} from "../background";
import type { HealthReader } from "../days";
import { EMPTY_SYNC_STATE, type SyncRecord, type SyncState } from "../sync";

const TOKEN = "0123456789abcdef0123456789abcdef-secret";
/** 24 septembre 2026, 07:10 à Paris. */
const NOW = new Date("2026-09-24T05:10:00Z");

function success(at: string, to: string, kind: SyncRecord["kind"] = "sync"): SyncRecord {
  return {
    kind,
    at,
    ok: true,
    from: "2026-09-01",
    to,
    days: 7,
    upserted: 7,
    errorKind: null,
    message: "7 journées enregistrées.",
    details: [],
  };
}

function failure(at: string): SyncRecord {
  return { ...success(at, "2026-09-23"), ok: false, upserted: null, errorKind: "network", message: "API injoignable" };
}

const state = (patch: Partial<SyncState>): SyncState => ({ ...EMPTY_SYNC_STATE, ...patch });

describe("bornes de la journée", () => {
  it("hier en date locale", () => {
    expect(yesterdayOf(NOW)).toBe("2026-09-23");
    // 00:30 à Paris le 24 = 22:30 UTC le 23 : hier reste le 23.
    expect(yesterdayOf(new Date("2026-09-23T22:30:00Z"))).toBe("2026-09-23");
  });

  it(`ancre quotidienne : dernier passage à ${DAILY_SYNC_HOUR} h locale`, () => {
    expect(dailyAnchor(NOW)).toEqual(new Date(2026, 8, 24, DAILY_SYNC_HOUR));
    // 03:00 à Paris : l'ancre est la veille à 5 h.
    expect(dailyAnchor(new Date("2026-09-24T01:00:00Z"))).toEqual(new Date(2026, 8, 23, DAILY_SYNC_HOUR));
  });

  it("changement d'heure de mars (29/03/2026, journée de 23 h)", () => {
    // 06:00 à Paris (UTC+2) le 29 : ancre 05:00 locale = 03:00 UTC.
    expect(dailyAnchor(new Date("2026-03-29T04:00:00Z")).toISOString()).toBe("2026-03-29T03:00:00.000Z");
    // 04:30 à Paris le 29 (déjà UTC+2) : ancre la veille à 05:00 UTC+1 = 04:00 UTC.
    expect(dailyAnchor(new Date("2026-03-29T02:30:00Z")).toISOString()).toBe("2026-03-28T04:00:00.000Z");
    expect(yesterdayOf(new Date("2026-03-29T04:00:00Z"))).toBe("2026-03-28");
  });

  it("changement d'heure d'octobre (25/10/2026, journée de 25 h)", () => {
    // 06:00 à Paris (UTC+1) le 25 : ancre 05:00 locale = 04:00 UTC.
    expect(dailyAnchor(new Date("2026-10-25T05:00:00Z")).toISOString()).toBe("2026-10-25T04:00:00.000Z");
    // 04:00 à Paris le 25 : ancre la veille à 05:00 UTC+2 = 03:00 UTC.
    expect(dailyAnchor(new Date("2026-10-25T03:00:00Z")).toISOString()).toBe("2026-10-24T03:00:00.000Z");
    expect(yesterdayOf(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
  });
});

describe("needsDailySync", () => {
  it("jamais synchronisé : oui", () => {
    expect(needsDailySync(EMPTY_SYNC_STATE, NOW)).toBe(true);
  });

  it("dernière réussite qui s'arrête avant hier : oui", () => {
    expect(needsDailySync(state({ lastSuccess: success("2026-09-23T06:00:00Z", "2026-09-22") }), NOW)).toBe(true);
  });

  it("hier déjà envoyé après 5 h aujourd'hui : non", () => {
    // 06:00 à Paris le 24.
    expect(needsDailySync(state({ lastSuccess: success("2026-09-24T04:00:00Z", "2026-09-23") }), NOW)).toBe(false);
  });

  it("hier envoyé à 02:00, avant 5 h : on renvoie après 5 h (données arrivées en retard)", () => {
    const s = state({ lastSuccess: success("2026-09-24T00:00:00Z", "2026-09-23") });
    expect(needsDailySync(s, NOW)).toBe(true);
    // …mais pas à 03:00, avant le passage de 5 h.
    expect(needsDailySync(s, new Date("2026-09-24T01:00:00Z"))).toBe(false);
  });

  it("n'importe quel type de synchro réussie compte (backfill manuel compris)", () => {
    const s = state({ lastSuccess: success("2026-09-24T04:30:00Z", "2026-09-23", "backfill") });
    expect(needsDailySync(s, NOW)).toBe(false);
  });

  it("horodatage illisible : oui", () => {
    expect(needsDailySync(state({ lastSuccess: success("pas une date", "2026-09-23") }), NOW)).toBe(true);
  });
});

describe("shouldSyncOnOpen (repli à l'ouverture de l'app)", () => {
  it("hier pas encore envoyé et réglages présents : oui", () => {
    const s = state({ lastSuccess: success("2026-09-23T06:00:00Z", "2026-09-22") });
    expect(shouldSyncOnOpen(s, NOW, true)).toBe(true);
  });

  it("sans URL ni token : jamais", () => {
    expect(shouldSyncOnOpen(EMPTY_SYNC_STATE, NOW, false)).toBe(false);
  });

  it("déjà à jour : non", () => {
    const s = state({ lastSuccess: success("2026-09-24T04:00:00Z", "2026-09-23", "background") });
    expect(shouldSyncOnOpen(s, NOW, true)).toBe(false);
  });

  it(`échec il y a moins de ${OPEN_RETRY_MINUTES} min : on ne réessaie pas à chaque ouverture`, () => {
    const s = state({ lastAttempt: failure("2026-09-24T05:00:00Z") });
    expect(shouldSyncOnOpen(s, NOW, true)).toBe(false);
    expect(shouldSyncOnOpen(s, new Date("2026-09-24T05:31:00Z"), true)).toBe(true);
  });
});

describe("describeAutoSync", () => {
  const ok = {
    configured: true,
    taskRegistered: true,
    access: "granted" as BackgroundAccess,
    featureUnavailable: false,
    restricted: false,
  };

  it("tout en place : en arrière-plan", () => {
    expect(describeAutoSync(ok).mode).toBe("background");
  });

  it("permission d'arrière-plan refusée : repli à l'ouverture, raison affichée", () => {
    const s = describeAutoSync({ ...ok, access: "denied" });
    expect(s.mode).toBe("open");
    expect(s.detail).toContain("n'est pas autorisée");
  });

  it("Health Connect trop ancien : repli, avec la raison", () => {
    const s = describeAutoSync({ ...ok, access: "denied", featureUnavailable: true });
    expect(s.mode).toBe("open");
    expect(s.detail).toContain("ne permet pas la lecture en arrière-plan");
  });

  it("batterie restreinte ou tâche non enregistrée : repli", () => {
    expect(describeAutoSync({ ...ok, restricted: true }).detail).toContain("Restreinte");
    expect(describeAutoSync({ ...ok, taskRegistered: false }).mode).toBe("open");
  });

  it("sans réglages : rien ne part", () => {
    expect(describeAutoSync({ ...ok, configured: false }).mode).toBe("off");
  });
});

/** Des pas et une nuit chaque jour. */
const everyDayReader: HealthReader = {
  async aggregateSteps(start) {
    return { total: 6000 + start.getDate(), dataOrigins: ["com.sec.android.app.shealth"] };
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

/** Ce que renvoie Health Connect en arrière-plan sans la permission : seulement les données de Sillage, donc rien. */
const emptyReader: HealthReader = {
  async aggregateSteps() {
    return { total: 0, dataOrigins: [] };
  },
  async readSleepSessions() {
    return [];
  },
};

function harness(opts: { initial?: SyncState; reader?: HealthReader; access?: BackgroundAccess; status?: number } = {}) {
  const bodies: unknown[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { days: unknown[] };
    bodies.push(body);
    const status = opts.status ?? 200;
    return {
      ok: status < 300,
      status,
      text: async () => JSON.stringify(status < 300 ? { upserted: body.days.length } : { error: "unauthorized" }),
    };
  };
  let saved: SyncState = opts.initial ?? { ...EMPTY_SYNC_STATE };
  const deps: BackgroundDeps = {
    reader: opts.reader ?? everyDayReader,
    fetch,
    now: () => NOW,
    loadSettings: async () => ({ apiUrl: "https://sillage.example", token: TOKEN }),
    loadState: async () => saved,
    saveState: async (s) => {
      saved = s;
    },
    backgroundAccess: async () => opts.access ?? "granted",
  };
  return {
    bodies,
    deps,
    get saved() {
      return saved;
    },
  };
}

describe("runBackgroundTask", () => {
  it("envoie les 3 dernières journées complètes en un appel et mémorise tout", async () => {
    const h = harness();
    const run = await runBackgroundTask(h.deps);

    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0] as { days: { date: string }[] };
    expect(HealthIngestBody.safeParse(body).success).toBe(true);
    expect(body.days.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);

    expect(run).toMatchObject({ outcome: "sent", at: NOW.toISOString() });
    expect(h.saved.lastBackground).toEqual(run);
    expect(h.saved.lastSuccess).toMatchObject({ kind: "background", ok: true, from: "2026-09-21", to: "2026-09-23" });
    expect(h.saved.lastAttempt).toEqual(h.saved.lastSuccess);
    expect(JSON.stringify(h.saved)).not.toContain(TOKEN);
  });

  it("déjà à jour : aucun appel, passage noté comme « rien à faire »", async () => {
    const lastSuccess = success("2026-09-24T04:00:00Z", "2026-09-23");
    const h = harness({ initial: state({ lastSuccess, lastAttempt: lastSuccess }) });
    const run = await runBackgroundTask(h.deps);

    expect(h.bodies).toHaveLength(0);
    expect(run.outcome).toBe("skipped");
    expect(h.saved.lastBackground).toEqual(run);
    expect(h.saved.lastSuccess).toEqual(lastSuccess);
  });

  it("lecture vide sans la permission d'arrière-plan : rien envoyé, échec expliqué", async () => {
    const previous = success("2026-09-22T06:00:00Z", "2026-09-21");
    const h = harness({ reader: emptyReader, access: "denied", initial: state({ lastSuccess: previous }) });
    const run = await runBackgroundTask(h.deps);

    expect(h.bodies).toHaveLength(0);
    expect(run.outcome).toBe("failed");
    expect(run.message).toContain("arrière-plan n'est pas autorisée");
    expect(run.message).toContain("prochaine ouverture");
    expect(h.saved.lastSuccess).toEqual(previous);
    expect(h.saved.lastAttempt).toMatchObject({ kind: "background", ok: false, errorKind: "read" });
  });

  it("lecture qui lève (SecurityException) : ne lève pas, échec mémorisé", async () => {
    const h = harness({
      reader: {
        ...everyDayReader,
        async aggregateSteps() {
          throw new Error("SecurityException: Caller doesn't have permission to read in background");
        },
      },
    });
    const run = await runBackgroundTask(h.deps);
    expect(h.bodies).toHaveLength(0);
    expect(run.outcome).toBe("failed");
    expect(run.message).toContain("SecurityException");
    expect(h.saved.lastBackground).toEqual(run);
  });

  it("API qui refuse le token : échec mémorisé, dernière réussite conservée", async () => {
    const previous = success("2026-09-22T06:00:00Z", "2026-09-21");
    const h = harness({ status: 401, initial: state({ lastSuccess: previous }) });
    const run = await runBackgroundTask(h.deps);
    expect(run.outcome).toBe("failed");
    expect(h.saved.lastSuccess).toEqual(previous);
    expect(h.saved.lastAttempt).toMatchObject({ ok: false, errorKind: "unauthorized" });
  });

  it("permission impossible à vérifier : on tente quand même", async () => {
    const h = harness();
    const run = await runBackgroundTask({
      ...h.deps,
      backgroundAccess: async () => {
        throw new Error("Health Connect non initialisé");
      },
    });
    expect(run.outcome).toBe("sent");
    expect(h.bodies).toHaveLength(1);
  });

  it("stockage illisible : ne lève pas et n'écrase pas l'état", async () => {
    const h = harness();
    const saves: SyncState[] = [];
    const run = await runBackgroundTask({
      ...h.deps,
      loadState: async () => {
        throw new Error("Keystore verrouillé");
      },
      saveState: async (s) => {
        saves.push(s);
      },
    });
    expect(run.outcome).toBe("sent");
    expect(saves).toHaveLength(0);
  });

  it("stockage en écriture impossible, réglages illisibles : ne lève jamais", async () => {
    const h = harness();
    await expect(
      runBackgroundTask({
        ...h.deps,
        loadSettings: async () => {
          throw new Error("SecureStore");
        },
        saveState: async () => {
          throw new Error("SecureStore");
        },
      })
    ).resolves.toMatchObject({ outcome: "failed" });
  });
});
