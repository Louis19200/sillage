import { registerRootComponent } from "expo";

// Définit la tâche de fond au chargement du JavaScript, y compris quand Android réveille
// l'app sans écran pour l'exécuter (voir src/backgroundTask.ts).
import "./src/backgroundTask";
import App from "./App";

registerRootComponent(App);
