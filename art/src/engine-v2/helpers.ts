/**
 * Outils de dessin partagés par les techniques (repris des esquisses `art/sketches/helpers.ts`,
 * rendus utilisables dans un Worker : aucun accès à `document` si `OffscreenCanvas` existe).
 */
import { createRng, type Rng } from "../engine/random";
import type { Ctx2D, TechniqueInput } from "./types";

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mixHex(a: string, b: string, t: number): string {
  return toHex(mix(hex(a), hex(b), t));
}

/** Rapproche une couleur de son gris (0 = inchangée, 1 = gris). */
export function desaturate(h: string, t: number): string {
  const c = hex(h);
  const g = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return toHex(mix(c, [g, g, g], t));
}

/** Dégradé à plusieurs arrêts, t dans [0, 1]. */
export function ramp(stops: readonly string[]): (t: number) => RGB {
  const cs = stops.map(hex);
  return (t) => {
    const x = Math.min(0.9999, Math.max(0, t)) * (cs.length - 1);
    const i = Math.floor(x);
    return mix(cs[i]!, cs[i + 1]!, x - i);
  };
}

export const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Générateur propre à une couche d'une technique : ajouter un tirage ailleurs ne le décale pas. */
export function rngFor(input: TechniqueInput, label: string): Rng {
  return createRng(input.seed).fork(label);
}

/** Canvas hors écran : OffscreenCanvas (Worker compris) ou, à défaut, un <canvas> détaché. */
export function createCanvas(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/** Grain de papier léger, par-dessus tout. */
export function grain(ctx: Ctx2D, S: number, rng: Rng, strength = 14): void {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rng.next() - 0.5) * strength;
    d[i] = d[i]! + g;
    d[i + 1] = d[i + 1]! + g;
    d[i + 2] = d[i + 2]! + g;
  }
  ctx.putImageData(img, 0, 0);
}

/** Bruit de valeur 2D lissé, déterministe. */
export function valueNoise(rng: Rng, size = 256): (x: number, y: number) => number {
  const perm = new Uint16Array(size * 2);
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    perm[i] = i;
    vals[i] = rng.next();
  }
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  for (let i = 0; i < size; i++) perm[i + size] = perm[i]!;
  const f = (t: number) => t * t * (3 - 2 * t);
  const at = (x: number, y: number) => vals[perm[(perm[x & (size - 1)]! + (y & (size - 1))) & (size * 2 - 1)]!]!;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = f(x - xi), ty = f(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Pose un champ scalaire basse résolution (w × w) sur le canvas, lissé. */
export function blitField(ctx: Ctx2D, S: number, w: number, color: (i: number) => RGB): void {
  const { canvas, ctx: octx } = createCanvas(w, w);
  const img = octx.createImageData(w, w);
  for (let i = 0; i < w * w; i++) {
    const c = color(i);
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, S, S);
}

/** Métriques absentes du jour (jamais confondues avec 0). */
export function missingMetrics(input: TechniqueInput): ("pas" | "sommeil" | "commits")[] {
  const out: ("pas" | "sommeil" | "commits")[] = [];
  if (input.day.steps === null) out.push("pas");
  if (input.day.sleep_minutes === null) out.push("sommeil");
  if (input.day.commits === null) out.push("commits");
  return out;
}

/**
 * Marque commune « données manquantes » : un cadre intérieur en pointillés, un tiret par
 * métrique absente dans le coin. Visible, jamais confondu avec une journée à 0.
 */
export function drawMissingMark(ctx: Ctx2D, S: number, input: TechniqueInput, color: string): void {
  const missing = missingMetrics(input);
  if (missing.length === 0) return;
  const k = S / 1000;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, 1.6 * k);
  ctx.setLineDash([6 * k, 7 * k]);
  ctx.strokeRect(22 * k, 22 * k, S - 44 * k, S - 44 * k);
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1, 3 * k);
  missing.forEach((_, i) => {
    ctx.beginPath();
    ctx.moveTo(S - (40 + i * 22) * k, S - 36 * k);
    ctx.lineTo(S - (28 + i * 22) * k, S - 36 * k);
    ctx.stroke();
  });
  ctx.restore();
}

/* ——— Mise en forme pour `explain()` ——— */

const nf = (digits: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmt = (n: number, digits = 2) => nf(digits).format(n).replace("-", "−");
export const fmtInt = (n: number) => nf(0).format(Math.round(n));

/** « 62ᵉ centile », « non mesuré ». */
export function centile(v: number | null): string {
  return v === null ? "non mesuré" : `${Math.round(v * 100)}ᵉ centile`;
}
