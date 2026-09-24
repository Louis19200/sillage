import { formatClock, formatDayLabel, formatSleepMinutes, formatSteps, MISSING } from "../format";

describe("format", () => {
  it("null s'affiche « — », 0 s'affiche 0", () => {
    expect(formatSteps(null)).toBe(MISSING);
    expect(formatSteps(0)).toBe("0");
    expect(formatSleepMinutes(null)).toBe(MISSING);
    expect(formatSleepMinutes(0)).toBe("0 h 00");
    expect(formatClock(null)).toBe(MISSING);
  });

  it("met en forme pas, durées et heures", () => {
    expect(formatSteps(8421)).toBe("8 421");
    expect(formatSteps(12345678)).toBe("12 345 678");
    expect(formatSleepMinutes(412)).toBe("6 h 52");
    expect(formatClock("2026-09-22T23:48:00+02:00")).toBe("23:48");
  });

  it("libellé du jour calculé sans fuseau", () => {
    expect(formatDayLabel("2026-09-23")).toBe("mer. 23/09");
    expect(formatDayLabel("2026-03-29")).toBe("dim. 29/03");
  });
});
