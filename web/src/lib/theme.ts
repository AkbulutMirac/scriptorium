import { create } from "zustand";
import { load, save } from "./storage";

export type ThemeMode = "light" | "dark" | "system";

/** Vurgu renkleri. `css` HeroUI'ın --accent değişkenine yazılır, `hex` 3D sahnede kullanılır. */
export const ACCENTS = {
  clay: { label: "Kil", css: "oklch(0.66 0.13 42)", hex: "#D97757", fg: "var(--snow)" },
  blue: { label: "Mavi", css: "oklch(0.62 0.195 253.83)", hex: "#3B82F6", fg: "var(--snow)" },
  violet: { label: "Mor", css: "oklch(0.58 0.2 293)", hex: "#8B5CF6", fg: "var(--snow)" },
  green: { label: "Yeşil", css: "oklch(0.6 0.15 155)", hex: "#22A06B", fg: "var(--snow)" },
  rose: { label: "Gül", css: "oklch(0.62 0.2 10)", hex: "#E5487A", fg: "var(--snow)" },
  amber: { label: "Kehribar", css: "oklch(0.76 0.15 75)", hex: "#E8A23A", fg: "var(--eclipse)" },
} as const;

export type AccentName = keyof typeof ACCENTS;

type ThemeState = {
  mode: ThemeMode;
  accent: AccentName;
  /** Sistem ayarı da hesaba katılmış gerçek mod */
  isDark: boolean;
  /** 3D sahne düşük çözünürlükte çizilip piksel sanat görünümü verilir */
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
