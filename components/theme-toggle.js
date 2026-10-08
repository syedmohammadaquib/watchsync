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

export function useTheme(defaultTheme = "light") {
    return useSyncExternalStore(
        subscribe,
        () => getStoredTheme(defaultTheme),
        () => defaultTheme,
    );
}

export default function ThemeToggle({ defaultTheme = "light" }) {
    const theme = useTheme(defaultTheme);

    function toggleTheme() {
        const nextTheme = theme === "dark" ? "light" : "dark";
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        window.dispatchEvent(new Event("watchsync-theme-change"));
    }

    return (
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            <span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
            {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
    );
}
