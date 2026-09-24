/**
 * composeDay(day, norms, seed) → Scene. Pur : pas de p5, pas de DOM, pas d'horloge,
 * pas de Math.random. Même entrée, même Scene (à l'octet près une fois sérialisée).
 *
 * Image : un courant (les « sillages ») traverse le cadre ; les pierres (commits)
 * le dévient comme des rochers dans l'eau ; un astre (sommeil) éclaire la scène.
 */
import type { DayInput } from "./day";
import type { Norms } from "./normalize";
import { derivedParams, type Palette, type VisualParams } from "./mapping";
import { createNoise2D, createRng, type Rng } from "./random";
import {
  SCENE_SIZE,
  type CirclePrim,
  type CurvePrim,
  type Paint,
  type Primitive,
  type Scene,
} from "./scene";

const C = SCENE_SIZE / 2;
/** Arrondi à 0,1 unité : scènes compactes et stables à la sérialisation. */
const q = (v: number) => Math.round(v * 10) / 10 + 0; // + 0 : pas de -0 (JSON le perd)
const qa = (v: number) => Math.round(v * 1000) / 1000 + 0;
const paint = (color: string, alpha: number): Paint => ({ color, alpha: qa(alpha) });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Stone {
  x: number;
  y: number;
  r: number;
}

/* ------------------------------------------------------------------ */
/* Placement des pierres                                               */
/* ------------------------------------------------------------------ */

function placeStones(p: VisualParams, rng: Rng): Stone[] {
  const { count, radius } = p.stones;
  if (count === 0) return [];
  const orb = p.orb;
  // Pierres regroupées en 1 à 3 archipels : plus composé qu'un semis uniforme.
  const clusters = Math.min(3, 1 + Math.floor(count / 7));
  const centers = Array.from({ length: clusters }, () => ({
    x: rng.range(220, 780),
    y: rng.range(420, 800),
  }));
  const spread = 90 + 18 * Math.sqrt(count);
  const stones: Stone[] = [];
  for (let i = 0; i < count; i++) {
    const r = radius * rng.range(0.65, 1.45);
    let placed: Stone | null = null;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const center = centers[i % clusters]!;
      const relax = 1 + attempt / 80; // on élargit la zone si ça coince
      const x = center.x + rng.gauss() * spread * relax;
      const y = center.y + rng.gauss() * spread * 0.75 * relax;
      const margin = r + 70;
      if (x < margin || x > SCENE_SIZE - margin || y < margin || y > SCENE_SIZE - margin) continue;
      if (Math.hypot(x - orb.cx, y - orb.cy) < orb.r + r + 40) continue;
      const gap = attempt < 200 ? 26 : 12;
      if (stones.some((s) => Math.hypot(x - s.x, y - s.y) < s.r + r + gap)) continue;
      placed = { x, y, r };
    }
    if (placed) stones.push(placed);
  }
  return stones;
}

/* ------------------------------------------------------------------ */
/* Champ d'écoulement : courant uniforme + doublets autour des pierres  */
/* ------------------------------------------------------------------ */

function makeField(p: VisualParams, stones: Stone[], seed: number) {
  const { angle, turbulence, noiseScale } = p.flow;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const n1 = createNoise2D(seed ^ 0x51a6e);
  const n2 = createNoise2D(seed ^ 0x2bd13);

  // Remous = rotationnel d'une fonction de courant bruitée ψ : le champ reste à divergence
  // nulle, donc les sillages ondulent sans s'agglutiner ni laisser de grands vides.
  // ψ s'éteint près des pierres pour que le courant les contourne proprement.
  const calmAt = (x: number, y: number) => {
    let calm = 1;
    for (const s of stones) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 9 * s.r * s.r) calm *= smoothstep(s.r * 1.15, s.r * 3, Math.sqrt(d2));
    }
    return calm;
  };
  const psi = (x: number, y: number) => {
    const f = noiseScale;
    const n = n1(x * f, y * f) + (0.4 / 2.3) * n2(x * f * 2.3 + 17.3, y * f * 2.3 - 5.1);
    return ((turbulence / f) * n * calmAt(x, y)) / 1.2;
  };
  const h = 0.75;

  return (x: number, y: number): [number, number] | null => {
    // Potentiel complexe w = e^{-iα} z + Σ e^{iα} R² / (z - c) ⇒ u - iv = dw/dz.
    let re = ca;
    let im = -sa;
    for (const s of stones) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < s.r * s.r * 1.02) return null; // on a touché la pierre
      // R² / (z - c)² = R² · conj((z - c)²) / |z - c|⁴
      const zr = dx * dx - dy * dy;
      const zi = 2 * dx * dy;
      const inv = (s.r * s.r) / (d2 * d2);
      const ir = zr * inv;
      const ii = -zi * inv;
      re -= ca * ir - sa * ii;
      im -= ca * ii + sa * ir;
    }
    let u = re;
    let v = -im;
    if (turbulence > 0) {
      u += (psi(x, y + h) - psi(x, y - h)) / (2 * h);
      v -= (psi(x + h, y) - psi(x - h, y)) / (2 * h);
    }
    const m = Math.hypot(u, v);
    if (m < 1e-4) return null; // point d'arrêt
    return [u / m, v / m];
  };
}

function traceLine(
  field: (x: number, y: number) => [number, number] | null,
  start: [number, number],
  angle: number,
): [number, number][] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const ds = 6;
  const keepEvery = 2;
  const pts: [number, number][] = [];
  let [x, y] = start;
  for (let i = 0; i < 700; i++) {
    const along = (x - C) * ca + (y - C) * sa;
    if (along > 640 || Math.abs(-(x - C) * sa + (y - C) * ca) > 800) break;
    if (i % keepEvery === 0) pts.push([q(x), q(y)]);
    // Runge-Kutta 2 : plus stable autour des pierres.
    const k1 = field(x, y);
    if (!k1) break;
    const k2 = field(x + k1[0] * ds * 0.5, y + k1[1] * ds * 0.5);
    if (!k2) break;
    x += k2[0] * ds;
    y += k2[1] * ds;
  }
  pts.push([q(x), q(y)]);
  // On ne garde que la portion utile autour du cadre.
  const inside = (pt: [number, number]) => pt[0] > -40 && pt[0] < 1040 && pt[1] > -40 && pt[1] < 1040;
  const first = pts.findIndex(inside);
  if (first === -1) return [];
  let last = pts.length - 1;
  while (last > first && !inside(pts[last]!)) last--;
  return pts.slice(Math.max(0, first - 1), Math.min(pts.length, last + 2));
}

function flowLines(p: VisualParams, stones: Stone[], seed: number, rng: Rng): CurvePrim[] {
  const { flow, palette } = p;
  const out: CurvePrim[] = [];

  if (flow.state === "still") {
    // 0 pas : eau dormante. Lignes parfaitement horizontales, resserrées vers l'horizon.
    for (let i = 0; i < flow.lines; i++) {
      const t = (i + 1) / (flow.lines + 1);
      const y = q(lerp(470, 975, Math.pow(t, 1.5)));
      out.push({
        layer: "wake-still",
        kind: "curve",
        points: [[0, y], [SCENE_SIZE, y]],
        stroke: { paint: paint(palette.ink, lerp(0.22, 0.5, t)), weight: q(flow.weight * lerp(0.7, 1.4, t)) },
      });
    }
    return out;
  }

  const field = makeField(p, stones, seed);
  const ca = Math.cos(flow.angle);
  const sa = Math.sin(flow.angle);
  const span = 1320;
  const spacing = span / flow.lines;
  for (let i = 0; i < flow.lines; i++) {
    const t = -span / 2 + spacing * (i + 0.5) + rng.gauss() * spacing * 0.3;
    const start: [number, number] = [C - ca * 620 - sa * t, C - sa * 620 + ca * t];
    const points = traceLine(field, start, flow.angle);
    const w = rng.range(0.55, 1.6);
    const a = rng.range(0.3, 0.85);
    if (points.length < 2) continue;
    if (flow.state === "unknown") {
      out.push({
        layer: "wake-unknown",
        kind: "curve",
        points,
        stroke: { paint: paint(palette.ink, 0.42), weight: flow.weight, dash: [2, 9] },
      });
      continue;
    }
    // Quelques sillages prennent la couleur de l'astre : des reflets.
    const glint = rng.next() < 0.1;
    out.push({
      layer: glint ? "wake-glint" : "wake",
      kind: "curve",
      points,
      stroke: {
        paint: paint(glint ? palette.orb : palette.ink, glint ? Math.min(1, a + 0.15) : a),
        weight: q(flow.weight * w * (glint ? 1.6 : 1)),
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Astre, pierres                                                      */
/* ------------------------------------------------------------------ */

/** Le halo passe derrière les sillages, l'astre devant (légèrement translucide). */
function orbPrims(p: VisualParams): { behind: Primitive[]; front: Primitive[] } {
  const { orb, palette } = p;
  const cx = q(orb.cx);
  const cy = q(orb.cy);
  const r = q(orb.r);
  const glow: Primitive = {
    layer: "orb-glow",
    kind: "radial-gradient",
    cx,
    cy,
    r: q(orb.r * (orb.known ? 4.2 : 3)),
    stops: [
      { offset: 0, paint: paint(palette.glow, orb.known ? 0.75 : 0.45) },
      { offset: 0.35, paint: paint(palette.glow, orb.known ? 0.3 : 0.15) },
      { offset: 1, paint: paint(palette.glow, 0) },
    ],
  };
  if (!orb.known) {
    // Sommeil inconnu : un astre « à remplir », contour en pointillés.
    return {
      behind: [glow],
      front: [
        { layer: "orb-unknown", kind: "circle", cx, cy, r, fill: paint(palette.glow, 0.55), stroke: { paint: paint(palette.ink, 0.55), weight: 1.6, dash: [6, 7] } },
        { layer: "orb-unknown", kind: "circle", cx, cy, r: q(r * 0.62), stroke: { paint: paint(palette.ink, 0.3), weight: 1.1, dash: [3, 7] } },
      ],
    };
  }
  return {
    behind: [glow],
    front: [{ layer: "orb", kind: "circle", cx, cy, r, fill: paint(palette.orb, 0.94) }],
  };
}

function blob(rng: Rng, s: Stone, n = 11): [number, number][] {
  const phase = rng.range(0, Math.PI * 2);
  const wobble = rng.range(0.05, 0.13);
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    const rr = s.r * (1 + wobble * Math.sin(a * 2 + phase) + rng.gauss() * 0.03);
    return [q(s.x + Math.cos(a) * rr), q(s.y + Math.sin(a) * rr)] as [number, number];
  });
}

function stonePrims(p: VisualParams, stones: Stone[], rng: Rng): Primitive[] {
  const { palette, stones: sp, flow } = p;
  const out: Primitive[] = [];
  for (const s of stones) {
    const ring = (k: number, alpha: number): CirclePrim => ({
      layer: "ripple",
      kind: "circle",
      cx: q(s.x),
      cy: q(s.y),
      r: q(s.r * k),
      stroke: { paint: paint(palette.ink, alpha), weight: 1, ...(sp.state === "unknown" ? { dash: [3, 6] } : {}) },
    });
    if (sp.state === "unknown") {
      out.push(ring(1.7, 0.25));
      out.push({
        layer: "stone-unknown",
        kind: "circle",
        cx: q(s.x),
        cy: q(s.y),
        r: q(s.r),
        stroke: { paint: paint(palette.ink, 0.65), weight: 1.6, dash: [5, 6] },
      });
      continue;
    }
    // Ronds dans l'eau : plus nets quand l'eau est calme.
    const still = flow.state === "still";
    out.push(ring(1.55, still ? 0.35 : 0.2));
    if (still) out.push(ring(2.2, 0.18));
    out.push({
      layer: "stone",
      kind: "polygon",
      points: blob(rng, s),
      smooth: true,
      fill: paint(palette.stone, 1),
      stroke: { paint: paint(palette.stoneRim, 0.9), weight: 1.4 },
    });
    // Reflet tourné vers l'astre : les pierres semblent éclairées par lui.
    const dx = p.orb.cx - s.x;
    const dy = p.orb.cy - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const hl: Stone = { x: s.x + (dx / d) * s.r * 0.28, y: s.y + (dy / d) * s.r * 0.28, r: s.r * 0.5 };
    out.push({
      layer: "stone-light",
      kind: "polygon",
      points: blob(rng, hl, 9),
      smooth: true,
      fill: paint(palette.stoneLight, 0.55),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function composeDay(day: DayInput, norms: Norms, seed: number): Scene {
  const rng = createRng(seed);
  const params = derivedParams(day, norms, rng);
  const stones = placeStones(params, rng.fork("stones"));
  const { palette } = params;
  const orb = orbPrims(params);

  const primitives: Primitive[] = [
    {
      layer: "sky",
      kind: "linear-gradient",
      x1: 0,
      y1: 0,
      x2: 0,
      y2: SCENE_SIZE,
      stops: [
        { offset: 0, paint: paint(palette.skyTop, 1) },
        { offset: 1, paint: paint(palette.skyBottom, 1) },
      ],
    },
    ...orb.behind,
    ...flowLines(params, stones, seed, rng.fork("wakes")),
    ...orb.front,
    ...stonePrims(params, stones, rng.fork("stone-shapes")),
  ];

  const missing: Scene["meta"]["missing"] = [];
  if (day.steps === null) missing.push("steps");
  if (day.sleep_minutes === null) missing.push("sleep");
  if (day.commits === null) missing.push("commits");

  return {
    size: SCENE_SIZE,
    background: palette.skyBottom,
    primitives,
    meta: { date: day.date, seed, missing },
  };
}

export type { Palette };
