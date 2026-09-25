/**
 * Écrit la résolution d'impression dans un PNG (bloc `pHYs`), pour qu'un 4000 px
 * s'ouvre en 33,9 cm à 300 dpi dans un logiciel d'impression au lieu de 141 cm à 72 dpi.
 * Pur (octets → octets), sans DOM : partagé par l'export navigateur et le script Node.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(png: Uint8Array): boolean {
  return png.length > 33 && SIGNATURE.every((b, i) => png[i] === b);
}

/** Lit la résolution (dpi arrondi) d'un PNG, `null` s'il n'a pas de bloc `pHYs` en mètres. */
export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "pHYs" && length === 9 && png[at + 16] === 1) {
      return Math.round(view.getUint32(at + 8) * 0.0254);
    }
    if (type === "IDAT" || type === "IEND") return null;
    at += 12 + length;
  }
  return null;
}

/** Renvoie une copie du PNG avec un bloc `pHYs` à `dpi`, remplaçant celui qui existerait. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error("setPngDpi : ce n'est pas un PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8); // signature + bloc IHDR (toujours en premier)

  // Retire un éventuel pHYs existant.
  const parts: Uint8Array[] = [png.subarray(0, ihdrEnd)];
  let at = ihdrEnd;
  let rest = at;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "pHYs") {
      parts.push(png.subarray(rest, at));
      rest = at + 12 + length;
    }
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  const tail = png.subarray(rest);

  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const c = new DataView(chunk.buffer);
  c.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  c.setUint32(8, ppm);
  c.setUint32(12, ppm);
  chunk[16] = 1; // unité : mètre
  c.setUint32(17, crc32(chunk.subarray(4, 17)));

  const head = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(head + chunk.length + tail.length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  out.set(chunk, o);
  out.set(tail, o + chunk.length);
  return out;
}
