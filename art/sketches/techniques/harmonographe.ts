/**
 * Harmonographe : quatre pendules amortis tracent une seule ligne. Rapports de
 * fréquences ← pas et commits (légèrement désaccordés par le sommeil) ;
 * amortissement ← sommeil ; rotation ← vent ; couleur ← temps qui passe.
 */
import { grain, ramp, css } from "../helpers";
import { n, palette, rngFor, weather, type Sketch } from "../day";

const RATIOS = [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 5]];

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("harmonographe");
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, S, S);
  const [p, q] = RATIOS[Math.min(RATIOS.length - 1, Math.floor(n.steps * RATIOS.length))]!;
  const [r, s] = RATIOS[Math.min(RATIOS.length - 1, Math.floor(n.commits * RATIOS.length))]!;
  const detune = 0.004 + 0.012 * (1 - n.sleep);
  const f = [p!, q! + detune, r! + detune * 0.7, s!];
  const ph = [0, rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI)];
  const damp = 0.0009 + 0.0022 * (1 - n.sleep);
  const rot = (weather.windDirDeg * Math.PI) / 180;
  const col = ramp([palette.colors[0]!, palette.colors[3]!, palette.colors[2]!, palette.colors[1]!, palette.colors[4]!]);

  const R = S * 0.185;
  const T = 900, dt = 0.012;
  ctx.lineWidth = 0.7;
  let prev: [number, number] | null = null;
  const seg = 400;
  let pts: [number, number][] = [];
  for (let t = 0, i = 0; t < T; t += dt, i++) {
    const e = Math.exp(-damp * t);
    const x = R * e * (Math.sin(f[0]! * t + ph[0]!) + Math.sin(f[2]! * t + ph[2]!));
    const y = R * e * (Math.sin(f[1]! * t + ph[1]!) + Math.sin(f[3]! * t + ph[3]!));
    const X = S / 2 + x * Math.cos(rot) - y * Math.sin(rot);
    const Y = S / 2 + x * Math.sin(rot) + y * Math.cos(rot);
    pts.push([X, Y]);
    if (pts.length === seg) {
      ctx.strokeStyle = css(col(t / T), 0.55);
      ctx.beginPath();
      if (prev) ctx.moveTo(prev[0], prev[1]); else ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const pt of pts) ctx.lineTo(pt[0], pt[1]);
      ctx.stroke();
      prev = pts[pts.length - 1]!;
      pts = [];
    }
  }
  grain(ctx, S, rng.fork("grain"), 12);
};
export default sketch;
