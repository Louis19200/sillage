/**
 * Compose des Scenes hors du fil principal. Le moteur pur (`engine/index.ts`) n'importe
 * pas p5, il tourne tel quel dans un worker. Le dessin reste sur le fil principal
 * (le rendu canvas du moteur vit dans `render-p5.ts`, qui charge p5, inutilisable ici).
 *
 * La Scene repart en JSON : une chaîne se transfère sans coût et `JSON.parse` est ~3×
 * plus rapide que le clonage structuré d'un objet fait de milliers de petits tableaux.
 */
import { composeForDate, type DayInput } from "../../engine";
import type { ToWorker, FromWorker } from "./worker-protocol";

// Pas de lib « webworker » dans ce tsconfig (conflit avec « DOM ») : on type le strict nécessaire.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
};

let history: DayInput[] = [];

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "history") {
    history = msg.days;
    return;
  }
  const t0 = performance.now();
  let reply: FromWorker;
  try {
    const json = JSON.stringify(composeForDate(msg.date, history));
    reply = { type: "scene", id: msg.id, date: msg.date, json, ms: performance.now() - t0 };
  } catch (err) {
    reply = { type: "error", id: msg.id, date: msg.date, message: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
