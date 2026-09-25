/**
 * Croissance par colonisation de l'espace : des branches poussent vers des
 * « nutriments » semés au hasard. Nombre de nutriments ← pas ; nombre de
 * racines ← commits ; inclinaison de la pousse ← vent ; épaisseur ← sommeil.
 */
import { grain, hex, css, mix } from "../helpers";
import { day, n, palette, rngFor, weather, type Sketch } from "../day";

interface Node { x: number; y: number; parent: number; dx: number; dy: number; cnt: number; leaves: number; }

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("corail");
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, S, S);

  // Nutriments dans une couronne ovale, plus dense vers le haut.
  const A = Math.round(900 + 1800 * n.steps);
  const attractors: { x: number; y: number; alive: boolean }[] = [];
  while (attractors.length < A) {
    const x = rng.range(0.06, 0.94) * S, y = rng.range(0.05, 0.8) * S;
    const dx = (x - S / 2) / (S * 0.46), dy = (y - S * 0.46) / (S * 0.42);
    if (dx * dx + dy * dy < 1) attractors.push({ x, y, alive: true });
  }
  const roots = Math.max(1, Math.min(5, Math.round((day.commits ?? 3) / 4)));
  const nodes: Node[] = [];
  for (let r = 0; r < roots; r++) {
    const x = S * (0.5 + (r - (roots - 1) / 2) * 0.12);
    nodes.push({ x, y: S * 0.97, parent: -1, dx: 0, dy: 0, cnt: 0, leaves: 0 });
  }
  const influence = 70, kill = 9, step = 6;
  const wa = (weather.windDirDeg * Math.PI) / 180;
  const wind = { x: Math.sin(wa) * 0.25 * (weather.windKmh / 30), y: 0 };

  const cell = influence;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(x / cell) * 10007 + Math.floor(y / cell);
  const add = (i: number) => {
    const k = key(nodes[i]!.x, nodes[i]!.y);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  };
  nodes.forEach((_, i) => add(i));
  const trunks = nodes.map((_, i) => i);

  for (let iter = 0; iter < 500; iter++) {
    let grew = false;
    for (const nd of nodes) { nd.dx = 0; nd.dy = 0; nd.cnt = 0; }
    for (const a of attractors) {
      if (!a.alive) continue;
      let best = -1, bd = influence * influence;
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const i of grid.get(gx * 10007 + gy) ?? []) {
          const nd = nodes[i]!;
          const d = (nd.x - a.x) ** 2 + (nd.y - a.y) ** 2;
          if (d < kill * kill) { a.alive = false; }
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (!a.alive || best < 0) continue;
      const nd = nodes[best]!;
      const len = Math.sqrt(bd) || 1;
      nd.dx += (a.x - nd.x) / len; nd.dy += (a.y - nd.y) / len; nd.cnt++;
    }
    const count = nodes.length;
    for (let i = 0; i < count; i++) {
      const nd = nodes[i]!;
      if (nd.cnt === 0) continue;
      let dx = nd.dx / nd.cnt + wind.x + (rng.next() - 0.5) * 0.25;
      let dy = nd.dy / nd.cnt - 0.08;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      nodes.push({ x: nd.x + dx * step, y: nd.y + dy * step, parent: i, dx: 0, dy: 0, cnt: 0, leaves: 0 });
      add(nodes.length - 1);
      grew = true;
    }
    // Troncs : chacun monte tant qu'aucun nutriment n'est à sa portée.
    for (let t = 0; t < trunks.length; t++) {
      const i = trunks[t]!;
      if (i < 0) continue;
      const tip = nodes[i]!;
      if (tip.cnt > 0) { trunks[t] = -1; continue; }
      nodes.push({ x: tip.x + wind.x * step * 0.5, y: tip.y - step, parent: i, dx: 0, dy: 0, cnt: 0, leaves: 0 });
      add(nodes.length - 1);
      trunks[t] = nodes.length - 1;
      grew = true;
    }
    if (!grew) break;
  }

  // Modèle des tuyaux : épaisseur ∝ racine du nombre de pointes en aval.
  const hasChild = new Uint8Array(nodes.length);
  nodes.forEach((nd) => { if (nd.parent >= 0) hasChild[nd.parent] = 1; });
  for (let i = nodes.length - 1; i >= 0; i--) {
    const nd = nodes[i]!;
    if (!hasChild[i]) nd.leaves += 1;
    if (nd.parent >= 0) nodes[nd.parent]!.leaves += nd.leaves;
  }
  const ink = hex(palette.ink), warm = hex(palette.colors[1]!), teal = hex(palette.colors[0]!);
  ctx.lineCap = "round";
  const thick = 0.45 + 0.5 * n.sleep;
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i]!;
    if (nd.parent < 0) continue;
    const p = nodes[nd.parent]!;
    const w = Math.min(28, thick * Math.pow(nd.leaves, 0.62));
    const t = Math.min(1, 1 - nd.y / S);
    ctx.strokeStyle = css(mix(mix(ink, teal, t * 0.8), warm, Math.max(0, 1 - nd.leaves / 3) * 0.6));
    ctx.lineWidth = Math.max(0.6, w);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nd.x, nd.y); ctx.stroke();
  }
  // Bourgeons aux pointes.
  for (let i = 0; i < nodes.length; i++) {
    if (hasChild[i] || rng.next() > 0.35) continue;
    const nd = nodes[i]!;
    ctx.fillStyle = css(hex(palette.colors[rng.int(1, 4)]!), 0.85);
    ctx.beginPath(); ctx.arc(nd.x, nd.y, rng.range(1.5, 3.8), 0, Math.PI * 2); ctx.fill();
  }
  grain(ctx, S, rng.fork("grain"), 12);
};
export default sketch;
