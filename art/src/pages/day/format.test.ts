import { describe, expect, it } from "vitest";
import { emptyDay } from "../../engine/day";
import { normalizeDay } from "../../engine/normalize";
import { clockOf, formatLongDate, formatSleep, formatSteps, legendRows } from "./format";

describe("légende", () => {
  it("formate les valeurs brutes", () => {
    expect(formatLongDate("2026-09-23")).toBe("mercredi 23 septembre 2026");
    expect(formatLongDate("2026-06-01")).toBe("lundi 1er juin 2026");
    expect(formatSleep(346)).toBe("5 h 46");
    expect(formatSteps(0)).toBe("0");
    expect(formatSteps(null)).toBeNull();
    expect(clockOf("2026-09-23T06:40:00+02:00")).toBe("06:40");
  });

  it("distingue non mesuré (null) de zéro", () => {
    const day = { ...emptyDay("2026-09-23"), steps: 0 };
    const rows = legendRows(day, normalizeDay(day, []));
    expect(rows.find((r) => r.label === "Pas")?.value).toBe("0");
    expect(rows.find((r) => r.label === "Commits")?.value).toBeNull();
  });
});
