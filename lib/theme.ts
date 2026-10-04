export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "thursday.theme";

/** What the app draws until someone picks: the maintainer's pick (09-29), light over the OS's. */
export const DEFAULT_THEME: Theme = "light";

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})||${JSON.stringify(DEFAULT_THEME)};var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.classList.toggle("dark",d);h.style.colorScheme=d?"dark":"light"}catch(e){}})();`;
