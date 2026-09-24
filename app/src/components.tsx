import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "./theme";

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}): ReactNode {
  const t = useTheme();
  const primary = (props.variant ?? "primary") === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: t.accent }
          : { borderColor: t.accent, borderWidth: StyleSheet.hairlineWidth * 2 },
        (pressed || props.disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.label, { color: primary ? t.onAccent : t.accent }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 12,
  },
  label: { fontSize: 16, fontWeight: "600" },
});
