export const runtime = "nodejs";

// Each time the app opens, the phone reports whether it can get alerts:
// notification permission, and whether it has an alert sign-up. Written to the
// server log only (Vercel → Logs), so a phone that isn't receiving alerts can be
// diagnosed without guessing. Login required (behind the app's login wall).
export async function POST(req: Request) {
  let s: Record<string, unknown> = {};
  try {
    s = (await req.json()) as Record<string, unknown>;
  } catch {
    /* log what we can */
  }
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 120);
  console.log(`[alerts-state] permission=${String(s.permission)} signedUp=${String(s.signedUp)} saved=${String(s.saved)} supported=${String(s.supported)} ua=${ua}`);
  return Response.json({ ok: true });
}
