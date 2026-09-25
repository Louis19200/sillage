/**
 * Glitch : une image source (24 bandes, une par heure, intensité ← pas de
 * l'heure) passée au tri de pixels. Seuil de tri ← sommeil ; blocs déplacés ←
 * commits ; décalage des canaux RVB ← vitesse du vent ; lignes de balayage.
 */
import { ramp, valueNoise } from "../helpers";
import { day, hourly, n, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("pixels");
  const noise = valueNoise(rng.fork("noise"));
  const col = ramp([palette.night, palette.colors[0]!, palette.colors[3]!, palette.colors[2]!, palette.colors[1]!, palette.colors[4]!]);
  const maxH = Math.max(...hourly, 1);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const hour = Math.min(23, Math.floor((y / S) * 24));
    const v = hourly[hour]! / maxH;
    for (let x = 0; x < S; x++) {
      const t = Math.min(1, 0.15 + 0.7 * v * (0.55 + 0.9 * noise(x / 140, y / 40)) + 0.2 * (x / S));
      const c = col(t);
      const i = (y * S + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  // Tri de pixels ligne par ligne sur les segments plus clairs que le seuil.
  const threshold = 45 + 70 * n.sleep;
  const lum = (i: number) => 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
  for (let y = 0; y < S; y++) {
    let x = 0;
    while (x < S) {
      while (x < S && lum((y * S + x) * 4) < threshold) x++;
      const start = x;
      while (x < S && lum((y * S + x) * 4) >= threshold) x++;
      if (x - start > 4) {
        const seg: [number, number, number, number][] = [];
        for (let k = start; k < x; k++) { const i = (y * S + k) * 4; seg.push([d[i]!, d[i + 1]!, d[i + 2]!, lum(i)]); }
        seg.sort((a, b) => a[3] - b[3]);
        seg.forEach((p, k) => { const i = (y * S + start + k) * 4; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; });
      }
    }
  }
  // Blocs déplacés : un par commit.
  const copy = new Uint8ClampedArray(d);
  // Tri vertical dans quelques colonnes.
  for (let s = 0; s < 4; s++) {
    const x0 = rng.int(0, S - 120), w = rng.int(20, 120);
    for (let x = x0; x < x0 + w; x++) {
      const col: [number, number, number, number][] = [];
      for (let y = 0; y < S; y++) { const i = (y * S + x) * 4; col.push([d[i]!, d[i + 1]!, d[i + 2]!, lum(i)]); }
      col.sort((a, b) => b[3] - a[3]);
      col.forEach((p, y) => { const i = (y * S + x) * 4; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; });
    }
  }
  for (let b = 0; b < (day.commits ?? 0) * 3; b++) {
    const bh = rng.int(6, 90), by = rng.int(0, S - bh), shift = rng.int(-320, 320);
    for (let y = by; y < by + bh; y++) for (let x = 0; x < S; x++) {
      const sx = (x - shift + S) % S;
      const i = (y * S + x) * 4, j = (y * S + sx) * 4;
      d[i] = copy[j]!; d[i + 1] = copy[j + 1]!; d[i + 2] = copy[j + 2]!;
    }
  }
  // Décalage des canaux et balayage.
  const shift = Math.round(2 + weather.windKmh / 3);
  const copy2 = new Uint8ClampedArray(d);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    d[i] = copy2[(y * S + Math.min(S - 1, x + shift)) * 4]!;
    d[i + 2] = copy2[(y * S + Math.max(0, x - shift)) * 4 + 2]!;
    if (y % 3 === 0) { d[i] *= 0.82; d[i + 1] *= 0.82; d[i + 2] *= 0.82; }
  }
  ctx.putImageData(img, 0, 0);
};
export default sketch;
