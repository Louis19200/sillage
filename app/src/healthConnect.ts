/**
 * Seul fichier qui parle à Health Connect. Tout le calcul est dans days.ts.
 */
import { Linking } from "react-native";
import {
  SdkAvailabilityStatus,
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  type Permission,
} from "react-native-health-connect";

import type { HealthReader, SleepSession } from "./days";

/** Paquet Play Store de Health Connect (Android 8 à 13 ; intégré au système à partir d'Android 14). */
const HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata";

export const READ_PERMISSIONS: Permission[] = [
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "SleepSession" },
];

export type Availability = "available" | "needs-install" | "unavailable";

export async function checkAvailability(): Promise<Availability> {
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
    return "needs-install";
  }
  return "unavailable";
}

/** Ouvre la fiche Play Store de Health Connect (installation ou mise à jour). */
export async function openHealthConnectInStore(): Promise<void> {
  const market =
    `market://details?id=${HEALTH_CONNECT_PACKAGE}` +
    `&url=${encodeURIComponent("healthconnect://onboarding")}`;
  try {
    await Linking.openURL(market);
  } catch {
    await Linking.openURL(`https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`);
  }
}

let initialized: Promise<boolean> | null = null;

/** `initialize()` doit précéder tout autre appel ; on ne le fait qu'une fois. */
export function ensureInitialized(): Promise<boolean> {
  if (!initialized) {
    initialized = initialize().catch((e: unknown) => {
      initialized = null;
      throw e;
    });
  }
  return initialized;
}

function hasAllReadPermissions(granted: readonly unknown[]): boolean {
  return READ_PERMISSIONS.every((wanted) =>
    granted.some(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        "recordType" in p &&
        "accessType" in p &&
        p.recordType === wanted.recordType &&
        p.accessType === wanted.accessType
    )
  );
}

export async function hasReadPermissions(): Promise<boolean> {
  await ensureInitialized();
  return hasAllReadPermissions(await getGrantedPermissions());
}

/** Ouvre la boîte de dialogue Health Connect. Renvoie `true` si pas ET sommeil sont accordés. */
export async function requestReadPermissions(): Promise<boolean> {
  await ensureInitialized();
  return hasAllReadPermissions(await requestPermission(READ_PERMISSIONS));
}

export { openHealthConnectSettings };

/** Lecteur réel, injecté dans computeHealthDays. */
export const healthConnectReader: HealthReader = {
  async aggregateSteps(start, end) {
    await ensureInitialized();
    const result = await aggregateRecord({
      recordType: "Steps",
      // Instants absolus : toISOString est correct ici (ce ne sont pas des dates calendaires).
      timeRangeFilter: {
        operator: "between",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    return { total: result.COUNT_TOTAL, dataOrigins: result.dataOrigins ?? [] };
  },

  async readSleepSessions(start, end) {
    await ensureInitialized();
    const sessions: SleepSession[] = [];
    let pageToken: string | undefined;
    do {
      const page = await readRecords("SleepSession", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const r of page.records) {
        sessions.push({ startTime: r.startTime, endTime: r.endTime });
      }
      pageToken = page.pageToken || undefined;
    } while (pageToken);
    return sessions;
  },
};
