import { useColorScheme } from "react-native";

export interface Theme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  danger: string;
}

const light: Theme = {
  background: "#f7f5f2",
  surface: "#ffffff",
  text: "#1c1b1a",
  muted: "#6b6660",
  border: "#e2ddd6",
  accent: "#2f5d62",
  onAccent: "#ffffff",
  danger: "#b3261e",
};

const dark: Theme = {
  background: "#141312",
  surface: "#1f1d1b",
  text: "#f2efea",
  muted: "#a39d95",
  border: "#34302c",
  accent: "#7fb7bc",
  onAccent: "#0f1a1b",
  danger: "#f2b8b5",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
