/**
 * Seul fichier qui parle à Health Connect. Tout le calcul est dans days.ts.
 */
import { Linking, Platform } from "react-native";
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

/**
 * Diagnostic lisible par l'utilisateur : ce que Health Connect renvoie vraiment à l'app,
 * sans calcul de journées. Chaque vérification est isolée : une erreur n'empêche pas les autres.
 * Aucune donnée n'est envoyée nulle part.
 */
export async function runDiagnostic(now: Date = new Date()): Promise<string[]> {
  const lines: string[] = [];
  const step = async (label: string, fn: () => Promise<string>) => {
    try {
      lines.push(`${label} : ${await fn()}`);
    } catch (e) {
      lines.push(`${label} : ERREUR ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const origins = (list: readonly (string | undefined)[]) => {
    const set = [...new Set(list.filter((x): x is string => !!x))];
    return set.length > 0 ? set.join(", ") : "aucune";
  };
  const since = (days: number) => ({
    operator: "between" as const,
    startTime: new Date(now.getTime() - days * 86_400_000).toISOString(),
    endTime: now.toISOString(),
  });

  lines.push(`Android ${String(Platform.Version)}`);
  await step("Health Connect", async () => String(await getSdkStatus()) + " (3 = disponible)");
  await step("Initialisation", async () => String(await ensureInitialized()));
  await step("Autorisations accordées", async () => {
    const granted = await getGrantedPermissions();
    return granted.length === 0
      ? "aucune"
      : granted.map((p) => `${p.accessType}:${p.recordType}`).join(", ");
  });
  for (const days of [7, 30]) {
    await step(`Pas, enregistrements sur ${days} j`, async () => {
      const page = await readRecords("Steps", { timeRangeFilter: since(days), pageSize: 5000 });
      const total = page.records.reduce((sum, r) => sum + r.count, 0);
      return `${page.records.length} enregistrement(s), total ${total} pas, applis : ${origins(page.records.map((r) => r.metadata?.dataOrigin))}`;
    });
    await step(`Pas, agrégat sur ${days} j`, async () => {
      const agg = await aggregateRecord({ recordType: "Steps", timeRangeFilter: since(days) });
      return `${agg.COUNT_TOTAL} pas, applis : ${origins(agg.dataOrigins ?? [])}`;
    });
    await step(`Sommeil sur ${days} j`, async () => {
      const page = await readRecords("SleepSession", { timeRangeFilter: since(days), pageSize: 1000 });
      return `${page.records.length} session(s), applis : ${origins(page.records.map((r) => r.metadata?.dataOrigin))}`;
    });
  }
  return lines;
}
