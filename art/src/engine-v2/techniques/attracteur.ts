/**
 * Attracteur de Clifford (porté depuis `art/sketches/techniques/attracteur.ts`) :
 *   x' = sin(a·y) + c·cos(a·x),  y' = sin(b·x) + d·cos(b·y)
 * a ← pas, b ← sommeil, c ← commits, d ← nuages (repli 0,5). Un petit écart de données donne
 * une forme très différente. Couleur ← direction du mouvement ; densité en échelle log.
 *
 * Coût : ~6 millions d'itérations pour 1000 px (0,3–0,6 s). La densité est accumulée à au plus
 * `MAX_RES` px puis agrandie, ce qui borne la mémoire à l'export.
 * Métrique absente : valeur neutre (0,5) et cadre en pointillés (`drawMissingMark`).
 */
import { centile, createCanvas, drawMissingMark, fmt, fmtInt, grain, hex, mix, rngFor, type RGB } from "../helpers";
import { weatherOrFallback } from "../input";
import type { Technique, TechniqueInput } from "../types";

const MAX_RES = 2000;
const ITER_PER_MPX = 6_000_000;

/** Pas de décalage de `a` quand la forme s'effondre (orbite périodique : quelques points seulement). */
const DEGENERATE_STEP = 0.071;
const MAX_NUDGES = 12;

/**
 * Part des cases d'une grille 128 × 128 touchées par 30 000 points : sous 3 %, l'attracteur
 * s'est effondré sur un cycle (image presque vide). Pur, sans canvas.
 */
export function coverage(a: number, b: number, c: number, d: number): number {
  const G = 128;
  const hit = new Uint8Array(G * G);
  let x = 0.1, y = 0.1;
  const pts: number[] = [];
  for (let i = 0; i < 30000; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx; y = ny;
    if (i > 100) pts.push(x, y);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]!); maxX = Math.max(maxX, pts[i]!);
    minY = Math.min(minY, pts[i + 1]!); maxY = Math.max(maxY, pts[i + 1]!);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const k = Math.min(G - 1, Math.floor(((pts[i]! - minX) / span) * G)) * G + Math.min(G - 1, Math.floor(((pts[i + 1]! - minY) / span) * G));
    if (!hit[k]) { hit[k] = 1; n++; }
  }
  return n / (G * G);
}

export function attractorParams(input: TechniqueInput) {
  const rng = rngFor(input, "attracteur");
  const n = input.norms;
  const cloud = weatherOrFallback(input.weather).cloud;
  const a0 = -1.25 - 0.8 * (n.steps ?? 0.5) + (rng.next() - 0.5) * 0.08;
  const b = 1.35 + 0.6 * (n.sleep ?? 0.5);
  const c = 0.55 + 0.9 * (n.commits ?? 0.5);
  const d = 0.35 + 0.9 * cloud.value;
  // Forme effondrée : on essaie a − s, a + s, a − 2s, a + 2s… (ordre fixe, donc déterministe).
  let nudges = 0;
  let a = a0;
  while (nudges < MAX_NUDGES * 2 && coverage(a, b, c, d) < 0.03) {
    nudges++;
    a = a0 + (nudges % 2 === 1 ? -1 : 1) * Math.ceil(nudges / 2) * DEGENERATE_STEP;
  }
  return { a, a0, nudges, b, c, d, cloudMeasured: cloud.measured };
}

function iterations(res: number, quality: "full" | "preview"): number {
  const full = ITER_PER_MPX * (res / 1000) ** 2;
  return Math.round(quality === "preview" ? Math.max(120_000, full * 0.2) : Math.max(400_000, full));
}

export const attracteur: Technique = {
  id: "attracteur",
  family: "mathematique",
  name: "Attracteur",
  process: "chaos déterministe (Clifford)",
  ported: true,
  heavy: false,
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const R = Math.min(S, MAX_RES);
    const { a, b, c, d } = attractorParams(input);
    const { palette } = input;
    const N = R * R;
    const count = new Float32Array(N);
    const r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N);
    const cols = palette.colors.map(hex);
    const colorAt = (ang: number): RGB => {
      const t = ((((ang / (2 * Math.PI)) % 1) + 1) % 1) * cols.length;
      const i = Math.floor(t);
      return mix(cols[i % cols.length]!, cols[(i + 1) % cols.length]!, t - i);
    };

    // Bornes du nuage (premiers 20 000 points, hors transitoire).
    let x = 0.1, y = 0.1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      x = nx; y = ny;
      if (i > 100) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-3) * 1.12;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    const total = iterations(R, options.quality ?? "full");
    for (let i = 0; i < total; i++) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      const px = Math.floor(((nx - cx) / span + 0.5) * R);
      const py = Math.floor(((ny - cy) / span + 0.5) * R);
      if (px >= 0 && py >= 0 && px < R && py < R) {
        const k = py * R + px;
        const col = colorAt(Math.atan2(ny - y, nx - x));
        count[k]! += 1; r[k]! += col[0]; g[k]! += col[1]; bl[k]! += col[2];
      }
      x = nx; y = ny;
    }

    let max = 0;
    for (let i = 0; i < N; i++) if (count[i]! > max) max = count[i]!;
    const bg = hex(palette.night);
    const { canvas, ctx: off } = createCanvas(R, R);
    const img = off.createImageData(R, R);
    const lm = Math.log(1 + Math.max(1, max));
    for (let i = 0; i < N; i++) {
      const cnt = count[i]!;
      const v = cnt > 0 ? Math.pow(Math.log(1 + cnt) / lm, 0.55) : 0;
      const avg: RGB = cnt > 0 ? [r[i]! / cnt, g[i]! / cnt, bl[i]! / cnt] : bg;
      const lit = mix(avg, [250, 244, 230], Math.max(0, v - 0.75) * 2);
      const out = mix(bg, lit, Math.min(1, v * 1.15));
      img.data[i * 4] = out[0]; img.data[i * 4 + 1] = out[1]; img.data[i * 4 + 2] = out[2]; img.data[i * 4 + 3] = 255;
    }
    off.putImageData(img, 0, 0);
    grain(off, R, rngFor(input, "attracteur-grain"), 8);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, S, S);
    ctx.restore();
    drawMissingMark(ctx, S, input, palette.colors[2]);
  },
  explain(input) {
    const p = attractorParams(input);
    const n = input.norms;
    const neutral = (v: number | null) => (v === null ? " → valeur neutre 0,5" : "");
    return [
      {
        param: "Paramètre a (torsion principale)",
        source: `Pas (${centile(n.steps)}${neutral(n.steps)})`,
        value: p.nudges ? `${fmt(p.a, 3)} (au lieu de ${fmt(p.a0, 3)}, qui effondrait la forme en quelques points)` : fmt(p.a, 3),
      },
      { param: "Paramètre b (seconde fréquence)", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: fmt(p.b, 3) },
      { param: "Paramètre c (amplitude)", source: `Commits (${centile(n.commits)}${neutral(n.commits)})`, value: fmt(p.c, 3) },
      { param: "Paramètre d (épaisseur)", source: p.cloudMeasured ? "Couverture nuageuse" : "Nuages : pas de météo → repli 0,5", value: fmt(p.d, 3) },
      { param: "Couleur des traînées", source: "Direction du mouvement dans l'attracteur", value: `palette « ${input.palette.name} »` },
      { param: "Points calculés", source: "Taille du rendu (même forme à toute taille)", value: `${fmtInt(ITER_PER_MPX)} par million de pixels` },
    ];
  },
};
