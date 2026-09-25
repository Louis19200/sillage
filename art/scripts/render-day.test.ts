import { describe, expect, it } from "vitest";
import { createFixturesSource } from "../src/data";
import { readPngDpi } from "../src/export/png-dpi";
import { sceneToSvg } from "../src/export/svg";
import { localYesterday, renderDay } from "./render-day";

describe("rendu Node de la veille", () => {
  it("écrit le même SVG que la page, et un PNG de la taille demandée à 300 dpi", async () => {
    const day = await renderDay(createFixturesSource(), "2026-06-06", 256);
    expect(day.hasData).toBe(true);
    expect(day.svg).toBe(sceneToSvg(day.scene));
    const view = new DataView(day.png.buffer, day.png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([256, 256]);
    expect(readPngDpi(day.png)).toBe(300);
  });

  it("signale une journée absente de la base", async () => {
    const day = await renderDay(createFixturesSource(), "2030-01-01", 32);
    expect(day.hasData).toBe(false);
    expect(day.scene.meta.missing).toEqual(["steps", "sleep", "commits"]);
  });

  it("la veille est calculée en heure locale, à cheval sur un mois et une année", () => {
    expect(localYesterday(new Date(2026, 0, 1, 0, 30))).toBe("2025-12-31");
    expect(localYesterday(new Date(2024, 2, 1, 23, 59))).toBe("2024-02-29");
  });
});
