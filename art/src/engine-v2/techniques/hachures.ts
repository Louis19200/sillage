/**
 * Hachures (porté depuis `art/sketches/techniques/hachures.ts`) : gravure au trait pensée pour
 * une table traçante. Le carré est subdivisé en rectangles hachurés ; un disque croisé, réservé
 * dans le papier, flotte au-dessus.
 *
 *   profondeur de découpe ← pas (centile)        angle des hachures ← direction du vent
 *   espacement d'un rectangle ← pas de l'heure    tremblement du stylo ← vitesse du vent
 *   rayon du disque ← sommeil (centile)           rectangles à l'encre d'accent ← commits
 *
 * Tout est calculé géométriquement dans un repère 1000 × 1000 (`hachuresPlan`) : chaque
 * hachure est déjà découpée dans son rectangle (et hors de la réserve du disque), ou dans le
 * disque. Le canvas et le SVG tracent **les mêmes polylignes** : le SVG est prêt à tracer
 * (chemins seuls, un calque par encre, aucun clipPath, aucun remplissage).
 *
 * Encre sur papier, toujours : en humeur « nocturne » (papier sombre dans la palette du jour),
 * les rôles sont inversés pour garder un papier clair et une encre sombre.
 * Métrique absente : valeur neutre + marque commune (cadre en pointillés, un tiret par métrique),
 * tracée elle aussi en segments ; sommeil absent → contour du disque en pointillés.
 */
import { centile, fmt, fmtInt, grain, hex, missingMetrics, rngFor } from "../helpers";
import { FALLBACKS, hourlyOrFallback, weatherOrFallback } from "../input";
import type { PaletteV2, Technique, TechniqueInput } from "../types";

/** Repère logique des plans (comme la v1). */
export const UNIT = 1000;

/** Réglages, en unités logiques (sur 1000). */
export const HACHURES = {
  margin: 70,
  /** Retrait des hachures dans chaque rectangle : un filet de papier entre deux zones. */
  inset: 4,
  minCell: 60,
  /** Profondeur de découpe = depthBase + depthSpan × centile des pas. */
  depthBase: 3,
  depthSpan: 4,
  /** Espacement = gapMin + gapSpan × (1 − pas de l'heure / heure la plus active). */
  gapMin: 4,
  gapSpan: 16,
  /** Rayon du disque = discBase + discSpan × centile du sommeil. */
  discBase: 120,
  discSpan: 140,
  /** Papier réservé autour du disque. */
  discReserve: 10,
  discGaps: [5, 7] as const,
  /** Tremblement du stylo = trembleBase + vent (km/h) / trembleDiv, borné. */
  trembleBase: 0.6,
  trembleDiv: 40,
  trembleMax: 2,
  /** Un point de tremblement tous les `trembleStep` le long d'un trait. */
  trembleStep: 25,
  /** Part des rectangles à l'encre d'accent = accentBase + accentSpan × centile des commits. */
  accentBase: 0.04,
  accentSpan: 0.22,
  widths: { ink: 0.8, accent: 1.1, disc: 0.6, disc2: 0.5, outline: 1.4, missing: 1.6, tick: 3 },
} as const;

export interface HatchLayer {
  id: string;
  /** Nom du calque dans le SVG (« 1 encre », « 2 accent »…) : un calque = un stylo. */
  label: string;
  color: string;
  width: number;
  /** Polylignes [x0, y0, x1, y1, …] en unités logiques, regroupées par zone (un chemin SVG par zone). */
  zones: number[][][];
  /** Pour les calques de rectangles : indice (dans `rects`) de chaque zone. */
  zoneRects?: number[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HachuresPlan {
  paper: string;
  ink: string;
  accent: string;
  /** true : palette nocturne, papier et encre échangés pour rester « encre sur papier ». */
  swapped: boolean;
  depth: number;
  rects: Rect[];
  /** Pour chaque rectangle : heure, espacement, angle (rad), accent. */
  cells: { hour: number; gap: number; angle: number; accent: boolean }[];
  disc: { cx: number; cy: number; r: number; dashed: boolean };
  angle: number;
  tremble: number;
  accentCount: number;
  hourly: number[];
  hourlyMeasured: boolean;
  layers: HatchLayer[];
}

const luminance = (h: string) => {
  const c = hex(h);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** Papier clair, encre sombre, et l'encre d'accent la plus contrastée (et la plus vive) de la palette. */
export function hachuresInks(p: PaletteV2): { paper: string; ink: string; accent: string; swapped: boolean } {
  const swapped = luminance(p.paper) < luminance(p.ink);
  const paper = swapped ? p.ink : p.paper;
  const ink = swapped ? p.paper : p.ink;
  const lp = luminance(paper);
  let best = p.colors[0];
  let bestScore = -Infinity;
  for (const c of p.colors) {
    const [r, g, b] = hex(c);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const score = (lp - luminance(c)) + 0.8 * chroma;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return { paper, ink, accent: best, swapped };
}

/* ——— Géométrie (pure) ——— */

/** Intervalle de t où P + t·d est dans le rectangle (méthode des bandes), ou null. */
export function clipLineRect(px: number, py: number, dx: number, dy: number, r: Rect): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  const slab = (p: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-12) return p >= lo && p <= hi;
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 < t1;
  };
  if (!slab(px, dx, r.x, r.x + r.w) || !slab(py, dy, r.y, r.y + r.h)) return null;
  return t0 < t1 ? [t0, t1] : null;
}

/** Intervalle de t où P + t·d (d unitaire) est dans le disque, ou null. */
export function clipLineCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, r: number): [number, number] | null {
  const ox = px - cx, oy = py - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/** [a, b] privé de [c, d] : 0, 1 ou 2 intervalles. */
function subtract(a: number, b: number, hole: [number, number] | null): [number, number][] {
  if (!hole || hole[1] <= a || hole[0] >= b) return [[a, b]];
  const out: [number, number][] = [];
  if (hole[0] > a) out.push([a, hole[0]]);
  if (hole[1] < b) out.push([hole[1], b]);
  return out;
}

interface Pen {
  tremble: number;
  next: () => number;
  /** false : traits droits (miniatures). */
  wobble: boolean;
}

/** Trait tremblé : extrémités exactes, points intermédiaires décalés de ±tremble/2. */
function penLine(x1: number, y1: number, x2: number, y2: number, pen: Pen): number[] {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (!pen.wobble) return [x1, y1, x2, y2];
  const k = Math.max(2, Math.floor(L / HACHURES.trembleStep));
  const out = [x1, y1];
  for (let i = 1; i < k; i++) {
    const t = i / k;
    out.push(x1 + (x2 - x1) * t + (pen.next() - 0.5) * pen.tremble, y1 + (y2 - y1) * t + (pen.next() - 0.5) * pen.tremble);
  }
  out.push(x2, y2);
  return out;
}

/**
 * Hachures parallèles d'angle `angle`, espacées de `gap`, calées sur le centre de la feuille
 * (elles se prolongent d'une zone à l'autre), découpées dans `inside` et hors de `hole`.
 */
function hatchLines(
  angle: number,
  gap: number,
  inside: (px: number, py: number, dx: number, dy: number) => [number, number] | null,
  hole: ((px: number, py: number, dx: number, dy: number) => [number, number] | null) | null,
  pen: Pen,
): number[][] {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const C = UNIT / 2, D = UNIT * 1.5;
  const out: number[][] = [];
  for (let o = -D; o < D; o += gap) {
    const px = C - dy * o, py = C + dx * o;
    const span = inside(px, py, dx, dy);
    if (!span) continue;
    for (const [a, b] of subtract(span[0], span[1], hole ? hole(px, py, dx, dy) : null)) {
      if (b - a < 0.5) continue;
      out.push(penLine(px + dx * a, py + dy * a, px + dx * b, py + dy * b, pen));
    }
  }
  return out;
}

function circlePolyline(cx: number, cy: number, r: number, from = 0, to = Math.PI * 2, n = 180): number[] {
  const steps = Math.max(2, Math.ceil((n * (to - from)) / (Math.PI * 2)));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Pointillés d'un segment : [trait, blanc] répétés, en segments séparés (prêts à tracer). */
function dashed(x1: number, y1: number, x2: number, y2: number, on: number, off: number): number[][] {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  const out: number[][] = [];
  for (let s = 0; s < L; s += on + off) {
    const e = Math.min(L, s + on);
    out.push([x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e]);
  }
  return out;
}

/** Heure couverte par le centre d'un rectangle (gauche = minuit, droite = 23 h). */
const hourAt = (x: number) => Math.max(0, Math.min(23, Math.floor((x / UNIT) * 24)));

export function hachuresPlan(input: TechniqueInput, options: { quality?: "full" | "preview" } = {}): HachuresPlan {
  const H = HACHURES;
  const rng = rngFor(input, "hachures");
  const n = input.norms;
  const weather = weatherOrFallback(input.weather);
  const inks = hachuresInks(input.palette);

  // 1. Découpe (même règle que l'esquisse).
  const depth = Math.round(H.depthBase + H.depthSpan * (n.steps ?? 0.5));
  const rects: Rect[] = [];
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    if (d <= 0 || w < H.minCell || h < H.minCell || (d < 3 && rng.next() < 0.25)) { rects.push({ x, y, w, h }); return; }
    const t = rng.range(0.3, 0.7);
    if (w > h) { split(x, y, w * t, h, d - 1); split(x + w * t, y, w * (1 - t), h, d - 1); }
    else { split(x, y, w, h * t, d - 1); split(x, y + h * t, w, h * (1 - t), d - 1); }
  };
  split(H.margin, H.margin, UNIT - 2 * H.margin, UNIT - 2 * H.margin, depth);

  // 2. Données heure par heure. Pas absents : la forme de repli (neutre), jamais « 0 pas ».
  const hourlyMeasured = input.hourlySteps !== null && input.hourlySteps.length === 24;
  const hourly = input.day.steps === null && !hourlyMeasured ? [...FALLBACKS.hourlyShape] : hourlyOrFallback(input);
  const maxH = Math.max(...hourly, 1);

  // 3. Rectangles à l'encre d'accent ← commits (0 commit : aucun ; absent : aucun, et la marque).
  const commits = input.day.commits;
  const accentCount = commits === null || commits === 0 || n.commits === null
    ? 0
    : Math.min(rects.length, Math.max(1, Math.round(rects.length * (H.accentBase + H.accentSpan * n.commits))));
  const accentRng = rng.fork("accent");
  const accent = new Set<number>();
  while (accent.size < accentCount) accent.add(accentRng.int(0, rects.length - 1));

  const angle = (weather.windDirDeg.value * Math.PI) / 180;
  const angleRng = rng.fork("angles");
  const cells = rects.map((r, i) => {
    const hour = hourAt(r.x + r.w / 2);
    return { hour, gap: H.gapMin + H.gapSpan * (1 - hourly[hour]! / maxH), angle: angle + (angleRng.int(0, 3) * Math.PI) / 4, accent: accent.has(i) };
  });

  // 4. Disque du sommeil.
  const discRng = rng.fork("disque");
  const disc = {
    r: H.discBase + H.discSpan * (n.sleep ?? 0.5),
    cx: UNIT * discRng.range(0.35, 0.65),
    cy: UNIT * discRng.range(0.35, 0.65),
    dashed: n.sleep === null,
  };

  // 5. Traits.
  const tremble = Math.min(H.trembleMax, H.trembleBase + weather.windKmh.value / H.trembleDiv);
  const pen: Pen = { tremble, next: rng.fork("stylo").next, wobble: options.quality !== "preview" };
  const reserve = (px: number, py: number, dx: number, dy: number) => clipLineCircle(px, py, dx, dy, disc.cx, disc.cy, disc.r + H.discReserve);
  const inDisc = (px: number, py: number, dx: number, dy: number) => clipLineCircle(px, py, dx, dy, disc.cx, disc.cy, disc.r);

  const inkZones: number[][][] = [], inkRects: number[] = [];
  const accentZones: number[][][] = [], accentRects: number[] = [];
  rects.forEach((r, i) => {
    const cell = cells[i]!;
    const box: Rect = { x: r.x + H.inset, y: r.y + H.inset, w: r.w - 2 * H.inset, h: r.h - 2 * H.inset };
    const lines = hatchLines(cell.angle, cell.gap, (px, py, dx, dy) => clipLineRect(px, py, dx, dy, box), reserve, pen);
    if (!lines.length) return;
    (cell.accent ? accentZones : inkZones).push(lines);
    (cell.accent ? accentRects : inkRects).push(i);
  });
  const disc1 = hatchLines(angle + Math.PI / 2, H.discGaps[0], inDisc, null, pen);
  const disc2 = hatchLines(angle + Math.PI / 2 + 0.6, H.discGaps[1], inDisc, null, pen);
  const outline = disc.dashed
    ? Array.from({ length: 48 }, (_, i) => circlePolyline(disc.cx, disc.cy, disc.r, (i * Math.PI * 2) / 48, ((i + 0.55) * Math.PI * 2) / 48, 180))
    : [circlePolyline(disc.cx, disc.cy, disc.r)];

  const layers: HatchLayer[] = [
    { id: "encre", label: "1 encre", color: inks.ink, width: H.widths.ink, zones: inkZones, zoneRects: inkRects },
    { id: "disque-1", label: "1 encre (disque, passe 1)", color: inks.ink, width: H.widths.disc, zones: [disc1] },
    { id: "disque-2", label: "1 encre (disque, passe 2)", color: inks.ink, width: H.widths.disc2, zones: [disc2] },
    { id: "contour", label: "1 encre (contour du disque)", color: inks.ink, width: H.widths.outline, zones: [outline] },
  ];
  if (accentZones.length) layers.push({ id: "accent", label: "2 accent", color: inks.accent, width: H.widths.accent, zones: accentZones, zoneRects: accentRects });

  // 6. Données manquantes : même dessin que `drawMissingMark`, en segments.
  const missing = missingMetrics(input);
  if (missing.length) {
    const a = 22, b = UNIT - 22;
    const frame = [
      ...dashed(a, a, b, a, 6, 7), ...dashed(b, a, b, b, 6, 7), ...dashed(b, b, a, b, 6, 7), ...dashed(a, b, a, a, 6, 7),
    ];
    const ticks = missing.map((_, i) => [UNIT - (40 + i * 22), UNIT - 36, UNIT - (28 + i * 22), UNIT - 36]);
    const faded = mixToPaper(inks.ink, inks.paper, 0.45);
    layers.push({ id: "manque", label: "3 données manquantes", color: faded, width: H.widths.missing, zones: [frame] });
    layers.push({ id: "manque-tirets", label: "3 données manquantes (tirets)", color: faded, width: H.widths.tick, zones: [ticks] });
  }

  return {
    ...inks,
    depth,
    rects,
    cells,
    disc,
    angle,
    tremble,
    accentCount,
    hourly,
    hourlyMeasured,
    layers,
  };
}

function mixToPaper(ink: string, paper: string, t: number): string {
  const a = hex(ink), b = hex(paper);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/* ——— Sorties ——— */

/** Nombre SVG stable : 2 décimales au plus, jamais « -0 ». */
const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? "0" : String(r);
};

function polylineD(p: readonly number[]): string {
  let d = `M${num(p[0]!)} ${num(p[1]!)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${num(p[i]!)} ${num(p[i + 1]!)}`;
  return d;
}

/** Taille physique proposée pour le tracé (le `viewBox` reste 1000 × 1000). */
export const SVG_SIZE = "300mm";

/**
 * SVG prêt à tracer : un calque Inkscape par stylo, des chemins sans remplissage, aucun clipPath.
 * Le papier n'est qu'un fond CSS (`style="background"`), pour qu'aucun logiciel de tracé ne
 * dessine son contour. Déterministe, octet pour octet.
 */
export function hachuresSvg(input: TechniqueInput): string {
  const plan = hachuresPlan(input);
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${UNIT} ${UNIT}" style="background:${plan.paper}">`,
    `<title>Sillage · ${input.date} · Hachures</title>`,
    `<desc>Tracé au trait (seed ${input.seed}) : ${plan.rects.length} rectangles, profondeur ${plan.depth}, papier ${plan.paper}.</desc>`,
  ];
  for (const layer of plan.layers) {
    out.push(
      `<g id="${layer.id}" inkscape:groupmode="layer" inkscape:label="${layer.label}" fill="none" stroke="${layer.color}" stroke-width="${num(layer.width)}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const zone of layer.zones) if (zone.length) out.push(`<path d="${zone.map(polylineD).join("")}"/>`);
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

/** Nombre de traits et longueur totale d'encre (unités logiques), pour la fiche et les mesures. */
export function hachuresStats(plan: HachuresPlan): { strokes: number; length: number } {
  let strokes = 0, length = 0;
  for (const l of plan.layers) for (const z of l.zones) for (const p of z) {
    strokes++;
    for (let i = 2; i < p.length; i += 2) length += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  }
  return { strokes, length };
}

const neutral = (v: number | null, what: string) => (v === null ? ` → ${what}` : "");

export const hachures: Technique = {
  id: "hachures",
  family: "geometrique",
  name: "Hachures",
  process: "art du tracé (plotter)",
  ported: true,
  heavy: false,
  maxExportSize: 8000,
  toSvg: hachuresSvg,
  render(ctx, S, input, options = {}) {
    const plan = hachuresPlan(input, options);
    const k = S / UNIT;
    ctx.save();
    ctx.fillStyle = plan.paper;
    ctx.fillRect(0, 0, S, S);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const layer of plan.layers) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(0.35, layer.width * k);
      ctx.beginPath();
      for (const zone of layer.zones) for (const p of zone) {
        ctx.moveTo(p[0]! * k, p[1]! * k);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]! * k, p[i + 1]! * k);
      }
      ctx.stroke();
    }
    ctx.restore();
    grain(ctx, S, rngFor(input, "hachures-grain"), 16);
  },
  explain(input) {
    const plan = hachuresPlan(input);
    const n = input.norms;
    const w = weatherOrFallback(input.weather);
    const stats = hachuresStats(plan);
    const busiest = plan.hourly.indexOf(Math.max(...plan.hourly));
    const gaps = plan.cells.map((c) => c.gap);
    const commits = input.day.commits;
    return [
      {
        param: "Profondeur de découpe",
        source: `Pas (${centile(n.steps)}${neutral(n.steps, "valeur neutre 0,5")})`,
        value: `${plan.depth} niveaux → ${plan.rects.length} rectangles`,
      },
      {
        param: "Espacement des hachures (rectangle par rectangle)",
        source: plan.hourlyMeasured
          ? "Pas heure par heure (gauche = minuit, droite = 23 h)"
          : input.day.steps === null
            ? "Pas non mesurés → profil horaire de repli"
            : `Total des pas réparti selon le profil horaire de repli`,
        value: `${fmt(Math.min(...gaps), 1)} à ${fmt(Math.max(...gaps), 1)} / 1000 ; plus serré vers ${busiest} h`,
      },
      {
        param: "Angle des hachures",
        source: w.windDirDeg.measured ? "Direction du vent" : "Vent : pas de météo → repli ouest-sud-ouest",
        value: `${fmtInt(w.windDirDeg.value)}° (± multiples de 45° selon le rectangle)`,
      },
      {
        param: "Tremblement du stylo",
        source: w.windKmh.measured ? "Vitesse du vent" : "Vent : pas de météo → repli",
        value: `${fmt(plan.tremble, 2)} / 1000 (vent ${fmtInt(w.windKmh.value)} km/h)`,
      },
      {
        param: "Rayon du disque réservé",
        source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep, "valeur neutre 0,5, contour en pointillés")})`,
        value: `${fmtInt(plan.disc.r)} / 1000`,
      },
      {
        param: "Rectangles à l'encre d'accent",
        source: commits === null ? "Commits non mesurés" : `Commits (${commits}, ${centile(n.commits)})`,
        value: commits === null ? "aucun (donnée absente, marquée)" : `${plan.accentCount} sur ${plan.rects.length}`,
      },
      {
        param: "Encres",
        source: `Palette « ${input.palette.name} »${plan.swapped ? " (nocturne : papier et encre inversés)" : ""}`,
        value: `encre ${plan.ink}, accent ${plan.accent}, papier ${plan.paper}`,
      },
      {
        param: "Tracé",
        source: "Géométrie du jour (même tracé en PNG et en SVG)",
        value: `${fmtInt(stats.strokes)} traits, ${fmt((stats.length / UNIT) * 0.3, 0)} m de trait sur une feuille de 30 cm`,
      },
    ];
  },
};
