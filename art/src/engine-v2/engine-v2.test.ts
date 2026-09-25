import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { computeChain, percentilesFor, DayIndex, STYLES, type StyleId } from "@sillage/shared";
import { normalizeDay } from "../engine/normalize";
import { composeForDate } from "../engine";
import { sceneToSvg } from "../export/svg";
import type { DayInput } from "../engine/day";
import {
  ALL_TECHNIQUES,
  buildFiche,
  buildTechniqueInput,
  compactFiche,
  paletteFor,
  selectStyles,
  techniqueFor,
  type DayWithStyle,
} from "./index";
import { attractorParams } from "./techniques/attracteur";

const days = rawDays as unknown as DayWithStyle[];
const LAST = days.at(-1)!.date;

describe("sélection côté navigateur", () => {
  it("les centiles de la sélection (shared) sont ceux de la v1", () => {
    const index = new DayIndex(days);
    for (const d of days.slice(0, 60)) {
      const v1 = normalizeDay(d as DayInput, days as DayInput[]);
      const p = percentilesFor(index, d.date);
      expect(p.steps.value).toBe(v1.steps.value);
      expect(p.sleep.value).toBe(v1.sleep_minutes.value);
      expect(p.commits.value).toBe(v1.commits.value);
    }
  });

  it("fixtures : même résultat que la chaîne complète, sur n'importe quelle fenêtre", () => {
    const full = computeChain({ days, to: LAST });
    const sel = selectStyles(days, "2026-08-01", "2026-08-31");
    for (const [date, s] of sel) {
      expect(s.style).toBe(full.entries.find((e) => e.date === date)!.style);
      expect(s.frozen).toBe(false);
    }
  });

  it("utilise le style figé renvoyé par l'API et son explication, et reprend la chaîne derrière", () => {
    const full = computeChain({ days, to: LAST });
    // L'API renvoie une fenêtre de 100 jours, tous figés sauf les 3 derniers.
    const window = days.filter((d) => d.date >= "2026-06-15").map((d) => {
      const e = full.entries.find((x) => x.date === d.date)!;
      return d.date > "2026-09-20" ? d : { ...d, style: e.style, style_explain: { ...e.explain!, frozen_at: "2026-09-24T03:30:00.000Z", engine_version: "v2" } };
    });
    const sel = selectStyles(window, "2026-09-19", LAST);
    const frozenDay = sel.get("2026-09-19")!;
    expect(frozenDay).toMatchObject({ frozen: true, frozenAt: "2026-09-24T03:30:00.000Z" });
    expect(frozenDay.explain?.origin).toBe(days[0]!.date);
    for (const date of ["2026-09-21", "2026-09-22", LAST]) {
      expect(sel.get(date)!.style).toBe(full.entries.find((e) => e.date === date)!.style);
      expect(sel.get(date)!.frozen).toBe(false);
    }
  });
});

describe("entrée des techniques", () => {
  it("déterministe et sérialisable (peut aller dans un Worker)", () => {
    const a = buildTechniqueInput("2026-07-14", days, "attracteur");
    const b = buildTechniqueInput("2026-07-14", days.slice().reverse(), "attracteur");
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.weather).toBeNull(); // pas de météo dans les fixtures → repli
    expect(a.hourlySteps).toBeNull();
  });

  it("ajouter des jours après J ne change pas l'entrée de J", () => {
    const cut = days.filter((d) => d.date <= "2026-07-14");
    expect(buildTechniqueInput("2026-07-14", cut, "maree")).toEqual(buildTechniqueInput("2026-07-14", days, "maree"));
  });

  it("palettes : saison et humeur par les données", () => {
    expect(paletteFor({ date: "2026-07-14", seed: 1, sleep: 0.9, tempMax: null }).id).toBe("ete-lumineux");
    expect(paletteFor({ date: "2026-01-10", seed: 1, sleep: 0.1, tempMax: null }).id).toBe("hiver-nocturne");
    expect(paletteFor({ date: "2026-04-10", seed: 1, sleep: null, tempMax: null }).id).toBe("printemps-brume");
    expect(paletteFor({ date: "2026-10-10", seed: 1, sleep: 0.5, tempMax: null }).id).toBe("automne-doux");
    const hot = paletteFor({ date: "2026-07-14", seed: 1, sleep: 0.5, tempMax: 31 });
    expect(hot.colors).not.toEqual(paletteFor({ date: "2026-07-14", seed: 1, sleep: 0.5, tempMax: null }).colors);
  });

  it("Attracteur : paramètres pilotés par les données, valeur neutre si absent", () => {
    const full = attractorParams(buildTechniqueInput("2026-07-14", days, "attracteur"));
    const noSteps = attractorParams(buildTechniqueInput("2026-07-14", days.map((d) => (d.date === "2026-07-14" ? { ...d, steps: null } : d)), "attracteur"));
    const zero = attractorParams(buildTechniqueInput("2026-07-14", days.map((d) => (d.date === "2026-07-14" ? { ...d, steps: 0 } : d)), "attracteur"));
    expect(noSteps.a).not.toBe(full.a);
    expect(noSteps.a).not.toBe(zero.a); // null ≠ 0
    expect(noSteps.b).toBe(full.b);
  });

  it("Marée v2 = l'œuvre v1 du même jour (SVG identique)", () => {
    const input = buildTechniqueInput("2026-07-14", days, "maree");
    expect(techniqueFor("maree").toSvg!(input)).toBe(sceneToSvg(composeForDate("2026-07-14", days as DayInput[])));
    expect(techniqueFor("attracteur").toSvg).toBeUndefined();
  });

  it("chaque technique explique au moins un paramètre, sans planter sur une journée vide", () => {
    for (const t of ALL_TECHNIQUES) {
      for (const date of ["2026-07-14", "2031-01-01"]) {
        const lines = t.explain(buildTechniqueInput(date, days, t.id));
        expect(lines.length).toBeGreaterThan(0);
        for (const l of lines) expect(l.param && l.source && l.value).toBeTruthy();
      }
    }
    expect(ALL_TECHNIQUES.map((t) => t.id)).toEqual([...STYLES]);
    expect(ALL_TECHNIQUES.filter((t) => t.ported).map((t) => t.id)).toEqual(["maree", "attracteur", "vitrail", "constructif"]);
  });
});

describe("fiche de calcul", () => {
  const date = "2026-07-14";
  const sel = selectStyles(days, date, date).get(date)!;
  const input = buildTechniqueInput(date, days, sel.style);
  const fiche = buildFiche(sel, techniqueFor(sel.style), input);
  const e = sel.explain!;

  it("valeurs brutes, formule substituée, K et u", () => {
    expect(fiche.raw.map((r) => r.label)).toEqual(["Pas", "Sommeil", "Réveil", "Commits"]);
    const d = days.find((x) => x.date === date)!;
    expect(fiche.raw[0]!.value.replace(/\s/g, "")).toBe(String(d.steps));
    expect(fiche.raw[2]!.value).toBe(d.sleep_end!.slice(11, 16));
    expect(fiche.key!.formula).toBe("K = pas × 1000 + minuteDuRéveil × 10 + commits");
    const k = d.steps! * 1000 + e.inputs.wake_minute! * 10 + d.commits!;
    expect(e.key.K).toBe(k);
    expect(fiche.key!.substituted.replace(/\s/g, "")).toBe(`K=${d.steps}×1000+${e.inputs.wake_minute}×10+${d.commits}=${k}`);
    expect(fiche.key!.uFormula).toContain("0,6180339887498949");
  });

  it("tranche, table des poids, ajustements, exclusions, chances et tirage", () => {
    expect(fiche.band!.table).toHaveLength(10);
    expect(fiche.chances).toHaveLength(10);
    const chances = fiche.chances.filter((c) => !c.excluded).reduce((s, c) => s + c.chance, 0);
    expect(chances).toBeCloseTo(1, 10);
    expect(fiche.chances.filter((c) => c.chosen).map((c) => c.style)).toEqual([sel.style]);
    expect(fiche.exclusions.length).toBe(e.exclusions.length);
    for (const x of fiche.exclusions) expect(x.reason).toMatch(/style d'hier|style d'avant-hier|même famille qu'hier/);
    expect(fiche.adjustments.length).toBe(e.adjustments.length);
    expect(fiche.draw!.formula).toMatch(/^point = u × total des poids = /);
    expect(fiche.draw!.result).toContain(techniqueFor(sel.style).name);
    expect(fiche.status).toMatch(/pas encore figé/);
    expect(fiche.technique.length).toBeGreaterThan(0);
  });

  it("mention « figé le … » et résumé compact", () => {
    const frozen = { ...sel, frozen: true, frozenAt: "2026-07-17T03:30:00.000Z" };
    expect(buildFiche(frozen, techniqueFor(sel.style), input).status).toBe("Figé le 17 juillet 2026 : cette œuvre ne changera plus.");
    const compact = compactFiche(frozen, techniqueFor(sel.style));
    expect(compact).toContain("K = ");
    expect(compact).toContain("figé le 17 juillet 2026");
  });

  it("jour sans aucune donnée : K = numéro du jour", () => {
    const empty = days.map((d) => (d.date === "2026-07-01" ? { ...d, steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null } : d));
    const s = selectStyles(empty, "2026-07-01", "2026-07-01").get("2026-07-01")!;
    const f = buildFiche(s, techniqueFor(s.style), buildTechniqueInput("2026-07-01", empty, s.style));
    expect(f.key!.formula).toMatch(/numéro du jour/);
    expect(f.raw.every((r) => r.value === "non mesuré")).toBe(true);
  });

  it("chaque combinaison de null donne une fiche complète", () => {
    const combos: Partial<DayWithStyle>[] = [{ steps: null }, { sleep_minutes: null, sleep_end: null }, { commits: null }, { steps: 0 }];
    const seen = new Set<StyleId>();
    for (const over of combos) {
      const alt = days.map((d) => (d.date === date ? { ...d, ...over } : d));
      const s = selectStyles(alt, date, date).get(date)!;
      seen.add(s.style);
      const f = buildFiche(s, techniqueFor(s.style), buildTechniqueInput(date, alt, s.style));
      expect(f.chances).toHaveLength(10);
      if (over.steps === null) expect(f.band!.centile).toMatch(/non mesurés/);
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("Attracteur : jamais de forme effondrée", () => {
  it("sur toutes les journées des fixtures, la couverture dépasse 3 %", async () => {
    const { coverage } = await import("./techniques/attracteur");
    for (const d of days) {
      const p = attractorParams(buildTechniqueInput(d.date, days, "attracteur"));
      expect(coverage(p.a, p.b, p.c, p.d)).toBeGreaterThanOrEqual(0.03);
    }
  });
});
