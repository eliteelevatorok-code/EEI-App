import { BookingError, confirmBooking, pickOtherDays } from "@/lib/booking";
import { CalendlyError } from "@/lib/calendly";
import { FIRST_ROW, NoSuchRow } from "@/lib/sheet";

export const runtime = "nodejs";

// A Calendly booking waiting for Robert (signed-in only, see proxy.ts):
//   POST { row, okla, action: "confirm" }                       — "Yes, that works"
//   POST { row, okla, action: "other", days, from, to }         — "Pick other days"
// See src/lib/booking.ts.
export async function POST(req: Request) {
  let body: { row?: number; okla?: string; action?: string; days?: unknown; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const row = Number(body.row);
  if (!Number.isInteger(row) || row < FIRST_ROW || row > 100000) return Response.json({ error: "Bad row" }, { status: 400 });
  const okla = String(body.okla ?? "").trim();
  if (!okla) return Response.json({ error: "Missing elevator" }, { status: 400 });
  try {
    if (body.action === "confirm") return Response.json({ ok: true, ...(await confirmBooking(row, okla)) });
    if (body.action === "other") {
      const days = Array.isArray(body.days) ? body.days.map(String) : [];
      return Response.json({ ok: true, ...(await pickOtherDays(row, okla, days, String(body.from ?? ""), String(body.to ?? ""))) });
    }
    return Response.json({ error: "Bad action" }, { status: 400 });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof BookingError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof CalendlyError) return Response.json({ error: err.message }, { status: 502 });
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
