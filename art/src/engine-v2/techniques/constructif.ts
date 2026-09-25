/**
 * Constructif (porté depuis `art/sketches/techniques/constructif.ts`) : composition
 * constructiviste en aplats sur une grille, imprimée « en risographie » (une couche d'encre
 * décalée et transparente sous la couche principale, grain de papier).
 *
 * - Grille 4 × 4, 5 × 5 ou 6 × 6, disposition des modules (dispersée, en diagonale, en grappe,
 *   en damier, en bandes), vocabulaire de 4 ou 5 formes parmi 8, grand module 2 × 2 éventuel :
 *   graine de la date → la composition change vraiment d'un jour à l'autre.
 * - Nombre de modules posés ← pas (centile) ; disque maître ← sommeil, posé **sous** les modules
 *   et borné (≤ 13 % de la surface utile) pour ne pas écraser la composition.
 * - Recouvrements (modules agrandis qui mordent sur leurs voisins, encre en multiplication)
 *   ← couverture nuageuse (repli 0,5) ; teinte dominante ← température (repli 16 °C) ;
 *   grande diagonale ← direction du vent (repli 250°), épaisseur ← vitesse (repli 12 km/h).
 * - Petits carrés ← commits (un par commit, 80 au plus).
 *
 * Vectoriel : chaque forme est un chemin (arcs compris) ; même plan pour le canvas et le SVG.
 * Données absentes : pas → 50 % de modules, désaturés ; sommeil → disque en pointillés ;
 * commits → aucun carré ; toujours la marque en pointillés.
 */
import { centile, desaturate, fmt, fmtInt, mixHex, rngFor } from "../helpers";
import type { Rng } from "../../engine/random";
import { weatherOrFallback } from "../input";
import type { ExplainLine, Technique, TechniqueInput } from "../types";
import { circlePath, drawPlan, missingMarkShapes, planToSvg, rectPath, translatePath, type PathCmd, type VShape, type VectorPlan } from "./vector";

const L = 1000;
const M = 80;
const INNER = L - 2 * M;
const GRIDS = [4, 5, 6] as const;
const KINDS = ["disque", "demi-disque", "quart", "demi-plan", "triangle", "anneau", "barres", "carré"] as const;
type Kind = (typeof KINDS)[number];
const LAYOUTS = ["dispersée", "diagonale", "grappe", "damier", "bandes"] as const;
type Layout = (typeof LAYOUTS)[number];
/** Part des cases occupées : 22 % (aucun pas) à 67 % (journée record). */
const FILL = { min: 0.22, span: 0.45 };
/** Rayon du disque maître en part de la surface utile : 10 % à 20 % du côté selon le sommeil. */
const DISK = { min: 0.1, span: 0.1 };
const COMMITS_MAX = 80;
const RISO = { dx: 4, dy: 3, alpha: 0.25 };

export interface Module {
  gx: number;
  gy: number;
  /** Côté en cases (1, ou 2 pour le grand module). */
  span: number;
  kind: Kind;
  /** Quart de tour (0–3). */
  quarter: number;
  color: string;
  /** > 1 : module agrandi qui recouvre ses voisins. */
  scale: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Tirage pondéré sans remise (clés exponentielles), déterministe. */
function weightedSample<T>(rng: Rng, items: readonly T[], weight: (t: T) => number, count: number): T[] {
  return items
    .map((it, i) => ({ it, i, key: -Math.log(1 - rng.next()) / Math.max(1e-9, weight(it)) }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .slice(0, count)
    .map((x) => x.it);
}

export function constructifParams(input: TechniqueInput) {
  const rng = rngFor(input, "constructif");
  const w = weatherOrFallback(input.weather);
  const G = rng.pick(GRIDS);
  const layout: Layout = rng.pick(LAYOUTS);
  const vocabSize = rng.int(4, 5);
  const vocab = weightedSample(rng, KINDS, () => 1, vocabSize);
  const bigModule = G >= 5 && rng.next() < 0.55;
  const energy = input.norms.steps ?? 0.5;
  const filled = Math.round(G * G * (FILL.min + FILL.span * energy));
  const cloud = w.cloud.value;
  const overlapChance = 0.06 + 0.5 * cloud;
  const warmth = clamp01((w.tempMax.value - 4) / 26);
  // Cap du vent (0 = nord, 90 = est) → axe à l'écran (y vers le bas) ; la ligne est décalée
  // perpendiculairement selon la graine, pour ne pas passer au même endroit tous les jours.
  const bearing = (w.windDirDeg.value * Math.PI) / 180;
  const axis = { x: Math.sin(bearing), y: -Math.cos(bearing) };
  const lineOffset = rng.range(-0.16, 0.16) * INNER;
  const lineWidth = 8 + 0.3 * Math.min(60, w.windKmh.value);
  const diskR = INNER * (DISK.min + DISK.span * (input.norms.sleep ?? 0.5));
  const commits = input.day.commits === null ? 0 : Math.min(COMMITS_MAX, input.day.commits);
  return { G, layout, vocab, bigModule, filled, energy, overlapChance, warmth, axis, lineOffset, lineWidth, diskR, commits, w, rng };
}

/** Couleurs tirées avec une préférence pour la teinte du jour (froide → chaude selon la température). */
function colorPicker(input: TechniqueInput, warmth: number) {
  const { palette } = input;
  const items = [...palette.colors.map((c, i) => ({ c, pos: i / 4 })), { c: palette.ink, pos: -1 }];
  const weightOf = (x: { pos: number }) => (x.pos < 0 ? 1 : 0.35 + 1.6 * (1 - Math.abs(x.pos - warmth)) ** 2);
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  return (rng: Rng) => {
    let u = rng.next() * total;
    for (const x of items) {
      u -= weightOf(x);
      if (u <= 0) return x.c;
    }
    return items.at(-1)!.c;
  };
}

/** Chemin d'une forme dans une case carrée (coin x, y ; côté w ; quart de tour q). */
export function modulePath(kind: Kind, x: number, y: number, w: number, q: number): PathCmd[] {
  const cx = x + w / 2, cy = y + w / 2, h = w / 2;
  // Rotation exacte d'un quart de tour : (u, v) → (−v, u).
  const T = (u: number, v: number): [number, number] => {
    let a = u, b = v;
    for (let i = 0; i < q; i++) [a, b] = [-b, a];
    return [cx + a, cy + b];
  };
  const P = (u: number, v: number, t: "M" | "L" = "L"): PathCmd => {
    const [px, py] = T(u, v);
    return { t, x: px, y: py };
  };
  const rot = (q * Math.PI) / 2;
  const A = (u: number, v: number, r: number, a0: number, a1: number, ccw = false): PathCmd => {
    const [px, py] = T(u, v);
    return { t: "A", cx: px, cy: py, r, a0: a0 + rot, a1: a1 + rot, ccw };
  };
  switch (kind) {
    case "disque":
      return circlePath(cx, cy, h);
    case "demi-disque":
      return [A(0, h, h, Math.PI, 2 * Math.PI), { t: "Z" }];
    case "quart":
      return [P(-h, -h, "M"), A(-h, -h, w, 0, Math.PI / 2), { t: "Z" }];
    case "demi-plan":
      return [P(-h, -h, "M"), P(h, -h), P(h, 0), P(-h, 0), { t: "Z" }];
    case "triangle":
      return [P(-h, h, "M"), P(h, h), P(-h, -h), { t: "Z" }];
    case "anneau":
      return [
        { t: "A", cx, cy, r: h, a0: 0, a1: Math.PI * 2 },
        { t: "Z" },
        { t: "M", x: cx + h * 0.52, y: cy },
        { t: "A", cx, cy, r: h * 0.52, a0: 0, a1: -Math.PI * 2, ccw: true },
        { t: "Z" },
      ];
    case "barres": {
      const out: PathCmd[] = [];
      for (let i = 0; i < 3; i++) {
        const v0 = -h + (i * 2 + 0.5) * (w / 6.5);
        out.push(P(-h, v0, "M"), P(h, v0), P(h, v0 + w / 6.5), P(-h, v0 + w / 6.5), { t: "Z" });
      }
      return out;
    }
    case "carré":
      return rectPath(x, y, w, w);
  }
}

export interface ConstructifPlan {
  plan: VectorPlan;
  params: ReturnType<typeof constructifParams>;
  modules: Module[];
  disk: { cx: number; cy: number; r: number; measured: boolean };
  diagonal: { x1: number; y1: number; x2: number; y2: number };
  squares: { x: number; y: number; s: number; color: string }[];
}

export function constructifPlan(input: TechniqueInput): ConstructifPlan {
  const params = constructifParams(input);
  const { G, layout, vocab, rng, palette } = { ...params, palette: input.palette };
  const cell = INNER / G;
  const pickColor = colorPicker(input, params.warmth);
  const r2 = rng.fork("plan");

  // Grand module 2 × 2 (réserve ses quatre cases).
  const modules: Module[] = [];
  const taken = new Set<number>();
  if (params.bigModule) {
    const gx = r2.int(0, G - 2), gy = r2.int(0, G - 2);
    const bigVocab = vocab.filter((k) => k !== "barres");
    modules.push({ gx, gy, span: 2, kind: r2.pick(bigVocab.length ? bigVocab : ["disque" as Kind]), quarter: r2.int(0, 3), color: pickColor(r2), scale: 1 });
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) taken.add((gy + dy) * G + gx + dx);
  }

  // Point de passage de la grande diagonale (relatif au centre).
  const linePoint = { x: -params.axis.y * params.lineOffset, y: params.axis.x * params.lineOffset };
  // Poids des cases selon la disposition du jour.
  const u = (g: number) => (g + 0.5) / G - 0.5;
  const focal = { x: r2.range(-0.3, 0.3), y: r2.range(-0.3, 0.3) };
  const bandVertical = r2.next() < 0.5;
  const bands = weightedSample(r2, Array.from({ length: G }, (_, i) => i), () => 1, 2);
  const weight = (c: number): number => {
    const gx = c % G, gy = Math.floor(c / G);
    switch (layout) {
      case "dispersée":
        return 1;
      case "diagonale": {
        const d = Math.abs(-params.axis.y * (u(gx) - linePoint.x / INNER) + params.axis.x * (u(gy) - linePoint.y / INNER));
        return Math.exp(-(d * d) / (2 * 0.18 * 0.18)) + 0.08;
      }
      case "grappe":
        return Math.exp(-((u(gx) - focal.x) ** 2 + (u(gy) - focal.y) ** 2) / (2 * 0.25 * 0.25)) + 0.06;
      case "damier":
        return (gx + gy) % 2 === 0 ? 1 : 0.1;
      case "bandes":
        return bands.includes(bandVertical ? gx : gy) ? 1 : 0.12;
    }
  };
  const free = Array.from({ length: G * G }, (_, i) => i).filter((c) => !taken.has(c));
  const chosen = weightedSample(r2, free, weight, Math.min(free.length, params.filled));
  for (const c of chosen) {
    const overlap = r2.next() < params.overlapChance;
    modules.push({
      gx: c % G,
      gy: Math.floor(c / G),
      span: 1,
      kind: r2.pick(vocab),
      quarter: r2.int(0, 3),
      color: pickColor(r2),
      scale: overlap ? r2.range(1.25, 1.7) : 1,
    });
  }

  // Disque maître : sur une intersection intérieure de la grille, hors du centre exact.
  const ix = r2.int(1, G - 1), iy = r2.int(1, G - 1);
  const disk = { cx: M + ix * cell, cy: M + iy * cell, r: params.diskR, measured: input.norms.sleep !== null };

  const reach = L * 0.9;
  const px = L / 2 + linePoint.x, py = L / 2 + linePoint.y;
  const diagonal = {
    x1: px - params.axis.x * reach,
    y1: py - params.axis.y * reach,
    x2: px + params.axis.x * reach,
    y2: py + params.axis.y * reach,
  };

  const squares: ConstructifPlan["squares"] = [];
  const sq = r2.fork("commits");
  const s = 22;
  for (let i = 0; i < params.commits; i++) {
    squares.push({ x: M + sq.range(0, INNER - s), y: M + sq.range(0, INNER - s), s, color: i % 3 === 0 ? palette.colors[4] : palette.ink });
  }

  // Couche d'encre principale.
  const tint = (c: string) => (input.norms.steps === null ? desaturate(c, 0.45) : c);
  const main: VShape[] = [];
  if (disk.measured) {
    main.push({ d: circlePath(disk.cx, disk.cy, disk.r), fill: mixHex(palette.colors[1], palette.paper, 0.2) });
    main.push({ d: circlePath(disk.cx, disk.cy, disk.r + 16), stroke: palette.ink, strokeAlpha: 0.55, lineWidth: 2 });
  } else {
    main.push({ d: circlePath(disk.cx, disk.cy, disk.r), stroke: palette.ink, strokeAlpha: 0.6, lineWidth: 3, dash: [10, 9] });
  }
  for (const m of modules) {
    const w = cell * m.span * m.scale;
    const x = M + (m.gx + m.span / 2) * cell - w / 2;
    const y = M + (m.gy + m.span / 2) * cell - w / 2;
    main.push({ d: modulePath(m.kind, x, y, w, m.quarter), fill: tint(m.color), ...(m.scale > 1 ? { blend: "multiply" as const, fillAlpha: 0.9 } : {}) });
  }
  main.push({
    d: [{ t: "M", x: diagonal.x1, y: diagonal.y1 }, { t: "L", x: diagonal.x2, y: diagonal.y2 }],
    stroke: palette.ink,
    lineWidth: params.lineWidth,
  });
  for (const q of squares) main.push({ d: rectPath(q.x, q.y, q.s, q.s), fill: q.color });

  // Risographie : la même couche décalée et transparente, dessous.
  const shadow: VShape[] = main.map((sh) => ({
    ...sh,
    d: translatePath(sh.d, RISO.dx, RISO.dy),
    ...(sh.fill !== undefined ? { fillAlpha: (sh.fillAlpha ?? 1) * RISO.alpha } : {}),
    ...(sh.stroke !== undefined ? { strokeAlpha: (sh.strokeAlpha ?? 1) * RISO.alpha } : {}),
  }));

  // Filets fins de la grille, par-dessus.
  const grid: PathCmd[] = [];
  for (let i = 0; i <= G; i++) {
    grid.push({ t: "M", x: M + i * cell, y: M * 0.6 }, { t: "L", x: M + i * cell, y: L - M * 0.6 });
    grid.push({ t: "M", x: M * 0.6, y: M + i * cell }, { t: "L", x: L - M * 0.6, y: M + i * cell });
  }
  const shapes: VShape[] = [...shadow, ...main, { d: grid, stroke: palette.ink, strokeAlpha: 0.2, lineWidth: 1.2 }];
  return { plan: { background: palette.paper, shapes, grain: 20, grainSeed: input.seed % 2147483647 }, params, modules, disk, diagonal, squares };
}

const KIND_NAMES: Record<Kind, string> = {
  disque: "disques",
  "demi-disque": "demi-disques",
  quart: "quarts de disque",
  "demi-plan": "demi-plans",
  triangle: "triangles",
  anneau: "anneaux",
  barres: "barres",
  carré: "carrés",
};

const DIRS = ["nord", "nord-nord-est", "nord-est", "est-nord-est", "est", "est-sud-est", "sud-est", "sud-sud-est", "sud", "sud-sud-ouest", "sud-ouest", "ouest-sud-ouest", "ouest", "ouest-nord-ouest", "nord-ouest", "nord-nord-ouest"];

export const constructif: Technique = {
  id: "constructif",
  family: "geometrique",
  name: "Constructif",
  process: "composition géométrique à règles",
  ported: true,
  heavy: false,
  maxExportSize: 8000,
  toSvg(input) {
    const { plan } = constructifPlan(input);
    return planToSvg(plan, missingMarkShapes(input, input.palette.ink), { title: `Sillage · Constructif · ${input.date}`, idPrefix: `constructif-${input.date}` });
  },
  render(ctx, S, input, options = {}) {
    const { plan } = constructifPlan(input);
    drawPlan(ctx, S, plan, input, input.palette.ink, options.quality === "preview" ? null : rngFor(input, "constructif").fork("grain"));
  },
  explain(input) {
    const { params: p, modules, disk } = constructifPlan(input);
    const n = input.norms;
    const overlaps = modules.filter((m) => m.scale > 1).length;
    const small = modules.filter((m) => m.span === 1).length;
    const dir = DIRS[Math.round((((p.w.windDirDeg.value % 360) + 360) % 360) / 22.5) % 16];
    const tintName = ["très froide", "froide", "tempérée", "chaude", "très chaude"][Math.min(4, Math.round(p.warmth * 4))];
    const lines: ExplainLine[] = [
      { param: "Grille", source: "Graine de la date", value: `${p.G} × ${p.G}` },
      { param: "Disposition des modules", source: "Graine de la date", value: p.layout },
      { param: "Vocabulaire de formes", source: "Graine de la date", value: p.vocab.map((k) => KIND_NAMES[k]).join(", ") },
      { param: "Grand module 2 × 2", source: "Graine de la date (grilles 5 et 6)", value: p.bigModule ? `oui (${KIND_NAMES[modules[0]!.kind]})` : "non" },
      {
        param: "Modules posés",
        source: `Pas (${centile(n.steps)}${n.steps === null ? " → valeur neutre 0,5, modules désaturés" : ""})`,
        value: `${small} sur ${p.G * p.G} cases (${Math.round((FILL.min + FILL.span * p.energy) * 100)} %)`,
      },
      {
        param: "Disque maître (sous les modules)",
        source: `Sommeil (${centile(n.sleep)}${n.sleep === null ? " → valeur neutre 0,5" : ""})`,
        value: `${disk.measured ? "rayon" : "contour en pointillés, rayon"} ${fmtInt(disk.r)} / 1000 (${Math.round(((Math.PI * disk.r * disk.r) / (INNER * INNER)) * 100)} % de la surface)`,
      },
      {
        param: "Recouvrements (modules agrandis, encre multipliée)",
        source: p.w.cloud.measured ? "Couverture nuageuse (mesurée)" : "Nuages : pas de météo → repli 50 %",
        value: `${Math.round(p.w.cloud.value * 100)} % → ${overlaps} module${overlaps > 1 ? "s" : ""} sur ${small}`,
      },
      {
        param: "Teinte dominante",
        source: p.w.tempMax.measured ? "Température maximale (mesurée)" : "Température : pas de météo → repli 16 °C",
        value: `${fmt(p.w.tempMax.value, 1)} °C → ${tintName}`,
      },
      {
        param: "Grande diagonale (axe)",
        source: p.w.windDirDeg.measured ? "Direction du vent (mesurée)" : "Vent : pas de météo → repli 250° (ouest-sud-ouest)",
        value: `${fmtInt(p.w.windDirDeg.value)}° (vent ${/^[aeiou]/.test(dir!) ? `d'${dir}` : `du ${dir}`}) · décalée de ${fmtInt(p.lineOffset)} / 1000 (graine)`,
      },
      {
        param: "Grande diagonale (épaisseur)",
        source: p.w.windKmh.measured ? "Vent maximal (mesuré)" : "Vent : pas de météo → repli 12 km/h",
        value: `${fmtInt(p.w.windKmh.value)} km/h → ${fmt(p.lineWidth, 1)} / 1000`,
      },
      {
        param: "Petits carrés",
        source: input.day.commits === null ? "Commits non mesurés" : `Commits (${input.day.commits}, ${centile(n.commits)})`,
        value: input.day.commits === null ? "aucun (pointillés)" : `${p.commits}${input.day.commits > COMMITS_MAX ? ` (plafond ${COMMITS_MAX})` : ""}`,
      },
      { param: "Encres", source: `Saison et sommeil (${centile(n.sleep)})`, value: `palette « ${input.palette.name} »` },
      { param: "Décalage d'encre (risographie)", source: "Constante du procédé", value: `${RISO.dx} × ${RISO.dy} / 1000, couche à ${Math.round(RISO.alpha * 100)} %` },
    ];
    return lines;
  },
};
