import type { Rng } from "../src/engine";

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Dégradé à plusieurs arrêts, t dans [0, 1]. */
export function ramp(stops: string[]): (t: number) => RGB {
  const cs = stops.map(hex);
  return (t) => {
    const x = Math.min(0.9999, Math.max(0, t)) * (cs.length - 1);
    const i = Math.floor(x);
    return mix(cs[i]!, cs[i + 1]!, x - i);
  };
}

export const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Grain de papier léger, par-dessus tout. */
export function grain(ctx: CanvasRenderingContext2D, S: number, rng: Rng, strength = 14): void {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rng.next() - 0.5) * strength;
    d[i] += g;
    d[i + 1] += g;
    d[i + 2] += g;
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
export function blitField(ctx: CanvasRenderingContext2D, S: number, w: number, color: (i: number) => RGB): void {
  const off = document.createElement("canvas");
  off.width = off.height = w;
  const octx = off.getContext("2d")!;
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
  ctx.drawImage(off, 0, 0, S, S);
}
