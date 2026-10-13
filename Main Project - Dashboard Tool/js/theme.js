"use strict";

const THEME_KEY = "ms-collabdash-theme";

function setTheme(theme) {
    const selectedTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = selectedTheme;
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
        const isLight = selectedTheme === "light";
        toggle.setAttribute("aria-pressed", String(isLight));
        toggle.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} theme`);
        toggle.textContent = `${isLight ? "Dark" : "Light"} theme`;
    }
}

function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, nextTheme);
    setTheme(nextTheme);
}

setTheme(localStorage.getItem(THEME_KEY) || "dark");
