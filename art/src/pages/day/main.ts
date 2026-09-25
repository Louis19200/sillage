/**
 * Page d'une journée : `?date=YYYY-MM-DD` (et `&engine=v1|v2`).
 * Le moteur est chargé à la demande : la v2 ne télécharge pas p5, la v1 n'a pas le moteur v2.
 */
import { dataSourceFromEnv } from "../../data";
import { currentEngine, mountEngineSwitch } from "../engine-choice";
import { $, showError } from "./shared";

const engine = currentEngine();
document.body.dataset.engine = engine;
mountEngineSwitch($("engine"), engine);

try {
  const source = dataSourceFromEnv();
  const run = engine === "v1" ? import("./v1").then((m) => m.runV1(source)) : import("./v2").then((m) => m.runV2(source));
  run.catch(showError);
} catch (err) {
  showError(err);
}
