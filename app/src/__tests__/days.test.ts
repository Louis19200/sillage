/**
 * Tests du calcul des journées. Ils tournent avec TZ=Europe/Paris (voir jest.tz-check.js) :
 * les horodatages en entrée sont écrits en UTC (`Z`), comme Health Connect les renvoie.
 */
import { HealthDay, HealthIngestBody } from "@sillage/shared";

import {
  computeHealthDays,
  computeLastCompleteDays,
  dayBounds,
  lastCompleteDays,
  localDateOf,
  sleepForDay,
  stepsFromAggregate,
  toLocalOffsetIso,
  type HealthReader,
  type LocalDate,
  type SleepSession,
  type StepsAggregate,
} from "../days";

const HOUR = 3_600_000;
const FIT = "com.google.android.apps.fitness";
const WATCH = "com.samsung.android.wear.shealth";

/** Faux Health Connect : comme le vrai, un jour sans données renvoie COUNT_TOTAL 0 et aucune source. */
function fakeReader(data: { steps?: Record<LocalDate, StepsAggregate>; sleep?: SleepSession[] }) {
  const stepCalls: { start: Date; end: Date }[] = [];
  const sleepCalls: { start: Date; end: Date }[] = [];
  const reader: HealthReader = {
    async aggregateSteps(start, end) {
      stepCalls.push({ start, end });
      return data.steps?.[localDateOf(start)] ?? { total: 0, dataOrigins: [] };
    },
    async readSleepSessions(start, end) {
      sleepCalls.push({ start, end });
      // Health Connect renvoie les sessions qui recoupent l'intervalle.
      return (data.sleep ?? []).filter(
        (s) => Date.parse(s.endTime) > start.getTime() && Date.parse(s.startTime) < end.getTime()
      );
    },
  };
  return { reader, stepCalls, sleepCalls };
}

describe("localDateOf", () => {
  it("donne le jour local, pas le jour UTC", () => {
    // 00:30 à Paris le 24 septembre = 22:30 UTC le 23.
    const d = new Date("2026-09-23T22:30:00Z");
    expect(localDateOf(d)).toBe("2026-09-24");
    expect(d.toISOString().slice(0, 10)).toBe("2026-09-23"); // le piège évité
  });
});

describe("dayBounds", () => {
  it("jour normal : minuit à minuit local, 24 h", () => {
    const b = dayBounds("2026-09-23");
    expect(b.start.toISOString()).toBe("2026-09-22T22:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-09-23T22:00:00.000Z");
    expect(b.end.getTime() - b.start.getTime()).toBe(24 * HOUR);
  });

  it("changement d'heure de mars : 23 h", () => {
    const b = dayBounds("2026-03-29");
    expect(b.start.toISOString()).toBe("2026-03-28T23:00:00.000Z"); // minuit UTC+1
    expect(b.end.toISOString()).toBe("2026-03-29T22:00:00.000Z"); // minuit UTC+2
    expect(b.end.getTime() - b.start.getTime()).toBe(23 * HOUR);
  });

  it("changement d'heure d'octobre : 25 h", () => {
    const b = dayBounds("2026-10-25");
    expect(b.start.toISOString()).toBe("2026-10-24T22:00:00.000Z"); // minuit UTC+2
    expect(b.end.toISOString()).toBe("2026-10-25T23:00:00.000Z"); // minuit UTC+1
    expect(b.end.getTime() - b.start.getTime()).toBe(25 * HOUR);
  });

  it("les journées consécutives se touchent sans trou ni recouvrement", () => {
    for (const [a, b] of [
      ["2026-03-28", "2026-03-29"],
      ["2026-03-29", "2026-03-30"],
      ["2026-10-24", "2026-10-25"],
      ["2026-10-25", "2026-10-26"],
      ["2026-12-31", "2027-01-01"],
    ] as const) {
      expect(dayBounds(a).end.getTime()).toBe(dayBounds(b).start.getTime());
    }
  });

  it("refuse une date mal formée ou inexistante", () => {
    expect(() => dayBounds("2026-9-1")).toThrow();
    expect(() => dayBounds("2026-02-30")).toThrow();
    expect(() => dayBounds("2026-13-01")).toThrow();
  });
});

describe("lastCompleteDays", () => {
  it("n'inclut jamais aujourd'hui, finit hier, ordre chronologique", () => {
    const now = new Date(2026, 8, 24, 23, 59); // 24/09 23:59 local
    expect(lastCompleteDays(7, now)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("juste après minuit local, hier est bien la veille locale", () => {
    // 00:05 le 24/09 à Paris = 22:05 UTC le 23 : un calcul en UTC dirait « hier = 22 ».
    const now = new Date("2026-09-23T22:05:00Z");
    expect(lastCompleteDays(1, now)).toEqual(["2026-09-23"]);
  });

  it("traverse les changements d'heure sans sauter ni doubler de jour", () => {
    expect(lastCompleteDays(3, new Date(2026, 2, 30, 0, 30))).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
    ]);
    expect(lastCompleteDays(3, new Date(2026, 9, 26, 0, 30))).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("traverse les fins de mois et d'année", () => {
    expect(lastCompleteDays(3, new Date(2027, 0, 2, 9))).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(lastCompleteDays(0, new Date())).toEqual([]);
  });
});

describe("toLocalOffsetIso", () => {
  it("écrit l'heure locale avec le décalage du moment (été +02:00, hiver +01:00)", () => {
    expect(toLocalOffsetIso(new Date("2026-09-23T04:40:00Z"))).toBe("2026-09-23T06:40:00+02:00");
    expect(toLocalOffsetIso(new Date("2026-01-15T22:10:30Z"))).toBe("2026-01-15T23:10:30+01:00");
  });

  it("représente le même instant et respecte le contrat", () => {
    const d = new Date("2026-03-29T05:30:00Z");
    const iso = toLocalOffsetIso(d);
    expect(iso).toBe("2026-03-29T07:30:00+02:00");
    expect(Date.parse(iso)).toBe(d.getTime());
    expect(HealthDay.shape.sleep_end.parse(iso)).toBe(iso);
  });
});

describe("stepsFromAggregate", () => {
  it("jour normal : le total", () => {
    expect(stepsFromAggregate({ total: 8421, dataOrigins: [FIT] })).toBe(8421);
  });

  it("jour sans données : null, même si Health Connect renvoie 0", () => {
    expect(stepsFromAggregate({ total: 0, dataOrigins: [] })).toBeNull();
    expect(stepsFromAggregate({ total: undefined, dataOrigins: [] })).toBeNull();
  });

  it("jour à 0 pas avec une source : vraiment 0", () => {
    expect(stepsFromAggregate({ total: 0, dataOrigins: [FIT] })).toBe(0);
  });
});

describe("sleepForDay", () => {
  const sept23 = dayBounds("2026-09-23");

  it("aucune session : trois null", () => {
    expect(sleepForDay([], sept23)).toEqual({
      sleep_minutes: null,
      sleep_start: null,
      sleep_end: null,
    });
  });

  it("nuit à cheval sur minuit : comptée pour le jour du réveil", () => {
    // 22/09 23:48 → 23/09 06:40, heure de Paris.
    const night = { startTime: "2026-09-22T21:48:00.000Z", endTime: "2026-09-23T04:40:00.000Z" };
    expect(sleepForDay([night], sept23)).toEqual({
      sleep_minutes: 412,
      sleep_start: "2026-09-22T23:48:00+02:00",
      sleep_end: "2026-09-23T06:40:00+02:00",
    });
    expect(sleepForDay([night], dayBounds("2026-09-22")).sleep_minutes).toBeNull();
  });

  it("sieste + nuit : durées additionnées, coucher/réveil de la plus longue", () => {
    const night = { startTime: "2026-09-22T21:30:00Z", endTime: "2026-09-23T05:00:00Z" }; // 7 h 30
    const nap = { startTime: "2026-09-23T12:00:00Z", endTime: "2026-09-23T12:40:00Z" }; // 40 min
    expect(sleepForDay([nap, night], sept23)).toEqual({
      sleep_minutes: 490,
      sleep_start: "2026-09-22T23:30:00+02:00",
      sleep_end: "2026-09-23T07:00:00+02:00",
    });
  });

  it("une nuit enregistrée par le téléphone et la montre n'est pas comptée deux fois", () => {
    const phone = { startTime: "2026-09-22T21:30:00Z", endTime: "2026-09-23T05:00:00Z" };
    const watch = { startTime: "2026-09-22T21:45:00Z", endTime: "2026-09-23T05:10:00Z" };
    const r = sleepForDay([phone, watch], sept23);
    expect(r.sleep_minutes).toBe(460); // 23:30 → 07:10, pas 450 + 445
    expect(r.sleep_start).toBe("2026-09-22T23:30:00+02:00"); // la plus longue : téléphone
  });

  it("borne : une fin à minuit pile appartient au jour qui commence", () => {
    const s = { startTime: "2026-09-23T20:00:00Z", endTime: "2026-09-23T22:00:00Z" }; // 22:00 → 00:00
    expect(sleepForDay([s], sept23).sleep_minutes).toBeNull();
    expect(sleepForDay([s], dayBounds("2026-09-24")).sleep_minutes).toBe(120);
  });

  it("ignore les sessions invalides (fin avant début, date illisible)", () => {
    const bad = [
      { startTime: "2026-09-23T05:00:00Z", endTime: "2026-09-23T04:00:00Z" },
      { startTime: "n'importe quoi", endTime: "2026-09-23T04:00:00Z" },
    ];
    expect(sleepForDay(bad, sept23).sleep_minutes).toBeNull();
  });

  it("changement d'heure de mars : 23:30 → 07:30 ne dure que 7 h", () => {
    // 28/03 23:30 (UTC+1) → 29/03 07:30 (UTC+2).
    const night = { startTime: "2026-03-28T22:30:00Z", endTime: "2026-03-29T05:30:00Z" };
    expect(sleepForDay([night], dayBounds("2026-03-29"))).toEqual({
      sleep_minutes: 420,
      sleep_start: "2026-03-28T23:30:00+01:00",
      sleep_end: "2026-03-29T07:30:00+02:00",
    });
  });

  it("changement d'heure d'octobre : 23:30 → 07:30 dure 9 h", () => {
    // 24/10 23:30 (UTC+2) → 25/10 07:30 (UTC+1).
    const night = { startTime: "2026-10-24T21:30:00Z", endTime: "2026-10-25T06:30:00Z" };
    expect(sleepForDay([night], dayBounds("2026-10-25"))).toEqual({
      sleep_minutes: 540,
      sleep_start: "2026-10-24T23:30:00+02:00",
      sleep_end: "2026-10-25T07:30:00+01:00",
    });
  });

  it("changement d'heure d'octobre : une session finissant à 23:30 appartient encore au 25", () => {
    const late = { startTime: "2026-10-25T21:00:00Z", endTime: "2026-10-25T22:30:00Z" }; // 22:00 → 23:30 (UTC+1)
    expect(sleepForDay([late], dayBounds("2026-10-25")).sleep_minutes).toBe(90);
    expect(sleepForDay([late], dayBounds("2026-10-26")).sleep_minutes).toBeNull();
  });
});

describe("computeHealthDays", () => {
  it("jour normal, jour sans données et jour à 0 pas, conformes au contrat", async () => {
    const { reader } = fakeReader({
      steps: {
        "2026-09-21": { total: 8421, dataOrigins: [FIT, WATCH] },
        "2026-09-23": { total: 0, dataOrigins: [FIT] },
      },
      sleep: [{ startTime: "2026-09-20T21:48:00Z", endTime: "2026-09-21T04:40:00Z" }],
    });
    const days = await computeHealthDays(reader, ["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(days).toEqual([
      {
        date: "2026-09-21",
        steps: 8421,
        sleep_minutes: 412,
        sleep_start: "2026-09-20T23:48:00+02:00",
        sleep_end: "2026-09-21T06:40:00+02:00",
      },
      { date: "2026-09-22", steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null },
      { date: "2026-09-23", steps: 0, sleep_minutes: null, sleep_start: null, sleep_end: null },
    ]);
    expect(() => HealthIngestBody.parse({ days })).not.toThrow();
  });

  it("interroge les pas entre les minuits locaux, 23 h et 25 h compris", async () => {
    const { reader, stepCalls } = fakeReader({});
    await computeHealthDays(reader, ["2026-03-29", "2026-10-25"]);
    expect(stepCalls.map((c) => [c.start.toISOString(), c.end.toISOString()])).toEqual([
      ["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
      ["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
    ]);
  });

  it("lit le sommeil en une fois, depuis 24 h avant le premier jour, et rattache chaque nuit à son réveil", async () => {
    const { reader, sleepCalls } = fakeReader({
      sleep: [
        // Nuit du 21 au 22, commencée avant la fenêtre des jours demandés.
        { startTime: "2026-09-21T21:00:00Z", endTime: "2026-09-22T05:00:00Z" },
        // Nuit du 22 au 23.
        { startTime: "2026-09-22T22:15:00Z", endTime: "2026-09-23T04:15:00Z" },
        // Nuit du 23 au 24 : réveil aujourd'hui, hors période.
        { startTime: "2026-09-23T21:00:00Z", endTime: "2026-09-24T05:00:00Z" },
      ],
    });
    const days = await computeHealthDays(reader, ["2026-09-22", "2026-09-23"]);
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]?.start.toISOString()).toBe("2026-09-20T22:00:00.000Z");
    expect(sleepCalls[0]?.end.toISOString()).toBe("2026-09-23T22:00:00.000Z");
    expect(days.map((d) => [d.date, d.sleep_minutes])).toEqual([
      ["2026-09-22", 480],
      ["2026-09-23", 360],
    ]);
  });

  it("les 7 derniers jours ne demandent jamais aujourd'hui", async () => {
    const { reader, stepCalls } = fakeReader({});
    const now = new Date(2026, 8, 24, 7, 0);
    const days = await computeLastCompleteDays(reader, 7, now);
    expect(days.map((d) => d.date)).toEqual(lastCompleteDays(7, now));
    expect(days.at(-1)?.date).toBe("2026-09-23");
    const todayStart = dayBounds("2026-09-24").start.getTime();
    expect(stepCalls.every((c) => c.end.getTime() <= todayStart)).toBe(true);
  });

  it("aucun jour demandé : aucune lecture", async () => {
    const { reader, stepCalls, sleepCalls } = fakeReader({});
    expect(await computeHealthDays(reader, [])).toEqual([]);
    expect(stepCalls).toHaveLength(0);
    expect(sleepCalls).toHaveLength(0);
  });
});
