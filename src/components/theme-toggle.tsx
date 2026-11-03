"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "hiiiive-billing-theme";
const THEME_CHANGE_EVENT = "hiiiive-billing-theme-change";
const subscribe = (callback: () => void) => {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
};
const getTheme = (): Theme => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const getServerTheme = (): Theme => "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* The selected theme still applies for this visit. */ }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const targetTheme = theme === "dark" ? "light" : "dark";

  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${targetTheme} mode`} title={`${targetTheme === "dark" ? "Dark" : "Light"} mode`} aria-pressed={theme === "dark"}>
    {theme === "dark" ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><circle cx="12" cy="12" r="3.8" /><path d="M12 2.5v2M12 19.5v2M4.05 4.05l1.42 1.42m13.06 13.06 1.42 1.42M2.5 12h2m15 0h2M4.05 19.95l1.42-1.42M18.53 5.47l1.42-1.42" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M20.2 15.2A8.6 8.6 0 0 1 8.8 3.8 8.6 8.6 0 1 0 20.2 15.2Z" /></svg>}
  </button>;
}
