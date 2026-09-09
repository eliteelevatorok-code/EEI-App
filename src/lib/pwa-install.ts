"use client";

// App-wide install state. The browser fires "beforeinstallprompt" once, early,
// right after load — long before the Settings popup opens. If we only listened
// inside Settings we'd miss it and the button could never appear. So we start
// listening at app startup (see initInstall(), called from AppBoot) and stash
// the event here for Settings to use whenever it opens.

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BIPEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mm || iosStandalone);
}

// Called once at app startup (AppBoot). Safe to call more than once.
export function initInstall(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  installed = detectStandalone();

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault(); // stop Chrome's mini-infobar; we drive the prompt ourselves
    deferred = e as BIPEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", () => {
    installed = detectStandalone();
    emit();
  });

  // Chrome (Android): if the PWA is already installed but being viewed in a
  // browser tab, no beforeinstallprompt fires. Ask the browser directly.
  const nav = window.navigator as unknown as {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string }>>;
  };
  nav.getInstalledRelatedApps?.()
    .then((apps) => {
      if (apps.some((a) => a.platform === "webapp")) {
        installed = true;
        emit();
      }
    })
    .catch(() => {});
}

export function subscribeInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getInstallState(): { installed: boolean; canInstall: boolean } {
  return { installed, canInstall: !installed && deferred !== null };
}

// Trigger the native install sheet. Returns true if the user accepted.
export async function triggerInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  deferred = null;
  if (choice.outcome === "accepted") installed = true;
  emit();
  return choice.outcome === "accepted";
}

// Is this an iOS device? (iOS Safari never fires beforeinstallprompt, so install
// there is only via the Share sheet — we show steps instead of a button.)
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as a Mac but has touch — catch that too.
  const iPadOS = navigator.platform === "MacIntel" && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return iOSDevice || iPadOS;
}
