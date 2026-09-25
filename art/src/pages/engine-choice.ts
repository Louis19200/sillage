/**
 * Choix du moteur affiché (v1 = Marée pour tous les jours, v2 = une technique par jour).
 * Priorité : `?engine=v1|v2` dans l'URL, puis le dernier choix mémorisé (localStorage, protégé :
 * navigation privée ou stockage bloqué ne cassent rien), puis v2 pour une première visite.
 */
export type Engine = "v1" | "v2";
export const DEFAULT_ENGINE: Engine = "v2";
const KEY = "sillage.engine";

function isEngine(v: unknown): v is Engine {
  return v === "v1" || v === "v2";
}

export function readStoredEngine(): Engine | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return isEngine(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeEngine(engine: Engine): void {
  try {
    globalThis.localStorage?.setItem(KEY, engine);
  } catch {
    /* stockage indisponible : le choix vaut pour cette page seulement */
  }
}

export function currentEngine(search: string = globalThis.location?.search ?? ""): Engine {
  const asked = new URLSearchParams(search).get("engine");
  if (isEngine(asked)) {
    storeEngine(asked);
    return asked;
  }
  return readStoredEngine() ?? DEFAULT_ENGINE;
}

/** Sélecteur « v1 · v2 » : deux liens, le courant marqué `aria-current`. */
export function mountEngineSwitch(container: HTMLElement, current: Engine): void {
  container.replaceChildren();
  container.classList.add("engine-switch");
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Moteur");
  const titles: Record<Engine, string> = {
    v1: "Moteur v1 : la même technique (Marée) pour tous les jours",
    v2: "Moteur v2 : une technique parmi dix, choisie par les données du jour",
  };
  for (const engine of ["v1", "v2"] as const) {
    const a = document.createElement("a");
    const url = new URL(window.location.href);
    url.searchParams.set("engine", engine);
    a.href = url.pathname + url.search;
    a.textContent = engine;
    a.title = titles[engine];
    if (engine === current) a.setAttribute("aria-current", "true");
    a.addEventListener("click", () => storeEngine(engine));
    container.append(a);
  }
}
