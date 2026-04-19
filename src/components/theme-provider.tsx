"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Persists the user's theme choice across page loads via localStorage.
 * Initial render defaults to "light" — a matching pre-hydration inline
 * script in `src/app/layout.tsx` reads localStorage BEFORE React paints
 * and sets the `dark` class on <html> so returning dark-theme users
 * don't see a flash-of-light-theme on every refresh. Keep the two in
 * sync: same storage key, same class name.
 *
 * We intentionally don't read prefers-color-scheme here — the light-
 * theme migration made light the explicit default, and respecting the
 * system preference would override users who opted into light on a
 * system that's set to dark.
 */

type Theme = "light" | "dark";

const STORAGE_KEY = "securewarp-theme";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Hydrate from localStorage on mount. The pre-hydration script in
  // layout.tsx has already set the `dark` class on <html> for returning
  // dark users, so this state sync doesn't cause any visible flicker —
  // it just brings the React tree in line with the DOM.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {
      // localStorage disabled / privacy mode — silently keep the light
      // default.
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
