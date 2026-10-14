import { syncBookings } from "@/lib/booking";
import { checkCalendly, fixCalendly } from "@/lib/calendlyCheck";
import { isMasterOn } from "@/lib/switches";

export const runtime = "nodejs";

// Settings → Calendly (signed-in only, see proxy.ts).
//   GET            — is the booking page offering days? If not, why, and what the fix would change.
//                    Also picks up new Calendly bookings right away (otherwise
//                    the hourly alert run does it), while the master switch is on.
//   POST {fix:true} — make that fix, then check again.
export async function GET() {
  let bookings: Awaited<ReturnType<typeof syncBookings>> | { error: string } | null = null;
  try {
    if (await isMasterOn()) bookings = await syncBookings();
  } catch (err) {
    bookings = { error: err instanceof Error ? err.message : String(err) };
  }
  return Response.json({ ...(await checkCalendly()), bookings });
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
