import { createContext, useContext, useEffect, useState } from "react";

/** User preference. "system" follows the OS colour scheme (ChatGPT default). */
export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "system";

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (isTheme(stored)) return stored;
    } catch {
      /* storage unavailable */
    }
    return defaultTheme;
  });
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Track OS colour-scheme changes so "system" stays live.
  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;

    // Mobile browser / PWA chrome (status + nav bars) follow theme-color, not CSS.
    const applyChromeColor = () => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && bg) meta.setAttribute("content", bg);

      const apple = document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      );
      if (apple) {
        apple.setAttribute(
          "content",
          resolvedTheme === "dark" ? "black-translucent" : "default",
        );
      }
    };

    // Wait a frame so theme CSS variables are applied before reading background.
    const id = requestAnimationFrame(applyChromeColor);
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  const value: ThemeProviderState = {
    theme,
    resolvedTheme,
    setTheme: (next: Theme) => {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable */
      }
      setThemeState(next);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
