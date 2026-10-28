import { appendRow, ensureTab } from "@/lib/google";
import { cell, findByToken } from "@/lib/sheet";

export const runtime = "nodejs";

// Public, token-keyed: the customer pages (/po, /maint, /pay) report what
// happens on them here (see src/lib/pageLog.ts), one line per event on the
// dashboard's "Page log" tab. Only a real link code is logged — anything else
// is dropped, so outsiders can't fill the tab. Always answers 204: the page
// never waits on it or shows anything about it.
const TAB = "Page log";
const HEADER = ["When (Oklahoma)", "Page", "OK #", "Building", "What happened", "Detail", "Phone / browser", "Full browser info"];

// "Android · Gmail app browser", "iPhone · Safari" … from the browser's user agent.
function device(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : "other";
  const app = /GSA\//.test(ua)
    ? "Google app browser"
    : /; wv\)/.test(ua)
      ? "in-app browser (WebView)"
      : /FBAN|FBAV|Instagram/.test(ua)
        ? "Facebook/Instagram browser"
        : /EdgA?\//.test(ua)
          ? "Edge"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "browser";
  return `${os} · ${app}`;
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { t?: string; page?: string; e?: string; d?: string; ua?: string };
    const s = (v: unknown, max: number) => String(v ?? "").slice(0, max);
    const hit = await findByToken(s(b.t, 64));
    if (!hit) return new Response(null, { status: 204 });
    const ua = s(b.ua, 300);
    const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
    await ensureTab(TAB, HEADER);
    await appendRow(`'${TAB}'!A:H`, [when, s(b.page, 20), cell(hit.cells, "okla"), cell(hit.cells, "building"), s(b.e, 60), s(b.d, 300), device(ua), ua]);
  } catch (err) {
    console.error("[pagelog]", err);
  }
  return new Response(null, { status: 204 });
}
