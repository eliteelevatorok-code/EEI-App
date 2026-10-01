"use client";

import { useEffect } from "react";
import { applyFontScale, currentFontScale } from "@/lib/prefs";
import { initInstall } from "@/lib/pwa-install";
import { resyncAlerts } from "@/lib/push-client";

// Runs once on load: registers the service worker (makes the app installable +
// offline-safe), starts listening for the install prompt so Settings can offer
// it later, and re-applies the saved text size so it survives reloads.
export function AppBoot() {
  useEffect(() => {
    initInstall();
    applyFontScale(currentFontScale());
    // Live site only: while developing, file names don't change between edits, so
    // the worker's "serve from the phone" rule would show stale code.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      // If this phone has alerts on, make sure the server's list still has it.
      // (Customer pages never have alerts on, so they skip this.)
      if (!/^\/(po|maint|pay|privacy|terms)/.test(location.pathname)) resyncAlerts().catch(() => {});
    }
  }, []);
  return null;
}
