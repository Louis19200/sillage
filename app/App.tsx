import { StatusBar } from "expo-status-bar";
import { useCallback, useState, type ReactNode } from "react";
import { StatusBar as RNStatusBar, StyleSheet, View } from "react-native";

import { DaysScreen } from "./src/screens/DaysScreen";
import { PermissionsScreen } from "./src/screens/PermissionsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { useTheme } from "./src/theme";

export default function App(): ReactNode {
  const t = useTheme();
  const [granted, setGranted] = useState(false);
  const onGranted = useCallback(() => setGranted(true), []);
  const [screen, setScreen] = useState<"days" | "settings">("days");
  const openSettings = useCallback(() => setScreen("settings"), []);
  const closeSettings = useCallback(() => setScreen("days"), []);

  return (
    <View
      style={[
        styles.root,
        // Android affiche l'app bord à bord : on laisse la place à la barre d'état.
        { backgroundColor: t.background, paddingTop: RNStatusBar.currentHeight ?? 0 },
      ]}
    >
      <StatusBar style="auto" />
      {!granted ? (
        <PermissionsScreen onGranted={onGranted} />
      ) : screen === "settings" ? (
        <SettingsScreen onBack={closeSettings} />
      ) : (
        <DaysScreen onOpenSettings={openSettings} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
