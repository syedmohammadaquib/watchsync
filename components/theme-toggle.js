"use client";

import { useSyncExternalStore } from "react";

const THEME_STORAGE_KEY = "watchsync-theme";

function subscribe(callback) {
    window.addEventListener("watchsync-theme-change", callback);
    return () => window.removeEventListener("watchsync-theme-change", callback);
}

function getStoredTheme(defaultTheme) {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === "dark" || savedTheme === "light" ? savedTheme : defaultTheme;
}

export function useTheme(defaultTheme = "dark") {
    return useSyncExternalStore(
        subscribe,
        () => getStoredTheme(defaultTheme),
        () => defaultTheme,
    );
}

export default function ThemeToggle({ defaultTheme = "dark", selectedTheme, onThemeChange }) {
    const storedTheme = useTheme(defaultTheme);
    const theme = selectedTheme || storedTheme;

    function toggleTheme() {
        const nextTheme = theme === "dark" ? "light" : "dark";
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        window.dispatchEvent(new Event("watchsync-theme-change"));
        if (onThemeChange) {
            onThemeChange(nextTheme);
        }
    }

    return (
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"} data-theme={theme}>
            <span className={`theme-toggle-label ${theme === "light" ? "is-active" : ""}`}>Light</span>
            <span className="theme-toggle-track" aria-hidden="true">
                <span className="theme-toggle-thumb">
                    {theme === "dark" ? (
                        <svg viewBox="0 0 24 24"><path d="M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" /></svg>
                    ) : (
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
                    )}
                </span>
            </span>
            <span className={`theme-toggle-label ${theme === "dark" ? "is-active" : ""}`}>Dark</span>
        </button>
    );
}
