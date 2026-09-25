/**
 * Physarum : des dizaines de milliers d'agents suivent les traces des autres et
 * tissent un réseau veineux. Nombre d'agents ← pas ; points nourriciers ←
 * commits ; angle de détection ← sommeil ; dérive ← vent.
 */
import { grain, blitField, ramp } from "../helpers";
import { day, n, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("reseau");
  const W = 500;
  const A = Math.round(25000 + 45000 * n.steps);
  const px = new Float32Array(A), py = new Float32Array(A), pa = new Float32Array(A);
  for (let i = 0; i < A; i++) {
    px[i] = rng.next() * W; py[i] = rng.next() * W;
    pa[i] = rng.next() * Math.PI * 2;
  }
  let trail = new Float32Array(W * W), tmp = new Float32Array(W * W);
  const food: [number, number][] = [];
  for (let i = 0; i < Math.max(2, day.commits ?? 2); i++) food.push([Math.floor(rng.range(0.1, 0.9) * W), Math.floor(rng.range(0.1, 0.9) * W)]);
  const SA = (22 + 23 * n.sleep) * Math.PI / 180, RA = 45 * Math.PI / 180, SD = 9, STEP = 1;
  const wa = (weather.windDirDeg * Math.PI) / 180, drift = 0.06 * weather.windKmh / 30;
  const sense = (x: number, y: number, a: number) => {
    const sx = Math.floor(x + Math.cos(a) * SD), sy = Math.floor(y + Math.sin(a) * SD);
    return trail[((sy + W) % W) * W + ((sx + W) % W)]!;
  };
  for (let it = 0; it < 150; it++) {
    for (const [fx, fy] of food) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) trail[(fy + dy) * W + fx + dx] = 40;
    for (let i = 0; i < A; i++) {
      const a = pa[i]!;
      const f = sense(px[i]!, py[i]!, a), l = sense(px[i]!, py[i]!, a - SA), r = sense(px[i]!, py[i]!, a + SA);
      let na = a;
      if (f > l && f > r) { /* tout droit */ }
      else if (f < l && f < r) na += (rng.next() < 0.5 ? -1 : 1) * RA;
      else if (l > r) na -= RA;
      else if (r > l) na += RA;
      pa[i] = na;
      let x = px[i]! + Math.cos(na) * STEP + Math.cos(wa) * drift;
      let y = py[i]! + Math.sin(na) * STEP + Math.sin(wa) * drift;
      x = (x + W) % W; y = (y + W) % W;
      px[i] = x; py[i] = y;
      trail[(y | 0) * W + (x | 0)]! += 5;
    }
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += trail[((y + dy + W) % W) * W + ((x + dx + W) % W)]!;
      tmp[y * W + x] = (s / 9) * 0.92;
    }
    [trail, tmp] = [tmp, trail];
  }
  let max = 0;
  for (let i = 0; i < W * W; i++) max = Math.max(max, trail[i]!);
  const col = ramp([palette.night, "#1c3a4a", palette.colors[0]!, palette.colors[3]!, palette.colors[2]!, "#fff4dc"]);
  const lm = Math.log(1 + max);
  blitField(ctx, S, W, (i) => col(Math.pow(Math.log(1 + trail[i]!) / lm, 1.6)));
  grain(ctx, S, rng.fork("grain"), 10);
};
export default sketch;
