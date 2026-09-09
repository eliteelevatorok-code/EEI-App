"use client";

import { useEffect } from "react";
import { FONT_SCALE_KEY, applyFontScale } from "@/lib/prefs";
import { initInstall } from "@/lib/pwa-install";

// Runs once on load: registers the service worker (makes the app installable +
// offline-safe), starts listening for the install prompt so Settings can offer
// it later, and re-applies the saved text size so it survives reloads.
export function AppBoot() {
  useEffect(() => {
    initInstall();
    try {
      const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
      if (saved) applyFontScale(saved);
    } catch {
      /* storage may be unavailable */
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
