/**
 * Réglages et état de synchro, stockés avec expo-secure-store (chiffrés par le Keystore
 * Android). Le token ne quitte ce module que pour l'en-tête `Authorization`.
 */
import * as SecureStore from "expo-secure-store";

import { healthConnectReader } from "./healthConnect";
import { parseSyncState, runSync, type Settings, type SyncKind, type SyncRecord, type SyncState } from "./sync";

// Clés SecureStore : lettres, chiffres, « . », « - » et « _ » uniquement.
const KEY_API_URL = "sillage.apiUrl";
const KEY_TOKEN = "sillage.ingestToken";
const KEY_SYNC_STATE = "sillage.syncState";

export async function loadSettings(): Promise<Settings> {
  const [apiUrl, token] = await Promise.all([
    SecureStore.getItemAsync(KEY_API_URL),
    SecureStore.getItemAsync(KEY_TOKEN),
  ]);
  return { apiUrl: apiUrl ?? "", token: token ?? "" };
}

export async function saveApiUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_API_URL, url);
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_TOKEN, token);
}

export async function deleteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_TOKEN);
}

export async function loadSyncState(): Promise<SyncState> {
  try {
    return parseSyncState(await SecureStore.getItemAsync(KEY_SYNC_STATE));
  } catch {
    return { lastAttempt: null, lastSuccess: null };
  }
}

/** SecureStore déconseille les valeurs de plus de 2 Ko : on borne les détails d'erreur. */
function compact(r: SyncRecord | null): SyncRecord | null {
  if (!r) return null;
  return {
    ...r,
    message: r.message.slice(0, 300),
    details: r.details.slice(0, 5).map((d) => d.slice(0, 120)),
  };
}

async function saveSyncState(state: SyncState): Promise<void> {
  const value = JSON.stringify({
    lastAttempt: compact(state.lastAttempt),
    lastSuccess: compact(state.lastSuccess),
  });
  await SecureStore.setItemAsync(KEY_SYNC_STATE, value);
}

/** Synchro réelle : Health Connect + fetch du téléphone + SecureStore. */
export function syncNow(kind: SyncKind): Promise<SyncRecord> {
  return runSync(kind, {
    reader: healthConnectReader,
    fetch: (url, init) => fetch(url, init),
    loadSettings,
    loadState: loadSyncState,
    saveState: saveSyncState,
  });
}
