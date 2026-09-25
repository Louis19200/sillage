/**
 * Harmonographe : quatre pendules amortis tracent une seule ligne (porté depuis
 * `art/sketches/techniques/harmonographe.ts`).
 *
 *   x(t) = e^(−δt) · (sin(f₁t + φ₁) + sin(f₃t + φ₃)),   y(t) = e^(−δt) · (sin(f₂t + φ₂) + sin(f₄t + φ₄))
 *
 *   rapports f₁:f₂        ← pas (centile) ;   rapports f₃:f₄ ← commits (centile) ;
 *   désaccord, amortissement δ ← sommeil (nuit courte : figure plus nerveuse, qui s'éteint vite) ;
 *   orientation           ← direction du vent ; rotation lente de la table ← force du vent
 *                           (repli : 250°, 12 km/h) ;
 *   phases φ              ← seed de la date ;   couleur ← temps qui passe (palette v2).
 *
 * Cadre : la courbe est calculée en entier (`harmonographDrawing`, pur, repère 1000), puis mise
 * à l'échelle sur son étendue RÉELLE : elle tient toujours dans la marge, quelle que soit la
 * combinaison de fréquences et de phases. Le SVG reprend exactement les mêmes points.
 * Métrique absente : valeur neutre et marque commune (`drawMissingMark`).
 */
import { centile, css, drawMissingMark, fmt, fmtInt, grain, hex, ramp, rngFor } from "../helpers";
import { weatherOrFallback } from "../input";
import type { Technique, TechniqueInput } from "../types";
import { n1, svgMissingMark, svgOpen } from "./svg-kit";

export const HARMONO = {
  ratios: [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 5]] as const,
  /** Durée simulée et pas de temps (miniature : pas doublé). */
  T: 900,
  dt: 0.012,
  /** Points par tronçon de couleur. */
  chunk: 400,
  /** Marge autour de l'étendue réelle de la courbe (repère 1000). */
  margin: 80,
  detuneBase: 0.004,
  detuneSpan: 0.012,
  dampBase: 0.0009,
  dampSpan: 0.0022,
  /** Rotation de la table sur toute la durée, à 30 km/h (radians). */
  spinPer30Kmh: 0.5,
  lineWidth: 0.7,
  alpha: 0.55,
} as const;

export interface HarmonoParams {
  stepsRatio: readonly [number, number];
  commitsRatio: readonly [number, number];
  f: [number, number, number, number];
  phases: [number, number, number, number];
  detune: number;
  damp: number;
  rotation: number;
  spin: number;
  windDirDeg: number;
  windKmh: number;
  windMeasured: boolean;
}

const ratioIndex = (v: number) => Math.min(HARMONO.ratios.length - 1, Math.floor(v * HARMONO.ratios.length));

export function harmonoParams(input: TechniqueInput): HarmonoParams {
  const rng = rngFor(input, "harmonographe");
  const n = input.norms;
  const w = weatherOrFallback(input.weather);
  const sleep = n.sleep ?? 0.5;
  const [p, q] = HARMONO.ratios[ratioIndex(n.steps ?? 0.5)]!;
  const [r, s] = HARMONO.ratios[ratioIndex(n.commits ?? 0.5)]!;
  const detune = HARMONO.detuneBase + HARMONO.detuneSpan * (1 - sleep);
  const phases: [number, number, number, number] = [0, rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI)];
  return {
    stepsRatio: [p, q],
    commitsRatio: [r, s],
    f: [p, q + detune, r + detune * 0.7, s],
    phases,
    detune,
    damp: HARMONO.dampBase + HARMONO.dampSpan * (1 - sleep),
    rotation: (w.windDirDeg.value * Math.PI) / 180,
    spin: HARMONO.spinPer30Kmh * (w.windKmh.value / 30),
    windDirDeg: w.windDirDeg.value,
    windKmh: w.windKmh.value,
    windMeasured: w.windDirDeg.measured,
  };
}

export interface HarmonoStroke { color: string; pts: Float64Array }
export interface HarmonoDrawing {
  paper: string;
  strokes: HarmonoStroke[];
  /** Étendue de la courbe dans le repère 1000 (toujours dans [margin, 1000 − margin]). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Facteur appliqué à l'amplitude brute pour remplir le cadre. */
  scale: number;
  points: number;
}

/** La ligne entière, dans le repère 1000, découpée en tronçons de couleur (pur). */
export function harmonographDrawing(input: TechniqueInput, quality: "full" | "preview" = "full", p: HarmonoParams = harmonoParams(input)): HarmonoDrawing {
  const dt = HARMONO.dt * (quality === "preview" ? 2 : 1);
  const count = Math.floor(HARMONO.T / dt);
  const raw = new Float64Array(count * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const [f0, f1, f2, f3] = p.f;
  const [p0, p1, p2, p3] = p.phases;
  for (let i = 0; i < count; i++) {
    const t = i * dt;
    const e = Math.exp(-p.damp * t);
    const x = e * (Math.sin(f0 * t + p0) + Math.sin(f2 * t + p2));
    const y = e * (Math.sin(f1 * t + p1) + Math.sin(f3 * t + p3));
    const rot = p.rotation + p.spin * (t / HARMONO.T);
    const c = Math.cos(rot), s = Math.sin(rot);
    const X = x * c - y * s, Y = x * s + y * c;
    raw[2 * i] = X; raw[2 * i + 1] = Y;
    if (X < minX) minX = X; if (X > maxX) maxX = X;
    if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
  }
  const inner = 1000 - 2 * HARMONO.margin;
  const scale = inner / Math.max(maxX - minX, maxY - minY, 1e-6);
  const ox = 500 - ((minX + maxX) / 2) * scale, oy = 500 - ((minY + maxY) / 2) * scale;
  const col = ramp([input.palette.colors[0], input.palette.colors[3], input.palette.colors[2], input.palette.colors[1], input.palette.colors[4]]);
  const strokes: HarmonoStroke[] = [];
  // Chaque tronçon reprend le dernier point du précédent : la ligne reste continue.
  for (let start = 0; start < count - 1; start += HARMONO.chunk) {
    const end = Math.min(count - 1, start + HARMONO.chunk);
    const pts = new Float64Array((end - start + 1) * 2);
    for (let i = start; i <= end; i++) {
      pts[2 * (i - start)] = ox + raw[2 * i]! * scale;
      pts[2 * (i - start) + 1] = oy + raw[2 * i + 1]! * scale;
    }
    const c = col(((end) * dt) / HARMONO.T);
    strokes.push({ color: `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`, pts });
  }
  return {
    paper: input.palette.paper,
    strokes,
    bounds: { minX: ox + minX * scale, maxX: ox + maxX * scale, minY: oy + minY * scale, maxY: oy + maxY * scale },
    scale,
    points: count,
  };
}

export const harmonographe: Technique = {
  id: "harmonographe",
  family: "mathematique",
  name: "Harmonographe",
  process: "courbe paramétrique amortie (quatre pendules)",
  ported: true,
  heavy: false,
  maxExportSize: 8000,
  toSvg(input) {
    const dr = harmonographDrawing(input, "full");
    const out = svgOpen(dr.paper, `Sillage · ${input.date} · Harmonographe`);
    out.push(`<g fill="none" stroke-width="${HARMONO.lineWidth}" stroke-opacity="${HARMONO.alpha}" stroke-linejoin="round">`);
    // Coordonnées arrondies au dixième, puis écrites en relatif (« l ») : les écarts entre
    // valeurs arrondies sont exacts (en dixièmes entiers), donc aucune dérive, et le fichier
    // est ~30 % plus léger qu'en absolu.
    const tenth = (v: number) => Math.round(v * 10);
    const dec = (t: number) => n1(t / 10);
    for (const s of dr.strokes) {
      let px = tenth(s.pts[0]!), py = tenth(s.pts[1]!);
      const parts: string[] = [`M${dec(px)} ${dec(py)}l`];
      for (let i = 2; i < s.pts.length; i += 2) {
        const x = tenth(s.pts[i]!), y = tenth(s.pts[i + 1]!);
        const dx = dec(x - px), dy = dec(y - py);
        parts.push(`${i > 2 && !dx.startsWith("-") ? " " : ""}${dx}${dy.startsWith("-") ? "" : " "}${dy}`);
        px = x; py = y;
      }
      out.push(`<path stroke="${s.color}" d="${parts.join("")}"/>`);
    }
    out.push(`</g>`, svgMissingMark(input, input.palette.ink), `</svg>`);
    return out.join("\n");
  },
  render(ctx, S, input, options = {}) {
    const dr = harmonographDrawing(input, options.quality ?? "full");
    const k = S / 1000;
    ctx.save();
    ctx.fillStyle = dr.paper;
    ctx.fillRect(0, 0, S, S);
    // Trait de 0,7 px à 1000 px ; plancher pour que les miniatures ne s'évanouissent pas.
    ctx.lineWidth = Math.max(0.35, HARMONO.lineWidth * k);
    ctx.lineJoin = "round";
    for (const s of dr.strokes) {
      ctx.strokeStyle = css(hex(s.color), HARMONO.alpha);
      ctx.beginPath();
      ctx.moveTo(s.pts[0]! * k, s.pts[1]! * k);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i]! * k, s.pts[i + 1]! * k);
      ctx.stroke();
    }
    ctx.restore();
    if (S <= 4000) grain(ctx, S, rngFor(input, "harmonographe-grain"), 12);
    drawMissingMark(ctx, S, input, input.palette.ink);
  },
  explain(input) {
    const p = harmonoParams(input);
    const dr = harmonographDrawing(input, "full", p);
    const n = input.norms;
    const neutral = (v: number | null) => (v === null ? " → valeur neutre" : "");
    const deg = (r: number) => `${fmtInt((((r * 180) / Math.PI) % 360 + 360) % 360)}°`;
    return [
      { param: "Rapport des pendules 1 et 2 (x : y)", source: `Pas (${centile(n.steps)}${neutral(n.steps)})`, value: `${p.stepsRatio[0]} : ${p.stepsRatio[1]}` },
      { param: "Rapport des pendules 3 et 4 (x : y)", source: `Commits (${centile(n.commits)}${neutral(n.commits)})`, value: `${p.commitsRatio[0]} : ${p.commitsRatio[1]}` },
      { param: "Désaccord des fréquences (dérive des boucles)", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: fmt(p.detune, 4) },
      { param: "Amortissement (vitesse d'extinction)", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: `${fmt(p.damp, 4)} → amplitude finale ${fmtInt(Math.exp(-p.damp * HARMONO.T) * 100)} %` },
      {
        param: "Orientation de la figure",
        source: p.windMeasured ? `Direction du vent (${fmtInt(p.windDirDeg)}°)` : `Vent : pas de météo → repli ${fmtInt(p.windDirDeg)}°`,
        value: deg(p.rotation),
      },
      {
        param: "Rotation lente de la table",
        source: p.windMeasured ? `Force du vent (${fmt(p.windKmh, 0)} km/h)` : `Vent : repli ${fmt(p.windKmh, 0)} km/h`,
        value: `${deg(p.spin)} sur toute la durée`,
      },
      { param: "Phases de départ", source: "Seed de la date", value: p.phases.slice(1).map((v) => fmt(v, 2)).join(" · ") },
      { param: "Mise à l'échelle (cadre)", source: "Étendue réelle de la courbe", value: `× ${fmtInt(dr.scale)} px / 1000, marge ${HARMONO.margin}` },
      { param: "Couleur de la ligne", source: "Temps qui passe (du premier au dernier balancement)", value: `palette « ${input.palette.name} »` },
    ];
  },
};
