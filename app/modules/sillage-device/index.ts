/**
 * Module natif local (voir android/…/SillageDeviceModule.kt). Optionnel : dans un APK construit
 * sans lui, chaque fonction renvoie `unknown` / `null` au lieu de planter.
 */
import { requireOptionalNativeModule } from "expo";

export type BackgroundReadFeature = "available" | "unavailable" | "sdk-unavailable" | "unknown";

interface SillageDeviceNative {
  backgroundReadFeature(): string;
  isIgnoringBatteryOptimizations(): boolean | null;
  isBackgroundRestricted(): boolean | null;
}

const native = requireOptionalNativeModule<SillageDeviceNative>("SillageDevice");

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** La version installée de Health Connect permet-elle la lecture en arrière-plan ? */
export function backgroundReadFeature(): BackgroundReadFeature {
  if (!native) return "unknown";
  const v = safe(() => native.backgroundReadFeature(), "unknown");
  return v === "available" || v === "unavailable" || v === "sdk-unavailable" ? v : "unknown";
}

export function isIgnoringBatteryOptimizations(): boolean | null {
  return native ? safe(() => native.isIgnoringBatteryOptimizations(), null) : null;
}

export function isBackgroundRestricted(): boolean | null {
  return native ? safe(() => native.isBackgroundRestricted(), null) : null;
}
