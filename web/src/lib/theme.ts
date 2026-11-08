import { create } from "zustand";
import { load, save } from "./storage";

export type ThemeMode = "light" | "dark" | "system";

/** Accent colors. `css` is written to HeroUI's --accent variable, `hex` is used in the 3D scene. */
export const ACCENTS = {
  clay: { label: "Clay", css: "oklch(0.66 0.13 42)", hex: "#D97757", fg: "var(--snow)" },
  blue: { label: "Blue", css: "oklch(0.62 0.195 253.83)", hex: "#3B82F6", fg: "var(--snow)" },
  violet: { label: "Purple", css: "oklch(0.58 0.2 293)", hex: "#8B5CF6", fg: "var(--snow)" },
  green: { label: "Green", css: "oklch(0.6 0.15 155)", hex: "#22A06B", fg: "var(--snow)" },
  rose: { label: "Rose", css: "oklch(0.62 0.2 10)", hex: "#E5487A", fg: "var(--snow)" },
  amber: { label: "Amber", css: "oklch(0.76 0.15 75)", hex: "#E8A23A", fg: "var(--eclipse)" },
} as const;

export type AccentName = keyof typeof ACCENTS;

type ThemeState = {
  mode: ThemeMode;
  accent: AccentName;
  /** Actual mode taking the system setting into account */
  isDark: boolean;
  /** The 3D scene is rendered at low resolution to give a pixel art look */
  pixel: boolean;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: AccentName) => void;
  setPixel: (p: boolean) => void;
};

const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolveDark(mode: ThemeMode) {
  return mode === "dark" || (mode === "system" && media.matches);
}

function apply(mode: ThemeMode, accent: AccentName) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveDark(mode));
  root.dataset.accent = accent;
}

const initialMode = load<ThemeMode>("theme.mode", "system");
const initialAccent = load<AccentName>("theme.accent", "clay");
apply(initialMode, initialAccent);

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  accent: initialAccent in ACCENTS ? initialAccent : "clay",
  isDark: resolveDark(initialMode),
  pixel: load("theme.pixel", true),
  setPixel: (pixel) => {
    save("theme.pixel", pixel);
    set({ pixel });
  },
  setMode: (mode) => {
    save("theme.mode", mode);
    apply(mode, get().accent);
    set({ mode, isDark: resolveDark(mode) });
  },
  setAccent: (accent) => {
    save("theme.accent", accent);
    apply(get().mode, accent);
    set({ accent });
  },
}));

media.addEventListener("change", () => {
  const { mode, accent } = useTheme.getState();
  apply(mode, accent);
  useTheme.setState({ isDark: resolveDark(mode) });
});
