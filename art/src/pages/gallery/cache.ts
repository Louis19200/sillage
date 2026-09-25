/**
 * Cache persistant des miniatures (IndexedDB), propre à ce navigateur.
 * Une entrée par (taille, date) : on écrase quand l'empreinte change, donc le cache
 * ne grossit pas au fil des mises à jour (au plus une image par jour et par taille).
 * Toute erreur (navigation privée, quota, IndexedDB bloqué) rend le cache inactif, sans plus.
 */

export interface CachedThumb {
  /** Version du code + empreinte des données : l'image n'est valide que si elle est égale. */
  key: string;
  blob: Blob;
}

export interface ThumbCache {
  getMany(slots: readonly string[]): Promise<Map<string, CachedThumb>>;
  /** Mis en attente, écrit par lots (une transaction pour beaucoup d'images). */
  put(slot: string, value: CachedThumb): void;
  /** Écrit ce qui attend ; résolu quand la transaction est validée (ou a échoué). */
  flush(): Promise<void>;
}

const BATCH = 48;
const BATCH_DELAY_MS = 400;

const DB_NAME = "sillage-gallery";
const STORE = "thumbs";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function openThumbCache(): Promise<ThumbCache | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    const db = await request(open);
    let pending: [string, CachedThumb][] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writing: Promise<void> = Promise.resolve();

    const flush = (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending.length === 0) return writing;
      const batch = pending;
      pending = [];
      writing = writing.then(
        () =>
          new Promise<void>((resolve) => {
            try {
              const tx = db.transaction(STORE, "readwrite");
              const store = tx.objectStore(STORE);
              for (const [slot, value] of batch) store.put(value, slot);
              tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
            } catch {
              resolve(); // quota ou base fermée : tant pis pour le cache
            }
          }),
      );
      return writing;
    };

    return {
      flush,
      async getMany(slots) {
        const out = new Map<string, CachedThumb>();
        try {
          const store = db.transaction(STORE, "readonly").objectStore(STORE);
          const values = await Promise.all(slots.map((s) => request(store.get(s) as IDBRequest<CachedThumb | undefined>)));
          values.forEach((v, i) => {
            if (v && typeof v.key === "string" && v.blob instanceof Blob) out.set(slots[i]!, v);
          });
        } catch {
          /* cache illisible : on recompose */
        }
        return out;
      },
      put(slot, value) {
        pending.push([slot, value]);
        if (pending.length >= BATCH) void flush();
        else timer ??= setTimeout(() => void flush(), BATCH_DELAY_MS);
      },
    };
  } catch {
    return null;
  }
}
