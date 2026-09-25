/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_API_TOKEN?: string;
  /** Moteur v2 : premier jour de la chaîne de sélection si aucun style figé ne l'indique. */
  readonly VITE_SELECTION_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
