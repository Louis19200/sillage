import { describe, expect, it } from "vitest";

import { HealthIngestBody } from "@sillage/shared";

import { buildHealthDays, parseOffset, parseSamsungCsv, sleepByDate, stepsByDate, toLocalIso } from "./parse";

// Données synthétiques au format de l'export Samsung Health (ligne technique, en-tête, virgule finale).
const PEDOMETER = [
  "﻿com.samsung.shealth.tracker.pedometer_day_summary,7006011,7",
  "create_sh_ver,step_count,source_info,deviceuuid,day_time",
  // Jour avec ligne fusionnée « tous appareils » (source_info) + deux appareils.
  ",2480,aaa.source_info.json,MERGED,2026-09-23 00:00:00.000,",
  ",1085,,PHONE,2026-09-23 00:00:00.000,",
  ",2141,,WATCH,2026-09-23 00:00:00.000,",
  // Jour sans ligne fusionnée : la plus grande valeur.
  ",900,,PHONE,2026-09-22 00:00:00.000,",
  ",1200,,WATCH,2026-09-22 00:00:00.000,",
  // Vraie journée à 0 pas.
  ",0,bbb.source_info.json,MERGED,2026-09-21 00:00:00.000,",
  // Aujourd'hui (incomplet) : exclu plus tard par buildHealthDays.
  ",300,ccc.source_info.json,MERGED,2026-09-25 00:00:00.000,",
].join("\r\n");

const SLEEP = [
  "﻿com.samsung.shealth.sleep_combined,7006011,8",
  "start_time,time_offset,sleep_duration,end_time,datauuid",
  // Nuit du 22 au 23 (heure d'été) : 21:20Z → 05:39Z = 23:20 → 07:39 à Paris, 460 min dormies.
  "2026-09-22 21:20:00.000,UTC+0200,460,2026-09-23 05:39:00.000,n1,",
  // Sieste le 23 : 12:00Z → 12:40Z.
  "2026-09-23 12:00:00.000,UTC+0200,40,2026-09-23 12:40:00.000,n2,",
  // Doublon qui chevauche la nuit : ignoré (on garde la plus longue).
  "2026-09-22 22:00:00.000,UTC+0200,300,2026-09-23 03:00:00.000,n3,",
  // Nuit d'hiver qui se termine après minuit UTC mais le même jour local : 22:30Z → 06:10Z (+01:00).
  "2026-01-14 22:30:00.000,UTC+0100,440,2026-01-15 06:10:00.000,n4,",
  // Réveil à 00:30 heure locale le 11 = 22:30Z le 10 : compte pour le 11 (jour local du réveil).
  "2026-09-10 16:00:00.000,UTC+0200,390,2026-09-10 22:30:00.000,n5,",
  // Ligne corrompue (1970) : ignorée.
  "1970-01-01 00:00:00.000,UTC+0200,0,1970-01-01 00:00:00.000,bad,",
].join("\n");

describe("export Samsung Health", () => {
  it("lit le CSV (ligne technique sautée, BOM et virgule finale)", () => {
    const rows = parseSamsungCsv(PEDOMETER);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ step_count: "2480", deviceuuid: "MERGED", day_time: "2026-09-23 00:00:00.000" });
  });

  it("pas : ligne fusionnée prioritaire, sinon le maximum ; 0 reste 0", () => {
    const steps = stepsByDate(parseSamsungCsv(PEDOMETER));
    expect(steps.get("2026-09-23")).toBe(2480);
    expect(steps.get("2026-09-22")).toBe(1200);
    expect(steps.get("2026-09-21")).toBe(0);
  });

  it("décalages et heure locale", () => {
    expect(parseOffset("UTC+0200")).toBe(120);
    expect(parseOffset("UTC-0530")).toBe(-330);
    expect(parseOffset("n'importe quoi")).toBeNull();
    expect(toLocalIso(Date.UTC(2026, 8, 22, 21, 20), 120)).toBe("2026-09-22T23:20:00+02:00");
  });

  it("sommeil : jour local du réveil, sieste additionnée, chevauchement compté une fois", () => {
    const sleep = sleepByDate(parseSamsungCsv(SLEEP));
    expect(sleep.get("2026-09-23")).toEqual({
      sleep_minutes: 500,
      sleep_start: "2026-09-22T23:20:00+02:00",
      sleep_end: "2026-09-23T07:39:00+02:00",
    });
    expect(sleep.get("2026-01-15")).toEqual({
      sleep_minutes: 440,
      sleep_start: "2026-01-14T23:30:00+01:00",
      sleep_end: "2026-01-15T07:10:00+01:00",
    });
    expect(sleep.has("2026-09-10")).toBe(false);
    expect(sleep.get("2026-09-11")?.sleep_end).toBe("2026-09-11T00:30:00+02:00");
    expect([...sleep.keys()].some((d) => d.startsWith("1970"))).toBe(false);
  });

  it("journées : aujourd'hui exclu, valeurs absentes omises, conforme au contrat", () => {
    const days = buildHealthDays(
      stepsByDate(parseSamsungCsv(PEDOMETER)),
      sleepByDate(parseSamsungCsv(SLEEP)),
      "2026-09-25",
    );
    expect(days.map((d) => d.date)).toEqual([
      "2026-01-15",
      "2026-09-11",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
    expect(days.find((d) => d.date === "2026-09-22")).toEqual({ date: "2026-09-22", steps: 1200 });
    expect(days.find((d) => d.date === "2026-01-15")).not.toHaveProperty("steps");
    expect(HealthIngestBody.safeParse({ days }).success).toBe(true);
  });
});
