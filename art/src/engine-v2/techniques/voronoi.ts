/**
 * Diagramme de Voronoï exact, limité à un cadre rectangulaire, par intersection de demi-plans :
 * la cellule d'un site part du cadre et est coupée par la médiatrice de chaque autre site, du plus
 * proche au plus lointain, jusqu'à ce qu'aucun site restant ne puisse encore la toucher
 * (distance > 2 × rayon de la cellule). Pur et déterministe ; O(n² log n) dans le pire cas,
 * ~2 ms pour 250 sites.
 *
 * Les cellules sont des polygones convexes, dans le sens horaire à l'écran (y vers le bas),
 * qui pavent exactement le cadre (aux erreurs d'arrondi près).
 */
export type Pt = readonly [number, number];

export interface VoronoiCell {
  /** Indice du site dans la liste d'entrée. */
  site: number;
  poly: Pt[];
}

/** Coupe un polygone convexe par le demi-plan des points plus proches de `a` que de `b`. */
function clip(poly: Pt[], ax: number, ay: number, bx: number, by: number): Pt[] {
  const nx = bx - ax, ny = by - ay;
  const c = (nx * (ax + bx) + ny * (ay + by)) / 2; // n·m
  const out: Pt[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!, q = poly[(i + 1) % n]!;
    const dp = nx * p[0] + ny * p[1] - c;
    const dq = nx * q[0] + ny * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Cellules des `sites` dans le cadre [0, w] × [0, h]. Un site en double (à moins de 1e-6) ou dont
 * la cellule ne touche pas le cadre n'a pas de cellule : il est absent du résultat.
 */
export function voronoiCells(sites: readonly Pt[], w: number, h: number): VoronoiCell[] {
  const keep: number[] = [];
  const seen = new Set<string>();
  sites.forEach(([x, y], i) => {
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
    if (!seen.has(key) && Number.isFinite(x) && Number.isFinite(y)) {
      seen.add(key);
      keep.push(i);
    }
  });
  const cells: VoronoiCell[] = [];
  for (const i of keep) {
    const [ax, ay] = sites[i]!;
    const others = keep
      .filter((j) => j !== i)
      .map((j) => ({ j, d: (sites[j]![0] - ax) ** 2 + (sites[j]![1] - ay) ** 2 }))
      .sort((p, q) => p.d - q.d || p.j - q.j);
    let poly: Pt[] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    for (const { j, d } of others) {
      let r2 = 0;
      for (const p of poly) r2 = Math.max(r2, (p[0] - ax) ** 2 + (p[1] - ay) ** 2);
      if (d > 4 * r2) break; // plus aucun site ne peut couper la cellule
      poly = clip(poly, ax, ay, sites[j]![0], sites[j]![1]);
      if (poly.length < 3) break;
    }
    // Retire les sommets confondus (coupes passant par un sommet).
    const clean: Pt[] = [];
    for (const p of poly) {
      const last = clean[clean.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) clean.push(p);
    }
    while (clean.length > 1 && Math.abs(clean[0]![0] - clean.at(-1)![0]) <= 1e-9 && Math.abs(clean[0]![1] - clean.at(-1)![1]) <= 1e-9) clean.pop();
    if (clean.length >= 3 && Math.abs(polygonArea(clean)) > 1e-9) cells.push({ site: i, poly: clean });
  }
  return cells;
}

/**
 * Arêtes intérieures (partagées par deux cellules), sans doublon et sans les bords du cadre :
 * ce sont les plombs du vitrail.
 */
export function interiorEdges(cells: readonly VoronoiCell[], w: number, h: number): [Pt, Pt][] {
  const eps = 1e-6;
  const onBorder = (p: Pt, q: Pt) =>
    (Math.abs(p[0]) < eps && Math.abs(q[0]) < eps) ||
    (Math.abs(p[0] - w) < eps && Math.abs(q[0] - w) < eps) ||
    (Math.abs(p[1]) < eps && Math.abs(q[1]) < eps) ||
    (Math.abs(p[1] - h) < eps && Math.abs(q[1] - h) < eps);
  const key = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const seen = new Set<string>();
  const out: [Pt, Pt][] = [];
  for (const c of cells) {
    for (let i = 0; i < c.poly.length; i++) {
      const p = c.poly[i]!, q = c.poly[(i + 1) % c.poly.length]!;
      if (onBorder(p, q)) continue;
      if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 1e-6) continue;
      const kp = key(p), kq = key(q);
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([p, q]);
    }
  }
  return out;
}
