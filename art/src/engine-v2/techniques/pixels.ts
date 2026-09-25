/**
 * Pixels (porté depuis `art/sketches/techniques/pixels.ts`) : glitch par tri de pixels. La
 * technique des nuits courtes et des journées chamboulées : **l'intensité du glitch suit le
 * manque de sommeil** (g = 1 − centile du sommeil).
 *
 *   image source : 24 bandes, une par heure ← pas de l'heure ; contraste ← pas (centile)
 *   seuil du tri des lignes ← g (plus la nuit est courte, plus l'image coule)
 *   coulures verticales, glissement des bandes horaires (× pas de l'heure), amplitude des
 *   blocs, balayage ← g
 *   blocs déplacés ← commits (3 par commit) ; décalage RVB ← vent (vitesse et direction)
 *
 * Tout le calcul se fait sur un tampon RGBA (`pixelsBuffer`, pur, sans canvas ni DOM : tests
 * en Node, Workers). Le tampon est calculé à au plus `MAX_RES` px puis agrandi sans lissage
 * (pixels nets), ce qui borne mémoire et temps à l'export. Toutes les longueurs sont des
 * fractions de la taille : même composition à toute taille. PNG seulement (pas de SVG).
 * Métrique absente : valeur neutre + `drawMissingMark` ; pas absents → profil horaire de repli.
 */
import { centile, createCanvas, drawMissingMark, fmt, fmtInt, hex, ramp, rngFor, valueNoise } from "../helpers";
import { FALLBACKS, hourlyOrFallback, weatherOrFallback } from "../input";
import type { Technique, TechniqueInput } from "../types";

/** Résolution de calcul maximale (px) ; au-delà, le tampon est agrandi sans lissage. */
export const MAX_RES = 2000;
/** Miniatures de galerie : calcul à au plus 400 px. */
export const PREVIEW_RES = 400;

/** Réglages, en unités logiques (sur 1000) sauf mention. */
export const PIXELS = {
  /** Contraste des bandes = contrastBase + contrastSpan × centile des pas. */
  contrastBase: 0.45,
  contrastSpan: 0.5,
  /** Seuil de luminance (0–255) au-dessus duquel une ligne est triée = thresholdMax − thresholdSpan × g. */
  thresholdMax: 115,
  thresholdSpan: 70,
  /** Coulures (colonnes triées à la verticale) = columnsBase + round(columnsSpan × g). */
  columnsBase: 1,
  columnsSpan: 4,
  /** Glissement maximal d'une bande horaire = tearSpan × g² (× activité de l'heure). */
  tearSpan: 260,
  /** Blocs déplacés : 3 par commit, au plus `blocksMax`. */
  blocksPerCommit: 3,
  blocksMax: 90,
  /** Décalage horizontal maximal d'un bloc = shiftBase + shiftSpan × g. */
  shiftBase: 120,
  shiftSpan: 300,
  /** Décalage RVB = (rgbBase + vent km/h / rgbDiv), dans le sens où souffle le vent. */
  rgbBase: 2,
  rgbDiv: 3,
  /** Assombrissement d'une ligne de balayage sur trois = scanBase − scanSpan × g. */
  scanBase: 0.9,
  scanSpan: 0.14,
} as const;

export interface PixelsParams {
  /** Intensité du glitch 0–1 (1 = nuit la plus courte de mes habitudes). */
  glitch: number;
  contrast: number;
  threshold: number;
  columns: number;
  /** Glissement maximal des bandes horaires (unités logiques). */
  tear: number;
  blocks: number;
  maxShift: number;
  rgbShift: number;
  /** Sens du décalage RVB (vecteur unitaire, vers où souffle le vent). */
  rgbDir: [number, number];
  scanDark: number;
  hourly: number[];
  hourlyMeasured: boolean;
}

export function pixelsParams(input: TechniqueInput): PixelsParams {
  const P = PIXELS;
  const n = input.norms;
  const w = weatherOrFallback(input.weather);
  const glitch = 1 - (n.sleep ?? 0.5);
  const hourlyMeasured = input.hourlySteps !== null && input.hourlySteps.length === 24;
  const hourly = input.day.steps === null && !hourlyMeasured ? [...FALLBACKS.hourlyShape] : hourlyOrFallback(input);
  const dir = (w.windDirDeg.value * Math.PI) / 180;
  const commits = input.day.commits;
  return {
    glitch,
    contrast: P.contrastBase + P.contrastSpan * (n.steps ?? 0.5),
    threshold: Math.round(P.thresholdMax - P.thresholdSpan * glitch),
    columns: P.columnsBase + Math.round(P.columnsSpan * glitch),
    tear: P.tearSpan * glitch * glitch,
    blocks: commits === null ? 0 : Math.min(P.blocksMax, commits * P.blocksPerCommit),
    maxShift: P.shiftBase + P.shiftSpan * glitch,
    rgbShift: P.rgbBase + w.windKmh.value / P.rgbDiv,
    // « D'où vient le vent » → sens où il souffle (x vers l'est, y vers le sud).
    rgbDir: [-Math.sin(dir), Math.cos(dir)],
    scanDark: P.scanBase - P.scanSpan * glitch,
    hourly,
    hourlyMeasured,
  };
}

/** Résolution du calcul pour un rendu de `S` px. */
export function pixelsResolution(S: number, quality: "full" | "preview" = "full"): number {
  return Math.max(1, Math.min(S, quality === "preview" ? PREVIEW_RES : MAX_RES));
}

/** Mesures d'un rendu (tests) : part des pixels passés au tri des lignes, bandes horaires déplacées. */
export interface PixelsStats {
  sortedShare?: number;
  tornBands?: number;
}

/**
 * Tampon RGBA R × R de l'œuvre (pur, déterministe). Longueurs en fractions de R.
 * Tri : clé = luminance entière × 2²⁴ + couleur, triée dans un `Float64Array` (ordre total, stable
 * d'un moteur à l'autre).
 */
export function pixelsBuffer(input: TechniqueInput, R: number, stats?: PixelsStats): Uint8ClampedArray {
  const p = pixelsParams(input);
  const f = R / 1000;
  const rng = rngFor(input, "pixels");
  const noise = valueNoise(rng.fork("noise"));
  const pal = input.palette;
  const col = ramp([pal.night, pal.colors[0], pal.colors[3], pal.colors[2], pal.colors[1], pal.colors[4]]);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = col(i / 255);
    lut[i * 3] = Math.round(c[0]); lut[i * 3 + 1] = Math.round(c[1]); lut[i * 3 + 2] = Math.round(c[2]);
  }
  const maxH = Math.max(...p.hourly, 1);
  const d = new Uint8ClampedArray(R * R * 4);

  // 1. Image source : une bande par heure.
  for (let y = 0; y < R; y++) {
    const hour = Math.min(23, Math.floor((y / R) * 24));
    const v = p.hourly[hour]! / maxH;
    const Y = y / f;
    for (let x = 0; x < R; x++) {
      const t = Math.min(1, 0.15 + p.contrast * v * (0.55 + 0.9 * noise(x / f / 140, Y / 40)) + 0.2 * (x / R));
      const k = Math.round(t * 255) * 3;
      const i = (y * R + x) * 4;
      d[i] = lut[k]!; d[i + 1] = lut[k + 1]!; d[i + 2] = lut[k + 2]!; d[i + 3] = 255;
    }
  }

  const lum = (i: number) => Math.round(0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!);
  const keyAt = (i: number) => lum(i) * 16777216 + ((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
  const writeKey = (i: number, key: number) => {
    const rgb = key % 16777216;
    d[i] = (rgb >> 16) & 255; d[i + 1] = (rgb >> 8) & 255; d[i + 2] = rgb & 255;
  };

  // 2. Tri de chaque ligne sur les segments plus clairs que le seuil.
  const minRun = Math.max(2, Math.round(4 * f));
  const buf = new Float64Array(R);
  let sorted = 0;
  for (let y = 0; y < R; y++) {
    let x = 0;
    while (x < R) {
      while (x < R && lum((y * R + x) * 4) < p.threshold) x++;
      const start = x;
      while (x < R && lum((y * R + x) * 4) >= p.threshold) x++;
      const len = x - start;
      if (len > minRun) {
        sorted += len;
        const seg = buf.subarray(0, len);
        for (let k = 0; k < len; k++) seg[k] = keyAt((y * R + start + k) * 4);
        seg.sort();
        for (let k = 0; k < len; k++) writeKey((y * R + start + k) * 4, seg[k]!);
      }
    }
  }

  if (stats) stats.sortedShare = sorted / (R * R);

  // Les blocs déplacés reprennent l'image d'avant le tri vertical (comme l'esquisse).
  const before = new Uint8ClampedArray(d);

  // 3. Coulures : colonnes triées à la verticale (du plus clair au plus sombre) sur une partie de la hauteur.
  const colRng = rng.fork("colonnes");
  for (let s = 0; s < p.columns; s++) {
    const w = Math.max(1, Math.round(colRng.range(10, 70) * f));
    const x0 = Math.min(R - w, Math.round(colRng.range(0, 930) * f));
    const y0 = Math.round(colRng.range(0, 600) * f);
    const y1 = Math.min(R, y0 + Math.max(2, Math.round(colRng.range(200, 600) * f)));
    for (let x = Math.max(0, x0); x < x0 + w; x++) {
      const seg = buf.subarray(0, y1 - y0);
      for (let y = y0; y < y1; y++) seg[y - y0] = keyAt((y * R + x) * 4);
      seg.sort();
      for (let y = y0; y < y1; y++) writeKey((y * R + x) * 4, seg[y1 - 1 - y]!);
    }
  }

  // 3 bis. Déchirures : chaque bande horaire glisse, d'autant plus que la nuit a été courte
  // et que l'heure a été active.
  const tearRng = rng.fork("dechirures");
  const row = new Uint8ClampedArray(R * 4);
  for (let h = 0; h < 24; h++) {
    const amount = p.tear * (0.3 + 0.7 * (p.hourly[h]! / maxH)) * (tearRng.next() * 2 - 1);
    const shift = Math.round(amount * f);
    if (shift === 0) continue;
    if (stats) stats.tornBands = (stats.tornBands ?? 0) + 1;
    const ya = Math.ceil((h / 24) * R), yb = Math.ceil(((h + 1) / 24) * R);
    for (let y = ya; y < yb; y++) {
      row.set(d.subarray(y * R * 4, (y + 1) * R * 4));
      for (let x = 0; x < R; x++) {
        const sx = (((x - shift) % R) + R) % R;
        d[(y * R + x) * 4] = row[sx * 4]!; d[(y * R + x) * 4 + 1] = row[sx * 4 + 1]!; d[(y * R + x) * 4 + 2] = row[sx * 4 + 2]!;
      }
    }
  }

  // 4. Blocs déplacés : 3 par commit.
  const blockRng = rng.fork("blocs");
  for (let b = 0; b < p.blocks; b++) {
    const bh = Math.max(1, Math.round(blockRng.range(6, 90) * f));
    const by = Math.min(R - bh, Math.round(blockRng.range(0, 1000 - 90) * f));
    const shift = Math.round(blockRng.range(-p.maxShift, p.maxShift) * f);
    for (let y = Math.max(0, by); y < by + bh; y++) {
      for (let x = 0; x < R; x++) {
        const sx = (((x - shift) % R) + R) % R;
        const i = (y * R + x) * 4, j = (y * R + sx) * 4;
        d[i] = before[j]!; d[i + 1] = before[j + 1]!; d[i + 2] = before[j + 2]!;
      }
    }
  }

  // 5. Décalage des canaux (rouge dans le sens du vent, bleu à l'opposé) et balayage.
  const sx = Math.round(p.rgbShift * f * p.rgbDir[0]);
  const sy = Math.round(p.rgbShift * f * p.rgbDir[1]);
  const src = new Uint8ClampedArray(d);
  const clamp = (v: number) => (v < 0 ? 0 : v >= R ? R - 1 : v);
  // Sous 1 px par ligne logique, le motif d'une ligne sur trois est remplacé par sa moyenne.
  const fine = f >= 1;
  const avgDark = 1 - (1 - p.scanDark) / 3;
  for (let y = 0; y < R; y++) {
    const dark = fine ? (Math.floor(y / f) % 3 === 0 ? p.scanDark : 1) : avgDark;
    for (let x = 0; x < R; x++) {
      const i = (y * R + x) * 4;
      d[i] = src[(clamp(y - sy) * R + clamp(x - sx)) * 4]! * dark;
      d[i + 1] = src[i + 1]! * dark;
      d[i + 2] = src[(clamp(y + sy) * R + clamp(x + sx)) * 4 + 2]! * dark;
    }
  }
  return d;
}

const neutral = (v: number | null) => (v === null ? " → valeur neutre 0,5" : "");

function markColor(input: TechniqueInput): string {
  const l = (h: string) => { const c = hex(h); return c[0] + c[1] + c[2]; };
  return l(input.palette.paper) > l(input.palette.ink) ? input.palette.paper : input.palette.ink;
}

export const pixels: Technique = {
  id: "pixels",
  family: "numerique",
  name: "Pixels",
  process: "glitch (tri de pixels)",
  ported: true,
  heavy: false,
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const R = pixelsResolution(S, options.quality ?? "full");
    const data = pixelsBuffer(input, R);
    if (R === S) {
      const img = ctx.createImageData(S, S);
      img.data.set(data);
      ctx.putImageData(img, 0, 0);
    } else {
      const { canvas, ctx: off } = createCanvas(R, R);
      const img = off.createImageData(R, R);
      img.data.set(data);
      off.putImageData(img, 0, 0);
      ctx.save();
      // Agrandi (export) : pixels nets ; réduit (miniature) : lissé.
      ctx.imageSmoothingEnabled = R > S;
      ctx.drawImage(canvas, 0, 0, S, S);
      ctx.restore();
    }
    drawMissingMark(ctx, S, input, markColor(input));
  },
  explain(input) {
    const p = pixelsParams(input);
    const n = input.norms;
    const w = weatherOrFallback(input.weather);
    const commits = input.day.commits;
    const busiest = p.hourly.indexOf(Math.max(...p.hourly));
    const dirName = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"][Math.round((((w.windDirDeg.value + 180) % 360) + 360) % 360 / 45) % 8];
    return [
      {
        param: "Intensité du glitch",
        source: `Manque de sommeil (${centile(n.sleep)}${neutral(n.sleep)})`,
        value: `${fmt(p.glitch * 100, 0)} % (1 − centile du sommeil)`,
      },
      { param: "Seuil du tri des lignes", source: "Intensité du glitch", value: `luminance ≥ ${p.threshold} / 255 (plus bas = l'image coule davantage)` },
      { param: "Coulures (colonnes triées à la verticale)", source: "Intensité du glitch", value: String(p.columns) },
      { param: "Glissement des bandes horaires", source: "Intensité du glitch × pas de l'heure", value: `jusqu'à ± ${fmtInt(p.tear)} / 1000` },
      { param: "Amplitude des blocs déplacés", source: "Intensité du glitch", value: `± ${fmtInt(p.maxShift)} / 1000` },
      { param: "Assombrissement du balayage", source: "Intensité du glitch", value: `${fmt((1 - p.scanDark) * 100, 0)} % une ligne sur trois` },
      {
        param: "Bandes de l'image source (une par heure)",
        source: p.hourlyMeasured
          ? "Pas heure par heure (haut = minuit, bas = 23 h)"
          : input.day.steps === null
            ? "Pas non mesurés → profil horaire de repli"
            : "Total des pas réparti selon le profil horaire de repli",
        value: `bande la plus vive : ${busiest} h`,
      },
      { param: "Contraste des bandes", source: `Pas (${centile(n.steps)}${neutral(n.steps)})`, value: fmt(p.contrast, 2) },
      {
        param: "Blocs déplacés",
        source: commits === null ? "Commits non mesurés" : `Commits (${commits}, ${centile(n.commits)})`,
        value: commits === null ? "aucun (donnée absente, marquée)" : `${p.blocks} (3 par commit, 90 au plus)`,
      },
      {
        param: "Décalage des canaux rouge et bleu",
        source: w.windKmh.measured ? "Vitesse et direction du vent" : "Vent : pas de météo → repli",
        value: `${fmt(p.rgbShift, 1)} / 1000, rouge poussé vers le ${dirName} (vent de ${fmtInt(w.windKmh.value)} km/h venu du ${fmtInt(w.windDirDeg.value)}°)`,
      },
      { param: "Couleurs", source: `Palette « ${input.palette.name} »`, value: "fond de nuit → accents, par luminance" },
    ];
  },
};
