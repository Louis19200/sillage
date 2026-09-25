/**
 * Réaction-diffusion (Gray-Scott) : deux « substances » qui se nourrissent et
 * s'inhibent. Le régime (labyrinthe, taches, corail, vers) ← pas ; les germes ← commits ;
 * la diffusion ← sommeil ; l'étirement ← direction du vent.
 */
import { grain, blitField, ramp } from "../helpers";
import { day, n, palette, rngFor, weather, type Sketch } from "../day";

// Régimes vérifiés un par un (Du = 1, Dv = 0,5) : chacun donne un motif stable.
const REGIMES = [
  { F: 0.029, k: 0.057 }, // labyrinthe
  { F: 0.042, k: 0.063 }, // vers
  { F: 0.0545, k: 0.062 }, // corail
  { F: 0.022, k: 0.051 }, // rayures
];

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("pelage");
  const W = 340;
  const reg = REGIMES[Math.min(3, Math.floor(n.steps * 4))]!;
  const F = reg.F + (rng.next() - 0.5) * 0.0015;
  const k = reg.k + (n.sleep - 0.5) * 0.001;
  const Du = 1.0, Dv = 0.5;
  // Diffusion anisotrope dans l'axe du vent.
  const wa = (weather.windDirDeg * Math.PI) / 180;
  const ax = Math.abs(Math.cos(wa)), ay = Math.abs(Math.sin(wa));
  const wx = 0.2 * (1 + 0.25 * (ax - ay)), wy = 0.2 * (1 + 0.25 * (ay - ax));

  let U = new Float32Array(W * W).fill(1), V = new Float32Array(W * W);
  let U2 = new Float32Array(W * W), V2 = new Float32Array(W * W);
  const germs = Math.max(3, Math.min(30, (day.commits ?? 4) + 3));
  for (let s = 0; s < germs; s++) {
    const gx = Math.floor(rng.range(0.1, 0.9) * W), gy = Math.floor(rng.range(0.1, 0.9) * W);
    const r = rng.int(3, 7);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const i = ((gy + y + W) % W) * W + ((gx + x + W) % W);
      V[i] = 0.5 + rng.next() * 0.2; U[i] = 0.5;
    }
  }
  for (let it = 0; it < 7000; it++) {
    for (let y = 0; y < W; y++) {
      const ym = ((y - 1 + W) % W) * W, yp = ((y + 1) % W) * W, yc = y * W;
      for (let x = 0; x < W; x++) {
        const xm = (x - 1 + W) % W, xp = (x + 1) % W;
        const i = yc + x;
        const u = U[i]!, v = V[i]!;
        const lu = wx * (U[yc + xm]! + U[yc + xp]!) + wy * (U[ym + x]! + U[yp + x]!) +
          0.05 * (U[ym + xm]! + U[ym + xp]! + U[yp + xm]! + U[yp + xp]!) - u;
        const lv = wx * (V[yc + xm]! + V[yc + xp]!) + wy * (V[ym + x]! + V[yp + x]!) +
          0.05 * (V[ym + xm]! + V[ym + xp]! + V[yp + xm]! + V[yp + xp]!) - v;
        const uvv = u * v * v;
        U2[i] = u + Du * lu - uvv + F * (1 - u);
        V2[i] = v + Dv * lv + uvv - (F + k) * v;
      }
    }
    [U, U2] = [U2, U];
    [V, V2] = [V2, V];
  }
  const col = ramp([palette.paper, palette.colors[2]!, palette.colors[1]!, palette.colors[4]!, palette.night]);
  blitField(ctx, S, W, (i) => col(Math.min(1, V[i]! * 3.2)));
  grain(ctx, S, rng.fork("grain"), 10);
};
export default sketch;
