/**
 * Position quotidienne arrondie (météo) : arrondi, une position par jour, sélection des
 * jours à envoyer, 404 ignoré, aucune coordonnée dans ce qui est affiché ou mémorisé,
 * option désactivée par défaut. Tourne en Europe/Paris (voir jest.tz-check.js).
 */
import { checkLocationDays, ingestLocationDays, type FetchLike } from "../api";
import { runBackgroundTask } from "../background";
import type { HealthReader } from "../days";
import {
  DEFAULT_LOCATION_STORE,
  MAX_LOCATION_DAYS,
  MAX_STORED_DAYS,
  captureDailyPosition,
  describeLocation,
  disabledStore,
  hasPositionFor,
  locationDiagnostic,
  markSent,
  parseLocationStore,
  recordPosition,
  roundCoordinate,
  roundPosition,
  runLocationSync,
  scrubCoordinates,
  selectDaysToSend,
  serializeLocationStore,
  type LocationDay,
  type LocationDeps,
  type LocationPermission,
  type LocationStore,
  type PositionMode,
} from "../location";
import { EMPTY_SYNC_STATE, parseSyncState, runSync, type SyncState } from "../sync";

const TOKEN = "0123456789abcdef0123456789abcdef-secret";
// 24 septembre 2026, 07:10 à Paris : aujourd'hui = 24, hier = 23.
const NOW = new Date("2026-09-24T05:10:00Z");
/** Position brute précise (Paris, Notre-Dame) : ne doit apparaître nulle part. */
const RAW = { latitude: 48.852968, longitude: 2.349902 };
const RAW_STRINGS = ["48.852968", "2.349902", "48.85296", "2.34990", "48.853", "2.350"];
const ROUNDED = { lat: 48.85, lon: 2.35 };

const enabled = (pending: LocationDay[] = [], extra: Partial<LocationStore> = {}): LocationStore => ({
  ...DEFAULT_LOCATION_STORE,
  enabled: true,
  pending,
  ...extra,
});

/** Journées locales consécutives finissant la veille de `end` (YYYY-MM-DD). */
function pastDays(count: number, end = "2026-09-24"): string[] {
  const [y, m, d] = end.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = count; i >= 1; i--) {
    const x = new Date(y, m - 1, d - i);
    out.push(
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

function fakeDevice(
  initial: LocationStore,
  opts: {
    permission?: LocationPermission;
    position?: { latitude: number; longitude: number } | null | Error;
  } = {}
) {
  let store = initial;
  const calls = { permission: 0, getPosition: [] as PositionMode[], saves: 0 };
  const deps: LocationDeps = {
    loadStore: async () => store,
    saveStore: async (s) => {
      calls.saves++;
      // Comme le vrai stockage : passe par la forme sérialisée.
      store = parseLocationStore(serializeLocationStore(s));
    },
    permission: async () => {
      calls.permission++;
      return opts.permission ?? "granted";
    },
    getPosition: async (mode) => {
      calls.getPosition.push(mode);
      const p = opts.position === undefined ? RAW : opts.position;
      if (p instanceof Error) throw p;
      return p;
    },
  };
  return {
    deps,
    calls,
    get store() {
      return store;
    },
  };
}

function fakeFetch(response: { status: number; body: unknown } | ((url: string) => { status: number; body: unknown })) {
  const requests: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = typeof response === "function" ? response(url) : response;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
  return { fetch, requests };
}

const settings = async () => ({ apiUrl: "https://sillage.example", token: TOKEN });

function expectNoRawCoordinates(text: string): void {
  for (const s of RAW_STRINGS) expect(text).not.toContain(s);
}

function expectNoCoordinatesAtAll(text: string): void {
  expectNoRawCoordinates(text);
  expect(text).not.toContain("48.85");
  expect(text).not.toContain("2.35");
}

describe("arrondi", () => {
  it("arrondit à 2 décimales", () => {
    expect(roundCoordinate(48.852968)).toBe(48.85);
    expect(roundCoordinate(2.349902)).toBe(2.35);
    expect(roundCoordinate(-122.419416)).toBe(-122.42);
    expect(roundCoordinate(45)).toBe(45);
    expect(String(roundCoordinate(43.296482))).toBe("43.3");
  });

  it("jamais de -0", () => {
    expect(Object.is(roundCoordinate(-0.004), 0)).toBe(true);
  });

  it("au plus 2 décimales une fois écrit", () => {
    for (let i = 0; i < 2000; i++) {
      const v = (i * 37.123457) % 180 - 90;
      const [, dec = ""] = String(roundCoordinate(v)).split(".");
      expect(dec.length).toBeLessThanOrEqual(2);
    }
  });

  it("position inutilisable : null", () => {
    expect(roundPosition(Number.NaN, 2)).toBeNull();
    expect(roundPosition(91, 2)).toBeNull();
    expect(roundPosition(45, 181)).toBeNull();
    expect(roundPosition(RAW.latitude, RAW.longitude)).toEqual(ROUNDED);
  });
});

describe("désactivé par défaut", () => {
  it("état par défaut, absent ou illisible : option désactivée, rien en attente", () => {
    expect(DEFAULT_LOCATION_STORE.enabled).toBe(false);
    expect(parseLocationStore(null)).toEqual(disabledStore());
    expect(parseLocationStore("pas du json")).toEqual(disabledStore());
    expect(parseLocationStore('{"e":true}').enabled).toBe(false);
  });

  it("option désactivée : ni permission, ni capteur, ni réseau", async () => {
    const dev = fakeDevice(parseLocationStore(null));
    const { fetch, requests } = fakeFetch({ status: 200, body: { upserted: 1 } });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    expect(run.outcome).toBe("disabled");
    expect(dev.calls).toEqual({ permission: 0, getPosition: [], saves: 0 });
    expect(requests).toHaveLength(0);
  });

  it("recordPosition ne mémorise rien si l'option est désactivée", () => {
    expect(recordPosition(disabledStore(), RAW, NOW).pending).toEqual([]);
  });
});

describe("une position par jour", () => {
  it("mémorise la position arrondie pour la journée locale en cours", () => {
    const s = recordPosition(enabled(), RAW, NOW);
    expect(s.pending).toEqual([{ date: "2026-09-24", ...ROUNDED }]);
    expect(s.lastCaptured).toBe("2026-09-24");
  });

  it("une deuxième position le même jour remplace la première (pas de trajet)", () => {
    let s = recordPosition(enabled(), RAW, NOW);
    s = recordPosition(s, { latitude: 45.764043, longitude: 4.835659 }, new Date("2026-09-24T16:00:00Z"));
    expect(s.pending).toEqual([{ date: "2026-09-24", lat: 45.76, lon: 4.84 }]);
  });

  it("date locale, pas UTC : 00:30 à Paris le 25 = 22:30 UTC le 24", () => {
    const s = recordPosition(enabled(), RAW, new Date("2026-09-24T22:30:00Z"));
    expect(s.pending.map((d) => d.date)).toEqual(["2026-09-25"]);
  });

  it("changement d'heure (29 mars 2026, 23:30 à Paris) : reste le 29", () => {
    const s = recordPosition(enabled(), RAW, new Date(2026, 2, 29, 23, 30));
    expect(s.pending.map((d) => d.date)).toEqual(["2026-03-29"]);
  });

  it("ne garde que les journées les plus récentes", () => {
    const pending = pastDays(40).map((date) => ({ date, ...ROUNDED }));
    const s = recordPosition(enabled(pending), RAW, NOW);
    expect(s.pending).toHaveLength(MAX_STORED_DAYS);
    expect(s.pending[s.pending.length - 1]!.date).toBe("2026-09-24");
  });

  it("hasPositionFor : le jour a déjà sa position", () => {
    expect(hasPositionFor(enabled(), NOW)).toBe(false);
    expect(hasPositionFor(recordPosition(enabled(), RAW, NOW), NOW)).toBe(true);
  });
});

describe("sélection des jours à envoyer", () => {
  it("jamais aujourd'hui, ordre chronologique", () => {
    const store = enabled([
      { date: "2026-09-24", ...ROUNDED },
      { date: "2026-09-22", ...ROUNDED },
      { date: "2026-09-23", ...ROUNDED },
    ]);
    expect(selectDaysToSend(store, NOW).map((d) => d.date)).toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("au plus 30, les plus récentes", () => {
    const store = enabled(pastDays(35).map((date) => ({ date, ...ROUNDED })));
    const days = selectDaysToSend(store, NOW);
    expect(days).toHaveLength(MAX_LOCATION_DAYS);
    expect(days[0]!.date).toBe("2026-08-25");
    expect(days[days.length - 1]!.date).toBe("2026-09-23");
  });

  it("markSent efface les positions envoyées, garde la date de la dernière", () => {
    const store = enabled([
      { date: "2026-09-22", ...ROUNDED },
      { date: "2026-09-23", ...ROUNDED },
      { date: "2026-09-24", ...ROUNDED },
    ]);
    const after = markSent(store, selectDaysToSend(store, NOW));
    expect(after.pending.map((d) => d.date)).toEqual(["2026-09-24"]);
    expect(after.lastSent).toBe("2026-09-23");
    expect(selectDaysToSend(after, NOW)).toEqual([]);
  });

  it("le lendemain, la position d'hier part", () => {
    const store = recordPosition(enabled(), RAW, NOW);
    expect(selectDaysToSend(store, new Date("2026-09-25T05:10:00Z"))).toEqual([{ date: "2026-09-24", ...ROUNDED }]);
  });
});

describe("stockage local", () => {
  it("ne contient que des valeurs arrondies, même si on lui passe une position brute", () => {
    const tampered = enabled([{ date: "2026-09-23", lat: RAW.latitude, lon: RAW.longitude }]);
    const raw = serializeLocationStore(tampered);
    expectNoRawCoordinates(raw);
    expect(parseLocationStore(raw).pending).toEqual([{ date: "2026-09-23", ...ROUNDED }]);
  });

  it("relit en ré-arrondissant, ignore les entrées mal formées et les doublons", () => {
    const raw = JSON.stringify({
      e: 1,
      p: [
        ["2026-09-23", RAW.latitude, RAW.longitude],
        ["2026-09-23", 1, 1],
        ["hier", 1, 1],
        ["2026-09-22", "48", 2],
        ["2026-09-21", 95, 2],
      ],
      c: "2026-09-23",
      s: null,
    });
    const s = parseLocationStore(raw);
    expect(s.enabled).toBe(true);
    expect(s.pending).toEqual([{ date: "2026-09-23", ...ROUNDED }]);
  });
});

describe("captureDailyPosition", () => {
  it("permission refusée : rien n'est relevé", async () => {
    const dev = fakeDevice(enabled(), { permission: "denied" });
    const r = await captureDailyPosition(dev.deps, "current", NOW);
    expect(r.outcome).toBe("no-permission");
    expect(dev.calls.getPosition).toEqual([]);
    expect(dev.store.pending).toEqual([]);
  });

  it("onlyIfMissing : n'allume pas le capteur si le jour a déjà sa position", async () => {
    const dev = fakeDevice(recordPosition(enabled(), RAW, NOW));
    const r = await captureDailyPosition(dev.deps, "current", NOW, { onlyIfMissing: true });
    expect(r.outcome).toBe("skipped");
    expect(dev.calls.getPosition).toEqual([]);
  });

  it("aucune position connue : rien n'est mémorisé", async () => {
    const dev = fakeDevice(enabled(), { position: null });
    const r = await captureDailyPosition(dev.deps, "last-known", NOW);
    expect(r.outcome).toBe("no-position");
    expect(dev.calls.saves).toBe(0);
  });

  it("erreur du capteur contenant des coordonnées : masquées dans le message", async () => {
    const dev = fakeDevice(enabled(), { position: new Error(`fix rejeté ${RAW.latitude},${RAW.longitude}`) });
    const r = await captureDailyPosition(dev.deps, "current", NOW);
    expect(r.outcome).toBe("error");
    expectNoRawCoordinates(r.message);
  });
});

describe("runLocationSync", () => {
  const withYesterday = () =>
    enabled([{ date: "2026-09-22", lat: 48.85, lon: 2.35 }, { date: "2026-09-23", lat: 45.76, lon: 4.84 }]);

  it("envoie les journées terminées en un seul appel, arrondies, puis les efface", async () => {
    const dev = fakeDevice(withYesterday());
    const { fetch, requests } = fakeFetch({ status: 200, body: { upserted: 2 } });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);

    expect(run).toMatchObject({ outcome: "sent", from: "2026-09-22", to: "2026-09-23", days: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://sillage.example/ingest/location");
    expect(requests[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests[0]!.body).toEqual({
      days: [
        { date: "2026-09-22", lat: 48.85, lon: 2.35 },
        { date: "2026-09-23", lat: 45.76, lon: 4.84 },
      ],
    });
    // Aujourd'hui (relevé pendant la synchro) reste sur le téléphone ; le reste est effacé.
    expect(dev.store.pending).toEqual([{ date: "2026-09-24", ...ROUNDED }]);
    expect(dev.store.lastSent).toBe("2026-09-23");
    expect(dev.calls.getPosition).toEqual(["current"]);
  });

  it("le corps envoyé ne contient jamais de coordonnée brute", async () => {
    const dev = fakeDevice(enabled());
    const { fetch, requests } = fakeFetch({ status: 200, body: { upserted: 1 } });
    await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", new Date("2026-09-25T05:10:00Z"));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toEqual({ days: [{ date: "2026-09-24", ...ROUNDED }] });
    expectNoRawCoordinates(JSON.stringify(requests));
  });

  it("404 (route pas encore déployée) : pas d'échec, positions gardées pour plus tard", async () => {
    const dev = fakeDevice(withYesterday());
    const { fetch } = fakeFetch({ status: 404, body: { error: "not_found" } });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    expect(run.outcome).toBe("unavailable");
    expect(describeLocation(run, true)).toBe("Position : route pas encore disponible sur l'API");
    expect(dev.store.pending.map((d) => d.date)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(dev.store.lastSent).toBeNull();
  });

  it("autre erreur : échec, positions gardées, message sans coordonnée même si l'API les renvoie", async () => {
    const dev = fakeDevice(withYesterday());
    const { fetch } = fakeFetch({ status: 500, body: `boom at ${RAW.latitude},${RAW.longitude}` });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    expect(run.outcome).toBe("failed");
    expectNoRawCoordinates(run.message);
    expect(dev.store.pending).toHaveLength(3);
  });

  it("rien de terminé à envoyer : aucun appel réseau", async () => {
    const dev = fakeDevice(enabled());
    const { fetch, requests } = fakeFetch({ status: 200, body: { upserted: 1 } });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    expect(run.outcome).toBe("nothing");
    expect(requests).toHaveLength(0);
    expect(dev.store.pending).toEqual([{ date: "2026-09-24", ...ROUNDED }]);
  });

  it("permission retirée : ni capteur ni envoi", async () => {
    const dev = fakeDevice(withYesterday(), { permission: "denied" });
    const { fetch, requests } = fakeFetch({ status: 200, body: { upserted: 2 } });
    const run = await runLocationSync({ location: dev.deps, fetch, loadSettings: settings }, "current", NOW);
    expect(run.outcome).toBe("no-permission");
    expect(requests).toHaveLength(0);
  });
});

describe("dans le flux de synchro santé", () => {
  const reader: HealthReader = {
    async aggregateSteps() {
      return { total: 8421, dataOrigins: ["com.google.android.apps.fitness"] };
    },
    async readSleepSessions() {
      return [];
    },
  };

  function syncHarness(location: LocationDeps, routes: { health: number; location: number }, initial?: SyncState) {
    let saved: SyncState = initial ?? { ...EMPTY_SYNC_STATE };
    const { fetch, requests } = fakeFetch((url) =>
      url.endsWith("/ingest/location")
        ? routes.location === 404
          ? { status: 404, body: { error: "not_found" } }
          : { status: routes.location, body: { upserted: 1 } }
        : { status: routes.health, body: { upserted: 3 } }
    );
    return {
      requests,
      get saved() {
        return saved;
      },
      deps: {
        reader,
        fetch,
        now: () => NOW,
        loadSettings: settings,
        loadState: async () => saved,
        saveState: async (s: SyncState) => {
          saved = s;
        },
        location,
      },
    };
  }

  it("après la santé ; un 404 n'échoue pas la synchro santé et est noté dans l'état", async () => {
    const dev = fakeDevice(enabled([{ date: "2026-09-23", ...ROUNDED }]));
    const h = syncHarness(dev.deps, { health: 200, location: 404 });
    const record = await runSync("sync", h.deps);
    expect(record.ok).toBe(true);
    expect(h.requests.map((r) => new URL(r.url).pathname)).toEqual(["/ingest/health", "/ingest/location"]);
    expect(h.saved.lastSuccess?.ok).toBe(true);
    expect(h.saved.lastLocation?.outcome).toBe("unavailable");
  });

  it("option désactivée : aucun appel à /ingest/location, état « désactivée »", async () => {
    const dev = fakeDevice(disabledStore());
    const h = syncHarness(dev.deps, { health: 200, location: 200 });
    await runSync("sync", h.deps);
    expect(h.requests.map((r) => new URL(r.url).pathname)).toEqual(["/ingest/health"]);
    expect(h.saved.lastLocation?.outcome).toBe("disabled");
    expect(describeLocation(h.saved.lastLocation, false)).toBe("Position : désactivée");
  });

  it("tâche de fond : dernière position connue seulement (pas de GPS)", async () => {
    const dev = fakeDevice(enabled());
    const h = syncHarness(dev.deps, { health: 200, location: 200 });
    await runSync("background", h.deps);
    expect(dev.calls.getPosition).toEqual(["last-known"]);
  });

  it("réveil sans synchro à faire : relève quand même la dernière position connue, sans réseau", async () => {
    const dev = fakeDevice(enabled());
    const lastSuccess = {
      kind: "background" as const,
      at: "2026-09-24T04:00:00.000Z",
      ok: true,
      from: "2026-09-21",
      to: "2026-09-23",
      days: 3,
      upserted: 3,
      errorKind: null,
      message: "3 journées enregistrées.",
      details: [],
    };
    const h = syncHarness(dev.deps, { health: 200, location: 200 }, { ...EMPTY_SYNC_STATE, lastSuccess });
    const run = await runBackgroundTask({ ...h.deps, backgroundAccess: async () => "granted" });
    expect(run.outcome).toBe("skipped");
    expect(h.requests).toHaveLength(0);
    expect(dev.calls.getPosition).toEqual(["last-known"]);
    expect(dev.store.pending.map((d) => d.date)).toEqual(["2026-09-24"]);
  });

  it("aucune coordonnée dans l'état mémorisé et affiché (santé + position)", async () => {
    for (const status of [200, 404, 500]) {
      const dev = fakeDevice(enabled([{ date: "2026-09-23", ...ROUNDED }]));
      const h = syncHarness(dev.deps, { health: 200, location: status });
      await runSync("sync", h.deps);
      const shown = JSON.stringify(h.saved);
      expectNoCoordinatesAtAll(shown);
      expect(parseSyncState(shown).lastLocation).toEqual(h.saved.lastLocation);
      expectNoCoordinatesAtAll(describeLocation(h.saved.lastLocation, true));
    }
  });
});

describe("affichage et diagnostic", () => {
  it("describeLocation", () => {
    const base = { at: NOW.toISOString(), from: "2026-09-23", to: "2026-09-23", days: 1, message: "" };
    expect(describeLocation(null, false)).toBe("Position : désactivée");
    expect(describeLocation({ ...base, outcome: "sent" }, true)).toBe("Position : envoyée (2026-09-23)");
    expect(describeLocation({ ...base, outcome: "sent", from: "2026-09-20" }, true)).toBe(
      "Position : envoyée (du 2026-09-20 au 2026-09-23)"
    );
    expect(describeLocation(null, true)).toBe("Position : activée, pas encore envoyée");
  });

  it("diagnostic : permission et dates seulement, jamais de coordonnée", () => {
    const store = recordPosition(enabled([{ date: "2026-09-23", ...ROUNDED }]), RAW, NOW);
    const lines = locationDiagnostic({ store, permission: "granted", lastRun: null });
    const text = lines.join("\n");
    expect(text).toContain("activée");
    expect(text).toContain("accordée");
    expect(text).toContain("2026-09-24");
    expectNoCoordinatesAtAll(text);
  });

  it("scrubCoordinates masque les nombres précis, garde les autres", () => {
    expect(scrubCoordinates("lat 48.852968 lon -2,349902 code 404 v1.2")).toBe("lat … lon … code 404 v1.2");
  });
});

describe("client /ingest/location", () => {
  it("404 : erreur http avec le statut (l'appelant en fait « pas encore disponible »)", async () => {
    const { fetch } = fakeFetch({ status: 404, body: "Not Found" });
    const out = await ingestLocationDays({
      baseUrl: "https://sillage.example/",
      token: TOKEN,
      days: [{ date: "2026-09-23", ...ROUNDED }],
      fetch,
    });
    expect(out).toMatchObject({ ok: false, kind: "http", status: 404 });
  });

  it("validation locale : messages sans la valeur fautive", () => {
    const issues = checkLocationDays([
      { date: "2026-09-23", lat: 91.123456, lon: 2 },
      { date: "2026-09-23", lat: 1, lon: -181.654321 },
    ]);
    expect(issues).toHaveLength(3);
    expect(issues.join(" ")).not.toMatch(/91\.12|181\.65/);
  });
});
