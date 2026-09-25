/**
 * Miniatures du moteur v2 : chaque jour est rendu par sa technique en qualité « preview »,
 * dans un pool de Workers (OffscreenCanvas) qui renvoient directement une image WebP :
 * le fil principal ne fait qu'afficher. Même cache IndexedDB que la v1 (clé distincte).
 */
import { buildTechniqueInput, type DaySelection, type DayV2 } from "../../engine-v2";
import { createRenderer, type V2Renderer } from "../../engine-v2/render";
import type { ThumbCache } from "./cache";

export interface ThumbV2Request {
  date: string;
  size: number;
  selection: DaySelection;
  /** Empreinte des entrées (voir `inputFingerprints`) : avec le style, la clé du cache. */
  fingerprint: string;
  onReady(url: string): void;
}

export interface ThumbV2Stats {
  requested: number;
  fromCache: number;
  rendered: number;
  failed: number;
  renderer: "worker" | "main";
  firstMs: number | null;
  totalMs: number | null;
}

export class ThumbnailerV2 {
  private readonly renderer: V2Renderer;
  private readonly urls: string[] = [];
  private disposed = false;

  constructor(
    private readonly history: readonly DayV2[],
    private readonly options: { cache: ThumbCache | null; version: string; workers?: number | undefined },
  ) {
    this.renderer = createRenderer(options.workers);
  }

  private slot(r: ThumbV2Request) {
    return `v2|${r.size}|${r.date}`;
  }
  private key(r: ThumbV2Request) {
    return `${this.options.version}|${r.selection.style}|${r.fingerprint}`;
  }

  async render(requests: readonly ThumbV2Request[]): Promise<ThumbV2Stats> {
    const t0 = performance.now();
    const stats: ThumbV2Stats = { requested: requests.length, fromCache: 0, rendered: 0, failed: 0, renderer: this.renderer.kind, firstMs: null, totalMs: null };
    const deliver = (r: ThumbV2Request, blob: Blob) => {
      if (this.disposed) return;
      const url = URL.createObjectURL(blob);
      this.urls.push(url);
      stats.firstMs ??= performance.now() - t0;
      r.onReady(url);
    };
    let misses = requests.slice();
    const cache = this.options.cache;
    if (cache) {
      const hits = await cache.getMany(requests.map((r) => this.slot(r)));
      misses = [];
      for (const r of requests) {
        const hit = hits.get(this.slot(r));
        if (hit && hit.key === this.key(r)) {
          stats.fromCache++;
          deliver(r, hit.blob);
        } else misses.push(r);
      }
    }
    await Promise.all(
      misses.map(async (r) => {
        try {
          const input = buildTechniqueInput(r.date, this.history, r.selection.style);
          const blob = await this.renderer.blob(input, r.size, { type: "image/webp", quality: 0.9 }, { quality: "preview" });
          stats.rendered++;
          cache?.put(this.slot(r), { key: this.key(r), blob });
          deliver(r, blob);
        } catch (err) {
          console.warn(`miniature v2 ${r.date} : ${err instanceof Error ? err.message : String(err)}`);
          stats.failed++;
        }
      }),
    );
    stats.totalMs = performance.now() - t0;
    await cache?.flush();
    return stats;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    for (const u of this.urls) URL.revokeObjectURL(u);
  }
}
