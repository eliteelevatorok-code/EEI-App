// CUSTOMER PAGE TRACKER (Robert, 2026-10-28). The pages customers open from
// emails (/po, /maint, /pay) quietly report what happens on them — the page
// opening, each button tap, what the server answered, and any browser error —
// so when a customer says "the button did nothing", the dashboard's "Page log"
// tab shows exactly what their phone did instead of anyone guessing.
// Browser-only. Nothing here can block or slow the page: every report is
// fire-and-forget, and a failed report is simply dropped.

let page = "";
let token = "";
let listening = false;

// Call once when a customer page opens.
export function startPageLog(pageName: string, linkCode: string) {
  page = pageName;
  token = linkCode;
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("error", (ev) => logEvent("browser error", `${ev.message} (${(ev.filename || "").split("/").pop()}:${ev.lineno})`));
    window.addEventListener("unhandledrejection", (ev) => {
      const r = ev.reason as { message?: string } | undefined;
      logEvent("browser error", String(r?.message ?? ev.reason));
    });
  }
  logEvent("page opened", `${window.innerWidth}×${window.innerHeight}`);
}

// One line on the Page log: what happened, plus any detail.
export function logEvent(event: string, detail = "") {
  if (!token || typeof window === "undefined") return;
  const body = JSON.stringify({ t: token, page, e: event.slice(0, 60), d: detail.slice(0, 300), ua: navigator.userAgent.slice(0, 300) });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/pagelog", new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  fetch("/api/pagelog", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
