import { checkCalendly, fixCalendly } from "@/lib/calendlyCheck";

export const runtime = "nodejs";

// Settings → Calendly (signed-in only, see proxy.ts).
//   GET            — is the booking page offering times? If not, why, and what the fix would change.
//   POST {fix:true} — make that fix (after Robert's "Are you sure?"), then check again.
export async function GET() {
  return Response.json(await checkCalendly());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { fix?: boolean };
  if (!body.fix) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const done = await fixCalendly();
    return Response.json({ ok: true, done, check: await checkCalendly() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Fix failed" }, { status: 502 });
  }
}
