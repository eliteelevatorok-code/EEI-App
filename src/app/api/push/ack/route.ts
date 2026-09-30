export const runtime = "nodejs";

// A phone's background worker (public/sw.js) calls this right after an alert
// arrives: "shown", or why it couldn't be shown. It only writes one line to the
// server log (Vercel → Logs, search "[alerts-ack]"), so whether an alert reached
// the phone is a fact, not a guess. Public because the app may be closed (no
// login at that moment); it stores nothing and returns nothing.
export async function POST(req: Request) {
  const p = new URL(req.url).searchParams;
  const tag = (p.get("tag") ?? "").slice(0, 80);
  const result = (p.get("result") ?? "").slice(0, 200);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 80);
  console.log(`[alerts-ack] tag=${tag} result=${result} ua=${ua}`);
  return new Response(null, { status: 204 });
}
