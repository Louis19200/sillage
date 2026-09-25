/**
 * Vitrail (porté depuis `art/sketches/techniques/vitrail.ts`) : diagramme de Voronoï.
 *
 * - Chaque heure de la journée sème des cellules le long d'une spirale qui part du centre à
 *   minuit, fait un tour complet et revient en haut, au bord, au minuit suivant : les heures
 *   actives (pas horaires, ou le total du jour réparti selon `FALLBACKS.hourlyShape`) donnent
 *   des grappes de petits verres, les heures calmes de grands verres.
 * - Nombre de cellules ← pas (centile) ; une cellule vive en plus par commit.
 * - Couleur ← heure (nuit froide, après-midi chaude) × température (repli 16 °C) ; palette v2.
 * - Lumière ← phase de lune (`moonPhase` de @sillage/shared) : intensité ← fraction éclairée,
 *   côté d'où vient la lumière ← lune croissante (droite) ou décroissante (gauche).
 * - Assombrissement des bords ← couverture nuageuse (repli 0,5).
 *
 * Vectoriel : les cellules sont de vrais polygones (`voronoi.ts`), le plomb un seul chemin
 * d'arêtes ; même plan pour le canvas et le SVG (`vector.ts`).
 *
 * Données absentes : pas → répartition horaire type, 96 cellules (neutre), verres désaturés ;
 * commits → aucune cellule de commit ; toujours la marque en pointillés (`drawMissingMark`).
 */
import { moonPhase as moonOf } from "@sillage/shared";
import { centile, desaturate, fmt, fmtInt, hex, mix, ramp, rngFor, toHex } from "../helpers";
import { FALLBACKS, hourlyOrFallback, weatherOrFallback } from "../input";
import type { ExplainLine, Technique, TechniqueInput } from "../types";
import { drawPlan, missingMarkShapes, planToSvg, polygonPath, type VShape, type VectorPlan } from "./vector";
import { interiorEdges, voronoiCells, type VoronoiCell } from "./voronoi";

const L = 1000;
const C = L / 2;
const LEAD = "#17140f";
const LIGHT = "#fffaeb";
const SHADE = "#0a0a0e";
/** Cellules d'activité : 36 à 156 selon les pas (centile). */
const ACTIVITY_CELLS = { min: 36, span: 120 };
const COMMIT_CELLS_MAX = 60;
const FRAME_CELLS = 14;
/** Spirale de minuit à minuit (repère 1000) : rayon au départ et gain sur 24 h. */
const SPIRAL = { r0: 60, gain: 360 };
const GLOW_RADIUS = 90;
const LEAD_WIDTH = 6.5;
/** Distance minimale entre deux verres d'heure (repère 1000) : pas de verre plus petit que le plomb. */
const MIN_GAP = 26;

export interface VitrailSite {
  x: number;
  y: number;
  /** Heure (continue, 0–24) ; −1 pour une cellule de commit. */
  hour: number;
  kind: "heure" | "commit" | "cadre";
}

export function vitrailParams(input: TechniqueInput) {
  const w = weatherOrFallback(input.weather);
  const hourlyMeasured = !!input.hourlySteps && input.hourlySteps.length === 24;
  const stepsMissing = input.day.steps === null;
  const hourly: number[] = hourlyMeasured
    ? [...input.hourlySteps!]
    : stepsMissing
      ? [...FALLBACKS.hourlyShape]
      : hourlyOrFallback(input);
  const total = hourly.reduce((a, b) => a + b, 0);
  const energy = input.norms.steps ?? 0.5;
  const activityCells = Math.round(ACTIVITY_CELLS.min + ACTIVITY_CELLS.span * energy);
  // Chaque heure a au moins un verre (la journée entière est dans le vitrail) ; les autres
  // sont répartis selon la part de pas de l'heure.
  const perHour = hourly.map((v) => 1 + (total > 0 ? Math.round((v / total) * activityCells) : 0));
  const peakHour = total > 0 ? hourly.indexOf(Math.max(...hourly)) : null;
  const commitCells = input.day.commits === null ? 0 : Math.min(COMMIT_CELLS_MAX, input.day.commits);
  const warmth = Math.max(0, Math.min(1, (w.tempMax.value - 10) / 25));
  const moon = moonOf(input.date);
  const glow = 0.3 + 0.55 * moon.illumination;
  const vignette = 0.6 + 0.5 * w.cloud.value;
  return { hourly, hourlyMeasured, stepsMissing, perHour, peakHour, commitCells, warmth, moon, glow, vignette, w };
}

export type VitrailParams = ReturnType<typeof vitrailParams>;

export function vitrailSites(input: TechniqueInput, p: VitrailParams = vitrailParams(input)): VitrailSite[] {
  const rng = rngFor(input, "vitrail");
  const sites: VitrailSite[] = [];
  const tooClose = (x: number, y: number) => sites.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < MIN_GAP * MIN_GAP);
  p.perHour.forEach((k, h) => {
    // Une heure chargée s'étale davantage autour de la spirale (verres petits, jamais minuscules).
    const spread = 26 + 7 * Math.sqrt(k);
    for (let j = 0; j < k; j++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const hour = h + (j + 0.5 + rng.range(-0.45, 0.45)) / k;
        const t = hour / 24;
        const ang = -Math.PI / 2 + t * Math.PI * 2 + rng.range(-0.12, 0.12);
        const rad = Math.max(8, SPIRAL.r0 + SPIRAL.gain * t + rng.gauss() * spread);
        const x = C + Math.cos(ang) * rad, y = C + Math.sin(ang) * rad;
        if (tooClose(x, y)) continue; // nouvel essai (tirages en ordre fixe : déterministe)
        sites.push({ x, y, hour, kind: "heure" });
        break;
      }
    }
  });
  // Couronne du cadre : de grands verres dans les coins, colorés selon l'heure de leur angle.
  const fr = rng.fork("cadre");
  for (let i = 0; i < FRAME_CELLS; i++) {
    const ang = -Math.PI / 2 + ((i + fr.range(0.2, 0.8)) / FRAME_CELLS) * Math.PI * 2;
    const rad = fr.range(470, 560);
    const x = Math.max(4, Math.min(L - 4, C + Math.cos(ang) * rad));
    const y = Math.max(4, Math.min(L - 4, C + Math.sin(ang) * rad));
    sites.push({ x, y, hour: (((ang + Math.PI / 2) / (Math.PI * 2)) * 24 + 24) % 24, kind: "cadre" });
  }
  const cr = rng.fork("commits");
  for (let c = 0; c < p.commitCells; c++) sites.push({ x: cr.range(30, L - 30), y: cr.range(30, L - 30), hour: -1, kind: "commit" });
  return sites;
}

export interface VitrailPlan {
  plan: VectorPlan;
  params: VitrailParams;
  sites: VitrailSite[];
  cells: VoronoiCell[];
}

export function vitrailPlan(input: TechniqueInput): VitrailPlan {
  const params = vitrailParams(input);
  const sites = vitrailSites(input, params);
  const cells = voronoiCells(
    sites.map((s) => [s.x, s.y] as const),
    L,
    L,
  );
  const { palette } = input;
  // Chaud l'après-midi, froid la nuit ; plus chaud par temps chaud.
  const byHour = ramp([palette.night, palette.colors[0], palette.colors[3], palette.colors[2], palette.colors[1], palette.colors[4]]);
  const accent = hex(palette.colors[2]);
  const colorOf = (s: VitrailSite, i: number): string => {
    let c: string;
    if (s.kind === "commit") c = toHex(mix(accent, [255, 255, 255], (i % 3) * 0.06));
    else {
      const t = 0.5 - 0.5 * Math.cos((s.hour / 24) * Math.PI * 2);
      c = toHex(mix(byHour(t * (0.6 + 0.4 * params.warmth)), [255, 255, 255], (i % 5) * 0.03));
    }
    return params.stepsMissing ? desaturate(c, 0.55) : c;
  };
  const lightDx = params.moon.waxing ? 18 : -18;
  const shapes: VShape[] = [];
  for (const cell of cells) {
    const s = sites[cell.site]!;
    const d = polygonPath(cell.poly);
    shapes.push({ d, fill: colorOf(s, cell.site) });
    shapes.push({
      d,
      fill: { kind: "radial", cx: s.x + lightDx, cy: s.y - 12, r: GLOW_RADIUS, stops: [[0, LIGHT, params.glow * 0.45], [1, LIGHT, 0]] },
    });
  }
  // Assombrissement des bords (comme le verre loin de la lumière).
  shapes.push({
    d: polygonPath([[0, 0], [L, 0], [L, L], [0, L]]),
    fill: { kind: "radial", cx: C, cy: C, r: 750, stops: [[0, SHADE, 0], [0.35, SHADE, 0], [1, SHADE, 0.65 * params.vignette]] },
  });
  // Plomb : toutes les arêtes intérieures en un seul chemin.
  const edges = interiorEdges(cells, L, L);
  shapes.push({
    d: edges.flatMap(([a, b]) => [{ t: "M" as const, x: a[0], y: a[1] }, { t: "L" as const, x: b[0], y: b[1] }]),
    stroke: LEAD,
    lineWidth: LEAD_WIDTH,
    cap: "round",
    join: "round",
  });
  return { plan: { background: LEAD, shapes, grain: 22, grainSeed: input.seed % 2147483647 }, params, sites, cells };
}

const markColor = (input: TechniqueInput) => input.palette.colors[4];

export const vitrail: Technique = {
  id: "vitrail",
  family: "geometrique",
  name: "Vitrail",
  process: "géométrie (Voronoï)",
  ported: true,
  heavy: false,
  maxExportSize: 8000,
  toSvg(input) {
    const { plan } = vitrailPlan(input);
    return planToSvg(plan, missingMarkShapes(input, markColor(input)), { title: `Sillage · Vitrail · ${input.date}`, idPrefix: `vitrail-${input.date}` });
  },
  render(ctx, S, input, options = {}) {
    const { plan } = vitrailPlan(input);
    drawPlan(ctx, S, plan, input, markColor(input), options.quality === "preview" ? null : rngFor(input, "vitrail").fork("grain"));
  },
  explain(input) {
    const { params: p, sites, cells } = vitrailPlan(input);
    const n = input.norms;
    const count = (k: VitrailSite["kind"]) => cells.filter((c) => sites[c.site]!.kind === k).length;
    const hourCells = count("heure");
    const neutral = n.steps === null ? " → valeur neutre 0,5" : "";
    const lines: ExplainLine[] = [
      { param: "Verres de la journée (cellules sur la spirale)", source: `Pas (${centile(n.steps)}${neutral})`, value: `${fmtInt(hourCells)} cellules` },
      {
        param: "Répartition des verres par heure",
        source: p.hourlyMeasured ? "Pas heure par heure (mesurés)" : p.stepsMissing ? "Pas non mesurés → profil horaire type" : "Pas horaires absents → total du jour réparti selon le profil type",
        value: p.peakHour === null ? "un verre par heure (aucun pas)" : `pic à ${p.peakHour} h (${p.perHour[p.peakHour]} verres) · minuit au centre, minuit suivant au bord`,
      },
      {
        param: "Verres vifs semés au hasard",
        source: input.day.commits === null ? "Commits non mesurés" : `Commits (${input.day.commits}, ${centile(n.commits)})`,
        value: input.day.commits === null ? "aucun (pointillés)" : `${fmtInt(p.commitCells)}${input.day.commits > COMMIT_CELLS_MAX ? ` (plafond ${COMMIT_CELLS_MAX})` : ""}`,
      },
      {
        param: "Teinte des verres (froid la nuit, chaud l'après-midi)",
        source: p.w.tempMax.measured ? "Température maximale (mesurée)" : "Température : pas de météo → repli 16 °C",
        value: `${fmt(p.w.tempMax.value, 1)} °C → chaleur ${fmt(p.warmth, 2)}`,
      },
      {
        param: "Lumière à travers le verre",
        source: `Phase de lune (${fmt(p.moon.phase, 2)}, ${p.moon.waxing ? "croissante" : "décroissante"})`,
        value: `éclairée à ${Math.round(p.moon.illumination * 100)} % → intensité ${fmt(p.glow, 2)}, venue de ${p.moon.waxing ? "la droite" : "la gauche"}`,
      },
      {
        param: "Assombrissement des bords",
        source: p.w.cloud.measured ? "Couverture nuageuse (mesurée)" : "Nuages : pas de météo → repli 50 %",
        value: `${Math.round(p.w.cloud.value * 100)} % → ${fmt(p.vignette, 2)}`,
      },
      { param: "Palette des verres", source: `Saison et sommeil (${centile(n.sleep)})`, value: `« ${input.palette.name} »` },
      { param: "Cellules au total", source: "Heures + couronne du cadre + commits (Voronoï exact)", value: `${fmtInt(cells.length)} polygones` },
    ];
    if (p.stepsMissing) lines.push({ param: "Verres désaturés", source: "Pas non mesurés (jamais confondus avec 0)", value: "désaturation 55 %" });
    return lines;
  },
};
