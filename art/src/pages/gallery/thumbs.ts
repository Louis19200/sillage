/**
 * Fabrique de miniatures.
 *
 * 1. Cache (IndexedDB) : une miniature dont l'empreinte (version du code + J et ses 90 jours
 *    de référence) n'a pas changé s'affiche sans rien recomposer.
 * 2. Composition dans un pool de Web Workers (le moteur pur n'a pas besoin du DOM) :
 *    ~16 à 25 ms par Scene, en parallèle, hors du fil principal.
 * 3. Dessin sur le fil principal, par le rendu du moteur (`drawSceneToContext`), sur **un seul**
 *    canvas hors écran à la taille de la miniature, converti en image (`toBlob` → URL).
 *    Par tranches de ~12 ms entre lesquelles le navigateur peint et répond : l'onglet ne gèle pas.
 */
import type { DayInput } from "../../engine";
import { drawSceneToContext } from "../../engine/render-p5";
import type { Scene } from "../../engine/scene";
import type { ThumbCache } from "./cache";
import type { FromWorker, ToWorker } from "./worker-protocol";

export interface ThumbRequest {
  date: string;
  /** Côté en pixels réels de l'image produite. */
  size: number;
  /** Empreinte des entrées (voir `inputFingerprints`). */
  fingerprint: string;
  onReady(url: string): void;
}

export interface ThumbStats {
  requested: number;
  fromCache: number;
  composed: number;
  failed: number;
  workers: number;
  /** ms depuis `render()` jusqu'à la première / dernière miniature affichée. */
  firstMs: number | null;
  totalMs: number | null;
  /** Temps moyen de composition dans un worker. */
  composeAvgMs: number;
  /** Temps moyen sur le fil principal par miniature composée (JSON.parse + dessin + toBlob). */
  mainAvgMs: number;
  /** Plus longue tranche de travail continue sur le fil principal. */
  longestSliceMs: number;
}

const SLICE_MS = 12;
const PER_WORKER = 2;
const THUMB_TYPE = "image/webp";
const THUMB_QUALITY = 0.9;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

export function defaultWorkerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(6, cores - 1));
}

interface Pending {
  req: ThumbRequest;
  id: number;
}

export class Thumbnailer {
  private readonly workers: Worker[] = [];
  /** Travaux envoyés à chaque worker, dans l'ordre où il les traitera. */
  private readonly assigned = new Map<Worker, Pending[]>();
  private queue: Pending[] = [];
  private drawQueue: { pending: Pending; json: string }[] = [];
  private draining = false;
  private readonly urls: string[] = [];
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private nextId = 1;
  private t0 = 0;
  private remaining = 0;
  private composeMsSum = 0;
  private mainMsSum = 0;
  private disposed = false;
  private resolveDone: (() => void) | null = null;
  readonly stats: ThumbStats;

  constructor(
    history: readonly DayInput[],
    private readonly options: { cache: ThumbCache | null; version: string; workers?: number },
  ) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponible");
    this.ctx = ctx;
    const count = options.workers ?? defaultWorkerCount();
    const init: ToWorker = { type: "history", days: history.slice() };
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL("./compose.worker.ts", import.meta.url), { type: "module", name: `sillage-compose-${i}` });
      w.onmessage = (e: MessageEvent<FromWorker>) => this.onWorkerMessage(w, e.data);
      w.onerror = (e) => {
        e.preventDefault();
        this.failWorker(w, e.message);
      };
      w.postMessage(init);
      this.workers.push(w);
      this.assigned.set(w, []);
    }
    this.stats = {
      requested: 0, fromCache: 0, composed: 0, failed: 0, workers: count,
      firstMs: null, totalMs: null, composeAvgMs: 0, mainAvgMs: 0, longestSliceMs: 0,
    };
  }

  private cacheKey(req: ThumbRequest): string {
    return `${this.options.version}|${req.fingerprint}`;
  }

  private slot(req: ThumbRequest): string {
    return `${req.size}|${req.date}`;
  }

  /** Rend toutes les miniatures demandées, dans l'ordre donné (le haut de la page d'abord). */
  async render(requests: readonly ThumbRequest[]): Promise<ThumbStats> {
    this.t0 = performance.now();
    this.stats.requested = requests.length;
    this.remaining = requests.length;
    if (requests.length === 0) return this.finish();
    const done = new Promise<void>((resolve) => (this.resolveDone = resolve));

    let misses = requests.slice();
    const cache = this.options.cache;
    if (cache) {
      const hits = await cache.getMany(requests.map((r) => this.slot(r)));
      misses = [];
      for (const req of requests) {
        const hit = hits.get(this.slot(req));
        if (hit && hit.key === this.cacheKey(req)) {
          this.stats.fromCache++;
          this.deliver(req, URL.createObjectURL(hit.blob));
        } else {
          misses.push(req);
        }
      }
    }
    this.queue = misses.map((req) => ({ req, id: this.nextId++ }));
    this.pump();
    await done;
    const stats = this.finish();
    // Les dernières images partent en base avant de rendre la main (visite suivante complète).
    await cache?.flush();
    return stats;
  }

  private finish(): ThumbStats {
    const s = this.stats;
    s.composeAvgMs = s.composed ? this.composeMsSum / s.composed : 0;
    s.mainAvgMs = s.composed ? this.mainMsSum / s.composed : 0;
    if (s.totalMs === null) s.totalMs = performance.now() - this.t0;
    return s;
  }

  private deliver(req: ThumbRequest, url: string | null): void {
    if (this.disposed) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    if (url) {
      this.urls.push(url);
      if (this.stats.firstMs === null) this.stats.firstMs = performance.now() - this.t0;
      req.onReady(url);
    }
    if (--this.remaining === 0) {
      this.stats.totalMs = performance.now() - this.t0;
      this.resolveDone?.();
    }
  }

  /**
   * Remplit chaque worker jusqu'à `PER_WORKER` travaux : le suivant attend déjà dans sa file
   * pendant que le fil principal dessine, le worker ne chôme jamais. La file globale reste
   * dans l'ordre d'affichage.
   */
  private pump(): void {
    for (const [w, jobs] of this.assigned) {
      while (jobs.length < PER_WORKER && this.queue.length > 0) {
        const pending = this.queue.shift()!;
        jobs.push(pending);
        const msg: ToWorker = { type: "compose", id: pending.id, date: pending.req.date };
        w.postMessage(msg);
      }
    }
    // Plus aucun worker vivant : ce qui reste ne sera jamais composé.
    if (this.assigned.size === 0) {
      for (const pending of this.queue.splice(0)) {
        this.stats.failed++;
        this.deliver(pending.req, null);
      }
    }
  }

  private onWorkerMessage(w: Worker, msg: FromWorker): void {
    if (this.disposed) return;
    const jobs = this.assigned.get(w) ?? [];
    const at = jobs.findIndex((j) => j.id === msg.id);
    const pending = at >= 0 ? jobs.splice(at, 1)[0] : undefined;
    this.pump();
    if (!pending) return;
    if (msg.type === "error") {
      console.warn(`miniature ${msg.date} : ${msg.message}`);
      this.stats.failed++;
      this.deliver(pending.req, null);
      return;
    }
    this.composeMsSum += msg.ms;
    this.drawQueue.push({ pending, json: msg.json });
    void this.drain();
  }

  /** Erreur hors composition (chargement du worker…) : ses travaux repartent dans la file. */
  private failWorker(w: Worker, message: string): void {
    console.warn(`worker de composition hors service : ${message}`);
    const jobs = this.assigned.get(w) ?? [];
    this.assigned.delete(w);
    w.terminate();
    this.queue.unshift(...jobs);
    this.pump();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.drawQueue.length > 0 && !this.disposed) {
        const sliceStart = performance.now();
        while (this.drawQueue.length > 0 && performance.now() - sliceStart < SLICE_MS) {
          const { pending, json } = this.drawQueue.shift()!;
          const t = performance.now();
          this.drawOne(pending.req, JSON.parse(json) as Scene);
          this.mainMsSum += performance.now() - t;
        }
        this.stats.longestSliceMs = Math.max(this.stats.longestSliceMs, performance.now() - sliceStart);
        await yieldToMain();
      }
    } finally {
      this.draining = false;
    }
  }

  private drawOne(req: ThumbRequest, scene: Scene): void {
    const { canvas, ctx } = this;
    if (canvas.width !== req.size) {
      canvas.width = req.size;
      canvas.height = req.size;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, req.size, req.size);
    drawSceneToContext(ctx, scene, req.size);
    this.stats.composed++;
    // toBlob copie l'image tout de suite : le canvas peut resservir aussitôt.
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          this.stats.failed++;
          this.deliver(req, null);
          return;
        }
        this.options.cache?.put(this.slot(req), { key: this.cacheKey(req), blob });
        this.deliver(req, URL.createObjectURL(blob));
      },
      THUMB_TYPE,
      THUMB_QUALITY,
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.queue = [];
    this.drawQueue = [];
  }
}
