"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isMuted, setMuted as persistMuted } from "./sound";

type Theme = "light" | "dark";
interface Prefs { theme: Theme; toggleTheme: () => void; muted: boolean; toggleMuted: () => void }

const Ctx = createContext<Prefs>({ theme: "light", toggleTheme: () => {}, muted: false, toggleMuted: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let t: Theme = "light";
    try {
      const saved = localStorage.getItem("monumental:theme") as Theme | null;
      t = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch { /* ignore */ }
    setTheme(t);
    setMuted(isMuted());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("monumental:theme", theme); } catch { /* ignore */ }
  }, [theme]);

  return (
    <Ctx.Provider
      value={{
        theme,
        toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
        muted,
        toggleMuted: () => setMuted((m) => { persistMuted(!m); return !m; }),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const usePrefs = () => useContext(Ctx);
