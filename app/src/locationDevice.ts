/**
 * Câblage réel de la position quotidienne : permission ACCESS_COARSE_LOCATION (seule
 * déclarée dans le manifeste), capteur via expo-location, état dans expo-secure-store.
 * La logique (arrondi, une position par jour, envoi) est dans location.ts, testée.
 *
 * Aucune coordonnée n'est loggée ni renvoyée telle quelle : `getPosition` rend la position
 * brute uniquement à location.ts, qui l'arrondit avant toute autre chose.
 */
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { PermissionsAndroid } from "react-native";

import {
  captureDailyPosition,
  disabledStore,
  locationDiagnostic,
  parseLocationStore,
  serializeLocationStore,
  type CaptureResult,
  type LocationDeps,
  type LocationPermission,
  type LocationRun,
  type LocationStore,
  type PositionMode,
} from "./location";

const KEY_LOCATION = "sillage.location";
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

/** Délai pour obtenir une position au premier plan, avant de se rabattre sur la dernière connue. */
const CURRENT_TIMEOUT_MS = 15_000;
/** Une « dernière position connue » plus ancienne ne dit rien de la journée en cours. */
const LAST_KNOWN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function loadLocationStore(): Promise<LocationStore> {
  return parseLocationStore(await SecureStore.getItemAsync(KEY_LOCATION));
}

/** Pour l'affichage : ne lève jamais (option désactivée si le stockage est illisible). */
export async function safeLoadLocationStore(): Promise<LocationStore> {
  try {
    return await loadLocationStore();
  } catch {
    return disabledStore();
  }
}

export async function saveLocationStore(store: LocationStore): Promise<void> {
  await SecureStore.setItemAsync(KEY_LOCATION, serializeLocationStore(store));
}

export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    return (await PermissionsAndroid.check(COARSE)) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

export type LocationRequestResult = "granted" | "denied" | "blocked";

/** Fenêtre Android « position approximative ». `blocked` : refusée définitivement, passer par les réglages. */
export async function requestLocationPermission(): Promise<LocationRequestResult> {
  const r = await PermissionsAndroid.request(COARSE);
  if (r === PermissionsAndroid.RESULTS.GRANTED) return "granted";
  return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

async function lastKnown(): Promise<{ latitude: number; longitude: number } | null> {
  const p = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
  return p ? { latitude: p.coords.latitude, longitude: p.coords.longitude } : null;
}

async function getPosition(mode: PositionMode): Promise<{ latitude: number; longitude: number } | null> {
  if (mode === "last-known") return lastKnown();
  try {
    // Précision basse : avec la seule permission approximative, Android ne donne de toute
    // façon qu'une position à ~2 km près, sans allumer le GPS.
    const p = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }), CURRENT_TIMEOUT_MS);
    if (p) return { latitude: p.coords.latitude, longitude: p.coords.longitude };
  } catch {
    // Localisation coupée, délai… : on tente la dernière connue.
  }
  return lastKnown();
}

export const realLocationDeps: LocationDeps = {
  loadStore: loadLocationStore,
  saveStore: saveLocationStore,
  permission: getLocationPermission,
  getPosition,
};

/** Ouverture de l'app : relève la position du jour si elle manque (aucun envoi réseau). */
export function captureOnOpen(now: Date = new Date()): Promise<CaptureResult> {
  return captureDailyPosition(realLocationDeps, "current", now, { onlyIfMissing: true });
}

/** Lignes ajoutées au diagnostic : permission et dates seulement. */
export async function locationDiagnosticLines(lastRun: LocationRun | null): Promise<string[]> {
  const [store, permission] = await Promise.all([safeLoadLocationStore(), getLocationPermission()]);
  return locationDiagnostic({ store, permission, lastRun });
}
