/**
 * Hasard déterministe. Aucune fonction du moteur ne doit appeler `Math.random`
 * ni dépendre de l'horloge : tout part de la seed dérivée de la date.
 */

/** Hash 53 bits stable d'une chaîne (cyrb53, domaine public). */
export function cyrb53(str: string, salt = 0): number {
  let h1 = 0xdeadbeef ^ salt;
  let h2 = 0x41c6ce57 ^ salt;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Seed de l'œuvre d'une journée : ne dépend que de la chaîne `YYYY-MM-DD`. */
export function seedFromDate(date: string): number {
  return cyrb53(`sillage:${date}`);
}

/** Générateur mulberry32 : renvoie un flottant dans [0, 1). */
export function mulberry32(seed: number): () => number {
  // Replie les 53 bits de la seed sur 32 bits sans perdre la partie haute.
  let a = (seed ^ Math.floor(seed / 4294967296)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Petite boîte à outils autour d'un générateur seedé. */
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Approximation gaussienne (somme de 3 uniformes), centrée sur 0, écart-type ~1. */
  gauss(): number;
  /** Sous-générateur indépendant, pour qu'ajouter un tirage ici ne décale pas les autres couches. */
  fork(label: string): Rng;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick() sur une liste vide");
      return item;
    },
    gauss: () => (next() + next() + next() - 1.5) * 2,
    fork: (label) => createRng(cyrb53(label, Math.floor(seed % 4294967296))),
  };
  return rng;
}

/**
 * Bruit de gradient 2D (Perlin « amélioré ») à permutation seedée.
 * Renvoie une valeur continue dans environ [-1, 1].
 */
export function createNoise2D(seed: number): (x: number, y: number) => number {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const grad = (h: number, x: number, y: number): number => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X]! + Y]!;
    const ab = perm[perm[X]! + Y + 1]!;
    const ba = perm[perm[X + 1]! + Y]!;
    const bb = perm[perm[X + 1]! + Y + 1]!;
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.9;
  };
}
