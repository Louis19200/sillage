/**
 * Attracteur de Clifford : x' = sin(a·y) + c·cos(a·x), y' = sin(b·x) + d·cos(b·y).
 * a ← pas, b ← sommeil, c ← commits, d ← nuages. Un petit écart de données
 * donne une forme radicalement différente. Couleur ← direction du mouvement.
 */
import { hex, mix, grain, type RGB } from "../helpers";
import { n, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("attracteur");
  const a = -1.25 - 0.8 * n.steps + (rng.next() - 0.5) * 0.08;
  const b = 1.35 + 0.6 * n.sleep;
  const c = 0.55 + 0.9 * n.commits;
  const d = 0.35 + 0.9 * weather.cloud;

  const N = S * S;
  const count = new Float32Array(N);
  const r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N);
  const cols = palette.colors.map(hex);
  const colorAt = (ang: number): RGB => {
    const t = ((ang / (2 * Math.PI)) % 1 + 1) % 1 * cols.length;
    const i = Math.floor(t);
    return mix(cols[i % cols.length]!, cols[(i + 1) % cols.length]!, t - i);
  };

  let x = 0.1, y = 0.1;
  // Bornes approximatives du nuage.
  const pts: number[] = [];
  for (let i = 0; i < 20000; i++) {
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
  const span = Math.max(maxX - minX, maxY - minY) * 1.12;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  for (let i = 0; i < 6_000_000; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    const px = Math.floor(((nx - cx) / span + 0.5) * S);
    const py = Math.floor(((ny - cy) / span + 0.5) * S);
    if (px >= 0 && py >= 0 && px < S && py < S) {
      const k = py * S + px;
      const col = colorAt(Math.atan2(ny - y, nx - x));
      count[k]! += 1; r[k]! += col[0]; g[k]! += col[1]; bl[k]! += col[2];
    }
    x = nx; y = ny;
  }

  let max = 0;
  for (let i = 0; i < N; i++) if (count[i]! > max) max = count[i]!;
  const bg = hex(palette.night);
  const img = ctx.createImageData(S, S);
  const lm = Math.log(1 + max);
  for (let i = 0; i < N; i++) {
    const cnt = count[i]!;
    const v = cnt > 0 ? Math.pow(Math.log(1 + cnt) / lm, 0.55) : 0;
    const avg: RGB = cnt > 0 ? [r[i]! / cnt, g[i]! / cnt, bl[i]! / cnt] : bg;
    const lit = mix(avg, [250, 244, 230], Math.max(0, v - 0.75) * 2);
    const out = mix(bg, lit, Math.min(1, v * 1.15));
    img.data[i * 4] = out[0]; img.data[i * 4 + 1] = out[1]; img.data[i * 4 + 2] = out[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grain(ctx, S, rng.fork("grain"), 8);
};
export default sketch;
