import { describe, expect, it } from "vitest";
import {
  datesOfMonth,
  datesOfYear,
  daysInMonth,
  isLeapYear,
  mondayIndex,
  monthGrid,
  parseMonthKey,
  shiftMonth,
} from "./calendar";
import { hasData, inputFingerprints } from "./inputs";
import { emptyDay } from "../../engine";

describe("calendrier (lundi en premier)", () => {
  it("jour de la semaine : lundi = 0, dimanche = 6", () => {
    expect(mondayIndex("2026-09-21")).toBe(0); // lundi
    expect(mondayIndex("2026-09-27")).toBe(6); // dimanche
    expect(mondayIndex("2024-02-29")).toBe(3); // jeudi
  });

  it("mois commençant un dimanche : six cases vides avant le 1er", () => {
    // 1er mars 2026 : dimanche.
    const g = monthGrid(2026, 3);
    expect(g.weeks[0]).toEqual([null, null, null, null, null, null, "2026-03-01"]);
    expect(g.weeks[1]![0]).toBe("2026-03-02"); // lundi 2
    expect(g.weeks).toHaveLength(6); // 6 + 31 = 37 cases → 6 semaines
    expect(g.weeks.at(-1)).toEqual(["2026-03-30", "2026-03-31", null, null, null, null, null]);
    // Juin 2025 aussi : 1er = dimanche, 30 jours.
    expect(monthGrid(2025, 6).weeks[0]!.at(-1)).toBe("2025-06-01");
  });

  it("mois commençant un lundi : aucune case vide devant", () => {
    const g = monthGrid(2026, 6); // 1er juin 2026 : lundi
    expect(g.weeks[0]![0]).toBe("2026-06-01");
    expect(g.weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("février tient en 4 semaines exactes quand il commence un lundi (2021)", () => {
    const g = monthGrid(2021, 2);
    expect(g.weeks).toHaveLength(4);
    expect(g.weeks.flat().every(Boolean)).toBe(true);
  });

  it("années bissextiles", () => {
    expect([2019, 2020, 2024, 2026, 1900, 2000, 2100].map(isLeapYear)).toEqual([false, true, true, false, false, true, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(datesOfYear(2024)).toHaveLength(366);
    expect(datesOfYear(2026)).toHaveLength(365);
    expect(datesOfYear(2024)).toContain("2024-02-29");
    expect(datesOfMonth(2024, 2).at(-1)).toBe("2024-02-29");
    // 29 février 2024 (jeudi) : 4e colonne.
    const feb = monthGrid(2024, 2);
    const week = feb.weeks.find((w) => w.includes("2024-02-29"))!;
    expect(week.indexOf("2024-02-29")).toBe(3);
  });

  it("chaque jour de l'année est placé une fois, dans la bonne colonne", () => {
    for (const year of [2019, 2020, 2024, 2026]) {
      const all: string[] = [];
      for (let m = 1; m <= 12; m++) {
        for (const week of monthGrid(year, m).weeks) {
          expect(week).toHaveLength(7);
          week.forEach((d, col) => {
            if (d) {
              expect(mondayIndex(d)).toBe(col);
              all.push(d);
            }
          });
        }
      }
      expect(all).toEqual(datesOfYear(year));
    }
  });

  it("navigation entre mois et clés d'URL", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 7, -19)).toEqual({ year: 2024, month: 12 });
    expect(parseMonthKey("2026-07")).toEqual({ year: 2026, month: 7 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-7")).toBeNull();
    expect(parseMonthKey(null)).toBeNull();
  });
});

describe("données d'une case", () => {
  const day = (date: string, steps: number | null) => ({ ...emptyDay(date), steps });

  it("0 est une donnée, null non", () => {
    expect(hasData(undefined)).toBe(false);
    expect(hasData(emptyDay("2026-07-01"))).toBe(false);
    expect(hasData(day("2026-07-01", 0))).toBe(true);
  });

  it("l'empreinte ne change que si J ou ses 90 jours de référence changent", () => {
    const history = [day("2026-03-01", 100), day("2026-05-01", 200), day("2026-07-01", 300)];
    const a = inputFingerprints(["2026-07-01", "2026-07-02"], history);
    // 2026-03-01 est à plus de 90 jours : le modifier ne change rien.
    const b = inputFingerprints(["2026-07-01", "2026-07-02"], [day("2026-03-01", 999), ...history.slice(1)]);
    expect(b).toEqual(a);
    // 2026-05-01 est dans la fenêtre : l'empreinte change. Un 0 n'est pas un null.
    const c = inputFingerprints(["2026-07-01"], [history[0]!, day("2026-05-01", 0), history[2]!]);
    expect(c.get("2026-07-01")).not.toBe(a.get("2026-07-01"));
    const n = inputFingerprints(["2026-07-01"], [history[0]!, day("2026-05-01", null), history[2]!]);
    expect(n.get("2026-07-01")).not.toBe(c.get("2026-07-01"));
    // Dates différentes, empreintes différentes.
    expect(a.get("2026-07-01")).not.toBe(a.get("2026-07-02"));
  });
});
