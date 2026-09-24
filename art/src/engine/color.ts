/**
 * Couleurs en OKLCH (perceptuellement uniformes) : interpoler deux palettes
 * dans cet espace garde des teintes harmonieuses, sans passage par le gris boueux
 * qu'on obtient en mélangeant du RGB.
 */

export interface Oklch {
  /** Luminance perçue, 0 (noir) à 1 (blanc). */
  l: number;
  /** Chroma (saturation), 0 à ~0.35. */
  c: number;
  /** Teinte en degrés. */
  h: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return clamp01(v);
}

function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function inGamut(col: Oklch): boolean {
  const eps = 0.0001;
  return oklchToLinearRgb(col).every((v) => v >= -eps && v <= 1 + eps);
}

/** Ramène une couleur dans le gamut sRGB en réduisant d'abord son chroma. */
function toGamut(col: Oklch): Oklch {
  if (inGamut(col)) return col;
  let lo = 0;
  let hi = col.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...col, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...col, c: lo };
}

const hex2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");

/** OKLCH → `#rrggbb` (sRGB). */
export function oklchToHex(col: Oklch): string {
  const safe = toGamut({ l: clamp01(col.l), c: Math.max(0, col.c), h: col.h });
  const [r, g, b] = oklchToLinearRgb(safe).map(linearToSrgb) as [number, number, number];
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Interpolation de teinte par le plus court chemin sur le cercle. */
export function lerpHue(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * t) % 360) + 360) % 360;
}

export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  return {
    l: a.l + (b.l - a.l) * t,
    c: a.c + (b.c - a.c) * t,
    h: lerpHue(a.h, b.h, t),
  };
}
