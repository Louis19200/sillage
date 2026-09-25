/**
 * Étape 4 : réglages de la synchro. URL de l'API et INGEST_TOKEN, stockés dans
 * expo-secure-store. Le token enregistré n'est jamais réaffiché.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { isInsecureRemoteUrl, normalizeBaseUrl } from "../api";
import { Button } from "../components";
import { captureDailyPosition, disabledStore, type LocationStore } from "../location";
import {
  realLocationDeps,
  requestLocationPermission,
  safeLoadLocationStore,
  saveLocationStore,
} from "../locationDevice";
import { deleteToken, loadSettings, saveApiUrl, saveToken } from "../settings";
import { useTheme } from "../theme";

export function SettingsScreen(props: { onBack: () => void }): ReactNode {
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [apiUrl, setApiUrl] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // Bouton « retour » d'Android : revenir au tableau plutôt que quitter l'app.
  const { onBack } = props;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setApiUrl(s.apiUrl);
        setHasToken(s.token.length > 0);
      })
      .catch((e: unknown) =>
        setMessage({ text: `Lecture des réglages impossible : ${String(e)}`, error: true })
      )
      .finally(() => setLoading(false));
  }, []);

  const normalized = normalizeBaseUrl(apiUrl);
  const insecure = normalized !== null && isInsecureRemoteUrl(normalized);

  async function save(): Promise<void> {
    if (!normalized) {
      setMessage({ text: "URL invalide : elle doit commencer par http:// ou https://.", error: true });
      return;
    }
    try {
      await saveApiUrl(normalized);
      setApiUrl(normalized);
      const token = newToken.trim();
      if (token.length > 0) {
        await saveToken(token);
        setHasToken(true);
        setNewToken("");
      }
      setMessage({ text: "Réglages enregistrés.", error: false });
    } catch (e) {
      setMessage({ text: `Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }

  async function forgetToken(): Promise<void> {
    try {
      await deleteToken();
      setHasToken(false);
      setMessage({ text: "Token effacé de ce téléphone.", error: false });
    } catch (e) {
      setMessage({ text: `Effacement impossible : ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }

  const inputStyle = [styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }];

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: t.text }]}>Réglages de synchro</Text>

      {loading ? (
        <ActivityIndicator color={t.accent} style={styles.spinner} />
      ) : (
        <View>
          <Text style={[styles.label, { color: t.text }]}>URL de l'API</Text>
          <TextInput
            style={inputStyle}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://mon-projet.vercel.app"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
          <Text style={[styles.help, { color: t.muted }]}>
            Production : l'URL HTTPS de Vercel. En développement : branche le téléphone en USB,
            lance « adb reverse tcp:8787 tcp:8787 » sur l'ordinateur et saisis
            http://localhost:8787. Seul le development build tolère le HTTP en clair.
          </Text>
          {insecure && (
            <Text style={[styles.help, { color: t.danger }]}>
              HTTP en clair vers une adresse distante : Android le bloquera dans un APK de
              production. Utilise HTTPS, ou localhost avec adb reverse.
            </Text>
          )}

          <Text style={[styles.label, { color: t.text }]}>Token (INGEST_TOKEN)</Text>
          <Text style={[styles.help, { color: hasToken ? t.text : t.muted }]}>
            {hasToken
              ? "Un token est enregistré (masqué). Saisis-en un nouveau pour le remplacer."
              : "Aucun token enregistré."}
          </Text>
          <TextInput
            style={inputStyle}
            value={newToken}
            onChangeText={setNewToken}
            placeholder={hasToken ? "Nouveau token (facultatif)" : "Colle la valeur d'INGEST_TOKEN"}
            placeholderTextColor={t.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
          />
          <Text style={[styles.help, { color: t.muted }]}>
            Stocké chiffré sur ce téléphone (expo-secure-store), jamais affiché ni envoyé
            ailleurs qu'à l'API.
          </Text>

          {message && (
            <Text style={[styles.message, { color: message.error ? t.danger : t.accent }]}>
              {message.text}
            </Text>
          )}

          <Button label="Enregistrer" onPress={() => void save()} />
          {hasToken && (
            <Button label="Effacer le token" variant="secondary" onPress={() => void forgetToken()} />
          )}

          <LocationSetting />
        </View>
      )}

      <Button label="Retour" variant="secondary" onPress={onBack} />
    </ScrollView>
  );
}

/**
 * Option « Envoyer ma position approximative (pour la météo) », désactivée par défaut.
 * L'activer demande la permission de localisation approximative ; la désactiver efface
 * toutes les positions encore sur le téléphone.
 */
function LocationSetting(): ReactNode {
  const t = useTheme();
  const [store, setStore] = useState<LocationStore | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void safeLoadLocationStore().then(setStore);
  }, []);

  async function toggle(on: boolean): Promise<void> {
    if (!store || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!on) {
        const next = disabledStore();
        await saveLocationStore(next);
        setStore(next);
        setBlocked(false);
        setMessage({ text: "Option désactivée : positions effacées de ce téléphone.", error: false });
        return;
      }
      const permission = await requestLocationPermission();
      if (permission !== "granted") {
        setBlocked(permission === "blocked");
        setMessage({
          text:
            permission === "blocked"
              ? "Permission refusée définitivement : autorise « Position » (approximative) dans les réglages Android de Sillage."
              : "Permission refusée : l'option reste désactivée.",
          error: true,
        });
        return;
      }
      const next: LocationStore = { ...store, enabled: true };
      await saveLocationStore(next);
      setStore(next);
      const capture = await captureDailyPosition(realLocationDeps, "current", new Date());
      if (capture.store) setStore(capture.store);
      setMessage({
        text:
          capture.outcome === "captured"
            ? `Option activée. Position du ${capture.date ?? "jour"} mémorisée (arrondie), envoyée une fois la journée finie.`
            : `Option activée. ${capture.message}`,
        error: false,
      });
    } catch (e) {
      setMessage({ text: `Réglage impossible : ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.switchRow}>
        <Text style={[styles.label, styles.switchLabel, { color: t.text }]}>
          Envoyer ma position approximative (pour la météo)
        </Text>
        {store ? (
          <Switch
            value={store.enabled}
            onValueChange={(v) => void toggle(v)}
            disabled={busy}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Envoyer ma position approximative (pour la météo)"
          />
        ) : (
          <ActivityIndicator color={t.accent} />
        )}
      </View>
      <Text style={[styles.help, { color: t.muted }]}>
        Ta position est arrondie sur le téléphone à ~1 km (2 décimales) avant d'être mémorisée ou
        envoyée, une seule par jour (jamais de trajet), et effacée du téléphone une fois envoyée.
      </Text>
      {store?.enabled && (
        <Text style={[styles.help, { color: t.muted }]}>
          Dernière position mémorisée : {store.lastCaptured ?? "aucune"} ; en attente d'envoi :{" "}
          {store.pending.length} jour{store.pending.length > 1 ? "s" : ""}.
        </Text>
      )}
      {message && (
        <Text style={[styles.message, { color: message.error ? t.danger : t.accent }]}>{message.text}</Text>
      )}
      {blocked && (
        <Button label="Ouvrir les réglages de Sillage" variant="secondary" onPress={() => void Linking.openSettings()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchLabel: { flex: 1 },
  container: { padding: 16, paddingTop: 24 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  spinner: { marginVertical: 32 },
  label: { fontSize: 15, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  help: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  message: { fontSize: 14, marginTop: 16 },
});
