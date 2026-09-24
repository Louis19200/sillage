/**
 * Étape 2 : Health Connect est-il là ? Si non, proposer de l'installer.
 * Puis demander la lecture des pas (Steps) et du sommeil (SleepSession).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";

import { Button } from "../components";
import {
  checkAvailability,
  hasReadPermissions,
  openHealthConnectInStore,
  openHealthConnectSettings,
  requestReadPermissions,
} from "../healthConnect";
import { useTheme } from "../theme";

type State =
  | { kind: "checking" }
  | { kind: "needs-install" }
  | { kind: "unavailable" }
  | { kind: "needs-permission"; deniedOnce: boolean }
  | { kind: "error"; message: string };

export function PermissionsScreen(props: { onGranted: () => void }): ReactNode {
  const t = useTheme();
  const { onGranted } = props;
  const [state, setState] = useState<State>({ kind: "checking" });
  // La fenêtre de permission met l'app en arrière-plan : pas de revérification pendant ce temps.
  const asking = useRef(false);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const availability = await checkAvailability();
      if (availability !== "available") {
        setState({ kind: availability });
        return;
      }
      if (await hasReadPermissions()) onGranted();
      else setState({ kind: "needs-permission", deniedOnce: false });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [onGranted]);

  useEffect(() => {
    void check();
    // Au retour du Play Store ou des réglages Health Connect, on revérifie.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && !asking.current) void check();
    });
    return () => sub.remove();
  }, [check]);

  const ask = async () => {
    asking.current = true;
    try {
      if (await requestReadPermissions()) onGranted();
      else setState({ kind: "needs-permission", deniedOnce: true });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      asking.current = false;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: t.text }]}>Accès à Health Connect</Text>

      {state.kind === "checking" && <ActivityIndicator color={t.accent} style={styles.spinner} />}

      {state.kind === "needs-install" && (
        <>
          <Text style={[styles.body, { color: t.text }]}>
            Health Connect n'est pas installé ou doit être mis à jour. Sillage en a besoin pour
            lire tes pas et ton sommeil.
          </Text>
          <Button label="Installer Health Connect" onPress={() => void openHealthConnectInStore()} />
          <Button label="Vérifier à nouveau" variant="secondary" onPress={() => void check()} />
        </>
      )}

      {state.kind === "unavailable" && (
        <>
          <Text style={[styles.body, { color: t.text }]}>
            Health Connect n'est pas disponible sur cet appareil (Android 8 minimum, profil
            principal). Si tu penses que c'est une erreur, essaie de l'installer depuis le Play
            Store.
          </Text>
          <Button label="Ouvrir le Play Store" onPress={() => void openHealthConnectInStore()} />
          <Button label="Vérifier à nouveau" variant="secondary" onPress={() => void check()} />
        </>
      )}

      {state.kind === "needs-permission" && (
        <>
          <Text style={[styles.body, { color: t.text }]}>
            Sillage lit uniquement tes <Text style={styles.bold}>pas</Text> et tes{" "}
            <Text style={styles.bold}>sessions de sommeil</Text>. Rien n'est écrit dans Health
            Connect et, à cette étape, rien ne quitte le téléphone.
          </Text>
          <Button label="Autoriser la lecture" onPress={() => void ask()} />
          {state.deniedOnce && (
            <>
              <Text style={[styles.hint, { color: t.muted }]}>
                Les deux autorisations sont nécessaires. Si la fenêtre ne s'affiche plus
                (Android la bloque après deux refus), active-les à la main dans Health Connect.
              </Text>
              <Button
                label="Ouvrir les réglages Health Connect"
                variant="secondary"
                onPress={() => openHealthConnectSettings()}
              />
            </>
          )}
        </>
      )}

      {state.kind === "error" && (
        <>
          <Text style={[styles.body, { color: t.danger }]}>Erreur : {state.message}</Text>
          <Button label="Réessayer" onPress={() => void check()} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 23 },
  bold: { fontWeight: "700" },
  hint: { fontSize: 14, lineHeight: 20, marginTop: 16 },
  spinner: { marginTop: 24 },
});
