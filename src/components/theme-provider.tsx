"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Phase 1 of the dashboard light-theme migration: the app now
 * defaults to `light` and no longer respects system prefers-dark
 * or an older `theme=dark` in localStorage. Keeping the context +
 * `toggle` API in place so later phases can re-enable a theme
 * switcher without touching every consumer.
 */

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
