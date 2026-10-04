"use client";

import { useSyncExternalStore } from "react";

/** Whether the window is at least `px` wide, kept current; a server render counts as wide. */
export function useWide(px: number) {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => true,
  );
}
